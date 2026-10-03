import { Candle } from '../types.ts';

export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const result: number[] = new Array(values.length);
  const k = 2 / (period + 1);

  // Initialize first EMA with SMA of first period elements or first element
  let sum = 0;
  const initialPeriod = Math.min(period, values.length);
  for (let i = 0; i < initialPeriod; i++) {
    sum += values[i];
    result[i] = sum / (i + 1);
  }

  for (let i = initialPeriod; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function calculateATR(candles: Candle[], period: number = 14): number[] {
  if (candles.length < 2) return candles.map(() => 0);
  const tr: number[] = [candles[0].high - candles[0].low];

  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }

  const atr: number[] = new Array(candles.length);
  let trSum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) {
    trSum += tr[i];
    atr[i] = trSum / (i + 1);
  }

  for (let i = period; i < tr.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

export interface BollingerBandsResult {
  middle: number[];
  upper: number[];
  lower: number[];
  width: number[];
  isSqueeze: boolean[];
}

export function calculateBollingerBands(
  candles: Candle[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandsResult {
  const n = candles.length;
  const middle = new Array(n).fill(0);
  const upper = new Array(n).fill(0);
  const lower = new Array(n).fill(0);
  const width = new Array(n).fill(0);
  const isSqueeze = new Array(n).fill(false);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - period + 1);
    const count = i - start + 1;
    let sum = 0;
    for (let j = start; j <= i; j++) {
      sum += candles[j].close;
    }
    const sma = sum / count;
    middle[i] = sma;

    let varianceSum = 0;
    for (let j = start; j <= i; j++) {
      varianceSum += Math.pow(candles[j].close - sma, 2);
    }
    const stdDev = Math.sqrt(varianceSum / count);
    upper[i] = sma + stdDevMultiplier * stdDev;
    lower[i] = sma - stdDevMultiplier * stdDev;
    width[i] = sma > 0 ? (upper[i] - lower[i]) / sma : 0;
  }

  // Squeeze: current width is in the lowest 20th percentile of past 50 bars
  for (let i = 20; i < n; i++) {
    const sample = width.slice(Math.max(0, i - 50), i + 1);
    const sorted = [...sample].sort((a, b) => a - b);
    const threshold = sorted[Math.floor(sorted.length * 0.2)] || 0;
    isSqueeze[i] = width[i] <= threshold;
  }

  return { middle, upper, lower, width, isSqueeze };
}

export function calculateRSI(candles: Candle[], period: number = 14): number[] {
  const n = candles.length;
  if (n < 2) return candles.map(() => 50);

  const rsi = new Array(n).fill(50);
  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= Math.min(period, n - 1); i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss += Math.abs(diff);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  if (period < n) {
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  for (let i = period + 1; i < n; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const currentGain = diff >= 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - 100 / (1 + rs);
    }
  }

  return rsi;
}

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const closes = candles.map((c) => c.close);
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  const macdLine = closes.map((_, i) => fastEMA[i] - slowEMA[i]);
  const signalLine = calculateEMA(macdLine, signalPeriod);
  const histogram = macdLine.map((val, i) => val - signalLine[i]);

  return { macd: macdLine, signal: signalLine, histogram };
}

export interface ADXResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function calculateADX(candles: Candle[], period: number = 14): ADXResult {
  const n = candles.length;
  const adx = new Array(n).fill(0);
  const plusDI = new Array(n).fill(0);
  const minusDI = new Array(n).fill(0);

  if (n < period + 1) {
    return { adx, plusDI, minusDI };
  }

  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];

  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const prevH = candles[i - 1].high;
    const prevL = candles[i - 1].low;
    const prevC = candles[i - 1].close;

    const trVal = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    tr.push(trVal);

    const upMove = h - prevH;
    const downMove = prevL - l;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  // Smooth TR, +DM, -DM
  let smoothTR = 0;
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;

  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i];
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
  }

  const dxList: number[] = new Array(n).fill(0);

  for (let i = period; i < n; i++) {
    if (i > period) {
      smoothTR = smoothTR - smoothTR / period + tr[i];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    }

    const pDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const mDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

    plusDI[i] = pDI;
    minusDI[i] = mDI;

    const diSum = pDI + mDI;
    const dx = diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0;
    dxList[i] = dx;
  }

  // ADX is smoothed DX
  let dxSum = 0;
  for (let i = period; i < Math.min(period * 2, n); i++) {
    dxSum += dxList[i];
  }
  let currentADX = dxSum / period;
  if (period * 2 - 1 < n) {
    adx[period * 2 - 1] = currentADX;
  }

  for (let i = period * 2; i < n; i++) {
    currentADX = (currentADX * (period - 1) + dxList[i]) / period;
    adx[i] = currentADX;
  }

  return { adx, plusDI, minusDI };
}

export interface VWAPResult {
  vwap: number[];
  upperBand: number[];
  lowerBand: number[];
}

export function calculateVWAP(candles: Candle[]): VWAPResult {
  const n = candles.length;
  const vwap = new Array(n).fill(0);
  const upperBand = new Array(n).fill(0);
  const lowerBand = new Array(n).fill(0);

  let cumulativeTPV = 0;
  let cumulativeVol = 0;
  let cumulativeTPVSq = 0;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 1;

    cumulativeTPV += typicalPrice * vol;
    cumulativeVol += vol;
    cumulativeTPVSq += typicalPrice * typicalPrice * vol;

    const currentVwap = cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : typicalPrice;
    vwap[i] = currentVwap;

    // Variance for +/- 1 sigma bands
    const variance = cumulativeVol > 0 ? Math.max(0, cumulativeTPVSq / cumulativeVol - currentVwap * currentVwap) : 0;
    const stdDev = Math.sqrt(variance);

    upperBand[i] = currentVwap + stdDev;
    lowerBand[i] = currentVwap - stdDev;
  }

  return { vwap, upperBand, lowerBand };
}
