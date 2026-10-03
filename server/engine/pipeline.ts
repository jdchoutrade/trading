import {
  Candle,
  CorrelationMatrixItem,
  CrossAssetQuote,
  FullAnalysisResult,
  MacroDataPoint,
  MarketNewsStory,
  RiskOffClassification,
  ScheduledEconomicEvent,
  ShockAlert,
  Timeframe,
} from '../types.ts';
import { calculateATR } from './indicators.ts';
import { detectMarketRegime } from './L1_regime.ts';
import { analyzeMultiTimeframe } from './L2_multitimeframe.ts';
import { identifyLiquidityLevels } from './L3_liquidity.ts';
import { detectBOSAndCHoCH, detectFVGs, detectLiquiditySweeps, detectOrderBlocks } from './L4_smc.ts';
import { analyzeCandlePatterns, analyzeMomentum, analyzeVolumeAndVWAP } from './L5_L8_patterns.ts';
import { analyzeSession } from './L9_session.ts';
import { evaluateConfirmations } from './L10_confirmation.ts';
import { computeSignalAndTradePlan } from './L11_scoring.ts';
import { RegimeWeightsConfig } from './defaultWeights.ts';

export interface PipelineMultiTfCandles {
  m1?: Candle[];
  m5?: Candle[];
  m15?: Candle[];
  h1?: Candle[];
  h4?: Candle[];
  d1?: Candle[];
}

const secondsPerTimeframe: Record<Timeframe, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, D: 86400,
};

function storiesWithObservedGoldReaction(stories: MarketNewsStory[], candles: Candle[], currentPrice: number, timeframe: Timeframe): MarketNewsStory[] {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return stories.map((story) => {
    if (story.verificationStatus === 'UNVERIFIED' || nowSeconds - story.publishedAt < 0 || nowSeconds - story.publishedAt > 6 * 60 * 60) return story;
    const anchor = [...candles].reverse().find((candle) => candle.time + secondsPerTimeframe[timeframe] <= story.publishedAt);
    if (!anchor || anchor.close <= 0) return story;
    const movePercent = ((currentPrice - anchor.close) / anchor.close) * 100;
    const goldImpact: MarketNewsStory['goldImpact'] = movePercent >= 0.1 ? 'BULLISH' : movePercent <= -0.1 ? 'BEARISH' : 'MIXED';
    return {
      ...story,
      goldImpact,
      reasoningKm: `មាស ${movePercent >= 0 ? 'ឡើង' : 'ចុះ'} ${Math.abs(movePercent).toFixed(2)}% ចាប់ពីទៀនបិទមុនពេលព័ត៌មាន។ នេះជាចលនាតម្លៃក្រោយព័ត៌មាន មិនមែនភស្តុតាងថាព័ត៌មានជាមូលហេតុផ្ទាល់ទេ។`,
    };
  });
}

export function runFullAnalysisPipeline(params: {
  symbol: string;
  timeframe: Timeframe;
  currentPrice: number;
  candles: Candle[];
  multiTf?: PipelineMultiTfCandles;
  spread?: number;
  isStale?: boolean;
  isDelayed?: boolean;
  dataAgeMs?: number;
  secondaryPrice?: number;
  isPriceDivergent?: boolean;
  secondaryFeedAvailable?: boolean;
  divergenceAtr?: number;
  riskOff?: RiskOffClassification;
  griIndex?: number;
  crossAssets?: CrossAssetQuote[];
  correlations?: CorrelationMatrixItem[];
  macroData?: MacroDataPoint[];
  stories?: MarketNewsStory[];
  activeShock?: ShockAlert;
  scheduledEvents?: ScheduledEconomicEvent[];
  calendarAvailable?: boolean;
  sourceWeights?: RegimeWeightsConfig;
}): FullAnalysisResult {
  const {
    symbol,
    timeframe,
    currentPrice,
    candles,
    multiTf = {},
    spread = 0.35,
    isStale = false,
    isDelayed = false,
    dataAgeMs = 35,
    secondaryPrice = currentPrice,
    isPriceDivergent = false,
    secondaryFeedAvailable = false,
    divergenceAtr = 0,
    riskOff,
    griIndex,
    crossAssets = [],
    correlations = [],
    macroData = [],
    stories = [],
    activeShock,
    scheduledEvents = [],
    calendarAvailable = false,
    sourceWeights,
  } = params;

  const m1Candles = multiTf.m1 || candles;
  const m5Candles = multiTf.m5 || candles;
  const m15Candles = multiTf.m15 || candles;
  const h1Candles = multiTf.h1 || candles;
  const h4Candles = multiTf.h4 || candles;
  const storiesWithReaction = storiesWithObservedGoldReaction(stories, candles, currentPrice, timeframe);

  // L1: Regime
  const regime = detectMarketRegime(candles);

  // L2: Multi-Timeframe Bias
  const mtfBias = analyzeMultiTimeframe(m1Candles, m5Candles, m15Candles, h1Candles, h4Candles);

  // L3: Liquidity Levels
  const liquidityLevels = identifyLiquidityLevels(candles, timeframe);

  // L4: SMC Engine
  const breaks = detectBOSAndCHoCH(candles, liquidityLevels, timeframe);
  const orderBlocks = detectOrderBlocks(candles, timeframe);
  const fvgs = detectFVGs(candles, timeframe);
  const sweeps = detectLiquiditySweeps(candles, liquidityLevels);

  // L5 - L8: Indicators & Patterns
  const momentum = analyzeMomentum(candles);
  const volume = analyzeVolumeAndVWAP(candles);
  const patterns = analyzeCandlePatterns(candles);

  // L9: Session
  const session = analyzeSession(candles, candles[candles.length - 1]?.time);

  // L10: Confirmations (Includes V2 Cross-Asset, Correlation, Macro, News, GRI factors)
  const confirmations = evaluateConfirmations({
    candles,
    regime,
    mtfBias,
    session,
    liquidityLevels,
    orderBlocks,
    fvgs,
    breaks,
    sweeps,
    momentum,
    volume,
    patterns,
    isStale,
    isDelayed,
    spread,
    isPriceDivergent,
    divergenceAtr,
    riskOffType: riskOff?.type,
    griIndex,
    crossAssets,
    correlations,
    macroData,
    stories: storiesWithReaction,
    customWeights: sourceWeights?.[
      regime.type === 'HIGH_VOLATILITY' ? 'HIGH_VOLATILITY' : regime.type === 'RANGE' ? 'RANGE' : 'TREND'
    ],
  });

  // L11: Scoring & Trade Plan
  const scoring = computeSignalAndTradePlan({
    buyScore: confirmations.buyScore,
    sellScore: confirmations.sellScore,
    currentPrice,
    candles,
    orderBlocks,
    liquidityLevels,
    isHardBlocked: confirmations.isHardBlocked,
  });

  const atrs = calculateATR(candles, 14);
  const atr14 = Number((atrs[atrs.length - 1] || 0).toFixed(2));
  const directionalFactors = scoring.verdict === 'BUY'
    ? confirmations.buyFactors
    : scoring.verdict === 'SELL' ? confirmations.sellFactors : [];
  const factorStatus = (code: string) => directionalFactors.find((factor) => factor.code === code)?.status;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const highImpactEvents = scheduledEvents.filter((event) => event.impact === 'HIGH');
  const eventInWindow = highImpactEvents.find((event) => Math.abs(event.scheduledAt - nowSeconds) <= 90);
  const nextHighImpactEvent = highImpactEvents.filter((event) => event.scheduledAt > nowSeconds).sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
  const eventRestricted = Boolean(eventInWindow || (activeShock?.status === 'ACTIVE' && nowSeconds - activeShock.timestamp <= 300));
  const coreStatus = (code: string): 'PASS' | 'PARTIAL' | 'FAIL' => {
    const status = factorStatus(code);
    return status === 'pass' ? 'PASS' : status === 'partial' || status === 'na' ? 'PARTIAL' : 'FAIL';
  };
  const analysisStages = [
    { index: 1, name: 'Live feed & data integrity', status: isStale || isDelayed || isPriceDivergent ? 'FAIL' as const : secondaryFeedAvailable ? 'PASS' as const : 'PARTIAL' as const, evidence: `${isStale ? 'stale' : 'fresh'} feed · ${dataAgeMs} ms quote age · ${isPriceDivergent ? 'price divergence' : secondaryFeedAvailable ? 'secondary quote aligned' : 'secondary quote unavailable'}` },
    { index: 2, name: 'Market regime', status: regime.confidence >= 55 ? 'PASS' as const : 'PARTIAL' as const, evidence: `${regime.type} · ${regime.confidence}/100 regime score` },
    { index: 3, name: 'Multi-timeframe alignment', status: mtfBias.alignmentScore >= 60 ? 'PASS' as const : mtfBias.alignmentScore >= 40 ? 'PARTIAL' as const : 'FAIL' as const, evidence: `H4 ${mtfBias.h4Bias} · H1 ${mtfBias.h1Bias} · ${mtfBias.alignmentScore}/100 aligned` },
    { index: 4, name: 'Liquidity map', status: liquidityLevels.length ? 'PASS' as const : 'FAIL' as const, evidence: `${liquidityLevels.length} observed levels` },
    { index: 5, name: 'BOS / CHoCH structure', status: coreStatus('S'), evidence: directionalFactors.find((factor) => factor.code === 'S')?.reason || 'No directional verdict to validate' },
    { index: 6, name: 'Order Block (OB)', status: coreStatus('O'), evidence: directionalFactors.find((factor) => factor.code === 'O')?.reason || 'No directional verdict to validate' },
    { index: 7, name: 'Fair Value Gap (FVG)', status: coreStatus('F'), evidence: directionalFactors.find((factor) => factor.code === 'F')?.reason || 'No directional verdict to validate' },
    { index: 8, name: 'Liquidity sweep / key level', status: coreStatus('K'), evidence: directionalFactors.find((factor) => factor.code === 'K')?.reason || 'No directional verdict to validate' },
    { index: 9, name: 'Momentum confirmation', status: coreStatus('MOM'), evidence: directionalFactors.find((factor) => factor.code === 'MOM')?.reason || 'No directional verdict to validate' },
    { index: 10, name: 'Volume / VWAP confirmation', status: coreStatus('VWAP'), evidence: directionalFactors.find((factor) => factor.code === 'VWAP')?.reason || 'No directional verdict to validate' },
    { index: 11, name: 'Score, trade plan & risk/reward', status: scoring.tradePlan?.riskRewardValid && scoring.signalLock.isLocked ? 'PASS' as const : 'FAIL' as const, evidence: `${scoring.verdict} · ${Math.max(confirmations.buyScore, confirmations.sellScore)}/100 · ${scoring.tradePlan?.riskRewardValid ? 'risk/reward valid' : 'no valid plan'}` },
    { index: 12, name: 'Economic release guard', status: eventRestricted ? 'WAIT' as const : calendarAvailable ? 'PASS' as const : 'PARTIAL' as const, evidence: eventInWindow ? `${eventInWindow.country} ${eventInWindow.title} release window; wait for observed price reaction` : activeShock?.status === 'ACTIVE' ? 'Unusual price displacement is still in the five-minute cooldown' : calendarAvailable && nextHighImpactEvent ? `Next high-impact release: ${nextHighImpactEvent.country} ${nextHighImpactEvent.title} at ${new Date(nextHighImpactEvent.scheduledAt * 1000).toISOString()} (${nextHighImpactEvent.source})` : calendarAvailable ? 'Economic calendar feeds checked; no high-impact release in the loaded window' : 'Official release calendar feeds are not available yet' },
  ];

  return {
    symbol,
    timeframe,
    timestamp: Math.floor(Date.now() / 1000),
    currentPrice: Number(currentPrice.toFixed(2)),
    bid: Number((currentPrice - spread / 2).toFixed(2)),
    ask: Number((currentPrice + spread / 2).toFixed(2)),
    spread: Number(spread.toFixed(2)),
    atr14,
    primaryPrice: Number(currentPrice.toFixed(2)),
    secondaryPrice: Number(secondaryPrice.toFixed(2)),
    priceDivergenceAtr: Number(divergenceAtr.toFixed(2)),
    isPriceDivergent,
    regime,
    mtfBias,
    session,
    liquidityLevels,
    orderBlocks,
    fvgs,
    recentBreaks: breaks,
    recentSweeps: sweeps,
    buyFactors: confirmations.buyFactors,
    sellFactors: confirmations.sellFactors,
    buyScore: confirmations.buyScore,
    sellScore: confirmations.sellScore,
    verdict: scoring.verdict,
    grade: scoring.grade,
    signalLock: scoring.signalLock,
    tradePlan: scoring.tradePlan,
    isStale,
    dataAgeMs,
    hardBlockReason: confirmations.blockReason,
    hardBlockReasonKm: confirmations.blockReasonKm,
    riskOff,
    griIndex,
    recentStories: storiesWithReaction.slice(0, 5),
    activeShock,
    analysisStages,
    scheduledEvents,
  };
}
