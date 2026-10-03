import { Candle, FVG, LiquidityLevel, LiquiditySweep, OrderBlock, StructureBreak, Timeframe } from '../types.ts';
import { calculateATR } from './indicators.ts';

export function detectBOSAndCHoCH(
  candles: Candle[],
  liquidityLevels: LiquidityLevel[],
  timeframe: Timeframe = '15m'
): StructureBreak[] {
  const breaks: StructureBreak[] = [];
  if (candles.length < 5) return breaks;

  const swingHighs = liquidityLevels.filter((l) => l.type === 'SWING_HIGH');
  const swingLows = liquidityLevels.filter((l) => l.type === 'SWING_LOW');

  // Check recent candle body breaks
  const lookbackStart = Math.max(1, candles.length - 20);
  for (let i = lookbackStart; i < candles.length; i++) {
    const c = candles[i];
    const prevCandle = candles[i - 1];
    const bodyHigh = Math.max(c.open, c.close);
    const bodyLow = Math.min(c.open, c.close);

    // Bullish break: candle body closes strictly ABOVE a swing high
    for (const sh of swingHighs) {
      if (sh.time < c.time && bodyHigh > sh.price && prevCandle.close <= sh.price) {
        // Is it BOS (continuation) or CHoCH (trend change)?
        const isChoch = prevCandle.close < prevCandle.open && c.close > c.open;
        breaks.push({
          type: isChoch ? 'CHOCH' : 'BOS',
          direction: 'BULLISH',
          time: c.time,
          brokenLevel: sh.price,
          closePrice: c.close,
          timeframe,
          status: 'CONFIRMED',
        });
      }
    }

    // Bearish break: candle body closes strictly BELOW a swing low
    for (const sl of swingLows) {
      if (sl.time < c.time && bodyLow < sl.price && prevCandle.close >= sl.price) {
        const isChoch = prevCandle.close > prevCandle.open && c.close < c.open;
        breaks.push({
          type: isChoch ? 'CHOCH' : 'BOS',
          direction: 'BEARISH',
          time: c.time,
          brokenLevel: sl.price,
          closePrice: c.close,
          timeframe,
          status: 'CONFIRMED',
        });
      }
    }
  }

  return breaks.slice(-10); // keep last 10 breaks
}

export function detectOrderBlocks(
  candles: Candle[],
  timeframe: Timeframe = '15m'
): OrderBlock[] {
  const orderBlocks: OrderBlock[] = [];
  if (candles.length < 10) return orderBlocks;

  const atrs = calculateATR(candles, 14);

  // Scan through candles to find displacement moves (> 1.4x ATR)
  for (let i = 2; i < candles.length - 1; i++) {
    const c0 = candles[i - 1]; // Candidate OB candle
    const c1 = candles[i];     // Displacement candle 1
    const c2 = candles[i + 1]; // Displacement candle 2
    const localATR = atrs[i] || 1.5;

    // Bullish OB: Bearish candle (c0.close < c0.open) followed by strong upward displacement
    const upwardDisplacement = c1.close - c1.open + (c2 ? Math.max(0, c2.close - c2.open) : 0);
    if (c0.close < c0.open && upwardDisplacement > 1.3 * localATR) {
      const obHigh = c0.high;
      const obLow = c0.low;
      const obMid = (obHigh + obLow) / 2;

      // Check if subsequent candles mitigated this OB
      let mitigated = false;
      let mitigatedTime: number | undefined;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].low <= obHigh && candles[j].high >= obLow) {
          mitigated = true;
          mitigatedTime = candles[j].time;
          break;
        }
      }

      const strength = Math.min(10, Math.max(4, Math.round((upwardDisplacement / localATR) * 3)));

      orderBlocks.push({
        id: `ob_bull_${c0.time}`,
        type: 'BULLISH',
        high: Number(obHigh.toFixed(2)),
        low: Number(obLow.toFixed(2)),
        mid: Number(obMid.toFixed(2)),
        time: c0.time,
        timeframe,
        mitigated,
        mitigatedTime,
        strength,
        displacementSize: Number(upwardDisplacement.toFixed(2)),
        status: 'CONFIRMED',
      });
    }

    // Bearish OB: Bullish candle (c0.close > c0.open) followed by strong downward displacement
    const downwardDisplacement = c1.open - c1.close + (c2 ? Math.max(0, c2.open - c2.close) : 0);
    if (c0.close > c0.open && downwardDisplacement > 1.3 * localATR) {
      const obHigh = c0.high;
      const obLow = c0.low;
      const obMid = (obHigh + obLow) / 2;

      let mitigated = false;
      let mitigatedTime: number | undefined;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].high >= obLow && candles[j].low <= obHigh) {
          mitigated = true;
          mitigatedTime = candles[j].time;
          break;
        }
      }

      const strength = Math.min(10, Math.max(4, Math.round((downwardDisplacement / localATR) * 3)));

      orderBlocks.push({
        id: `ob_bear_${c0.time}`,
        type: 'BEARISH',
        high: Number(obHigh.toFixed(2)),
        low: Number(obLow.toFixed(2)),
        mid: Number(obMid.toFixed(2)),
        time: c0.time,
        timeframe,
        mitigated,
        mitigatedTime,
        strength,
        displacementSize: Number(downwardDisplacement.toFixed(2)),
        status: 'CONFIRMED',
      });
    }
  }

  return orderBlocks.slice(-8); // return recent relevant order blocks
}

export function detectFVGs(
  candles: Candle[],
  timeframe: Timeframe = '15m'
): FVG[] {
  const fvgs: FVG[] = [];
  if (candles.length < 5) return fvgs;

  const atrs = calculateATR(candles, 14);

  // 3-candle imbalance
  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c1 = candles[i - 1]; // Big impulse candle
    const c2 = candles[i];
    const localATR = atrs[i] || 1.5;
    const minGap = 0.3 * localATR;

    // Bullish FVG: Low of candle 3 is higher than High of candle 1
    if (c2.low > c0.high && (c2.low - c0.high) >= minGap && c1.close > c1.open) {
      const top = c2.low;
      const bottom = c0.high;
      const mid = (top + bottom) / 2;
      const gapSize = top - bottom;

      // Check fill status in remaining candles
      let lowestFill = top;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].low < lowestFill) {
          lowestFill = candles[j].low;
        }
      }

      const fillPercentage = Math.min(100, Math.max(0, Math.round(((top - lowestFill) / gapSize) * 100)));
      const filled = fillPercentage >= 100;

      fvgs.push({
        id: `fvg_bull_${c1.time}`,
        type: 'BULLISH',
        top: Number(top.toFixed(2)),
        bottom: Number(bottom.toFixed(2)),
        mid: Number(mid.toFixed(2)),
        time: c1.time,
        timeframe,
        filled,
        fillPercentage,
        size: Number(gapSize.toFixed(2)),
        status: 'CONFIRMED',
      });
    }

    // Bearish FVG: High of candle 3 is lower than Low of candle 1
    if (c2.high < c0.low && (c0.low - c2.high) >= minGap && c1.close < c1.open) {
      const top = c0.low;
      const bottom = c2.high;
      const mid = (top + bottom) / 2;
      const gapSize = top - bottom;

      let highestFill = bottom;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].high > highestFill) {
          highestFill = candles[j].high;
        }
      }

      const fillPercentage = Math.min(100, Math.max(0, Math.round(((highestFill - bottom) / gapSize) * 100)));
      const filled = fillPercentage >= 100;

      fvgs.push({
        id: `fvg_bear_${c1.time}`,
        type: 'BEARISH',
        top: Number(top.toFixed(2)),
        bottom: Number(bottom.toFixed(2)),
        mid: Number(mid.toFixed(2)),
        time: c1.time,
        timeframe,
        filled,
        fillPercentage,
        size: Number(gapSize.toFixed(2)),
        status: 'CONFIRMED',
      });
    }
  }

  return fvgs.slice(-10);
}

export function detectLiquiditySweeps(
  candles: Candle[],
  levels: LiquidityLevel[]
): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  if (candles.length < 5) return sweeps;

  const recentCandles = candles.slice(-15);
  for (const c of recentCandles) {
    for (const lvl of levels) {
      if (lvl.time >= c.time) continue;

      // Bullish sweep: Wick goes lower than swing low / EQL, but candle body closes back ABOVE it
      if (
        (lvl.type === 'SWING_LOW' || lvl.type === 'EQUAL_LOW' || lvl.type === 'ASIA_LOW') &&
        c.low < lvl.price &&
        c.close > lvl.price
      ) {
        sweeps.push({
          time: c.time,
          levelType: lvl.type,
          levelPrice: lvl.price,
          sweepPrice: c.low,
          closePrice: c.close,
          direction: 'BULLISH_SWEEP',
        });
      }

      // Bearish sweep: Wick goes higher than swing high / EQH, but candle body closes back BELOW it
      if (
        (lvl.type === 'SWING_HIGH' || lvl.type === 'EQUAL_HIGH' || lvl.type === 'ASIA_HIGH') &&
        c.high > lvl.price &&
        c.close < lvl.price
      ) {
        sweeps.push({
          time: c.time,
          levelType: lvl.type,
          levelPrice: lvl.price,
          sweepPrice: c.high,
          closePrice: c.close,
          direction: 'BEARISH_SWEEP',
        });
      }
    }
  }

  return sweeps.slice(-6);
}
