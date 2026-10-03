import { Router } from 'express';
import { runFullAnalysisPipeline } from './engine/pipeline.ts';
import { getSignalSourceConfig, updateSignalSourceConfig } from './engine/sourceConfig.ts';
import { marketProvider } from './market/dataProvider.ts';
import { marketIntelligence } from './intel/marketIntelligence.ts';
import { askQraAssistant, requestAiReview } from './ai/deepseek.ts';
import { dbStore } from './db/store.ts';
import { sqliteStore } from './db/sqliteStore.ts';
import { liveOutcomeTracker } from './market/outcomeTracker.ts';
import { StatsEngine } from './stats/statsEngine.ts';
import { formatSignalHtml, sendTelegramHtmlMessage } from './telegram/bot.ts';
import { Candle, SignalEntity, Timeframe } from './types.ts';
import { tvFeed } from './market/tvFeed.ts';
import { calculateATR } from './engine/indicators.ts';

export const apiRouter = Router();

function candlesWithLiveBar(symbol: string, timeframe: Timeframe, currentPrice: number): Candle[] {
  const closed = marketProvider.getCandles(symbol, timeframe).filter((candle) => !candle.isForming);
  if (symbol !== 'XAUUSD') return closed;
  const live = tvFeed.getFormingCandle(timeframe);
  if (!live) return closed;
  const offset = marketProvider.getBrokerOffset();
  const liveBar: Candle = {
    ...live,
    open: live.open + offset,
    high: Math.max(live.high + offset, currentPrice),
    low: Math.min(live.low + offset, currentPrice),
    close: currentPrice,
    isForming: true,
  };
  return [...closed.filter((candle) => candle.time !== liveBar.time), liveBar].sort((a, b) => a.time - b.time);
}

function currentGoldChangePercent(candles: Candle[], timeframe: Timeframe): number | undefined {
  const barsBack = timeframe === '1m' ? 1440 : timeframe === '5m' ? 288 : timeframe === '15m' ? 96 : 24;
  const current = candles.at(-1);
  const prior = candles[Math.max(0, candles.length - 1 - barsBack)];
  if (!current || !prior || prior.close <= 0 || candles.length <= barsBack) return undefined;
  return ((current.close - prior.close) / prior.close) * 100;
}

// GET all symbols & live status
apiRouter.get('/symbols', (req, res) => {
  const symbols = marketProvider.getAllSymbols();
  res.json({ success: true, symbols });
});

// GET current market snapshot with V2 intelligence + auto signal emitter
apiRouter.get('/snapshot', (req, res) => {
  const symbol = (req.query.symbol as string) || 'XAUUSD';
  const timeframe = (req.query.timeframe as Timeframe) || '15m';

  const symData = marketProvider.getSymbolData(symbol);
  if (!symData) {
    return res.status(404).json({ success: false, error: 'Symbol not found' });
  }

  const brokerOffset = marketProvider.getBrokerOffset();
  const currentPrice = symData.currentPrice + (symbol === 'XAUUSD' ? brokerOffset : 0);
  const candles = candlesWithLiveBar(symbol, timeframe, currentPrice);
  const multiTf = {
    m1: candlesWithLiveBar(symbol, '1m', currentPrice),
    m5: candlesWithLiveBar(symbol, '5m', currentPrice),
    m15: candlesWithLiveBar(symbol, '15m', currentPrice),
    h1: candlesWithLiveBar(symbol, '1h', currentPrice),
    h4: candlesWithLiveBar(symbol, '4h', currentPrice),
    d1: candlesWithLiveBar(symbol, 'D', currentPrice),
  };

  const crossAssets = marketIntelligence.getCrossAssets();
  const correlations = marketIntelligence.getCorrelationMatrix();
  const stories = marketIntelligence.getStories(250);

  const riskOff = marketIntelligence.evaluateRiskOffClassification(currentGoldChangePercent(candles, timeframe));
  const griIndex = marketIntelligence.getGriIndex();
  const atrSeries = calculateATR(candles, 14);
  const activeShock = marketIntelligence.checkUnscheduledShock(candles, atrSeries.at(-1) || 0, symData.spread);

  const pipelineInput = {
    symbol,
    timeframe,
    currentPrice,
    candles,
    multiTf,
    spread: symData.spread,
    isStale: symData.isStale,
    isDelayed: symData.isDelayed,
    dataAgeMs: symData.latencyMs,
    secondaryFeedAvailable: Boolean(symData.secondaryPrice),
    secondaryPrice: (symData.secondaryPrice ?? symData.currentPrice) + (symbol === 'XAUUSD' ? brokerOffset : 0),
    isPriceDivergent: symData.isDivergent,
    divergenceAtr: symData.divergenceAtr || 0,
    riskOff,
    griIndex,
    crossAssets,
    correlations,
    macroData: marketIntelligence.getMacroData(),
    stories,
    scheduledEvents: marketIntelligence.getScheduledEvents(),
    calendarAvailable: marketIntelligence.getCalendarStatus().isAvailable,
    activeShock: activeShock || undefined,
  };
  const analysisData = runFullAnalysisPipeline({
    ...pipelineInput,
    sourceWeights: getSignalSourceConfig('ANALYSIS').weights,
  });
  const indicatorData = runFullAnalysisPipeline({
    ...pipelineInput,
    sourceWeights: getSignalSourceConfig('INDICATOR').weights,
  });

  res.json({
    success: true,
    data: analysisData,
    indicatorData,
    analysisData,
    candles: candles.slice(-250), // last 250 candles
    formingCandle: candles.find((candle) => candle.isForming),
    brokerOffset,
  });
});

// V2: Desk Bundle Endpoint
apiRouter.get('/desk', (req, res) => {
  res.json({
    success: true,
    crossAssets: marketIntelligence.getCrossAssets(),
    correlations: marketIntelligence.getCorrelationMatrix(),
    macro: marketIntelligence.getMacroData(),
    riskOff: marketIntelligence.getRiskOff(),
    scenarios: marketIntelligence.getScenarios(),
    griIndex: marketIntelligence.getGriIndex(),
    recentStories: marketIntelligence.getStories().slice(0, 8),
    scheduledEvents: marketIntelligence.getScheduledEvents(),
    calendarStatus: marketIntelligence.getCalendarStatus(),
    activeShock: marketIntelligence.getActiveShock(),
  });
});

// V2: Market Intelligence Endpoint
apiRouter.get('/intel', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.min(marketIntelligence.getStoryCount(), Math.max(0, Number(req.query.offset) || 0));
  res.json({
    success: true,
    stories: marketIntelligence.getStories(limit, offset),
    totalStories: marketIntelligence.getStoryCount(),
    scheduledEvents: marketIntelligence.getScheduledEvents(),
    calendarStatus: marketIntelligence.getCalendarStatus(),
    scenarios: marketIntelligence.getScenarios(),
    riskOff: marketIntelligence.getRiskOff(),
    griIndex: marketIntelligence.getGriIndex(),
    activeShock: marketIntelligence.getActiveShock(),
  });
});

// Calibration & Factor Attribution
apiRouter.get('/calibration', (req, res) => {
  const result = dbStore.getCalibration();
  res.json({ success: true, ...result });
});

apiRouter.get('/factor-attribution', (req, res) => {
  const factors = dbStore.getFactorAttribution();
  res.json({ success: true, factors });
});

// Drawing tools storage
apiRouter.get('/drawings', (req, res) => {
  const symbol = (req.query.symbol as string) || 'XAUUSD';
  res.json({ success: true, drawings: dbStore.getDrawings(symbol) });
});

apiRouter.post('/drawings', (req, res) => {
  const drawing = req.body;
  drawing.id = `draw_${Date.now()}`;
  drawing.createdAt = Date.now();
  dbStore.saveDrawing(drawing);
  res.json({ success: true, drawing });
});

apiRouter.delete('/drawings/:id', (req, res) => {
  dbStore.deleteDrawing(req.params.id);
  res.json({ success: true });
});

// Health check endpoint
apiRouter.get('/health', (req, res) => {
  res.json({ success: true, health: marketProvider.getHealth() });
});

// Broker offset setting
apiRouter.post('/settings/offset', (req, res) => {
  const { offset } = req.body;
  if (typeof offset === 'number') {
    marketProvider.setBrokerOffset(offset);
    dbStore.setBrokerOffset(offset);
  }
  res.json({ success: true, offset: marketProvider.getBrokerOffset() });
});

// POST analyze (runs pipeline + AI review with token & latency measurement)
apiRouter.post('/analyze', async (req, res) => {
  try {
    const { symbol = 'XAUUSD', timeframe = '15m', apiKey } = req.body;
    const symData = marketProvider.getSymbolData(symbol);
    if (!symData) {
      return res.status(404).json({ success: false, error: 'Symbol not found' });
    }

    const brokerOffset = marketProvider.getBrokerOffset();
    const currentPrice = symData.currentPrice + (symbol === 'XAUUSD' ? brokerOffset : 0);
    const candles = candlesWithLiveBar(symbol, timeframe, currentPrice);
    const multiTf = {
      m1: candlesWithLiveBar(symbol, '1m', currentPrice),
      m5: candlesWithLiveBar(symbol, '5m', currentPrice),
      m15: candlesWithLiveBar(symbol, '15m', currentPrice),
      h1: candlesWithLiveBar(symbol, '1h', currentPrice),
      h4: candlesWithLiveBar(symbol, '4h', currentPrice),
      d1: candlesWithLiveBar(symbol, 'D', currentPrice),
    };

    const crossAssets = marketIntelligence.getCrossAssets();
    const correlations = marketIntelligence.getCorrelationMatrix();
    const stories = marketIntelligence.getStories(250);
    const riskOff = marketIntelligence.evaluateRiskOffClassification(currentGoldChangePercent(candles, timeframe));
    const griIndex = marketIntelligence.getGriIndex();
    const atrSeries = calculateATR(candles, 14);
    const activeShock = marketIntelligence.checkUnscheduledShock(candles, atrSeries.at(-1) || 0, symData.spread);

    const analysis = runFullAnalysisPipeline({
      symbol,
      timeframe,
      currentPrice,
      candles,
      multiTf,
      spread: symData.spread,
      isStale: symData.isStale,
      isDelayed: symData.isDelayed,
      dataAgeMs: symData.latencyMs,
      secondaryFeedAvailable: Boolean(symData.secondaryPrice),
      secondaryPrice: (symData.secondaryPrice ?? symData.currentPrice) + (symbol === 'XAUUSD' ? brokerOffset : 0),
      isPriceDivergent: symData.isDivergent,
      divergenceAtr: symData.divergenceAtr || 0,
      riskOff,
      griIndex,
      crossAssets,
      correlations,
      macroData: marketIntelligence.getMacroData(),
      stories,
      activeShock: activeShock || undefined,
      scheduledEvents: marketIntelligence.getScheduledEvents(),
      calendarAvailable: marketIntelligence.getCalendarStatus().isAvailable,
    });

    const review = await requestAiReview(analysis, apiKey, { allowRuleFallback: false, useCache: false });
    if (review) analysis.deepSeekReview = review;

    res.json({ success: true, data: analysis });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Analysis pipeline failed' });
  }
});

// POST setup (generate execution plan)
apiRouter.post('/setup', (req, res) => {
  const { symbol = 'XAUUSD', timeframe = '15m' } = req.body;
  const symData = marketProvider.getSymbolData(symbol);
  if (!symData) {
    return res.status(404).json({ success: false, error: 'Symbol not found' });
  }

  const candles = marketProvider.getCandles(symbol, timeframe);
  const analysis = runFullAnalysisPipeline({
    symbol,
    timeframe,
    currentPrice: symData.currentPrice,
    candles,
    spread: symData.spread,
    isStale: symData.isStale,
    dataAgeMs: symData.latencyMs,
  });

  res.json({
    success: true,
    data: {
      tradePlan: analysis.tradePlan,
      verdict: analysis.verdict,
      grade: analysis.grade,
      symbol,
      currentPrice: symData.currentPrice,
    },
  });
});

// Signals history, filtering & pagination (SQLite backed)
apiRouter.get('/signals', (req, res) => {
  const { source, origin, grade, session, regime, status, direction, limit, offset } = req.query;
  const result = sqliteStore.getAllSignals({
    source: source === 'CONFLUENCE' ? undefined : source as string,
    origin: (origin as string) || 'engine_live',
    agreement: source === 'CONFLUENCE' ? 'BOTH_SAME_DIR' : undefined,
    grade: grade as string,
    session: session as string,
    regime: regime as string,
    status: status as string,
    direction: direction as string,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  });

  res.json({ success: true, signals: result.signals, total: result.total });
});

// Single signal detail with events history and notes
apiRouter.get('/signals/:id', (req, res) => {
  const signal = sqliteStore.getSignal(req.params.id);
  if (!signal) {
    return res.status(404).json({ success: false, error: 'Signal not found' });
  }

  const events = sqliteStore.getSignalEvents(signal.id);
  const outcome = sqliteStore.getSignalOutcome(signal.id);
  const notes = sqliteStore.getSignalNotes(signal.id);

  res.json({
    success: true,
    signal: {
      ...signal,
      events,
      outcome: outcome || signal.outcome,
      notes: notes?.notes,
      tags: notes?.tags || signal.tags,
    },
  });
});

// Verify cryptographic hash integrity of a signal
apiRouter.get('/signals/:id/verify', (req, res) => {
  try {
    const result = sqliteStore.verifySignal(req.params.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// Verify entire hash chain integrity
apiRouter.get('/signals/chain/verify', (req, res) => {
  const result = sqliteStore.verifyChain();
  res.json({ success: true, ...result });
});

// Summary Statistics with Wilson CI, Expectancy, Sample Gating (Rule 2: n < 30 insufficient sample)
apiRouter.get('/signals/history/stats', (req, res) => {
  const source = (req.query.source as string) || 'ALL';
  const origin = (req.query.origin as string) || 'engine_live';
  const { signals } = sqliteStore.getAllSignals({
    source: source === 'ALL' || source === 'CONFLUENCE' ? undefined : source,
    origin,
    agreement: source === 'CONFLUENCE' ? 'BOTH_SAME_DIR' : undefined,
    limit: 10000,
  });
  let verifiedSignals = signals.filter((signal) => signal.source !== 'UNKNOWN_LEGACY');
  if (source === 'CONFLUENCE') {
    const byGroup = new Map<string, (typeof verifiedSignals)[number]>();
    for (const signal of verifiedSignals) {
      if (!signal.groupId) continue;
      const current = byGroup.get(signal.groupId);
      if (!current || signal.source === 'INDICATOR') byGroup.set(signal.groupId, signal);
    }
    verifiedSignals = [...byGroup.values()];
  }

  const summary = StatsEngine.calculateSummary(verifiedSignals, 30);
  const equityCurve = StatsEngine.calculateEquityCurve(verifiedSignals);
  const rDistribution = StatsEngine.calculateRDistribution(verifiedSignals);
  const mfeMaeScatter = StatsEngine.calculateMfeMaeScatter(verifiedSignals);
  const bySession = StatsEngine.calculateSegments(verifiedSignals, 'session');
  const byGrade = StatsEngine.calculateSegments(verifiedSignals, 'grade');
  const byRegime = StatsEngine.calculateSegments(verifiedSignals, 'regime');
  const byDirection = StatsEngine.calculateSegments(verifiedSignals, 'direction');

  res.json({
    success: true,
    summary,
    equityCurve,
    rDistribution,
    mfeMaeScatter,
    segments: {
      bySession,
      byGrade,
      byRegime,
      byDirection,
    },
  });
});

apiRouter.get('/signals/history/source-compare', (_req, res) => {
  const { signals: allSignals } = sqliteStore.getAllSignals({ origin: 'engine_live', limit: 10000 });
  const signals = allSignals.filter((signal) => signal.source !== 'UNKNOWN_LEGACY');
  const indicator = signals.filter((signal) => signal.source === 'INDICATOR');
  const analysis = signals.filter((signal) => signal.source === 'ANALYSIS');
  const groups = new Map<string, SignalEntity[]>();
  for (const signal of signals) {
    if (!signal.groupId) continue;
    const group = groups.get(signal.groupId) || [];
    group.push(signal);
    groups.set(signal.groupId, group);
  }

  const confluence = StatsEngine.selectConfluenceRepresentatives(signals);
  const soloIndicator = indicator.filter((signal) => signal.agreement === 'SOLO');
  const soloAnalysis = analysis.filter((signal) => signal.agreement === 'SOLO');
  const oppositeIndicator = indicator.filter((signal) => signal.agreement === 'OPPOSITE_DIR');
  const oppositeAnalysis = analysis.filter((signal) => signal.agreement === 'OPPOSITE_DIR');
  const resolved = (signal: SignalEntity) => signal.outcome?.rFinal !== undefined
    && !['PENDING', 'TRIGGERED', 'TP1_HIT', 'TP2_HIT'].includes(signal.outcome.status);
  const pairedDeltas: number[] = [];
  for (const group of groups.values()) {
    const indicatorSignal = group.find((signal) => signal.source === 'INDICATOR');
    const analysisSignal = group.find((signal) => signal.source === 'ANALYSIS');
    if (indicatorSignal && analysisSignal && resolved(indicatorSignal) && resolved(analysisSignal)) {
      pairedDeltas.push(analysisSignal.outcome!.rFinal! - indicatorSignal.outcome!.rFinal!);
    }
  }

  const summary = (rows: SignalEntity[]) => StatsEngine.calculateSummary(rows, 30);
  res.json({
    success: true,
    sources: {
      INDICATOR: summary(indicator),
      ANALYSIS: summary(analysis),
      CONFLUENCE: summary(confluence),
    },
    agreementMatrix: {
      BOTH_SAME_DIR: summary(confluence),
      SOLO_INDICATOR: summary(soloIndicator),
      SOLO_ANALYSIS: summary(soloAnalysis),
      OPPOSITE_INDICATOR: summary(oppositeIndicator),
      OPPOSITE_ANALYSIS: summary(oppositeAnalysis),
    },
    paired: {
      sampleCount: pairedDeltas.length,
      averageAnalysisMinusIndicatorR: pairedDeltas.length
        ? Number((pairedDeltas.reduce((total, value) => total + value, 0) / pairedDeltas.length).toFixed(2))
        : 0,
      isSampleSufficient: pairedDeltas.length >= 30,
      confidenceInterval: null,
    },
    sharedInputPercent: 100,
    independenceWarning: 'Both sources use the same XAUUSD candle/tick stream; source outcomes are not independent market samples.',
  });
});

// Currently open signals with live tracking data
apiRouter.get('/signals/history/open', (req, res) => {
  const openSignals = sqliteStore.getOpenSignals({ origin: 'engine_live' });
  res.json({ success: true, openSignals });
});

// Annotate signal notes / reflections
apiRouter.post('/signals/:id/notes', (req, res) => {
  const { notes, tags } = req.body;
  sqliteStore.setSignalNotes(req.params.id, notes || '', tags);
  res.json({ success: true });
});

// Export CSV of historical signals
apiRouter.get('/signals/export/csv', (req, res) => {
  const { signals } = sqliteStore.getAllSignals({ limit: 10000 });
  const headers = [
    'id',
    'source',
    'origin',
    'candle_close_ts',
    'group_id',
    'agreement',
    'ai_state',
    'created_ts',
    'symbol',
    'direction',
    'grade',
    'score',
    'entry_price',
    'sl',
    'tp1',
    'tp2',
    'tp3',
    'rr_planned',
    'status',
    'r_final',
    'mfe_r',
    'mae_r',
    'first_hit',
    'duration',
    'reconstructed',
    'ambiguous',
    'snapshot_hash',
  ];

  const rows = signals.map((s) => {
    const o = s.outcome;
    return [
      s.id,
      s.source,
      s.origin,
      s.candleCloseTs,
      s.groupId || '',
      s.agreement,
      s.aiState,
      new Date(s.createdTs * 1000).toISOString(),
      s.symbol,
      s.direction,
      s.grade,
      s.score,
      s.entryPrice,
      s.sl,
      s.tp1,
      s.tp2,
      s.tp3,
      s.rrPlanned,
      o?.status || 'PENDING',
      o?.rFinal ?? '',
      o?.rMaxMfe ?? '',
      o?.rMaxMae ?? '',
      o?.firstHit || 'none',
      o?.duration ?? '',
      o?.reconstructedFlag ? '1' : '0',
      o?.ambiguousFlag ? '1' : '0',
      s.snapshotHash,
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="signals_history.csv"');
  res.send(csvContent);
});

// Export JSON of historical signals
apiRouter.get('/signals/export/json', (req, res) => {
  const { signals } = sqliteStore.getAllSignals({ limit: 10000 });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="signals_history.json"');
  res.json({ success: true, signals });
});

// My Trades ("I took this" modal integration)
apiRouter.get('/my-trades', (req, res) => {
  const trades = sqliteStore.getMyTrades();
  res.json({ success: true, trades });
});

apiRouter.post('/my-trades', (req, res) => {
  const { signalId, takenTs, symbol, direction, actualEntry, actualSl, actualTp, lot, notes, screenshotRef } = req.body;
  const id = `my_${Date.now()}`;
  sqliteStore.addMyTrade({
    id,
    signalId: signalId || undefined,
    takenTs: takenTs || Math.floor(Date.now() / 1000),
    symbol: symbol || 'XAUUSD',
    direction: direction || 'BUY',
    actualEntry: Number(actualEntry),
    actualSl: Number(actualSl),
    actualTp: Number(actualTp),
    lot: Number(lot) || 0.1,
    notes,
    screenshotRef,
    status: 'OPEN',
  });
  res.json({ success: true, tradeId: id });
});

apiRouter.post('/my-trades/:id/close', (req, res) => {
  const { actualExit, exitTs, actualR, notes } = req.body;
  sqliteStore.closeMyTrade(
    req.params.id,
    Number(actualExit),
    exitTs || Math.floor(Date.now() / 1000),
    Number(actualR),
    notes
  );
  res.json({ success: true });
});

// Compare View: System Signals vs My Trades
apiRouter.get('/my-trades/compare', (req, res) => {
  const compare = sqliteStore.getCompareTrades();
  res.json({ success: true, compare });
});

// Telegram dispatch
apiRouter.post('/telegram/send', async (req, res) => {
  const { symbol = 'XAUUSD', timeframe = '15m', botToken, chatId } = req.body;
  const symData = marketProvider.getSymbolData(symbol);
  if (!symData) {
    return res.status(404).json({ success: false, error: 'Symbol not found' });
  }

  const candles = marketProvider.getCandles(symbol, timeframe);
  const analysis = runFullAnalysisPipeline({
    symbol,
    timeframe,
    currentPrice: symData.currentPrice,
    candles,
  });

  const messageHtml = formatSignalHtml(analysis);
  const result = await sendTelegramHtmlMessage(messageHtml, botToken, chatId);
  res.json(result);
});

// Interactive Ask QRA assistant
apiRouter.post('/ai/ask', async (req, res) => {
  try {
    const { question, symbol = 'XAUUSD', timeframe = '15m', history, apiKey } = req.body;
    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    const symData = marketProvider.getSymbolData(symbol);
    const candles = symData ? marketProvider.getCandles(symbol, timeframe) : [];
    const analysis = runFullAnalysisPipeline({
      symbol,
      timeframe,
      currentPrice: symData?.currentPrice || 2650,
      candles,
    });

    const reply = await askQraAssistant({
      question,
      snapshot: analysis,
      history,
      customApiKey: apiKey,
    });

    res.json({ success: true, reply });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'AI assistant error' });
  }
});

// Paper trades & Journal
apiRouter.get('/paper-trades', (req, res) => {
  res.json({
    success: true,
    trades: dbStore.getPaperTrades(),
    balance: dbStore.getAccountBalance(),
  });
});

apiRouter.post('/paper-trades', (req, res) => {
  const trade = req.body;
  trade.id = `trade_${Date.now()}`;
  trade.openTime = Math.floor(Date.now() / 1000);
  trade.status = 'OPEN';
  trade.pnl = 0;
  trade.pnlPips = 0;
  dbStore.addPaperTrade(trade);
  res.json({ success: true, trade });
});

apiRouter.post('/paper-trades/close', (req, res) => {
  const { id, reason = 'MANUAL', currentPrice } = req.body;
  dbStore.closePaperTrade(id, reason, currentPrice);
  res.json({ success: true });
});

// Live Trade Trackers (Spread-aware multi-stage execution)
apiRouter.get('/live-trackers', (req, res) => {
  res.json({
    success: true,
    trackers: dbStore.getLiveTrackers(),
  });
});

apiRouter.post('/live-trackers', (req, res) => {
  const tracker = req.body;
  if (!tracker.signalId) tracker.signalId = `tr_${Date.now()}`;
  dbStore.saveLiveTracker(tracker);
  res.json({ success: true, tracker });
});

// Weights configuration
apiRouter.get('/weights', (req, res) => {
  res.json({ success: true, weights: dbStore.getWeights() });
});

apiRouter.post('/weights', (req, res) => {
  dbStore.updateWeights(req.body.weights);
  res.json({ success: true });
});

apiRouter.get('/settings/signal-sources', (_req, res) => {
  res.json({
    success: true,
    sources: {
      INDICATOR: getSignalSourceConfig('INDICATOR'),
      ANALYSIS: getSignalSourceConfig('ANALYSIS'),
    },
  });
});

apiRouter.patch('/settings/signal-sources/:source', (req, res) => {
  const source = req.params.source;
  if (source !== 'INDICATOR' && source !== 'ANALYSIS') {
    return res.status(400).json({ success: false, error: 'Source must be INDICATOR or ANALYSIS.' });
  }
  try {
    const config = updateSignalSourceConfig(source, req.body);
    res.json({ success: true, config });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Invalid source config.' });
  }
});

// Backtest simulation engine
apiRouter.post('/backtest', (req, res) => {
  const { symbol = 'XAUUSD', timeframe = '15m', lookback = 100 } = req.body;
  const allCandles = marketProvider.getCandles(symbol, timeframe);

  if (allCandles.length < 50) {
    return res.status(400).json({ success: false, error: 'Insufficient candles for backtest' });
  }

  const testCandles = allCandles.slice(-Math.min(lookback, allCandles.length));
  const simSignals: any[] = [];
  let balance = 10000;
  let wins = 0;
  let losses = 0;

  for (let i = 35; i < testCandles.length - 5; i++) {
    const windowCandles = testCandles.slice(0, i + 1);
    const curPrice = windowCandles[windowCandles.length - 1].close;

    const analysis = runFullAnalysisPipeline({
      symbol,
      timeframe,
      currentPrice: curPrice,
      candles: windowCandles,
    });

    if ((analysis.grade === 'A+' || analysis.grade === 'A') && analysis.tradePlan) {
      const plan = analysis.tradePlan;
      const futureCandles = testCandles.slice(i + 1, i + 10);
      let outcome: 'TP1' | 'TP2' | 'SL' | 'EXPIRED' = 'EXPIRED';

      for (const fc of futureCandles) {
        if (analysis.verdict === 'BUY') {
          if (fc.high >= plan.tp1) {
            outcome = fc.high >= plan.tp2 ? 'TP2' : 'TP1';
            break;
          }
          if (fc.low <= plan.stopLoss) {
            outcome = 'SL';
            break;
          }
        } else if (analysis.verdict === 'SELL') {
          if (fc.low <= plan.tp1) {
            outcome = fc.low <= plan.tp2 ? 'TP2' : 'TP1';
            break;
          }
          if (fc.high >= plan.stopLoss) {
            outcome = 'SL';
            break;
          }
        }
      }

      const pnl = outcome.startsWith('TP') ? 100 * (outcome === 'TP2' ? plan.rr2 : plan.rr1) : -100;
      balance += pnl;
      if (pnl > 0) wins++;
      else losses++;

      simSignals.push({
        time: windowCandles[windowCandles.length - 1].time,
        direction: analysis.verdict,
        grade: analysis.grade,
        score: analysis.verdict === 'BUY' ? analysis.buyScore : analysis.sellScore,
        entryPrice: plan.entryPrice,
        stopLoss: plan.stopLoss,
        tp1: plan.tp1,
        outcome,
        pnl,
        balance,
      });

      i += 4;
    }
  }

  const winRate = wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
  res.json({
    success: true,
    stats: {
      totalTrades: wins + losses,
      wins,
      losses,
      winRate,
      finalBalance: Number(balance.toFixed(2)),
      netPnl: Number((balance - 10000).toFixed(2)),
    },
    signals: simSignals,
  });
});
