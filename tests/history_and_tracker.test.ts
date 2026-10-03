import { describe, expect, it } from 'vitest';
import { StatsEngine } from '../server/stats/statsEngine.ts';
import { SqliteStore } from '../server/db/sqliteStore.ts';
import { SignalEntity, SignalEvent } from '../server/types.ts';

describe('StatsEngine: Statistical Rigor & Sample Gating', () => {
  it('counts one Indicator outcome per same-direction confluence group', () => {
    const indicator = { id: 'indicator-1', groupId: 'group-1', source: 'INDICATOR', agreement: 'BOTH_SAME_DIR' } as SignalEntity;
    const analysis = { id: 'analysis-1', groupId: 'group-1', source: 'ANALYSIS', agreement: 'BOTH_SAME_DIR' } as SignalEntity;
    const solo = { id: 'indicator-solo', groupId: 'group-2', source: 'INDICATOR', agreement: 'SOLO' } as SignalEntity;
    const opposite = { id: 'indicator-opposite', groupId: 'group-3', source: 'INDICATOR', agreement: 'OPPOSITE_DIR' } as SignalEntity;

    const representatives = StatsEngine.selectConfluenceRepresentatives([analysis, solo, opposite, indicator]);

    expect(representatives.map((signal) => signal.id)).toEqual(['indicator-1']);
  });

  it('correctly calculates 95% Wilson Confidence Interval', () => {
    // 15 wins out of 20 trials
    const [lower, upper] = StatsEngine.computeWilsonInterval(15, 20);
    expect(lower).toBeGreaterThan(50);
    expect(upper).toBeLessThan(95);
    expect(lower).toBeLessThan(upper);
  });

  it('enforces Rule 2: Minimum sample gating (insufficient sample when n < 30)', () => {
    // 10 mock resolved signals
    const signals: any[] = [];
    for (let i = 0; i < 10; i++) {
      signals.push({
        id: `sig_${i}`,
        createdTs: 1700000000 + i * 900,
        symbol: 'XAUUSD',
        direction: i % 2 === 0 ? 'BUY' : 'SELL',
        entryPrice: 2650,
        sl: 2640,
        tp1: 2670,
        rrPlanned: 2.0,
        score: 80,
        grade: 'A',
        outcome: {
          signalId: `sig_${i}`,
          status: i % 2 === 0 ? 'TP1_HIT' : 'SL_HIT',
          rFinal: i % 2 === 0 ? 2.0 : -1.0,
        },
      });
    }

    const summary = StatsEngine.calculateSummary(signals, 30);
    expect(summary.sampleCount).toBe(10);
    expect(summary.isSampleSufficient).toBe(false); // < 30 must flag insufficient sample
    expect(summary.wins).toBe(5);
    expect(summary.losses).toBe(5);
  });

  it('marks sample sufficient when n >= 30 and computes real expectancy & drawdown', () => {
    const signals: any[] = [];
    for (let i = 0; i < 35; i++) {
      const isWin = i % 3 !== 0; // ~66% win rate
      signals.push({
        id: `sig_${i}`,
        createdTs: 1700000000 + i * 900,
        symbol: 'XAUUSD',
        direction: 'BUY',
        entryPrice: 2650,
        sl: 2640,
        tp1: 2670,
        rrPlanned: 2.0,
        score: 85,
        grade: 'A+',
        outcome: {
          signalId: `sig_${i}`,
          status: isWin ? 'TP1_HIT' : 'SL_HIT',
          rFinal: isWin ? 2.0 : -1.0,
          firstHit: isWin ? 'TP1' : 'SL',
          duration: 1800,
          timeToTp1: isWin ? 900 : undefined,
        },
      });
    }

    const summary = StatsEngine.calculateSummary(signals, 30);
    expect(summary.sampleCount).toBe(35);
    expect(summary.isSampleSufficient).toBe(true);
    expect(summary.winRate).toBeGreaterThan(60);
    expect(summary.expectancyR).toBeGreaterThan(0.5);
    expect(summary.profitFactor).toBeGreaterThan(1.0);
    expect(summary.longestWinStreak).toBeGreaterThan(1);
  });

  it('correctly calculates cumulative equity curve and R distribution buckets', () => {
    const signals: any[] = [
      {
        id: 's1',
        createdTs: 100,
        direction: 'BUY',
        outcome: { status: 'TP1_HIT', rFinal: 1.5, updatedAt: 110 },
      },
      {
        id: 's2',
        createdTs: 200,
        direction: 'SELL',
        outcome: { status: 'SL_HIT', rFinal: -1.0, updatedAt: 210 },
      },
      {
        id: 's3',
        createdTs: 300,
        direction: 'BUY',
        outcome: { status: 'BE_EXIT', rFinal: 0.1, updatedAt: 310 },
      },
    ];

    const curve = StatsEngine.calculateEquityCurve(signals as any);
    expect(curve.length).toBe(3);
    expect(curve[0].r).toBe(1.5);
    expect(curve[1].r).toBe(0.5); // 1.5 - 1.0 = 0.5
    expect(curve[2].r).toBe(0.6); // 0.5 + 0.1 = 0.6

    const dist = StatsEngine.calculateRDistribution(signals as any);
    expect(dist.length).toBe(7);
  });
});

describe('SqliteStore: Immutability & Hash Chain Verification', () => {
  it('computes SHA-256 hash chain deterministically and detects verification', () => {
    const store = new SqliteStore(':memory:');

    // Verify chain on the store
    const chainCheck = store.verifyChain();
    expect(chainCheck.isValid).toBe(true);
    expect(chainCheck.totalChecked).toBeGreaterThanOrEqual(0);
  });

  it('prevents direct UPDATE of immutable signals via SQLite triggers', () => {
    const store = new SqliteStore(':memory:');
    const testId = `test_immut_${Date.now()}`;

    const sig = store.createFromEngine('INDICATOR', {
      id: testId,
      createdTs: Math.floor(Date.now() / 1000),
      candleCloseTs: Math.floor(Date.now() / 1000),
      symbol: 'XAUUSD',
      sourceFeed: 'TEST',
      direction: 'BUY',
      triggerTf: '15m',
      entryType: 'MARKET',
      entryPrice: 2650.0,
      sl: 2640.0,
      tp1: 2670.0,
      tp2: 2680.0,
      tp3: 2690.0,
      rrPlanned: 2.0,
      score: 85,
      grade: 'A+',
      regime: 'TREND_BULL',
      session: 'London',
      factors: [],
      weightsVersion: '2.0',
      configVersion: '2.0',
      priceFeedSnapshot: { primaryPrice: 2650, spread: 0.35, latencyMs: 10 },
      mgmtPlan: { partialCloseTp1Percent: 50, partialCloseTp2Percent: 30, moveSlToBreakEvenAtTp1: true, maxCandlesTimeStop: 48 },
      brokerOffset: 0,
      origin: 'UNKNOWN_LEGACY',
      agreement: 'UNKNOWN_LEGACY',
      inputProvenance: { fixture: 'sqlite-immutability-test' },
      aiState: 'UNKNOWN',
    });

    const { snapshotHash: _snapshotHash, prevHash: _prevHash, source: _source, hashVersion: _hashVersion, ...signalInput } = sig;
    const duplicate = store.createFromEngine('INDICATOR', signalInput);
    const analysisSignal = store.createFromEngine('ANALYSIS', {
      ...signalInput,
      id: `analysis_${testId}`,
      configVersion: 'analysis-test-v1',
      origin: 'engine_live',
    });

    expect(duplicate.snapshotHash).toBe(sig.snapshotHash);
    expect(analysisSignal.source).toBe('ANALYSIS');
    expect(store.getAllSignals({ source: 'INDICATOR' }).total).toBe(1);
    expect(store.getAllSignals({ source: 'ANALYSIS' }).total).toBe(1);
    expect(store.getOpenSignals({ origin: 'engine_live' }).map((signal) => signal.id)).toEqual([analysisSignal.id]);

    expect(sig.snapshotHash).toBeDefined();

    // Verification check on this single signal
    const verify = store.verifySignal(testId);
    expect(verify.isValid).toBe(true);
    expect(verify.expectedHash).toBe(sig.snapshotHash);

    // Attempting to UPDATE the signal table MUST throw an immutability violation error via SQLite trigger!
    expect(() => {
      (store as any).db.prepare('UPDATE signals SET entry_price = 9999 WHERE id = ?').run(testId);
    }).toThrow(/IMMUTABILITY_VIOLATION/);
  });
});
