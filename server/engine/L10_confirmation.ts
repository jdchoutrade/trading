import {
  Candle,
  CorrelationMatrixItem,
  CrossAssetQuote,
  FactorDetail,
  FVG,
  LiquidityLevel,
  LiquiditySweep,
  MacroDataPoint,
  MarketNewsStory,
  MarketRegime,
  MultiTimeframeBias,
  OrderBlock,
  SessionInfo,
  StructureBreak,
} from '../types.ts';
import { DEFAULT_WEIGHTS, FactorWeights } from './defaultWeights.ts';
import { CandlePatternAnalysis, MomentumAnalysis, VolumeAnalysis } from './L5_L8_patterns.ts';
import { calculateATR } from './indicators.ts';

export interface ConfirmationInput {
  candles: Candle[];
  regime: MarketRegime;
  mtfBias: MultiTimeframeBias;
  session: SessionInfo;
  liquidityLevels: LiquidityLevel[];
  orderBlocks: OrderBlock[];
  fvgs: FVG[];
  breaks: StructureBreak[];
  sweeps: LiquiditySweep[];
  momentum: MomentumAnalysis;
  volume: VolumeAnalysis;
  patterns: CandlePatternAnalysis;
  isStale: boolean;
  isDelayed?: boolean;
  spread: number;
  customWeights?: FactorWeights;
  // V2 Cross-Asset & Macro inputs
  isPriceDivergent?: boolean;
  divergenceAtr?: number;
  riskOffType?: 'SAFE_HAVEN_GOLD' | 'DOLLAR_SMILE' | 'MIXED_UNCLEAR';
  griIndex?: number;
  crossAssets?: CrossAssetQuote[];
  correlations?: CorrelationMatrixItem[];
  macroData?: MacroDataPoint[];
  stories?: MarketNewsStory[];
}

export interface ConfirmationResult {
  buyFactors: FactorDetail[];
  sellFactors: FactorDetail[];
  buyScore: number;
  sellScore: number;
  isHardBlocked: boolean;
  blockReason?: string;
  blockReasonKm?: string;
}

export function evaluateConfirmations(input: ConfirmationInput): ConfirmationResult {
  const {
    candles,
    regime,
    mtfBias,
    session,
    orderBlocks,
    fvgs,
    breaks,
    sweeps,
    momentum,
    volume,
    patterns,
    isStale,
    isDelayed = false,
    spread,
    isPriceDivergent = false,
    divergenceAtr = 0,
    riskOffType = 'MIXED_UNCLEAR',
    griIndex,
    crossAssets = [],
    correlations = [],
    macroData = [],
    stories = [],
  } = input;

  const currentPrice = candles[candles.length - 1]?.close || 0;
  const currentCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  const atrSeries = calculateATR(candles, 14);
  const currentATR = Math.max(1, atrSeries[atrSeries.length - 1] || 15);
  const zoneTolerance = Math.max(6, Math.min(22, currentATR * 0.4));
  const timeframeSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, D: 86400 };
  const currentCandleTime = currentCandle?.time || 0;
  const isRecentZone = (time: number, timeframe: string) =>
    time <= currentCandleTime && currentCandleTime - time <= 64 * (timeframeSeconds[timeframe] || 900);
  const zoneDistance = (low: number, high: number) =>
    currentPrice < low ? low - currentPrice : currentPrice > high ? currentPrice - high : 0;

  // RANGE uses the recent completed bars as its dealing range. A reclaim from an edge is
  // a valid directional trigger even when the market has not printed a fresh BOS yet.
  const rangeWindow = candles.slice(Math.max(0, candles.length - 25), Math.max(0, candles.length - 1));
  const rangeHigh = rangeWindow.length ? Math.max(...rangeWindow.map((candle) => candle.high)) : 0;
  const rangeLow = rangeWindow.length ? Math.min(...rangeWindow.map((candle) => candle.low)) : 0;
  const rangeSpan = Math.max(0, rangeHigh - rangeLow);
  const rangeEdgeBand = rangeSpan > 0 ? Math.min(rangeSpan * 0.3, Math.max(currentATR * 0.5, rangeSpan * 0.15)) : 0;
  const nearRangeLow = rangeEdgeBand > 0 && currentPrice <= rangeLow + rangeEdgeBand;
  const nearRangeHigh = rangeEdgeBand > 0 && currentPrice >= rangeHigh - rangeEdgeBand;
  const bullishRangeReclaim = regime.type === 'RANGE' && nearRangeLow && currentPrice >= rangeLow && Boolean(currentCandle && previousCandle)
    && (currentCandle!.close > currentCandle!.open || currentCandle!.close > previousCandle!.high);
  const bearishRangeReclaim = regime.type === 'RANGE' && nearRangeHigh && currentPrice <= rangeHigh && Boolean(currentCandle && previousCandle)
    && (currentCandle!.close < currentCandle!.open || currentCandle!.close < previousCandle!.low);

  // 1. HARD BLOCK CHECKS
  let isHardBlocked = false;
  let blockReason: string | undefined;
  let blockReasonKm: string | undefined;

  if (isStale) {
    isHardBlocked = true;
    blockReason = 'DATA STALE: Live market feed disconnected. Signals halted.';
    blockReasonKm = 'ទិន្នន័យដាច់ (DATA STALE)៖ បិទ Signal ទាំងអស់ដើម្បីសុវត្ថិភាព។';
  } else if (isDelayed) {
    isHardBlocked = true;
    blockReason = 'DATA DELAYED: Delayed feed cannot produce official signals.';
    blockReasonKm = 'ទិន្នន័យយឺត (DATA DELAYED)៖ ផ្អាក Signal ផ្លូវការ។';
  } else if (isPriceDivergent) {
    isHardBlocked = true;
    blockReason = `PRICE DIVERGENCE: Primary & secondary feed diverge by ${divergenceAtr}× ATR (> 0.6 ATR limit). Signals halted.`;
    blockReasonKm = `តម្លៃប្រភពទាំងពីរខុសគ្នា ${divergenceAtr}× ATR (លើសកម្រិត 0.6 ATR)។ ផ្អាកការជួញដូរ។`;
  } else if (session.isRolloverBlocked) {
    isHardBlocked = true;
    blockReason = 'ROLLOVER WINDOW: High spread & low liquidity (21:45-23:15 UTC). Signals blocked.';
    blockReasonKm = 'ម៉ោង ROLLOVER៖ Spread ឡើងខ្ពស់ខ្លាំង (21:45-23:15 UTC)។ ផ្អាកការចូល Trade។';
  } else if (spread > 6.0) {
    isHardBlocked = true;
    blockReason = `SPREAD TOO WIDE: Spread is $${spread.toFixed(2)}. Trading blocked.`;
    blockReasonKm = `Spread ឡើងខ្ពស់ខ្លាំងពេក ($${spread.toFixed(2)})។ ផ្អាកការជួញដូរ។`;
  }

  // Determine weights according to Regime
  const regimeCategory =
    regime.type === 'HIGH_VOLATILITY' ? 'HIGH_VOLATILITY' : regime.type === 'RANGE' ? 'RANGE' : 'TREND';
  const weights = input.customWeights || DEFAULT_WEIGHTS[regimeCategory];

  const evaluateScore = (status: FactorDetail['status'], weight: number): number => {
    if (status === 'pass') return weight;
    if (status === 'partial') return weight * 0.5;
    return 0;
  };

  // Cross-Asset Metrics for V2
  const dxy = crossAssets.find((a) => a.symbol === 'DXY');
  const silver = crossAssets.find((a) => a.symbol === 'XAGUSD');
  const dxyDown = dxy ? dxy.direction === 'DOWN' || dxy.change24h < 0 : false;
  const dxyUp = dxy ? dxy.direction === 'UP' || dxy.change24h > 0 : false;
  const silverUp = silver ? silver.direction === 'UP' || silver.change24h > 0 : false;
  const realYield = macroData.find((point) => point.id === 'DFII10');

  // Verified News (ignoring unverified tier-3 stories)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const verifiedStories = stories.filter((s) => s.verificationStatus !== 'UNVERIFIED' && nowSeconds - s.publishedAt <= 6 * 60 * 60);
  const bullishNews = verifiedStories.some((s) => s.goldImpact === 'BULLISH' && s.severity >= 6);
  const bearishNews = verifiedStories.some((s) => s.goldImpact === 'BEARISH' && s.severity >= 6);

  // --- BUY FACTORS EVALUATION ---
  const buyFactors: FactorDetail[] = [];

  // S: Structure
  const recentBullBreak = breaks.find((b) => b.direction === 'BULLISH');
  let sStatusBuy: FactorDetail['status'] = recentBullBreak
    ? recentBullBreak.type === 'CHOCH' ? 'pass' : 'pass'
    : breaks.some((b) => b.direction === 'BEARISH') ? 'fail' : 'partial';
  buyFactors.push({
    code: 'S',
    name: 'Structure (BOS/CHoCH)',
    status: sStatusBuy,
    weight: weights.S,
    scoreContribution: evaluateScore(sStatusBuy, weights.S),
    reason: recentBullBreak
      ? `Bullish ${recentBullBreak.type} confirmed with body close at ${recentBullBreak.closePrice.toFixed(2)}`
      : 'No recent bullish structural break detected',
    reasonKm: recentBullBreak
      ? `មាន Bullish ${recentBullBreak.type} ទៀនបិទពេញលើ swing (${recentBullBreak.closePrice.toFixed(2)})`
      : 'មិនទាន់មានការបំបែក Structure ឡើងលើច្បាស់លាស់',
    sourceProof: 'M15 Candle Close',
  });

  // H: HTF Bias
  let hStatusBuy: FactorDetail['status'] = regime.type === 'RANGE'
    ? 'partial'
    : mtfBias.h1Bias === 'BULL' ? 'pass' : mtfBias.h1Bias === 'NEUTRAL' ? 'partial' : 'fail';
  buyFactors.push({
    code: 'H',
    name: 'HTF Bias (H1)',
    status: hStatusBuy,
    weight: weights.H,
    scoreContribution: evaluateScore(hStatusBuy, weights.H),
    reason: `H1 Bias is ${mtfBias.h1Bias} (Price ${currentPrice > mtfBias.h1Ema50 ? '>' : '<'} EMA50)`,
    reasonKm: `ទិសដៅធំ H1 គឺ ${mtfBias.h1Bias}`,
    sourceProof: `H1 EMA50: ${mtfBias.h1Ema50.toFixed(2)}`,
  });

  // F: FVG
  const nearbyBullFVG = fvgs
    .filter((f) => f.type === 'BULLISH' && !f.filled && isRecentZone(f.time, f.timeframe))
    .filter((f) => zoneDistance(f.bottom, f.top) <= zoneTolerance)
    .sort((a, b) => zoneDistance(a.bottom, a.top) - zoneDistance(b.bottom, b.top) || b.time - a.time)[0];
  const insideBullFVG = Boolean(nearbyBullFVG && currentPrice >= nearbyBullFVG.bottom && currentPrice <= nearbyBullFVG.top);
  let fStatusBuy: FactorDetail['status'] = nearbyBullFVG
    ? insideBullFVG || nearbyBullFVG.fillPercentage > 20 ? 'pass' : 'partial'
    : 'fail';
  buyFactors.push({
    code: 'F',
    name: 'Fair Value Gap (FVG)',
    status: fStatusBuy,
    weight: weights.F,
    scoreContribution: evaluateScore(fStatusBuy, weights.F),
    reason: nearbyBullFVG
      ? `${insideBullFVG ? 'Price reacting inside' : 'Active zone nearby'} Bullish FVG (${nearbyBullFVG.bottom.toFixed(2)} - ${nearbyBullFVG.top.toFixed(2)})`
      : 'No recent unmitigated Bullish FVG within the active price range',
    reasonKm: nearbyBullFVG ? 'តម្លៃកំពុងស្ថិតក្នុងតំបន់ Bullish FVG' : 'គ្មាន Bullish FVG នៅសុពលភាព',
  });

  // K: Liquidity Sweep
  const recentBullSweep = sweeps.find((s) => s.direction === 'BULLISH_SWEEP');
  let kStatusBuy: FactorDetail['status'] = recentBullSweep || bullishRangeReclaim
    ? 'pass'
    : mtfBias.premiumDiscountZone === 'DISCOUNT' ? 'partial' : 'fail';
  buyFactors.push({
    code: 'K',
    name: 'Key Level / Liquidity Sweep',
    status: kStatusBuy,
    weight: weights.K,
    scoreContribution: evaluateScore(kStatusBuy, weights.K),
    reason: recentBullSweep
      ? `Sell-side liquidity swept at ${recentBullSweep.sweepPrice.toFixed(2)} with swift rejection`
      : bullishRangeReclaim ? `Bullish reclaim near recent range low ${rangeLow.toFixed(2)}`
      : mtfBias.premiumDiscountZone === 'DISCOUNT' ? 'Price in Discount zone' : 'No liquidity sweep or range reclaim',
    reasonKm: recentBullSweep ? 'មាន Liquidity Sweep សម្អាត Low' : 'គ្មាន liquidity sweep',
  });

  // O: Order Block
  const activeBullOB = orderBlocks
    .filter((ob) => ob.type === 'BULLISH' && isRecentZone(ob.time, ob.timeframe))
    .filter((ob) => zoneDistance(ob.low, ob.high) <= zoneTolerance)
    .sort((a, b) => Number(a.mitigated) - Number(b.mitigated) || zoneDistance(a.low, a.high) - zoneDistance(b.low, b.high) || b.time - a.time)[0];
  const insideBullOB = Boolean(activeBullOB && currentPrice >= activeBullOB.low && currentPrice <= activeBullOB.high);
  let oStatusBuy: FactorDetail['status'] = activeBullOB
    ? insideBullOB && !activeBullOB.mitigated ? 'pass' : 'partial'
    : 'fail';
  buyFactors.push({
    code: 'O',
    name: 'Order Block (OB)',
    status: oStatusBuy,
    weight: weights.O,
    scoreContribution: evaluateScore(oStatusBuy, weights.O),
    reason: activeBullOB
      ? `${insideBullOB && !activeBullOB.mitigated ? 'Active' : 'Nearby'} Bullish Order Block at ${activeBullOB.low.toFixed(2)} - ${activeBullOB.high.toFixed(2)}`
      : 'No recent Bullish Order Block within the active price range',
    reasonKm: activeBullOB ? 'Order Block ឡើងសុពលភាព' : 'តម្លៃមិនទាន់ដល់ OB',
  });

  // T: Timing & Killzone
  let tStatusBuy: FactorDetail['status'] = session.isKillZone
    ? 'pass'
    : session.currentSession === 'LONDON' || session.currentSession === 'OVERLAP' || session.currentSession === 'NY'
    ? 'partial'
    : 'fail';
  buyFactors.push({
    code: 'T',
    name: 'Timing & Session',
    status: tStatusBuy,
    weight: weights.T,
    scoreContribution: evaluateScore(tStatusBuy, weights.T),
    reason: session.isKillZone ? `Active in ${session.killZoneName || 'Kill Zone'}` : `Session: ${session.currentSession}`,
    reasonKm: session.isKillZone ? 'ស្ថិតក្នុង Kill Zone' : `វគ្គជួញដូរ ${session.currentSession}`,
  });

  // REG: Regime
  let regStatusBuy: FactorDetail['status'] =
    regime.type === 'TREND_BULL' || regime.type === 'EVENT_DRIVEN' || regime.type === 'RANGE' ? 'pass' : 'fail';
  buyFactors.push({
    code: 'REG',
    name: 'Market Regime',
    status: regStatusBuy,
    weight: weights.REG,
    scoreContribution: evaluateScore(regStatusBuy, weights.REG),
    reason: `Regime: ${regime.type} (ADX: ${regime.adx.toFixed(1)})`,
    reasonKm: `Regime: ${regime.type}`,
  });

  // 4H Trend
  let fourHStatusBuy: FactorDetail['status'] = regime.type === 'RANGE'
    ? 'partial'
    : mtfBias.h4Bias === 'BULL' ? 'pass' : mtfBias.h4Bias === 'NEUTRAL' ? 'partial' : 'fail';
  buyFactors.push({
    code: '4H',
    name: '4H Trend Alignment',
    status: fourHStatusBuy,
    weight: weights['4H'],
    scoreContribution: evaluateScore(fourHStatusBuy, weights['4H']),
    reason: `4H Trend: ${mtfBias.h4Bias}`,
    reasonKm: `និន្នាការ 4H: ${mtfBias.h4Bias}`,
  });

  // D1 Trend
  let d1StatusBuy: FactorDetail['status'] = session.dailyOpen && currentPrice > session.dailyOpen
    ? 'pass' : regime.type === 'RANGE' ? 'partial' : 'fail';
  buyFactors.push({
    code: 'D1',
    name: 'Daily Open Bias',
    status: d1StatusBuy,
    weight: weights.D1,
    scoreContribution: evaluateScore(d1StatusBuy, weights.D1),
    reason: `Price is ${currentPrice > (session.dailyOpen || 0) ? 'ABOVE' : 'BELOW'} Daily Open`,
    reasonKm: `តម្លៃធៀប Daily Open`,
  });

  // VWAP
  let vwapStatusBuy: FactorDetail['status'] = volume.priceVsVwap === 'ABOVE' || currentPrice > volume.vwap
    ? 'pass' : regime.type === 'RANGE' ? 'partial' : 'fail';
  buyFactors.push({
    code: 'VWAP',
    name: 'VWAP Support',
    status: vwapStatusBuy,
    weight: weights.VWAP,
    scoreContribution: evaluateScore(vwapStatusBuy, weights.VWAP),
    reason: `Price is ${volume.priceVsVwap} VWAP (${volume.vwap.toFixed(2)})`,
    reasonKm: `តម្លៃធៀប VWAP`,
  });

  // MOM
  let momStatusBuy: FactorDetail['status'] =
    momentum.rsiDivergence === 'BULLISH_DIV' || momentum.diCross === 'BULL_CROSS'
      ? 'pass'
      : momentum.rsi > 45 && momentum.macdHistogram > 0 || regime.type === 'RANGE' && nearRangeLow ? 'partial' : 'fail';
  buyFactors.push({
    code: 'MOM',
    name: 'Momentum (RSI/MACD)',
    status: momStatusBuy,
    weight: weights.MOM,
    scoreContribution: evaluateScore(momStatusBuy, weights.MOM),
    reason: `RSI: ${momentum.rsi}, Div: ${momentum.rsiDivergence}`,
    reasonKm: `RSI: ${momentum.rsi}`,
  });

  // RAIL
  const heldRailBuy = session.asiaRange && currentPrice > session.asiaRange.high;
  let railStatusBuy: FactorDetail['status'] = regime.type === 'RANGE'
    ? bullishRangeReclaim ? 'pass' : nearRangeLow ? 'partial' : 'fail'
    : heldRailBuy ? 'pass' : 'partial';
  buyFactors.push({
    code: 'RAIL',
    name: 'Level Rails',
    status: railStatusBuy,
    weight: weights.RAIL,
    scoreContribution: evaluateScore(railStatusBuy, weights.RAIL),
    reason: regime.type === 'RANGE'
      ? bullishRangeReclaim ? `Range-low reclaim near ${rangeLow.toFixed(2)}` : nearRangeLow ? 'Near range low; waiting for reclaim' : 'Away from range-low reaction area'
      : heldRailBuy ? 'Price above Asia High' : 'Inside range boundaries',
    reasonKm: 'កម្រិត Rail',
  });

  // V2: XA (Cross-Asset Alignment)
  let xaStatusBuy: FactorDetail['status'] =
    !dxy && !silver ? 'na' : (dxyDown && silverUp) || riskOffType === 'SAFE_HAVEN_GOLD' ? 'pass' : dxyDown || silverUp ? 'partial' : 'fail';
  buyFactors.push({
    code: 'XA',
    name: 'Cross-Asset Alignment',
    status: xaStatusBuy,
    weight: weights.XA,
    scoreContribution: evaluateScore(xaStatusBuy, weights.XA),
    reason: `DXY ${dxy ? `${dxyDown ? 'weakening' : 'firm'} (${dxy.price})` : 'unavailable'}, Silver ${silver ? (silverUp ? 'rising' : 'soft') : 'unavailable'}, Mode: ${riskOffType}`,
    reasonKm: `កម្លាំងដុល្លារ និងប្រាក់ស្របគ្នាជាមួយមាស`,
    sourceProof: `DXY: ${dxy?.price || 'N/A'}, Silver: ${silver?.price || 'N/A'}`,
  });

  // V2: COR (Correlation Health)
  const spxDivergence = correlations.find((c) => c.isBroken);
  let corStatusBuy: FactorDetail['status'] = correlations.length === 0 ? 'na' : spxDivergence ? 'partial' : 'pass';
  buyFactors.push({
    code: 'COR',
    name: 'Correlation Health',
    status: corStatusBuy,
    weight: weights.COR,
    scoreContribution: evaluateScore(corStatusBuy, weights.COR),
    reason: correlations.length === 0 ? 'Rolling aligned return data is unavailable' : spxDivergence ? `Decoupling note: ${spxDivergence.divergenceReason}` : 'No correlation break detected in the available sample',
    reasonKm: 'សុខភាព Correlation ម៉ាក្រូ',
  });

  // MAC: use the latest as-of-dated 10Y real-yield observation, when available.
  const macroStatusBuy: FactorDetail['status'] = !realYield ? 'na' : realYield.biasForGold === 'BULLISH' ? 'pass' : realYield.biasForGold === 'BEARISH' ? 'fail' : 'partial';
  buyFactors.push({
    code: 'MAC',
    name: 'Macro Bias (10Y real yield)',
    status: macroStatusBuy,
    weight: weights.MAC,
    scoreContribution: evaluateScore(macroStatusBuy, weights.MAC),
    reason: realYield ? `10Y real yield ${realYield.formattedValue} as of ${realYield.asOf}; recent direction ${realYield.biasForGold.toLowerCase()} for gold` : 'No current FRED 10Y real-yield observation is loaded',
    reasonKm: realYield ? `10Y real yield ${realYield.formattedValue} · ${realYield.asOf}` : 'មិនទាន់មានទិន្នន័យ FRED 10Y real yield',
    sourceProof: realYield ? `${realYield.source} · ${realYield.asOf}` : 'Unavailable',
  });

  // V2: NEWS (Breaking News Impact)
  let newsStatusBuy: FactorDetail['status'] = bullishNews ? 'pass' : verifiedStories.length ? 'partial' : 'na';
  buyFactors.push({
    code: 'NEWS',
    name: 'News / Event Impact',
    status: newsStatusBuy,
    weight: weights.NEWS,
    scoreContribution: evaluateScore(newsStatusBuy, weights.NEWS),
    reason: bullishNews ? 'Gold rose after a corroborated headline; this is an observed reaction, not proof of causation' : verifiedStories.length ? 'Corroborated headlines are present; no clear gold reaction is established' : 'No corroborated fresh headline data',
    reasonKm: 'ព័ត៌មាន និងព្រឹត្តិការណ៍សេដ្ឋកិច្ច',
  });

  // V2: GEO (Geopolitical Risk Index)
  let geoStatusBuy: FactorDetail['status'] = griIndex === undefined ? 'na' : griIndex >= 50 ? 'pass' : 'partial';
  buyFactors.push({
    code: 'GEO',
    name: 'Geopolitical Risk Index',
    status: geoStatusBuy,
    weight: weights.GEO,
    scoreContribution: evaluateScore(geoStatusBuy, weights.GEO),
    reason: griIndex === undefined ? 'No reproducible geopolitical risk index is available' : `GRI Index: ${griIndex}/100`,
    reasonKm: griIndex === undefined ? 'មិនទាន់មានសន្ទស្សន៍ភូមិសាស្ត្រនយោបាយដែលអាចផ្ទៀងផ្ទាត់បាន' : `សន្ទស្សន៍ហានិភ័យភូមិសាស្ត្រនយោបាយ: ${griIndex}/100`,
    sourceProof: 'Unavailable',
  });

  // BLOCK
  buyFactors.push({
    code: 'BLOCK',
    name: 'Hard Blockers',
    status: isHardBlocked ? 'fail' : 'pass',
    weight: 0,
    scoreContribution: 0,
    reason: isHardBlocked ? blockReason || 'Blocked' : 'No hard blocks active (Spread normal, feed healthy)',
    reasonKm: isHardBlocked ? blockReasonKm || 'បានបិទ' : 'គ្មានបញ្ហារារាំង',
  });

  // --- SELL FACTORS EVALUATION ---
  const sellFactors: FactorDetail[] = [];

  const recentBearBreak = breaks.find((b) => b.direction === 'BEARISH');
  let sStatusSell: FactorDetail['status'] = recentBearBreak
    ? 'pass'
    : breaks.some((b) => b.direction === 'BULLISH') ? 'fail' : 'partial';
  sellFactors.push({
    code: 'S',
    name: 'Structure (BOS/CHoCH)',
    status: sStatusSell,
    weight: weights.S,
    scoreContribution: evaluateScore(sStatusSell, weights.S),
    reason: recentBearBreak
      ? `Bearish ${recentBearBreak.type} confirmed with body close at ${recentBearBreak.closePrice.toFixed(2)}`
      : breaks.some((b) => b.direction === 'BULLISH') ? 'Recent bullish structure remains active' : 'No recent bearish structural break detected',
    reasonKm: recentBearBreak ? 'មាន Bearish BOS/CHoCH' : 'គ្មាន structural break ចុះក្រោម',
  });

  let hStatusSell: FactorDetail['status'] = regime.type === 'RANGE'
    ? 'partial'
    : mtfBias.h1Bias === 'BEAR' ? 'pass' : mtfBias.h1Bias === 'NEUTRAL' ? 'partial' : 'fail';
  sellFactors.push({
    code: 'H',
    name: 'HTF Bias (H1)',
    status: hStatusSell,
    weight: weights.H,
    scoreContribution: evaluateScore(hStatusSell, weights.H),
    reason: `H1 Bias is ${mtfBias.h1Bias}`,
    reasonKm: `ទិសដៅធំ H1 គឺ ${mtfBias.h1Bias}`,
  });

  const nearbyBearFVG = fvgs
    .filter((f) => f.type === 'BEARISH' && !f.filled && isRecentZone(f.time, f.timeframe))
    .filter((f) => zoneDistance(f.bottom, f.top) <= zoneTolerance)
    .sort((a, b) => zoneDistance(a.bottom, a.top) - zoneDistance(b.bottom, b.top) || b.time - a.time)[0];
  const insideBearFVG = Boolean(nearbyBearFVG && currentPrice >= nearbyBearFVG.bottom && currentPrice <= nearbyBearFVG.top);
  let fStatusSell: FactorDetail['status'] = nearbyBearFVG
    ? insideBearFVG || nearbyBearFVG.fillPercentage > 20 ? 'pass' : 'partial'
    : 'fail';
  sellFactors.push({
    code: 'F',
    name: 'Fair Value Gap (FVG)',
    status: fStatusSell,
    weight: weights.F,
    scoreContribution: evaluateScore(fStatusSell, weights.F),
    reason: nearbyBearFVG
      ? `${insideBearFVG ? 'Price reacting inside' : 'Active zone nearby'} Bearish FVG (${nearbyBearFVG.bottom.toFixed(2)} - ${nearbyBearFVG.top.toFixed(2)})`
      : 'No recent unmitigated Bearish FVG within the active price range',
    reasonKm: 'Bearish FVG',
  });

  const recentBearSweep = sweeps.find((s) => s.direction === 'BEARISH_SWEEP');
  let kStatusSell: FactorDetail['status'] = recentBearSweep || bearishRangeReclaim ? 'pass' : 'fail';
  sellFactors.push({
    code: 'K',
    name: 'Key Level / Liquidity Sweep',
    status: kStatusSell,
    weight: weights.K,
    scoreContribution: evaluateScore(kStatusSell, weights.K),
    reason: recentBearSweep ? 'Buy-side liquidity swept with rejection'
      : bearishRangeReclaim ? `Bearish reclaim near recent range high ${rangeHigh.toFixed(2)}` : 'No liquidity sweep or range reclaim',
    reasonKm: 'Liquidity sweep',
  });

  const activeBearOB = orderBlocks
    .filter((ob) => ob.type === 'BEARISH' && isRecentZone(ob.time, ob.timeframe))
    .filter((ob) => zoneDistance(ob.low, ob.high) <= zoneTolerance)
    .sort((a, b) => Number(a.mitigated) - Number(b.mitigated) || zoneDistance(a.low, a.high) - zoneDistance(b.low, b.high) || b.time - a.time)[0];
  const insideBearOB = Boolean(activeBearOB && currentPrice >= activeBearOB.low && currentPrice <= activeBearOB.high);
  let oStatusSell: FactorDetail['status'] = activeBearOB
    ? insideBearOB && !activeBearOB.mitigated ? 'pass' : 'partial'
    : 'fail';
  sellFactors.push({
    code: 'O',
    name: 'Order Block (OB)',
    status: oStatusSell,
    weight: weights.O,
    scoreContribution: evaluateScore(oStatusSell, weights.O),
    reason: activeBearOB
      ? `${insideBearOB && !activeBearOB.mitigated ? 'Active' : 'Nearby'} Bearish Order Block at ${activeBearOB.low.toFixed(2)} - ${activeBearOB.high.toFixed(2)}`
      : 'No recent Bearish Order Block within the active price range',
    reasonKm: 'Bearish OB',
  });

  sellFactors.push({
    code: 'T',
    name: 'Timing & Session',
    status: tStatusBuy,
    weight: weights.T,
    scoreContribution: evaluateScore(tStatusBuy, weights.T),
    reason: `Session: ${session.currentSession}`,
    reasonKm: `វគ្គជួញដូរ ${session.currentSession}`,
  });

  let regStatusSell: FactorDetail['status'] =
    regime.type === 'TREND_BEAR' || regime.type === 'RANGE' ? 'pass' : 'fail';
  sellFactors.push({
    code: 'REG',
    name: 'Market Regime',
    status: regStatusSell,
    weight: weights.REG,
    scoreContribution: evaluateScore(regStatusSell, weights.REG),
    reason: `Regime: ${regime.type}`,
    reasonKm: `Regime: ${regime.type}`,
  });

  let fourHStatusSell: FactorDetail['status'] = regime.type === 'RANGE'
    ? 'partial'
    : mtfBias.h4Bias === 'BEAR' ? 'pass' : mtfBias.h4Bias === 'NEUTRAL' ? 'partial' : 'fail';
  sellFactors.push({
    code: '4H',
    name: '4H Trend Alignment',
    status: fourHStatusSell,
    weight: weights['4H'],
    scoreContribution: evaluateScore(fourHStatusSell, weights['4H']),
    reason: `4H Trend: ${mtfBias.h4Bias}`,
    reasonKm: `និន្នាការ 4H: ${mtfBias.h4Bias}`,
  });

  let d1StatusSell: FactorDetail['status'] = session.dailyOpen && currentPrice < session.dailyOpen
    ? 'pass' : regime.type === 'RANGE' ? 'partial' : 'fail';
  sellFactors.push({
    code: 'D1',
    name: 'Daily Open Bias',
    status: d1StatusSell,
    weight: weights.D1,
    scoreContribution: evaluateScore(d1StatusSell, weights.D1),
    reason: 'Price is BELOW Daily Open',
    reasonKm: 'តម្លៃក្រោម Daily Open',
  });

  let vwapStatusSell: FactorDetail['status'] = volume.priceVsVwap === 'BELOW' || currentPrice < volume.vwap
    ? 'pass' : regime.type === 'RANGE' ? 'partial' : 'fail';
  sellFactors.push({
    code: 'VWAP',
    name: 'VWAP Resistance',
    status: vwapStatusSell,
    weight: weights.VWAP,
    scoreContribution: evaluateScore(vwapStatusSell, weights.VWAP),
    reason: 'Price is BELOW VWAP',
    reasonKm: 'តម្លៃក្រោម VWAP',
  });

  let momStatusSell: FactorDetail['status'] =
    momentum.rsiDivergence === 'BEARISH_DIV' || momentum.diCross === 'BEAR_CROSS'
      ? 'pass'
      : momentum.rsi < 55 && momentum.macdHistogram < 0 || regime.type === 'RANGE' && nearRangeHigh ? 'partial' : 'fail';
  sellFactors.push({
    code: 'MOM',
    name: 'Momentum (RSI/MACD)',
    status: momStatusSell,
    weight: weights.MOM,
    scoreContribution: evaluateScore(momStatusSell, weights.MOM),
    reason: `RSI: ${momentum.rsi}`,
    reasonKm: `RSI: ${momentum.rsi}`,
  });

  const brokeBelowAsia = session.asiaRange && currentPrice < session.asiaRange.low;
  let railStatusSell: FactorDetail['status'] = regime.type === 'RANGE'
    ? bearishRangeReclaim ? 'pass' : nearRangeHigh ? 'partial' : 'fail'
    : brokeBelowAsia ? 'pass' : 'partial';
  sellFactors.push({
    code: 'RAIL',
    name: 'Level Rails',
    status: railStatusSell,
    weight: weights.RAIL,
    scoreContribution: evaluateScore(railStatusSell, weights.RAIL),
    reason: regime.type === 'RANGE'
      ? bearishRangeReclaim ? `Range-high rejection near ${rangeHigh.toFixed(2)}` : nearRangeHigh ? 'Near range high; waiting for rejection' : 'Away from range-high reaction area'
      : brokeBelowAsia ? 'Price broke below Asia Low' : 'Within rails',
    reasonKm: 'Level rails',
  });

  // V2: XA Sell
  let xaStatusSell: FactorDetail['status'] = !dxy && !silver ? 'na' : dxyUp || riskOffType === 'DOLLAR_SMILE' ? 'pass' : dxy || silver ? 'partial' : 'na';
  sellFactors.push({
    code: 'XA',
    name: 'Cross-Asset Alignment',
    status: xaStatusSell,
    weight: weights.XA,
    scoreContribution: evaluateScore(xaStatusSell, weights.XA),
    reason: dxy ? `DXY ${dxyUp ? 'strong' : 'not strong'} (${dxy.price}), Dollar Smile mode: ${riskOffType}` : 'DXY quote unavailable',
    reasonKm: 'ដុល្លារឡើងថ្លៃសង្កត់លើមាស',
  });

  sellFactors.push({
    code: 'COR',
    name: 'Correlation Health',
    status: correlations.length === 0 ? 'na' : 'partial',
    weight: weights.COR,
    scoreContribution: correlations.length === 0 ? 0 : evaluateScore('partial', weights.COR),
    reason: correlations.length === 0 ? 'Rolling aligned return data is unavailable' : 'Correlation data available; no directional edge applied',
    reasonKm: 'Correlation ធម្មតា',
  });

  const macroStatusSell: FactorDetail['status'] = !realYield ? 'na' : realYield.biasForGold === 'BEARISH' ? 'pass' : realYield.biasForGold === 'BULLISH' ? 'fail' : 'partial';
  sellFactors.push({
    code: 'MAC',
    name: 'Macro Bias (10Y real yield)',
    status: macroStatusSell,
    weight: weights.MAC,
    scoreContribution: evaluateScore(macroStatusSell, weights.MAC),
    reason: realYield ? `10Y real yield ${realYield.formattedValue} as of ${realYield.asOf}; recent direction ${realYield.biasForGold.toLowerCase()} for gold` : 'No current FRED 10Y real-yield observation is loaded',
    reasonKm: realYield ? `10Y real yield ${realYield.formattedValue} · ${realYield.asOf}` : 'មិនទាន់មានទិន្នន័យ FRED 10Y real yield',
  });

  let newsStatusSell: FactorDetail['status'] = bearishNews ? 'pass' : verifiedStories.length ? 'partial' : 'na';
  sellFactors.push({
    code: 'NEWS',
    name: 'News / Event Impact',
    status: newsStatusSell,
    weight: weights.NEWS,
    scoreContribution: evaluateScore(newsStatusSell, weights.NEWS),
    reason: bearishNews ? 'Gold fell after a corroborated headline; this is an observed reaction, not proof of causation' : verifiedStories.length ? 'Corroborated headlines are present; no clear gold reaction is established' : 'No corroborated fresh headline data',
    reasonKm: 'ព័ត៌មានលក់',
  });

  sellFactors.push({
    code: 'GEO',
    name: 'Geopolitical Risk Index',
    status: griIndex === undefined ? 'na' : 'partial',
    weight: weights.GEO,
    scoreContribution: griIndex === undefined ? 0 : evaluateScore('partial', weights.GEO),
    reason: griIndex === undefined ? 'No reproducible geopolitical risk index is available' : `GRI Index: ${griIndex}/100`,
    reasonKm: griIndex === undefined ? 'មិនទាន់មានសន្ទស្សន៍ភូមិសាស្ត្រនយោបាយដែលអាចផ្ទៀងផ្ទាត់បាន' : `GRI: ${griIndex}/100`,
  });

  sellFactors.push({
    code: 'BLOCK',
    name: 'Hard Blockers',
    status: isHardBlocked ? 'fail' : 'pass',
    weight: 0,
    scoreContribution: 0,
    reason: isHardBlocked ? blockReason || 'Blocked' : 'No hard blocks active',
    reasonKm: isHardBlocked ? blockReasonKm || 'បានបិទ' : 'គ្មានបញ្ហារារាំង',
  });

  // Calculate scores
  const rawBuyScore = buyFactors.reduce((acc, f) => acc + f.scoreContribution, 0);
  const rawSellScore = sellFactors.reduce((acc, f) => acc + f.scoreContribution, 0);
  // Optional macro/news feeds should not count as a negative vote when they are unavailable.
  const buyAvailableWeight = buyFactors.filter((factor) => factor.status !== 'na').reduce((sum, factor) => sum + factor.weight, 0) || 100;
  const sellAvailableWeight = sellFactors.filter((factor) => factor.status !== 'na').reduce((sum, factor) => sum + factor.weight, 0) || 100;

  const buyScore = isHardBlocked ? 0 : Math.min(100, Math.round((rawBuyScore / buyAvailableWeight) * 100));
  const sellScore = isHardBlocked ? 0 : Math.min(100, Math.round((rawSellScore / sellAvailableWeight) * 100));

  return {
    buyFactors,
    sellFactors,
    buyScore,
    sellScore,
    isHardBlocked,
    blockReason,
    blockReasonKm,
  };
}
