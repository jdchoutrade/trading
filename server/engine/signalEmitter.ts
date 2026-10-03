import { DeepSeekReview, FullAnalysisResult, SignalAgreement, SignalEntity, SignalSource } from '../types.ts';
import { sqliteStore } from '../db/sqliteStore.ts';
import { liveOutcomeTracker } from '../market/outcomeTracker.ts';
import { getSignalSourceConfig } from './sourceConfig.ts';
import { countTechnicalPasses, hasDirectionalSmcSetup } from './signalQualification.ts';
import { formatSourceSignalGroupHtml, sendTelegramHtmlMessage } from '../telegram/bot.ts';

export interface SignalCreatedEvent {
  type: 'signal_created';
  groupId: string;
  agreement: SignalAgreement;
  signals: SignalEntity[];
}

export interface LiveAiReviewEvent {
  type: 'AI_REVIEW';
  symbol: string;
  timeframe: FullAnalysisResult['timeframe'];
  currentPrice: number;
  review: DeepSeekReview;
}

type PreparedSignal = Omit<SignalEntity, 'snapshotHash' | 'prevHash' | 'source' | 'hashVersion'>;

export class SignalEmitter {
  private readonly signalCreatedListeners = new Set<(event: SignalCreatedEvent) => void>();
  private readonly aiReviewListeners = new Set<(event: LiveAiReviewEvent) => void>();
  private readonly liveSignalBars = new Set<string>();
  private readonly checkedLiveSignalBars = new Set<string>();
  private latestLiveAiReview: LiveAiReviewEvent | null = null;

  private readonly timeframeSeconds: Record<FullAnalysisResult['timeframe'], number> = {
    '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, D: 86400,
  };

  public onSignalCreated(listener: (event: SignalCreatedEvent) => void) {
    this.signalCreatedListeners.add(listener);
    return () => this.signalCreatedListeners.delete(listener);
  }

  public onAiReview(listener: (event: LiveAiReviewEvent) => void) {
    this.aiReviewListeners.add(listener);
    return () => this.aiReviewListeners.delete(listener);
  }

  public publishLiveAiReview(analysis: FullAnalysisResult, review: DeepSeekReview) {
    const event: LiveAiReviewEvent = {
      type: 'AI_REVIEW',
      symbol: analysis.symbol,
      timeframe: analysis.timeframe,
      currentPrice: analysis.currentPrice,
      review,
    };
    this.latestLiveAiReview = event;
    for (const listener of this.aiReviewListeners) listener(event);
  }

  public getLatestLiveAiReview() {
    return this.latestLiveAiReview;
  }

  private prepare(
    source: Exclude<SignalSource, 'UNKNOWN_LEGACY'>,
    analysis: FullAnalysisResult,
    candleCloseTs: number,
    aiReview?: DeepSeekReview | null,
    phase: 'CLOSED' | 'LIVE' = 'CLOSED'
  ): PreparedSignal | null {
    const config = getSignalSourceConfig(source);
    const plan = analysis.tradePlan;
    const stages = analysis.analysisStages || [];
    if (stages.find((stage) => stage.index === 12)?.status === 'WAIT') return null;
    if (source === 'ANALYSIS') {
      const stageByIndex = new Map(stages.map((stage) => [stage.index, stage]));
      if (stages.length !== 12 || stageByIndex.get(1)?.status === 'FAIL' || stageByIndex.get(11)?.status !== 'PASS') return null;
    }
    if (!config.enabled || candleCloseTs <= 0 || analysis.isStale || analysis.isPriceDivergent || analysis.hardBlockReason || !plan || !plan.riskRewardValid || !analysis.signalLock.isLocked) return null;

    const direction = analysis.verdict === 'BUY' || analysis.verdict === 'SELL' ? analysis.verdict : null;
    if (!direction) return null;
    const score = direction === 'BUY' ? analysis.buyScore : analysis.sellScore;
    const grade = analysis.grade;
    const gradeOrder = { 'A+': 5, A: 4, B: 3, C: 2, X: 1 } as const;
    const minGradeOrder = { 'A+': 5, A: 4, B: 3, C: 2, X: 1 } as const;
    if (score < config.minScore || gradeOrder[grade] < minGradeOrder[config.minGrade]) return null;

    const factorsForDirection = direction === 'BUY' ? analysis.buyFactors : analysis.sellFactors;
    const technicalPasses = countTechnicalPasses(factorsForDirection);
    if (technicalPasses < config.minimumTechnicalPasses) return null;
    if (!hasDirectionalSmcSetup(factorsForDirection)) return null;

    const latest = sqliteStore.getAllSignals({ source, origin: 'engine_live', direction, limit: 1 }).signals[0];
    if (latest && candleCloseTs - latest.candleCloseTs < config.cooldownSeconds) return null;

    const factors = factorsForDirection
      .filter((factor) => factor.status === 'pass')
      .map((factor) => ({ code: factor.code, name: factor.name, reason: factor.reason, weight: factor.weight }));
    const modelReview = source === 'ANALYSIS' ? aiReview ?? undefined : undefined;
    const aiState: SignalEntity['aiState'] = source !== 'ANALYSIS'
      ? 'NOT_USED'
      : modelReview
        ? 'ONLINE'
        : 'RULE_FUSION_ONLY';
    const factorEvidence = factorsForDirection.map((factor) => ({
      code: factor.code,
      status: factor.status,
      scoreContribution: factor.scoreContribution,
      sourceProof: factor.sourceProof,
    }));
    const technicalCodes = new Set(['S', 'H', 'F', 'K', 'O', 'T', 'REG', '4H', 'D1', 'VWAP', 'MOM', 'RAIL']);
    const configVersion = `${source.toLowerCase()}-${config.version}`;
    const id = `${source.toLowerCase()}_${analysis.symbol}_${analysis.timeframe}_${candleCloseTs}_${direction}_${config.version}`;

    return {
      id,
      createdTs: candleCloseTs,
      candleCloseTs,
      symbol: analysis.symbol,
      sourceFeed: 'OANDA:XAUUSD',
      direction,
      triggerTf: analysis.timeframe,
      entryType: plan.entryType === 'LIMIT' ? 'LIMIT_RETEST' : 'MARKET',
      entryPrice: plan.entryPrice,
      sl: plan.stopLoss,
      tp1: plan.tp1,
      tp2: plan.tp2,
      tp3: plan.tp3,
      rrPlanned: plan.rr1,
      score,
      grade,
      regime: analysis.regime.type,
      session: analysis.session.currentSession,
      factors,
      weightsVersion: config.version,
      configVersion,
      aiVerdict: modelReview ? {
        verdict: modelReview.verdict,
        agreement: modelReview.agreement,
        modelUsed: modelReview.modelUsed,
        reviewedAt: modelReview.reviewedAt,
      } : undefined,
      priceFeedSnapshot: {
        primaryPrice: analysis.currentPrice,
        secondaryPrice: analysis.secondaryPrice,
        spread: analysis.spread,
        latencyMs: analysis.dataAgeMs,
      },
      mgmtPlan: {
        partialCloseTp1Percent: plan.partialCloseTp1Percent,
        partialCloseTp2Percent: plan.partialCloseTp2Percent,
        moveSlToBreakEvenAtTp1: plan.moveSlToBreakEvenAtTp1,
        maxCandlesTimeStop: plan.timeStopMaxCandles,
      },
      brokerOffset: 0,
      tags: ['algorithmic', grade.toLowerCase(), ...(phase === 'LIVE' ? ['intrabar-live'] : [])],
      origin: 'engine_live',
      agreement: 'SOLO',
      inputProvenance: {
        engineVersion: config.version,
        factorEvidence,
        technicalFactorCodes: factorEvidence.filter((factor) => technicalCodes.has(factor.code)).map((factor) => factor.code),
        contextFactorCodes: source === 'ANALYSIS'
          ? factorEvidence.filter((factor) => !technicalCodes.has(factor.code)).map((factor) => factor.code)
          : [],
        session: analysis.session.currentSession,
        regime: analysis.regime.type,
        riskOff: analysis.riskOff?.type ?? null,
        griIndex: analysis.griIndex,
        newsSources: source === 'ANALYSIS' ? (analysis.recentStories || []).map((story) => story.source) : [],
        quoteAgeMs: analysis.dataAgeMs,
        priceDivergenceAtr: analysis.priceDivergenceAtr,
        aiModel: modelReview?.modelUsed ?? null,
      },
      aiState,
    };
  }

  public emitClosedCandlePair(
    indicatorAnalysis: FullAnalysisResult,
    analysisAnalysis: FullAnalysisResult,
    candleCloseTs: number,
    aiReview?: DeepSeekReview | null
  ): SignalEntity[] {
    const barStartTs = candleCloseTs - this.timeframeSeconds[indicatorAnalysis.timeframe];
    const candidates = [
      { source: 'INDICATOR' as const, analysis: indicatorAnalysis },
      { source: 'ANALYSIS' as const, analysis: analysisAnalysis },
    ].filter(({ source, analysis }) => !this.hasLiveSignalForBar(source, analysis, barStartTs))
      .map(({ source, analysis }) => ({ source, signalInput: this.prepare(source, analysis, candleCloseTs, source === 'ANALYSIS' ? aiReview : undefined) }))
      .filter((candidate): candidate is { source: 'INDICATOR' | 'ANALYSIS'; signalInput: NonNullable<typeof candidate.signalInput> } => Boolean(candidate.signalInput));
    if (candidates.length === 0) return [];

    const groupId = `group_${indicatorAnalysis.symbol}_${indicatorAnalysis.timeframe}_${candleCloseTs}`;
    return this.persistCandidates(candidates, groupId);
  }

  public emitLivePair(
    indicatorAnalysis: FullAnalysisResult,
    analysisAnalysis: FullAnalysisResult,
    signalTs: number,
    formingBarStartTs: number,
  ): SignalEntity[] {
    for (const cache of [this.liveSignalBars, this.checkedLiveSignalBars]) {
      for (const key of cache) {
        const cachedBarStart = Number(key.slice(key.lastIndexOf('|') + 1));
        if (Number.isFinite(cachedBarStart) && formingBarStartTs - cachedBarStart > 24 * 60 * 60) cache.delete(key);
      }
    }
    const candidates = [
      { source: 'INDICATOR' as const, analysis: indicatorAnalysis },
      { source: 'ANALYSIS' as const, analysis: analysisAnalysis },
    ].filter(({ source, analysis }) => !this.hasLiveSignalForBar(source, analysis, formingBarStartTs))
      .map(({ source, analysis }) => ({ source, signalInput: this.prepare(source, analysis, signalTs, undefined, 'LIVE') }))
      .filter((candidate): candidate is { source: 'INDICATOR' | 'ANALYSIS'; signalInput: NonNullable<typeof candidate.signalInput> } => Boolean(candidate.signalInput));
    if (candidates.length === 0) return [];

    const groupId = `live_${indicatorAnalysis.symbol}_${indicatorAnalysis.timeframe}_${formingBarStartTs}`;
    const savedSignals = this.persistCandidates(candidates, groupId);
    for (const signal of savedSignals) {
      if (signal.tags.includes('intrabar-live')) {
        this.liveSignalBars.add(this.liveBarKey(signal.source, signal.symbol, signal.triggerTf, formingBarStartTs));
      }
    }
    return savedSignals;
  }

  private liveBarKey(source: SignalSource, symbol: string, timeframe: FullAnalysisResult['timeframe'], barStartTs: number) {
    return `${source}|${symbol}|${timeframe}|${barStartTs}`;
  }

  private hasLiveSignalForBar(source: Exclude<SignalSource, 'UNKNOWN_LEGACY'>, analysis: FullAnalysisResult, barStartTs: number): boolean {
    const key = this.liveBarKey(source, analysis.symbol, analysis.timeframe, barStartTs);
    if (this.liveSignalBars.has(key) || this.checkedLiveSignalBars.has(key)) return this.liveSignalBars.has(key);
    this.checkedLiveSignalBars.add(key);
    const period = this.timeframeSeconds[analysis.timeframe];
    const recentSignals = sqliteStore.getAllSignals({ source, origin: 'engine_live', limit: 500 }).signals;
    const alreadySaved = recentSignals.some((signal) => signal.tags.includes('intrabar-live')
      && signal.symbol === analysis.symbol
      && signal.triggerTf === analysis.timeframe
      && Math.floor(signal.createdTs / period) * period === barStartTs);
    if (alreadySaved) this.liveSignalBars.add(key);
    return alreadySaved;
  }

  private persistCandidates(
    candidates: Array<{ source: 'INDICATOR' | 'ANALYSIS'; signalInput: PreparedSignal }>,
    groupId: string,
  ): SignalEntity[] {
    const agreement: SignalAgreement = candidates.length === 1
      ? 'SOLO'
      : candidates[0].signalInput.direction === candidates[1].signalInput.direction
        ? 'BOTH_SAME_DIR'
        : 'OPPOSITE_DIR';
    const entries = candidates.map(({ source, signalInput }) => ({
      source,
      signalInput: { ...signalInput, groupId, agreement },
    }));
    const { signals: savedSignals, createdSignals } = sqliteStore.createFromEngineBatch(entries);
    for (const signal of savedSignals) {
      if (createdSignals.some((created) => created.id === signal.id)) {
        liveOutcomeTracker.registerSignal(signal);
      }
    }
    if (createdSignals.length > 0) {
      const event: SignalCreatedEvent = {
        type: 'signal_created',
        groupId,
        agreement,
        signals: createdSignals,
      };
      for (const listener of this.signalCreatedListeners) listener(event);
      void sendTelegramHtmlMessage(formatSourceSignalGroupHtml(createdSignals));
    }
    return savedSignals;
  }
}

export const signalEmitter = new SignalEmitter();
