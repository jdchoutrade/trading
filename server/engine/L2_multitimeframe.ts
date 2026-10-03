import { BiasType, Candle, MultiTimeframeBias } from '../types.ts';
import { calculateEMA } from './indicators.ts';

export function analyzeMultiTimeframe(
  m1Candles: Candle[],
  m5Candles: Candle[],
  m15Candles: Candle[],
  h1Candles: Candle[],
  h4Candles: Candle[]
): MultiTimeframeBias {
  // 1. Analyze H1 Bias
  const h1Closes = h1Candles.map((c) => c.close);
  const h1Ema50Series = calculateEMA(h1Closes, 50);
  const h1Ema200Series = calculateEMA(h1Closes, 200);

  const lastH1Idx = h1Candles.length - 1;
  const currentH1Price = h1Closes[lastH1Idx] || 0;
  const h1Ema50 = h1Ema50Series[lastH1Idx] || currentH1Price;
  const h1Ema200 = h1Ema200Series[lastH1Idx] || currentH1Price;

  // H1 Dealing range (past 48 H1 candles = 2 days)
  const dealingSlice = h1Candles.slice(Math.max(0, h1Candles.length - 48));
  let high = -Infinity;
  let low = Infinity;
  for (const c of dealingSlice) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  if (high === -Infinity) high = currentH1Price + 10;
  if (low === Infinity) low = currentH1Price - 10;

  const mid = (high + low) / 2;
  const premiumDiscountZone =
    currentH1Price > mid + (high - low) * 0.05
      ? 'PREMIUM'
      : currentH1Price < mid - (high - low) * 0.05
      ? 'DISCOUNT'
      : 'EQUILIBRIUM';

  // Determine H1 Bias
  let h1Bias: BiasType = 'NEUTRAL';
  if (currentH1Price > h1Ema50 && h1Ema50 >= h1Ema200) {
    h1Bias = 'BULL';
  } else if (currentH1Price < h1Ema50 && h1Ema50 <= h1Ema200) {
    h1Bias = 'BEAR';
  } else if (currentH1Price > h1Ema200) {
    h1Bias = 'BULL';
  } else if (currentH1Price < h1Ema200) {
    h1Bias = 'BEAR';
  }

  // 2. Analyze H4 Bias
  const h4Closes = h4Candles.map((c) => c.close);
  const h4Ema50Series = calculateEMA(h4Closes, 50);
  const lastH4Idx = h4Candles.length - 1;
  const currentH4Price = h4Closes[lastH4Idx] || currentH1Price;
  const h4Ema50 = h4Ema50Series[lastH4Idx] || currentH4Price;
  const h4Bias: BiasType = currentH4Price > h4Ema50 ? 'BULL' : currentH4Price < h4Ema50 ? 'BEAR' : 'NEUTRAL';

  // 3. Analyze M15 Structure
  let m15Structure: BiasType = 'NEUTRAL';
  if (m15Candles.length >= 10) {
    const recentM15 = m15Candles.slice(-10);
    const m15Highs = recentM15.map((c) => c.high);
    const m15Lows = recentM15.map((c) => c.low);
    const isHigherHighs = m15Highs[m15Highs.length - 1] > m15Highs[m15Highs.length - 4];
    const isHigherLows = m15Lows[m15Lows.length - 1] > m15Lows[m15Lows.length - 4];
    const isLowerLows = m15Lows[m15Lows.length - 1] < m15Lows[m15Lows.length - 4];
    const isLowerHighs = m15Highs[m15Highs.length - 1] < m15Highs[m15Highs.length - 4];

    if (isHigherHighs && isHigherLows) {
      m15Structure = 'BULL';
    } else if (isLowerLows && isLowerHighs) {
      m15Structure = 'BEAR';
    } else {
      m15Structure = h1Bias;
    }
  }

  // 4. M5 Trigger state
  let m5Trigger: 'BUY_READY' | 'SELL_READY' | 'WAIT' = 'WAIT';
  if (m5Candles.length >= 3) {
    const last3 = m5Candles.slice(-3);
    const currentM5 = last3[2];
    const prevM5 = last3[1];

    // Bullish trigger: hammer or engulfing close above previous high
    if (currentM5.close > prevM5.high && currentM5.close > currentM5.open) {
      m5Trigger = 'BUY_READY';
    } else if (currentM5.close < prevM5.low && currentM5.close < currentM5.open) {
      m5Trigger = 'SELL_READY';
    }
  }

  // Multi-timeframe alignment score
  let alignmentScore = 50;
  if (h4Bias === h1Bias && h1Bias === m15Structure) {
    alignmentScore = 95;
  } else if (h1Bias === m15Structure) {
    alignmentScore = 80;
  } else if (h4Bias === h1Bias) {
    alignmentScore = 70;
  } else {
    alignmentScore = 40;
  }

  return {
    h4Bias,
    h1Bias,
    m15Structure,
    m5Trigger,
    alignmentScore,
    h1Ema50,
    h1Ema200,
    premiumDiscountZone,
    dealingRange: { high, low, mid },
  };
}
