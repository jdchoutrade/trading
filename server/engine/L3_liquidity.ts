import { Candle, LiquidityLevel } from '../types.ts';
import { calculateATR } from './indicators.ts';

export function identifyLiquidityLevels(
  candles: Candle[],
  timeframeStr: string = '15m'
): LiquidityLevel[] {
  if (candles.length < 15) return [];

  const levels: LiquidityLevel[] = [];
  const atrs = calculateATR(candles, 14);
  const currentATR = atrs[atrs.length - 1] || 2.0;
  const eqTolerance = 0.12 * currentATR;

  // 1. Fractal Swing Highs and Lows (n = 3)
  for (let i = 3; i < candles.length - 3; i++) {
    const c = candles[i];

    // Swing High
    const isSwingHigh =
      c.high > candles[i - 1].high &&
      c.high > candles[i - 2].high &&
      c.high > candles[i - 3].high &&
      c.high > candles[i + 1].high &&
      c.high > candles[i + 2].high &&
      c.high > candles[i + 3].high;

    if (isSwingHigh) {
      // Check if swept by subsequent candles
      let swept = false;
      let sweptTime: number | undefined;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].high > c.high) {
          swept = true;
          sweptTime = candles[j].time;
          break;
        }
      }

      levels.push({
        id: `sh_${c.time}`,
        price: Number(c.high.toFixed(2)),
        type: 'SWING_HIGH',
        time: c.time,
        swept,
        sweptTime,
        label: `Swing H (${c.high.toFixed(2)})`,
        strength: 3,
      });
    }

    // Swing Low
    const isSwingLow =
      c.low < candles[i - 1].low &&
      c.low < candles[i - 2].low &&
      c.low < candles[i - 3].low &&
      c.low < candles[i + 1].low &&
      c.low < candles[i + 2].low &&
      c.low < candles[i + 3].low;

    if (isSwingLow) {
      let swept = false;
      let sweptTime: number | undefined;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].low < c.low) {
          swept = true;
          sweptTime = candles[j].time;
          break;
        }
      }

      levels.push({
        id: `sl_${c.time}`,
        price: Number(c.low.toFixed(2)),
        type: 'SWING_LOW',
        time: c.time,
        swept,
        sweptTime,
        label: `Swing L (${c.low.toFixed(2)})`,
        strength: 3,
      });
    }
  }

  // 2. Equal Highs (EQH) and Equal Lows (EQL)
  const swingHighs = levels.filter((l) => l.type === 'SWING_HIGH' && !l.swept);
  for (let i = 0; i < swingHighs.length; i++) {
    for (let j = i + 1; j < swingHighs.length; j++) {
      if (Math.abs(swingHighs[i].price - swingHighs[j].price) <= eqTolerance) {
        levels.push({
          id: `eqh_${swingHighs[j].time}`,
          price: Number(((swingHighs[i].price + swingHighs[j].price) / 2).toFixed(2)),
          type: 'EQUAL_HIGH',
          time: swingHighs[j].time,
          swept: false,
          label: `EQH Buy-Side Liquidity (${swingHighs[i].price.toFixed(2)})`,
          strength: 5,
        });
      }
    }
  }

  const swingLows = levels.filter((l) => l.type === 'SWING_LOW' && !l.swept);
  for (let i = 0; i < swingLows.length; i++) {
    for (let j = i + 1; j < swingLows.length; j++) {
      if (Math.abs(swingLows[i].price - swingLows[j].price) <= eqTolerance) {
        levels.push({
          id: `eql_${swingLows[j].time}`,
          price: Number(((swingLows[i].price + swingLows[j].price) / 2).toFixed(2)),
          type: 'EQUAL_LOW',
          time: swingLows[j].time,
          swept: false,
          label: `EQL Sell-Side Liquidity (${swingLows[i].price.toFixed(2)})`,
          strength: 5,
        });
      }
    }
  }

  // 3. Round Numbers (xx00 and xx50 for Gold)
  const currentPrice = candles[candles.length - 1].close;
  const baseRound = Math.floor(currentPrice / 50) * 50;
  const candidateRounds = [baseRound - 50, baseRound, baseRound + 50, baseRound + 100];

  for (const r of candidateRounds) {
    if (Math.abs(currentPrice - r) < 80) {
      levels.push({
        id: `rn_${r}`,
        price: r,
        type: 'ROUND_NUMBER',
        time: candles[candles.length - 1].time,
        swept: false,
        label: `Round Level ${r.toFixed(0)}`,
        strength: 4,
      });
    }
  }

  return levels;
}
