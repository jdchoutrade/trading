import { Candle, Timeframe } from '../types.ts';
import { marketIntelligence } from '../intel/marketIntelligence.ts';
import { marketProvider } from '../market/dataProvider.ts';
import { tvFeed } from '../market/tvFeed.ts';
import { runFullAnalysisPipeline } from './pipeline.ts';
import { getSignalSourceConfig } from './sourceConfig.ts';
import { signalEmitter } from './signalEmitter.ts';
import { countTechnicalPasses, hasDirectionalSmcSetup } from './signalQualification.ts';
import { calculateATR } from './indicators.ts';
import { requestAiReview } from '../ai/deepseek.ts';

const triggerTimeframe: Timeframe = process.env.SIGNAL_TRIGGER_TF === '15m' ? '15m' : '5m';
const requestedLiveScanInterval = Number(process.env.LIVE_SIGNAL_SCAN_INTERVAL_MS);
const liveScanIntervalMs = Number.isFinite(requestedLiveScanInterval) && requestedLiveScanInterval >= 250
  ? Math.min(5000, requestedLiveScanInterval)
  : 750;
const liveAiReviewEnabled = process.env.LIVE_AI_REVIEW === 'true';
const liveAiReviewIntervalMs = 5 * 60_000;
const timeframeSeconds: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  D: 86400,
};

function closedCandles(candles: Candle[], latestClosed: Candle): Candle[] {
  const byTime = new Map(candles.filter((candle) => !candle.isForming).map((candle) => [candle.time, candle]));
  byTime.set(latestClosed.time, { ...latestClosed, isForming: false });
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function atOrBefore(candles: Candle[], closeTime: number): Candle[] {
  return candles.filter((candle) => !candle.isForming && candle.time <= closeTime);
}

function candlesWithLivePrice(timeframe: Timeframe, currentPrice: number): Candle[] {
  const stored = marketProvider.getCandles('XAUUSD', timeframe);
  const closed = stored.filter((candle) => !candle.isForming);
  const brokerOffset = marketProvider.getBrokerOffset();
  const feedForming = tvFeed.getFormingCandle(timeframe);
  const providerForming = stored.find((candle) => candle.isForming);
  const live = feedForming
    ? {
        ...feedForming,
        open: feedForming.open + brokerOffset,
        high: feedForming.high + brokerOffset,
        low: feedForming.low + brokerOffset,
        close: feedForming.close + brokerOffset,
      }
    : providerForming;
  if (!live) return stored;

  const liveBar: Candle = {
    ...live,
    high: Math.max(live.high, currentPrice),
    low: Math.min(live.low, currentPrice),
    close: currentPrice,
    isForming: true,
  };
  return [...closed.filter((candle) => candle.time !== liveBar.time), liveBar].sort((a, b) => a.time - b.time);
}

function runSourceAnalysis(
  currentPrice: number,
  candles: Candle[],
  multiTf: { m1: Candle[]; m5: Candle[]; m15: Candle[]; h1: Candle[]; h4: Candle[]; d1: Candle[] },
  symbolData: NonNullable<ReturnType<typeof marketProvider.getSymbolData>>,
  health: ReturnType<typeof marketProvider.getHealth>,
) {
  if (candles.length < 50) return null;
  const indicatorConfig = getSignalSourceConfig('INDICATOR');
  const analysisConfig = getSignalSourceConfig('ANALYSIS');
  if (!indicatorConfig.enabled && !analysisConfig.enabled) return null;

  const crossAssets = marketIntelligence.getCrossAssets();
  const correlations = marketIntelligence.getCorrelationMatrix();
  const stories = marketIntelligence.getStories(250);
  const scheduledEvents = marketIntelligence.getScheduledEvents();
  const calendarAvailable = marketIntelligence.getCalendarStatus().isAvailable;
  const riskLookbackBars = triggerTimeframe === '5m' ? 288 : 96;
  const historyForRisk = candles.length > riskLookbackBars ? candles[candles.length - 1 - riskLookbackBars] : undefined;
  const goldChangePercent = historyForRisk && historyForRisk.close > 0
    ? ((candles[candles.length - 1].close - historyForRisk.close) / historyForRisk.close) * 100
    : undefined;
  const riskOff = marketIntelligence.evaluateRiskOffClassification(goldChangePercent);
  const griIndex = marketIntelligence.getGriIndex();
  const atrSeries = calculateATR(candles, 14);
  const activeShock = marketIntelligence.checkUnscheduledShock(candles, atrSeries[atrSeries.length - 1] || 0, symbolData.spread);

  const common = {
    symbol: 'XAUUSD',
    timeframe: triggerTimeframe,
    currentPrice,
    candles,
    multiTf,
    spread: symbolData.spread,
    isStale: symbolData.isStale,
    isDelayed: symbolData.isDelayed || health.isDelayed,
    dataAgeMs: symbolData.latencyMs,
    secondaryFeedAvailable: Boolean(symbolData.secondaryPrice),
    secondaryPrice: (symbolData.secondaryPrice || symbolData.currentPrice) + marketProvider.getBrokerOffset(),
    isPriceDivergent: symbolData.isDivergent,
    divergenceAtr: symbolData.divergenceAtr || 0,
    riskOff,
    griIndex,
    crossAssets,
    correlations,
    macroData: marketIntelligence.getMacroData(),
    stories,
    scheduledEvents,
    calendarAvailable,
    activeShock: activeShock || undefined,
  };

  return {
    indicator: runFullAnalysisPipeline({ ...common, sourceWeights: indicatorConfig.weights }),
    analysis: runFullAnalysisPipeline({ ...common, sourceWeights: analysisConfig.weights }),
  };
}

let lastLiveAiReviewAt = 0;
let liveAiReviewInFlight = false;
function maybeRequestLiveAiReview(analysis: ReturnType<typeof runFullAnalysisPipeline>) {
  if (!liveAiReviewEnabled || liveAiReviewInFlight || (!process.env.DEEPSEEK_API_KEY && !process.env.GEMINI_API_KEY)) return;
  const config = getSignalSourceConfig('ANALYSIS');
  const direction = analysis.verdict === 'BUY' || analysis.verdict === 'SELL' ? analysis.verdict : undefined;
  if (!direction || !config.enabled || !analysis.signalLock.isLocked || !analysis.tradePlan?.riskRewardValid
    || analysis.isStale || analysis.isPriceDivergent || analysis.hardBlockReason) return;
  const score = direction === 'BUY' ? analysis.buyScore : analysis.sellScore;
  const gradeOrder = { 'A+': 5, A: 4, B: 3, C: 2, X: 1 } as const;
  const minimumGradeOrder = { 'A+': 5, A: 4, B: 3, C: 2, X: 1 } as const;
  if (score < config.minScore || gradeOrder[analysis.grade] < minimumGradeOrder[config.minGrade]) return;
  const factors = direction === 'BUY' ? analysis.buyFactors : analysis.sellFactors;
  if (countTechnicalPasses(factors) < config.minimumTechnicalPasses
    || !hasDirectionalSmcSetup(factors)) return;
  const stages = analysis.analysisStages || [];
  const stageByIndex = new Map(stages.map((stage) => [stage.index, stage]));
  if (stages.length !== 12 || stageByIndex.get(1)?.status === 'FAIL' || stageByIndex.get(11)?.status !== 'PASS' || stageByIndex.get(12)?.status === 'WAIT') return;
  const now = Date.now();
  if (now - lastLiveAiReviewAt < liveAiReviewIntervalMs) return;

  lastLiveAiReviewAt = now;
  liveAiReviewInFlight = true;
  void requestAiReview(analysis, undefined, { useCache: false })
    .then((review) => {
      if (review) signalEmitter.publishLiveAiReview(analysis, review);
    })
    .catch((error: unknown) => {
      console.warn('Live AI second-opinion review failed:', error instanceof Error ? error.message : 'unknown error');
    })
    .finally(() => { liveAiReviewInFlight = false; });
}

function analyzeClosedCandle(candle: Candle) {
  const health = marketProvider.getHealth();
  const symbolData = marketProvider.getSymbolData('XAUUSD');
  if (!symbolData || !health.isConnected || health.status !== 'LIVE' || health.isDelayed || health.isDelayed15m || symbolData.isStale) {
    return;
  }

  const closeTs = candle.time + timeframeSeconds[triggerTimeframe];
  if (closeTs > Math.floor(Date.now() / 1000)) return;

  const brokerOffset = marketProvider.getBrokerOffset();
  const offsetCandle = {
    ...candle,
    open: candle.open + brokerOffset,
    high: candle.high + brokerOffset,
    low: candle.low + brokerOffset,
    close: candle.close + brokerOffset,
    isForming: false,
  };
  const candles = closedCandles(marketProvider.getCandles('XAUUSD', triggerTimeframe), offsetCandle);
  if (candles.length < 50 || candles[candles.length - 1].time !== candle.time) return;

  const m1 = atOrBefore(marketProvider.getCandles('XAUUSD', '1m'), candle.time);
  const m5 = atOrBefore(marketProvider.getCandles('XAUUSD', '5m'), candle.time);
  const m15 = triggerTimeframe === '15m' ? candles : atOrBefore(marketProvider.getCandles('XAUUSD', '15m'), candle.time);
  const h1 = atOrBefore(marketProvider.getCandles('XAUUSD', '1h'), candle.time);
  const h4 = atOrBefore(marketProvider.getCandles('XAUUSD', '4h'), candle.time);
  const d1 = atOrBefore(marketProvider.getCandles('XAUUSD', 'D'), candle.time);
  const multiTf = { m1, m5, m15, h1, h4, d1 };
  const analyses = runSourceAnalysis(candles[candles.length - 1].close, candles, multiTf, symbolData, health);
  if (analyses) signalEmitter.emitClosedCandlePair(analyses.indicator, analyses.analysis, closeTs);
}

function analyzeLiveTick(currentPrice: number) {
  const health = marketProvider.getHealth();
  const symbolData = marketProvider.getSymbolData('XAUUSD');
  if (!symbolData || !health.isConnected || health.status !== 'LIVE' || health.isDelayed || health.isDelayed15m || symbolData.isStale) return;

  const candles = candlesWithLivePrice(triggerTimeframe, currentPrice);
  const forming = candles[candles.length - 1];
  if (!forming?.isForming) return;
  const multiTf = {
    m1: candlesWithLivePrice('1m', currentPrice),
    m5: candlesWithLivePrice('5m', currentPrice),
    m15: candlesWithLivePrice('15m', currentPrice),
    h1: candlesWithLivePrice('1h', currentPrice),
    h4: candlesWithLivePrice('4h', currentPrice),
    d1: candlesWithLivePrice('D', currentPrice),
  };
  const analyses = runSourceAnalysis(currentPrice, candles, multiTf, symbolData, health);
  if (analyses) {
    signalEmitter.emitLivePair(analyses.indicator, analyses.analysis, Math.floor(Date.now() / 1000), forming.time);
    maybeRequestLiveAiReview(analyses.analysis);
  }
}

let unsubscribe: (() => void) | undefined;
export function startSourceIngest(): () => void {
  if (unsubscribe) return unsubscribe;
  const unsubscribeCandles = tvFeed.onCandleClose((timeframe, candle) => {
    if (timeframe !== triggerTimeframe) return;
    try {
      analyzeClosedCandle(candle);
    } catch (error) {
      console.error('Closed-candle source analysis failed:', error);
    }
  });
  let lastLiveScanAt = 0;
  const unsubscribeTicks = marketProvider.subscribe((symbol, tick) => {
    if (symbol !== 'XAUUSD') return;
    const now = Date.now();
    if (now - lastLiveScanAt < liveScanIntervalMs) return;
    lastLiveScanAt = now;
    try {
      analyzeLiveTick(tick.price);
    } catch (error) {
      console.error('Intrabar source analysis failed:', error);
    }
  });
  unsubscribe = () => {
    unsubscribeCandles();
    unsubscribeTicks();
  };
  return unsubscribe;
}
