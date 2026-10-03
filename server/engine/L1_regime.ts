import { Candle, MarketRegime, MarketRegimeType } from '../types.ts';
import { calculateADX, calculateATR, calculateBollingerBands } from './indicators.ts';

export function detectMarketRegime(candles: Candle[]): MarketRegime {
  if (candles.length < 30) {
    return {
      type: 'RANGE',
      confidence: 50,
      adx: 15,
      plusDI: 20,
      minusDI: 20,
      atrPercentile: 50,
      bbWidth: 0.005,
      isSqueeze: 0,
      description: 'Insufficient candles for regime confirmation. Defaulting to neutral range.',
      descriptionKm: 'ទិន្នន័យទៀនមិនទាន់គ្រប់គ្រាន់សម្រាប់ផ្ទៀងផ្ទាត់ Regime។ រក្សាជា Range អព្យាក្រឹត្យ។',
    };
  }

  const adxResult = calculateADX(candles, 14);
  const atrSeries = calculateATR(candles, 14);
  const bb = calculateBollingerBands(candles, 20, 2);

  const lastIdx = candles.length - 1;
  const currentADX = adxResult.adx[lastIdx] || 15;
  const currentPlusDI = adxResult.plusDI[lastIdx] || 20;
  const currentMinusDI = adxResult.minusDI[lastIdx] || 20;
  const currentATR = atrSeries[lastIdx] || 1.0;
  const currentBBWidth = bb.width[lastIdx] || 0.01;
  const isSqueeze = bb.isSqueeze[lastIdx] ? 1 : 0;

  // 1. Calculate ATR 80th percentile over past 200 candles (or available)
  const atrLookback = Math.min(200, atrSeries.length);
  const recentATRs = atrSeries.slice(atrSeries.length - atrLookback);
  const sortedATRs = [...recentATRs].sort((a, b) => a - b);
  const p80ATR = sortedATRs[Math.floor(sortedATRs.length * 0.8)] || currentATR;
  const atrPercentile = (sortedATRs.filter((v) => v <= currentATR).length / sortedATRs.length) * 100;

  // Recent candle range check
  const lastCandle = candles[lastIdx];
  const lastCandleRange = lastCandle.high - lastCandle.low;
  const isHugeCandle = lastCandleRange > 2.0 * currentATR;

  // Check structure for HH/HL vs LH/LL
  let higherHighs = 0;
  let lowerLows = 0;
  for (let i = candles.length - 6; i < candles.length; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].low >= candles[i - 1].low) {
      higherHighs++;
    } else if (candles[i].low < candles[i - 1].low && candles[i].high <= candles[i - 1].high) {
      lowerLows++;
    }
  }

  let type: MarketRegimeType = 'RANGE';
  let confidence = 60;
  let description = '';
  let descriptionKm = '';

  // Check High Volatility First
  if (currentATR > p80ATR || isHugeCandle || atrPercentile > 82) {
    type = 'HIGH_VOLATILITY';
    confidence = Math.min(95, Math.round(atrPercentile));
    description = `High Volatility regime. ATR is in ${Math.round(atrPercentile)}th percentile. Widen SL multiplier and require strict confirmation.`;
    descriptionKm = `ទីផ្សារប្រែប្រួលខ្លាំង (High Volatility)។ ATR ស្ថិតក្នុង percentile ទី ${Math.round(atrPercentile)}។ សូមពង្រីក SL និងរង់ចាំការបញ្ជាក់យ៉ាងតឹងរ៉ឹង។`;
  } else if (currentADX > 22 && (currentPlusDI > currentMinusDI || higherHighs >= 3)) {
    type = 'TREND_BULL';
    confidence = Math.min(95, Math.round(50 + (currentADX - 22) * 1.8 + (higherHighs * 5)));
    description = `Bullish Trend regime (ADX ${currentADX.toFixed(1)} > 22, +DI > -DI). Increased weight on BOS and discount pullbacks.`;
    descriptionKm = `និន្នាការឡើងខ្លាំង (Bullish Trend: ADX ${currentADX.toFixed(1)} > 22, +DI > -DI)។ បង្កើនទម្ងន់លើ BOS និងការទាញត្រឡប់ចូល Discount។`;
  } else if (currentADX > 22 && (currentMinusDI > currentPlusDI || lowerLows >= 3)) {
    type = 'TREND_BEAR';
    confidence = Math.min(95, Math.round(50 + (currentADX - 22) * 1.8 + (lowerLows * 5)));
    description = `Bearish Trend regime (ADX ${currentADX.toFixed(1)} > 22, -DI > +DI). Increased weight on downward BOS and premium pullbacks.`;
    descriptionKm = `និន្នាការចុះខ្លាំង (Bearish Trend: ADX ${currentADX.toFixed(1)} > 22, -DI > +DI)។ បង្កើនទម្ងន់លើ BOS ចុះ និងការទាញឡើងចូល Premium។`;
  } else {
    type = 'RANGE';
    confidence = Math.min(90, Math.round(75 - currentADX));
    description = `Sideways Range regime (ADX ${currentADX.toFixed(1)} < 22). Increased weight on liquidity sweeps and mean-reversion order blocks.`;
    descriptionKm = `ទីផ្សាររត់ក្នុងប្រអប់ Sideways (ADX ${currentADX.toFixed(1)} < 22)។ បង្កើនទម្ងន់លើ Liquidity Sweeps និង Order Block ត្រឡប់មកមធ្យមភាគ។`;
  }

  return {
    type,
    confidence,
    adx: currentADX,
    plusDI: currentPlusDI,
    minusDI: currentMinusDI,
    atrPercentile: Math.round(atrPercentile),
    bbWidth: currentBBWidth,
    isSqueeze,
    description,
    descriptionKm,
  };
}
