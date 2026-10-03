import type { Candle, Timeframe } from '../types.ts';

const goldCandleRangeLimits: Record<Timeframe, number> = {
  '1m': 0.02,
  '5m': 0.03,
  '15m': 0.05,
  '1h': 0.10,
  '4h': 0.20,
  D: 0.35,
};

/** Drop malformed feed bars before they can flatten chart scales or live quotes. */
export function cleanChartCandles(candles: Candle[], symbol: string, timeframe: Timeframe): Candle[] {
  const validByTime = new Map<number, Candle>();
  const maxGoldRange = goldCandleRangeLimits[timeframe];

  for (const candle of candles) {
    const time = Number(candle.time);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const prices = [open, high, low, close];
    if (!Number.isFinite(time) || time <= 0 || prices.some((price) => !Number.isFinite(price) || price <= 0)) continue;
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
    if (symbol.toUpperCase().includes('XAU') && (high - low) / close > maxGoldRange) continue;

    validByTime.set(time, { ...candle, time, open, high, low, close });
  }

  return [...validByTime.values()].sort((a, b) => a.time - b.time);
}
