import { HistorySummaryStats, SignalEntity } from '../types.ts';

export interface EquityPoint {
  index: number;
  time: number;
  r: number;
  drawdownR: number;
  signalId: string;
  direction: 'BUY' | 'SELL';
  status: string;
}

export interface RDistributionBucket {
  range: string;
  count: number;
  percentage: number;
}

export interface MfeMaeScatterPoint {
  signalId: string;
  mfeR: number;
  maeR: number;
  finalR: number;
  status: string;
  direction: 'BUY' | 'SELL';
}

export interface SegmentStat {
  key: string;
  name: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  wilsonInterval: [number, number];
  expectancyR: number;
  avgR: number;
  isSampleSufficient: boolean;
}

export class StatsEngine {
  private static readonly terminalStatuses = new Set([
    'TP3_HIT', 'SL_HIT', 'BE_EXIT', 'TRAIL_EXIT', 'SL_AFTER_TP1',
    'INVALIDATED', 'TIME_STOP', 'EXPIRED', 'CANCELLED',
  ]);

  private static isResolved(signal: SignalEntity): boolean {
    return Boolean(
      signal.outcome
      && this.terminalStatuses.has(signal.outcome.status)
      && Number.isFinite(signal.outcome.rFinal)
    );
  }

  public static selectConfluenceRepresentatives(signals: SignalEntity[]): SignalEntity[] {
    const representatives = new Map<string, SignalEntity>();
    for (const signal of signals) {
      if (!signal.groupId || signal.agreement !== 'BOTH_SAME_DIR') continue;
      const current = representatives.get(signal.groupId);
      if (!current || signal.source === 'INDICATOR') representatives.set(signal.groupId, signal);
    }
    return [...representatives.values()];
  }

  // Wilson 95% Confidence Interval for binomial proportions
  public static computeWilsonInterval(wins: number, total: number, z: number = 1.96): [number, number] {
    if (total <= 0) return [0, 0];
    const p = wins / total;
    const denom = 1 + (z * z) / total;
    const center = p + (z * z) / (2 * total);
    const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));

    const lower = Math.max(0, (center - margin) / denom) * 100;
    const upper = Math.min(100, (center + margin) / denom) * 100;
    return [Number(lower.toFixed(1)), Number(upper.toFixed(1))];
  }

  // Core statistical aggregator from real signal entities
  public static calculateSummary(signals: SignalEntity[], minSample: number = 30): HistorySummaryStats {
    const totalSignals = signals.length;

    // Triggered vs Non-triggered (EXPIRED, CANCELLED before entry)
    const triggered = signals.filter(
      (s) => s.outcome && s.outcome.status !== 'PENDING' && s.outcome.status !== 'EXPIRED' && s.outcome.status !== 'CANCELLED'
    );
    const triggeredCount = triggered.length;
    const fillRate = totalSignals > 0 ? Number(((triggeredCount / totalSignals) * 100).toFixed(1)) : 0;

    // Terminal resolved trades
    // TP1_HIT and TP2_HIT are intermediate states. Keep them open until the
    // tracker records a terminal exit and its realized R value.
    const resolved = triggered.filter((s) => this.isResolved(s));
    const openCount = signals.filter((s) => s.outcome && (s.outcome.status === 'PENDING' || s.outcome.status === 'TRIGGERED' || s.outcome.status === 'TP1_HIT' || s.outcome.status === 'TP2_HIT')).length;

    // Rule 1.3 Classification:
    // WIN: R >= +0.25R
    // LOSS: R <= -0.25R
    // BE: -0.25R < R < +0.25R
    let wins = 0;
    let losses = 0;
    let beCount = 0;

    const rValues: number[] = [];
    let grossWinR = 0;
    let grossLossR = 0;
    let totalTimeToTp1 = 0;
    let countTimeToTp1 = 0;
    let totalDuration = 0;

    let hitTp1Count = 0;
    let hitTp2Count = 0;
    let hitTp3Count = 0;
    let hitSlBeforeTp1Count = 0;

    let reconstructedCount = 0;
    let ambiguousCount = 0;

    for (const s of resolved) {
      const outcome = s.outcome!;
      const r = outcome.rFinal !== undefined ? outcome.rFinal : (outcome.status.startsWith('TP') ? s.rrPlanned : -1);
      rValues.push(r);

      if (r >= 0.25) {
        wins++;
        grossWinR += r;
      } else if (r <= -0.25) {
        losses++;
        grossLossR += Math.abs(r);
      } else {
        beCount++;
      }

      if (outcome.status === 'TP1_HIT' || outcome.status === 'TP2_HIT' || outcome.status === 'TP3_HIT' || outcome.firstHit === 'TP1') {
        hitTp1Count++;
      }
      if (outcome.status === 'TP2_HIT' || outcome.status === 'TP3_HIT') {
        hitTp2Count++;
      }
      if (outcome.status === 'TP3_HIT') {
        hitTp3Count++;
      }
      if (outcome.firstHit === 'SL') {
        hitSlBeforeTp1Count++;
      }

      if (outcome.timeToTp1 && outcome.timeToTp1 > 0) {
        totalTimeToTp1 += outcome.timeToTp1;
        countTimeToTp1++;
      }
      if (outcome.duration && outcome.duration > 0) {
        totalDuration += outcome.duration;
      }

      if (outcome.reconstructedFlag) reconstructedCount++;
      if (outcome.ambiguousFlag) ambiguousCount++;
    }

    const resolvedCount = resolved.length;
    const isSampleSufficient = resolvedCount >= minSample;

    const winDenom = wins + losses;
    const winRate = winDenom > 0 ? Number(((wins / winDenom) * 100).toFixed(1)) : 0;
    const wilsonInterval = this.computeWilsonInterval(wins, winDenom);

    const tp1HitRate = triggeredCount > 0 ? Number(((hitTp1Count / triggeredCount) * 100).toFixed(1)) : 0;
    const tp2HitRate = triggeredCount > 0 ? Number(((hitTp2Count / triggeredCount) * 100).toFixed(1)) : 0;
    const tp3HitRate = triggeredCount > 0 ? Number(((hitTp3Count / triggeredCount) * 100).toFixed(1)) : 0;
    const slHitRate = triggeredCount > 0 ? Number(((hitSlBeforeTp1Count / triggeredCount) * 100).toFixed(1)) : 0;

    const totalR = rValues.reduce((acc, v) => acc + v, 0);
    const avgR = resolvedCount > 0 ? Number((totalR / resolvedCount).toFixed(2)) : 0;

    // Median R
    let medianR = 0;
    if (rValues.length > 0) {
      const sorted = [...rValues].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianR = sorted.length % 2 !== 0 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
    }

    const expectancyR = resolvedCount > 0 ? Number((totalR / resolvedCount).toFixed(2)) : 0;
    const profitFactor = grossLossR > 0 ? Number((grossWinR / grossLossR).toFixed(2)) : grossWinR > 0 ? Number(grossWinR.toFixed(2)) : 0;

    // Streaks and Max Drawdown in R
    let currentWinStreak = 0;
    let maxWinStreak = 0;
    let currentLossStreak = 0;
    let maxLossStreak = 0;

    let runningR = 0;
    let peakR = 0;
    let maxDrawdownR = 0;

    for (const r of rValues) {
      if (r >= 0.25) {
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
      } else if (r <= -0.25) {
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
      } else {
        // Scratch / BE resets active streak
        currentWinStreak = 0;
        currentLossStreak = 0;
      }

      runningR += r;
      if (runningR > peakR) {
        peakR = runningR;
      }
      const dd = peakR - runningR;
      if (dd > maxDrawdownR) {
        maxDrawdownR = dd;
      }
    }

    const avgTimeToTp1 = countTimeToTp1 > 0 ? Math.round(totalTimeToTp1 / countTimeToTp1) : 0;
    const avgDuration = resolvedCount > 0 ? Math.round(totalDuration / resolvedCount) : 0;

    const percentReconstructed = resolvedCount > 0 ? Number(((reconstructedCount / resolvedCount) * 100).toFixed(1)) : 0;
    const percentAmbiguous = resolvedCount > 0 ? Number(((ambiguousCount / resolvedCount) * 100).toFixed(1)) : 0;

    return {
      totalSignals,
      triggeredCount,
      fillRate,
      wins,
      losses,
      beCount,
      openCount,
      winRate,
      wilsonInterval,
      tp1HitRate,
      tp2HitRate,
      tp3HitRate,
      slHitRate,
      avgR,
      medianR,
      expectancyR,
      profitFactor,
      maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
      longestWinStreak: maxWinStreak,
      longestLossStreak: maxLossStreak,
      avgTimeToTp1,
      avgDuration,
      isSampleSufficient,
      sampleCount: resolvedCount,
      percentReconstructed,
      percentAmbiguous,
    };
  }

  // Cumulative R curve
  public static calculateEquityCurve(signals: SignalEntity[]): EquityPoint[] {
    const resolved = signals
      .filter((s) => this.isResolved(s))
      .sort((a, b) => a.createdTs - b.createdTs);

    let cumulativeR = 0;
    let peakR = 0;

    return resolved.map((s, idx) => {
      const outcome = s.outcome!;
      const r = outcome.rFinal!;
      cumulativeR += r;
      if (cumulativeR > peakR) peakR = cumulativeR;
      const drawdownR = Number((peakR - cumulativeR).toFixed(2));

      return {
        index: idx + 1,
        time: outcome.updatedAt || s.createdTs,
        r: Number(cumulativeR.toFixed(2)),
        drawdownR,
        signalId: s.id,
        direction: s.direction,
        status: outcome.status,
      };
    });
  }

  // Histogram distribution of R multiples
  public static calculateRDistribution(signals: SignalEntity[]): RDistributionBucket[] {
    const buckets: { range: string; min: number; max: number; count: number }[] = [
      { range: '< -1.5R', min: -Infinity, max: -1.5, count: 0 },
      { range: '-1.5R to -0.8R', min: -1.5, max: -0.8, count: 0 },
      { range: '-0.8R to -0.2R', min: -0.8, max: -0.2, count: 0 },
      { range: '-0.2R to +0.2R (BE)', min: -0.2, max: 0.2, count: 0 },
      { range: '+0.2R to +1.0R', min: 0.2, max: 1.0, count: 0 },
      { range: '+1.0R to +2.0R', min: 1.0, max: 2.0, count: 0 },
      { range: '> +2.0R', min: 2.0, max: Infinity, count: 0 },
    ];

    let total = 0;
    for (const s of signals) {
      if (!this.isResolved(s)) continue;
      const r = s.outcome!.rFinal!;
      total++;
      for (const b of buckets) {
        if (r >= b.min && r < b.max) {
          b.count++;
          break;
        }
      }
    }

    return buckets.map((b) => ({
      range: b.range,
      count: b.count,
      percentage: total > 0 ? Number(((b.count / total) * 100).toFixed(1)) : 0,
    }));
  }

  // MFE vs MAE scatter points for SL/TP optimization
  public static calculateMfeMaeScatter(signals: SignalEntity[]): MfeMaeScatterPoint[] {
    const points: MfeMaeScatterPoint[] = [];

    for (const s of signals) {
      if (!s.outcome || s.outcome.status === 'PENDING') continue;
      points.push({
        signalId: s.id,
        mfeR: s.outcome.rMaxMfe ?? 0,
        maeR: s.outcome.rMaxMae ?? 0,
        finalR: s.outcome.rFinal ?? 0,
        status: s.outcome.status,
        direction: s.direction,
      });
    }

    return points;
  }

  // Segment breakdown (Session, Grade, Regime, Direction, Day of Week)
  public static calculateSegments(signals: SignalEntity[], segmentKey: 'session' | 'grade' | 'regime' | 'direction'): SegmentStat[] {
    const groups: Map<string, SignalEntity[]> = new Map();

    for (const s of signals) {
      const k = String((s as any)[segmentKey] || 'Unknown');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }

    const result: SegmentStat[] = [];
    for (const [key, groupSignals] of groups.entries()) {
      const summary = this.calculateSummary(groupSignals, 20); // segment rule n >= 20
      result.push({
        key,
        name: key,
        total: summary.sampleCount,
        wins: summary.wins,
        losses: summary.losses,
        winRate: summary.winRate,
        wilsonInterval: summary.wilsonInterval,
        expectancyR: summary.expectancyR,
        avgR: summary.avgR,
        isSampleSufficient: summary.isSampleSufficient,
      });
    }

    return result.sort((a, b) => b.total - a.total);
  }
}
