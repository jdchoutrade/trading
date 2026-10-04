import { Candle, CompositeSignal, CompositeStrategyFamily, MarketRegime } from '../types.ts';
import { calculateATR, calculateBollingerBands, calculateEMA, calculateMACD, calculateRSI } from './indicators.ts';

const BASE_WEIGHTS: Record<CompositeStrategyFamily, number> = {
  TREND: 0.25,
  MOMENTUM: 0.20,
  MEAN_REVERSION: 0.15,
  VOLUME: 0.20,
  VOLATILITY: 0.20,
};

const REGIME_MULTIPLIERS: Record<'TREND' | 'RANGE' | 'HIGH_VOLATILITY', Record<CompositeStrategyFamily, number>> = {
  TREND: { TREND: 1.3, MOMENTUM: 1.1, MEAN_REVERSION: 0.55, VOLUME: 1, VOLATILITY: 1.05 },
  RANGE: { TREND: 0.7, MOMENTUM: 0.95, MEAN_REVERSION: 1.5, VOLUME: 1, VOLATILITY: 0.8 },
  HIGH_VOLATILITY: { TREND: 1, MOMENTUM: 1, MEAN_REVERSION: 0.55, VOLUME: 1.05, VOLATILITY: 1.5 },
};

const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, places = 2) => Number(value.toFixed(places));

function regimeKey(regime: MarketRegime): 'TREND' | 'RANGE' | 'HIGH_VOLATILITY' {
  if (regime.type === 'HIGH_VOLATILITY') return 'HIGH_VOLATILITY';
  if (regime.type === 'RANGE') return 'RANGE';
  return 'TREND';
}

function supertrendDirection(candles: Candle[], atrPeriod = 10, multiplier = 3): -1 | 1 | null {
  if (candles.length < atrPeriod + 2) return null;
  const atr = calculateATR(candles, atrPeriod);
  let finalUpper = 0;
  let finalLower = 0;
  let direction: -1 | 1 = 1;
  let initialized = false;

  for (let i = atrPeriod; i < candles.length; i++) {
    const candle = candles[i];
    const mid = (candle.high + candle.low) / 2;
    const basicUpper = mid + multiplier * atr[i];
    const basicLower = mid - multiplier * atr[i];

    if (!initialized) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      direction = candle.close >= mid ? 1 : -1;
      initialized = true;
      continue;
    }

    const previousUpper = finalUpper;
    const previousLower = finalLower;
    finalUpper = basicUpper < previousUpper || candles[i - 1].close > previousUpper ? basicUpper : previousUpper;
    finalLower = basicLower > previousLower || candles[i - 1].close < previousLower ? basicLower : previousLower;

    if (direction === 1 && candle.close < finalLower) direction = -1;
    else if (direction === -1 && candle.close > finalUpper) direction = 1;
  }

  return initialized ? direction : null;
}

function emptyFamily(key: CompositeStrategyFamily, name: string, evidence: string): {
  key: CompositeStrategyFamily;
  name: string;
  score: number;
  baseWeight: number;
  effectiveWeight: number;
  available: boolean;
  evidence: string;
} {
  return { key, name, score: 0, baseWeight: BASE_WEIGHTS[key], effectiveWeight: 0, available: false, evidence };
}

export function calculateCompositeSignal(
  candles: Candle[],
  currentPrice: number,
  regime: MarketRegime,
): CompositeSignal | null {
  if (!candles.length || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const lastIndex = candles.length - 1;
  const atrSeries = calculateATR(candles, 14);
  const currentAtr = atrSeries[lastIndex] || 0;
  const families = [
    emptyFamily('TREND', 'Trend', 'Need 25+ candles for EMA and Supertrend.'),
    emptyFamily('MOMENTUM', 'Momentum', 'Need 35+ candles for RSI and MACD.'),
    emptyFamily('MEAN_REVERSION', 'Mean reversion', 'Need 20+ candles for Bollinger Bands.'),
    emptyFamily('VOLUME', 'OBV volume flow', 'Reliable candle volume is unavailable.'),
    emptyFamily('VOLATILITY', 'ATR breakout', 'Need 35+ candles to compare ATR and breakout range.'),
  ];

  if (candles.length >= 25 && currentAtr > 0) {
    const closes = candles.map((candle) => candle.close);
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const slopeIndex = Math.max(0, lastIndex - 3);
    const emaDirection = ema9[lastIndex] > ema21[lastIndex] ? 1 : ema9[lastIndex] < ema21[lastIndex] ? -1 : 0;
    const emaSlope = clamp((ema21[lastIndex] - ema21[slopeIndex]) / (currentAtr * 0.8));
    const emaScore = clamp(emaDirection * 0.65 + emaSlope * 0.35);
    const supertrend = supertrendDirection(candles);
    const trendScore = supertrend === null ? emaScore : clamp(emaScore * 0.55 + supertrend * 0.45);
    families[0] = {
      ...families[0],
      score: round(trendScore),
      available: true,
      evidence: `EMA 9/21 ${emaDirection > 0 ? 'bullish' : emaDirection < 0 ? 'bearish' : 'flat'} · EMA21 slope ${emaSlope >= 0 ? '+' : ''}${round(emaSlope)} · Supertrend ${supertrend === null ? 'unavailable' : supertrend > 0 ? 'up' : 'down'}`,
    };
  }

  if (candles.length >= 35 && currentAtr > 0) {
    const rsiSeries = calculateRSI(candles, 14);
    const macd = calculateMACD(candles, 12, 26, 9);
    const rsiScore = clamp((rsiSeries[lastIndex] - 50) / 25);
    const macdScore = clamp(macd.histogram[lastIndex] / (currentAtr * 0.08));
    const momentumScore = clamp(rsiScore * 0.45 + macdScore * 0.55);
    families[1] = {
      ...families[1],
      score: round(momentumScore),
      available: true,
      evidence: `RSI ${round(rsiSeries[lastIndex], 1)} · MACD histogram ${round(macd.histogram[lastIndex], 3)} · RSI ${rsiScore > 0.05 ? 'supports upside' : rsiScore < -0.05 ? 'supports downside' : 'neutral'}, MACD ${macdScore > 0.05 ? 'positive' : macdScore < -0.05 ? 'negative' : 'near zero'}`,
    };
  }

  if (candles.length >= 20) {
    const bands = calculateBollingerBands(candles, 20, 2);
    const upperDistance = bands.upper[lastIndex] - bands.middle[lastIndex];
    if (upperDistance > 0 && bands.lower[lastIndex] < bands.upper[lastIndex]) {
      const location = (currentPrice - bands.middle[lastIndex]) / upperDistance;
      const meanReversionScore = clamp(-location);
      families[2] = {
        ...families[2],
        score: round(meanReversionScore),
        available: true,
        evidence: `Bollinger location ${round(location, 2)}σ from mid · ${location <= -1 ? 'lower-band stretch' : location >= 1 ? 'upper-band stretch' : 'inside bands'}; weighted by ${regime.type} regime`,
      };
    }
  }

  const volumeLookback = candles.slice(-15);
  const usableVolume = volumeLookback.filter((candle) => !candle.volumeIsSynthetic && Number.isFinite(candle.volume) && candle.volume > 0);
  if (volumeLookback.length >= 14 && usableVolume.length >= Math.ceil(volumeLookback.length * 0.75)) {
    let signedVolume = 0;
    let totalVolume = 0;
    for (let i = 1; i < volumeLookback.length; i++) {
      const candle = volumeLookback[i];
      const previous = volumeLookback[i - 1];
      if (candle.volumeIsSynthetic || !Number.isFinite(candle.volume) || candle.volume <= 0) continue;
      const sign = candle.close > previous.close ? 1 : candle.close < previous.close ? -1 : 0;
      signedVolume += sign * candle.volume;
      totalVolume += candle.volume;
    }
    if (totalVolume > 0) {
      const volumeScore = clamp(signedVolume / totalVolume);
      families[3] = {
        ...families[3],
        score: round(volumeScore),
        available: true,
        evidence: `14-bar OBV-style signed volume flow ${volumeScore >= 0 ? '+' : ''}${round(volumeScore)} · uses feed candle volume as a proxy`,
      };
    }
  }

  if (candles.length >= 35 && currentAtr > 0) {
    const priorAtr = atrSeries.slice(Math.max(0, lastIndex - 20), lastIndex).filter((value) => value > 0);
    const priorRange = candles.slice(Math.max(0, lastIndex - 20), lastIndex);
    if (priorAtr.length >= 10 && priorRange.length >= 10) {
      const averageAtr = priorAtr.reduce((sum, value) => sum + value, 0) / priorAtr.length;
      const atrExpansion = averageAtr > 0 ? currentAtr / averageAtr : 1;
      const priorHigh = Math.max(...priorRange.map((candle) => candle.high));
      const priorLow = Math.min(...priorRange.map((candle) => candle.low));
      const expansionFactor = clamp((atrExpansion - 1.05) / 0.5, 0, 1);
      let breakoutScore = 0;
      if (currentPrice > priorHigh && expansionFactor > 0) {
        breakoutScore = expansionFactor * clamp(0.35 + (currentPrice - priorHigh) / (currentAtr * 0.25), 0.35, 1);
      } else if (currentPrice < priorLow && expansionFactor > 0) {
        breakoutScore = -expansionFactor * clamp(0.35 + (priorLow - currentPrice) / (currentAtr * 0.25), 0.35, 1);
      }
      families[4] = {
        ...families[4],
        score: round(breakoutScore),
        available: true,
        evidence: `ATR ${round(atrExpansion, 2)}× recent baseline · ${breakoutScore > 0 ? 'upside range break' : breakoutScore < 0 ? 'downside range break' : 'no expanding ATR breakout'}`,
      };
    }
  }

  const key = regimeKey(regime);
  const multipliers = REGIME_MULTIPLIERS[key];
  const availableWeight = families.reduce((sum, family) => sum + (family.available ? family.baseWeight * multipliers[family.key] : 0), 0);
  if (availableWeight <= 0) return null;

  let normalizedWeightTotal = 0;
  let finalAvailableFamilyIndex = -1;
  for (let index = 0; index < families.length; index++) {
    const family = families[index];
    family.effectiveWeight = family.available
      ? round((family.baseWeight * multipliers[family.key] / availableWeight) * 100, 1)
      : 0;
    if (family.available) {
      normalizedWeightTotal += family.effectiveWeight;
      finalAvailableFamilyIndex = index;
    }
  }

  // Keep the displayed/evaluated family weights at exactly 100 after rounding.
  if (finalAvailableFamilyIndex >= 0) {
    families[finalAvailableFamilyIndex].effectiveWeight = round(
      families[finalAvailableFamilyIndex].effectiveWeight + (100 - normalizedWeightTotal),
      1,
    );
  }

  const score = clamp(families.reduce((sum, family) => sum + family.score * family.effectiveWeight / 100, 0));
  const availableFamilies = families.filter((family) => family.available).length;
  const entryThreshold = 0.3;
  return {
    score: round(score),
    scorePercent: Math.round(score * 100),
    action: availableFamilies >= 3 && score >= entryThreshold ? 'LONG' : availableFamilies >= 3 && score <= -entryThreshold ? 'SHORT' : 'WAIT',
    entryThreshold,
    regime: key,
    availableFamilies,
    families,
  };
}
