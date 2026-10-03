import { describe, expect, it } from 'vitest';
import { TickAggregator } from '../server/market/aggregator.ts';

describe('TickAggregator Pure Calculation & Integrity Suite', () => {
  it('computes exact UTC timeframe buckets', () => {
    // 1790858700 is an exact 15m bucket (1989843 * 900)
    const t0 = 1790858700;
    const timestamp = t0 + 145; // 2m25s into the 15m bucket

    // 1m bucket should be t0 + 120 (2 minutes)
    expect(TickAggregator.computeBucket(timestamp, '1m')).toBe(t0 + 120);

    // 5m bucket should be t0
    expect(TickAggregator.computeBucket(timestamp, '5m')).toBe(t0);

    // 15m bucket should be t0
    expect(TickAggregator.computeBucket(timestamp, '15m')).toBe(t0);

    // 1h bucket
    const expected1h = Math.floor(timestamp / 3600) * 3600;
    expect(TickAggregator.computeBucket(timestamp, '1h')).toBe(expected1h);
  });

  it('aggregates ticks into a single forming candle correctly', () => {
    const agg = new TickAggregator();
    // 1790858700 is an exact multiple of 900
    const t0 = 1790858700;

    // Tick 1: Open at 2650.0 (t0 + 10s)
    const res1 = agg.aggregateTick('XAUUSD', '15m', { price: 2650.0, time: t0 + 10 });
    expect(res1.isNew).toBe(true);
    expect(res1.candle.open).toBe(2650.0);
    expect(res1.candle.high).toBe(2650.0);
    expect(res1.candle.low).toBe(2650.0);
    expect(res1.candle.close).toBe(2650.0);

    // Tick 2: Higher tick at 2654.5 (t0 + 100s)
    const res2 = agg.aggregateTick('XAUUSD', '15m', { price: 2654.5, time: t0 + 100 });
    expect(res2.isNew).toBe(false);
    expect(res2.candle.high).toBe(2654.5);
    expect(res2.candle.close).toBe(2654.5);

    // Tick 3: Lower tick at 2648.2 (t0 + 200s)
    const res3 = agg.aggregateTick('XAUUSD', '15m', { price: 2648.2, time: t0 + 200 });
    expect(res3.candle.high).toBe(2654.5);
    expect(res3.candle.low).toBe(2648.2);
    expect(res3.candle.close).toBe(2648.2);

    // Tick 4: Close tick at 2652.0 (t0 + 800s, still inside 900s bucket)
    const res4 = agg.aggregateTick('XAUUSD', '15m', { price: 2652.0, time: t0 + 800 });
    expect(res4.candle.open).toBe(2650.0);
    expect(res4.candle.high).toBe(2654.5);
    expect(res4.candle.low).toBe(2648.2);
    expect(res4.candle.close).toBe(2652.0);
    expect(res4.isClosed).toBe(false);
  });

  it('rolls into a new bucket and marks previous candle closed', () => {
    const agg = new TickAggregator();
    const t0 = 1790858700; // exact 15m bucket

    agg.aggregateTick('XAUUSD', '15m', { price: 2650.0, time: t0 + 100 });
    agg.aggregateTick('XAUUSD', '15m', { price: 2655.0, time: t0 + 500 });

    // Tick in next 15m bucket (t0 + 900)
    const tNext = t0 + 900;
    const res = agg.aggregateTick('XAUUSD', '15m', { price: 2656.0, time: tNext + 5 });

    expect(res.isNew).toBe(true);
    expect(res.isClosed).toBe(true);
    expect(res.closedCandle).toBeDefined();
    expect(res.closedCandle?.time).toBe(t0);
    expect(res.closedCandle?.close).toBe(2655.0);
    expect(res.candle.time).toBe(tNext);
    expect(res.candle.open).toBe(2656.0);
  });

  it('reconciles forming candle with official broker period and corrects mismatches', () => {
    const agg = new TickAggregator();
    const t0 = 1790858700;

    agg.aggregateTick('XAUUSD', '15m', { price: 2650.0, time: t0 + 10 });
    agg.aggregateTick('XAUUSD', '15m', { price: 2652.0, time: t0 + 300 });

    // Official candle from Chart session shows higher peak of 2655.5
    const official = {
      time: t0,
      open: 2650.0,
      high: 2655.5,
      low: 2649.0,
      close: 2652.0,
      volume: 1200,
    };

    const recon = agg.reconcileOfficialCandle('XAUUSD', '15m', official, 0.1);
    expect(recon.isMismatch).toBe(true);
    expect(recon.corrected?.high).toBe(2655.5);
    expect(recon.corrected?.low).toBe(2649.0);
    expect(agg.getMismatchCount()).toBeGreaterThan(0);
  });

  it('rejects stale out-of-order ticks', () => {
    const agg = new TickAggregator();
    const t0 = 1790858700;

    agg.aggregateTick('XAUUSD', '15m', { price: 2650.0, time: t0 + 100 });
    // Ticks arriving from 20s in the past should not corrupt current forming state
    const res = agg.aggregateTick('XAUUSD', '15m', { price: 2690.0, time: t0 + 50 });
    expect(res.candle.high).toBe(2650.0);
  });
});
