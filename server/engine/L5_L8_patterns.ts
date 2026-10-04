import { Candle } from '../types.ts';
import {
  calculateADX,
  calculateATR,
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateVWAP,
} from './indicators.ts';

export interface MomentumAnalysis {
  rsi: number;
  rsiDivergence: 'BULLISH_DIV' | 'BEARISH_DIV' | 'NONE';
  macdHistogram: number;
  macdSlope: 'EXPANDING_UP' | 'CONTRACTING_DOWN' | 'EXPANDING_DOWN' | 'CONTRACTING_UP';
  diCross: 'BULL_CROSS' | 'BEAR_CROSS' | 'NONE';
}

export interface VolumeAnalysis {
  currentVolume: number;
  smaVolume: number;
  isVolumeSpike: boolean;
  volumeRatio: number;
  vwap: number;
  vwapUpper: number;
  vwapLower: number;
  vwapAvailable: boolean;
  priceVsVwap: 'ABOVE' | 'BELOW' | 'AT_VWAP';
}

export interface CandlePatternAnalysis {
  isBullishEngulfing: boolean;
  isBearishEngulfing: boolean;
  isBullishRejection: boolean; // lower wick >= 60% range
  isBearishRejection: boolean; // upper wick >= 60% range
  isInsideBarBreakout: 'BULL_BREAK' | 'BEAR_BREAK' | 'NONE';
}

export function analyzeMomentum(candles: Candle[]): MomentumAnalysis {
  if (candles.length < 20) {
    return {
      rsi: 50,
      rsiDivergence: 'NONE',
      macdHistogram: 0,
      macdSlope: 'EXPANDING_UP',
      diCross: 'NONE',
    };
  }

  const rsiSeries = calculateRSI(candles, 14);
  const macdSeries = calculateMACD(candles, 12, 26, 9);
  const adxSeries = calculateADX(candles, 14);

  const lastIdx = candles.length - 1;
  const currentRsi = rsiSeries[lastIdx] || 50;
  const currentHist = macdSeries.histogram[lastIdx] || 0;
  const prevHist = macdSeries.histogram[lastIdx - 1] || 0;

  let macdSlope: MomentumAnalysis['macdSlope'] = 'EXPANDING_UP';
  if (currentHist > 0) {
    macdSlope = currentHist >= prevHist ? 'EXPANDING_UP' : 'CONTRACTING_DOWN';
  } else {
    macdSlope = currentHist <= prevHist ? 'EXPANDING_DOWN' : 'CONTRACTING_UP';
  }

  // DI Cross check in past 3 candles
  let diCross: MomentumAnalysis['diCross'] = 'NONE';
  const pDI = adxSeries.plusDI;
  const mDI = adxSeries.minusDI;
  if (pDI[lastIdx] > mDI[lastIdx] && pDI[lastIdx - 1] <= mDI[lastIdx - 1]) {
    diCross = 'BULL_CROSS';
  } else if (mDI[lastIdx] > pDI[lastIdx] && mDI[lastIdx - 1] <= pDI[lastIdx - 1]) {
    diCross = 'BEAR_CROSS';
  }

  // RSI Divergence detection over last 14 candles
  let rsiDivergence: MomentumAnalysis['rsiDivergence'] = 'NONE';
  if (candles.length >= 15) {
    const lookback = candles.slice(-14);
    const rsiSlice = rsiSeries.slice(-14);

    // Bullish divergence: price makes Lower Low, RSI makes Higher Low
    const priceLowNow = lookback[lookback.length - 1].low;
    const priceLowPrev = Math.min(...lookback.slice(0, 10).map((c) => c.low));
    const rsiNow = rsiSlice[rsiSlice.length - 1];
    const rsiPrev = Math.min(...rsiSlice.slice(0, 10));

    if (priceLowNow < priceLowPrev && rsiNow > rsiPrev && rsiNow < 45) {
      rsiDivergence = 'BULLISH_DIV';
    }

    // Bearish divergence: price makes Higher High, RSI makes Lower High
    const priceHighNow = lookback[lookback.length - 1].high;
    const priceHighPrev = Math.max(...lookback.slice(0, 10).map((c) => c.high));
    const rsiHighNow = rsiSlice[rsiSlice.length - 1];
    const rsiHighPrev = Math.max(...rsiSlice.slice(0, 10));

    if (priceHighNow > priceHighPrev && rsiHighNow < rsiHighPrev && rsiHighNow > 55) {
      rsiDivergence = 'BEARISH_DIV';
    }
  }

  return {
    rsi: Number(currentRsi.toFixed(1)),
    rsiDivergence,
    macdHistogram: Number(currentHist.toFixed(3)),
    macdSlope,
    diCross,
  };
}

export function analyzeVolumeAndVWAP(candles: Candle[]): VolumeAnalysis {
  if (candles.length < 5) {
    const p = candles[candles.length - 1]?.close || 0;
    return {
      currentVolume: 100,
      smaVolume: 100,
      isVolumeSpike: false,
      volumeRatio: 1,
      vwap: p,
      vwapUpper: p + 5,
      vwapLower: p - 5,
      vwapAvailable: false,
      priceVsVwap: 'AT_VWAP',
    };
  }

  const vwapResult = calculateVWAP(candles);
  const lastIdx = candles.length - 1;
  const currentCandle = candles[lastIdx];
  const curVwap = vwapResult.vwap[lastIdx];
  const upperVwap = vwapResult.upperBand[lastIdx];
  const lowerVwap = vwapResult.lowerBand[lastIdx];
  const vwapAvailable = candles.some((candle) => !candle.volumeIsSynthetic && Number.isFinite(candle.volume) && candle.volume > 0);

  // Volume SMA 20
  const volSlice = candles.slice(Math.max(0, candles.length - 21), candles.length - 1);
  const observedVolSlice = volSlice.filter((candle) => !candle.volumeIsSynthetic && Number.isFinite(candle.volume) && candle.volume > 0);
  const sumVol = observedVolSlice.reduce((acc, c) => acc + c.volume, 0);
  const smaVolume = sumVol / (observedVolSlice.length || 1);
  const currentVolume = !currentCandle.volumeIsSynthetic && Number.isFinite(currentCandle.volume) && currentCandle.volume > 0
    ? currentCandle.volume
    : 0;
  const volumeRatio = currentVolume > 0 && smaVolume > 0 ? Number((currentVolume / smaVolume).toFixed(2)) : 0;
  const isVolumeSpike = volumeRatio >= 1.8;

  const priceVsVwap = !vwapAvailable
    ? 'AT_VWAP'
    : currentCandle.close > curVwap + 0.5 ? 'ABOVE' : currentCandle.close < curVwap - 0.5 ? 'BELOW' : 'AT_VWAP';

  return {
    currentVolume,
    smaVolume: Math.round(smaVolume),
    isVolumeSpike,
    volumeRatio,
    vwap: Number(curVwap.toFixed(2)),
    vwapUpper: Number(upperVwap.toFixed(2)),
    vwapLower: Number(lowerVwap.toFixed(2)),
    vwapAvailable,
    priceVsVwap,
  };
}

export function analyzeCandlePatterns(candles: Candle[]): CandlePatternAnalysis {
  if (candles.length < 3) {
    return {
      isBullishEngulfing: false,
      isBearishEngulfing: false,
      isBullishRejection: false,
      isBearishRejection: false,
      isInsideBarBreakout: 'NONE',
    };
  }

  const c = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const totalRange = c.high - c.low || 0.001;

  // Rejection wicks (wick >= 60% of total candle range)
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);

  const isBullishRejection = lowerWick / totalRange >= 0.6;
  const isBearishRejection = upperWick / totalRange >= 0.6;

  // Engulfing
  const isBullishEngulfing =
    prev.close < prev.open &&
    c.close > c.open &&
    c.close > prev.high &&
    c.open <= prev.close;

  const isBearishEngulfing =
    prev.close > prev.open &&
    c.close < c.open &&
    c.close < prev.low &&
    c.open >= prev.close;

  // Inside-bar breakout
  let isInsideBarBreakout: CandlePatternAnalysis['isInsideBarBreakout'] = 'NONE';
  if (candles.length >= 4) {
    const motherBar = candles[candles.length - 3];
    const insideBar = candles[candles.length - 2];

    const isInside = insideBar.high <= motherBar.high && insideBar.low >= motherBar.low;
    if (isInside) {
      if (c.close > motherBar.high) isInsideBarBreakout = 'BULL_BREAK';
      else if (c.close < motherBar.low) isInsideBarBreakout = 'BEAR_BREAK';
    }
  }

  return {
    isBullishEngulfing,
    isBearishEngulfing,
    isBullishRejection,
    isBearishRejection,
    isInsideBarBreakout,
  };
}
