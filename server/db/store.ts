import fs from 'fs';
import path from 'path';
import {
  CalibrationBucket,
  FactorAttributionStat,
  FactorCode,
  LiveTradeTracker,
  PaperTrade,
  SignalHistoryRecord,
  SignalSnapshotImmutable,
} from '../types.ts';
import { DEFAULT_WEIGHTS, RegimeWeightsConfig } from '../engine/defaultWeights.ts';

export interface ChartDrawing {
  id: string;
  type: 'HLINE' | 'TRENDLINE' | 'RECTANGLE' | 'RULER';
  points: { time: number; price: number }[];
  color: string;
  label?: string;
  createdAt: number;
}

interface AppDatabase {
  signals: SignalHistoryRecord[];
  snapshots: SignalSnapshotImmutable[];
  paperTrades: PaperTrade[];
  liveTrackers: LiveTradeTracker[];
  drawings: ChartDrawing[];
  weights: RegimeWeightsConfig;
  accountBalance: number;
  brokerOffset: number;
  measuredAverageSpread: number;
  primarySymbol: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

class StoreManager {
  private data: AppDatabase = {
    signals: [],
    snapshots: [],
    paperTrades: [],
    liveTrackers: [],
    drawings: [],
    weights: DEFAULT_WEIGHTS,
    accountBalance: 10000,
    brokerOffset: 0,
    measuredAverageSpread: 0.35,
    primarySymbol: 'XAUUSD',
  };

  constructor() {
    this.load();
    // V2 Rule: NO FAKE / DEMO / MOCK SIGNALS! Start completely clean or load real signals only.
    if (this.data.signals.some((s) => s.id === 'sig_101' || s.id === 'sig_102' || s.id === 'sig_103')) {
      this.data.signals = this.data.signals.filter(
        (s) => s.id !== 'sig_101' && s.id !== 'sig_102' && s.id !== 'sig_103'
      );
      this.save();
    }
  }

  private load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = { ...this.data, ...parsed };
      } else {
        this.save();
      }
    } catch (e) {
      console.warn('Failed to load database, using fresh state:', e);
    }
  }

  public exportSnapshot(): string {
    return JSON.stringify(this.data);
  }

  public restoreSnapshot(snapshot: string) {
    const parsed = JSON.parse(snapshot) as Partial<AppDatabase>;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.signals) || !Array.isArray(parsed.paperTrades)) {
      throw new Error('Invalid JSON store snapshot.');
    }
    this.data = {
      ...this.data,
      ...parsed,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      liveTrackers: Array.isArray(parsed.liveTrackers) ? parsed.liveTrackers : [],
      drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
    };
    this.save();
  }

  private save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Failed to write database file:', e);
    }
  }

  public getSignals(): SignalHistoryRecord[] {
    return this.data.signals;
  }

  public addSignal(sig: SignalHistoryRecord, snapshot?: SignalSnapshotImmutable) {
    this.data.signals.unshift(sig);
    if (snapshot) {
      this.data.snapshots.unshift(snapshot);
      if (this.data.snapshots.length > 500) this.data.snapshots.pop();
    }
    if (this.data.signals.length > 500) this.data.signals.pop();
    this.save();
  }

  public getImmutableSnapshot(hash: string): SignalSnapshotImmutable | undefined {
    return this.data.snapshots.find((s) => s.hash === hash);
  }

  public getLiveTrackers(): LiveTradeTracker[] {
    return this.data.liveTrackers || [];
  }

  public saveLiveTracker(tracker: LiveTradeTracker) {
    const idx = (this.data.liveTrackers || []).findIndex((t) => t.signalId === tracker.signalId);
    if (!this.data.liveTrackers) this.data.liveTrackers = [];
    if (idx >= 0) {
      this.data.liveTrackers[idx] = tracker;
    } else {
      this.data.liveTrackers.unshift(tracker);
    }
    this.save();
  }

  public getDrawings(symbol: string): ChartDrawing[] {
    return this.data.drawings || [];
  }

  public saveDrawing(drawing: ChartDrawing) {
    if (!this.data.drawings) this.data.drawings = [];
    this.data.drawings.push(drawing);
    this.save();
  }

  public deleteDrawing(id: string) {
    if (!this.data.drawings) return;
    this.data.drawings = this.data.drawings.filter((d) => d.id !== id);
    this.save();
  }

  public getPaperTrades(): PaperTrade[] {
    return this.data.paperTrades;
  }

  public addPaperTrade(trade: PaperTrade) {
    this.data.paperTrades.unshift(trade);
    this.save();
  }

  public closePaperTrade(id: string, reason: PaperTrade['closeReason'], currentPrice: number) {
    const t = this.data.paperTrades.find((x) => x.id === id);
    if (t && t.status === 'OPEN') {
      t.status = 'CLOSED';
      t.closeTime = Math.floor(Date.now() / 1000);
      t.closeReason = reason;

      const pips = t.direction === 'BUY' ? currentPrice - t.entryPrice : t.entryPrice - currentPrice;
      t.pnlPips = Number(pips.toFixed(2));
      t.pnl = Number((pips * t.lotSize * 100).toFixed(2));
      this.data.accountBalance += t.pnl;
      this.save();
    }
  }

  public getWeights(): RegimeWeightsConfig {
    return this.data.weights || DEFAULT_WEIGHTS;
  }

  public updateWeights(weights: RegimeWeightsConfig) {
    this.data.weights = weights;
    this.save();
  }

  public getAccountBalance(): number {
    return this.data.accountBalance;
  }

  public getBrokerOffset(): number {
    return this.data.brokerOffset || 0;
  }

  public setBrokerOffset(offset: number) {
    this.data.brokerOffset = offset;
    this.save();
  }

  // Calibration Table: Computes empirical performance by score bucket
  // Enforces V2 Rule: If total sample n < 30, flags insufficient sample
  public getCalibration(): { buckets: CalibrationBucket[]; isSampleSufficient: boolean; totalSample: number } {
    const signals = this.data.signals.filter((s) => s.status !== 'PENDING' && s.status !== 'TRIGGERED');
    const totalSample = signals.length;
    const isSampleSufficient = totalSample >= 30;

    const ranges = [
      { min: 90, max: 100, label: '90-100 (A+ Premium)' },
      { min: 80, max: 89, label: '80-89 (A Institutional)' },
      { min: 70, max: 79, label: '70-79 (B Strong)' },
      { min: 60, max: 69, label: '60-69 (C Lean)' },
      { min: 0, max: 59, label: '0-59 (X Filtered)' },
    ];

    const buckets: CalibrationBucket[] = ranges.map((r) => {
      const inBucket = signals.filter((s) => s.score >= r.min && s.score <= r.max);
      const wins = inBucket.filter((s) => s.status.startsWith('TP')).length;
      const losses = inBucket.filter((s) => s.status === 'SL_HIT').length;
      const resolved = wins + losses;

      const p = resolved > 0 ? wins / resolved : 0;
      const z = 1.96; // 95% Wilson confidence interval
      const denom = 1 + (z * z) / (resolved || 1);
      const center = p + (z * z) / (2 * (resolved || 1));
      const margin = z * Math.sqrt((p * (1 - p)) / (resolved || 1) + (z * z) / (4 * Math.pow(resolved || 1, 2)));

      const lower = resolved > 0 ? Math.max(0, (center - margin) / denom) * 100 : 0;
      const upper = resolved > 0 ? Math.min(100, (center + margin) / denom) * 100 : 0;

      const totalR = inBucket.reduce((acc, s) => acc + (s.realizedR || 0), 0);
      const avgR = resolved > 0 ? Number((totalR / resolved).toFixed(2)) : 0;
      const expectancy = resolved > 0 ? Number((p * avgR - (1 - p) * 1).toFixed(2)) : 0;

      return {
        scoreRange: r.label,
        totalTrades: inBucket.length,
        wins,
        losses,
        winRate: resolved > 0 ? Number((p * 100).toFixed(1)) : 0,
        confidenceIntervalWilson: [Number(lower.toFixed(1)), Number(upper.toFixed(1))],
        avgR,
        expectancy,
        isSampleSufficient: inBucket.length >= 30,
      };
    });

    return { buckets, isSampleSufficient, totalSample };
  }

  // Factor Attribution: Computes marginal win rate per SMC/Macro factor
  public getFactorAttribution(): FactorAttributionStat[] {
    const signals = this.data.signals.filter((s) => s.status !== 'PENDING' && s.status !== 'TRIGGERED');
    const factorCodes: { code: FactorCode; name: string }[] = [
      { code: 'S', name: 'Structure (BOS/CHoCH)' },
      { code: 'H', name: 'HTF Alignment (H1/H4)' },
      { code: 'F', name: 'Fair Value Gap (FVG)' },
      { code: 'K', name: 'Liquidity Sweep' },
      { code: 'O', name: 'Order Block (OB)' },
      { code: 'T', name: 'Session Killzone' },
      { code: 'REG', name: 'Regime Alignment' },
      { code: 'VWAP', name: 'VWAP Position' },
      { code: 'MOM', name: 'Momentum Divergence' },
      { code: 'RAIL', name: 'Session Rails' },
      { code: 'XA', name: 'Cross-Asset Alignment' },
      { code: 'COR', name: 'Correlation Health' },
      { code: 'MAC', name: 'Macro Bias' },
      { code: 'NEWS', name: 'High-Impact News' },
      { code: 'GEO', name: 'Geopolitical Risk' },
    ];

    return factorCodes.map((item) => {
      // Find trades where this factor was active
      const passedTrades = signals.filter((s) => s.topFactors && s.topFactors.some((f) => f.includes(item.code)));
      const passWins = passedTrades.filter((s) => s.status.startsWith('TP')).length;
      const winRateWhenPassed = passedTrades.length > 0 ? (passWins / passedTrades.length) * 100 : 0;

      const otherTrades = signals.filter((s) => !s.topFactors || !s.topFactors.some((f) => f.includes(item.code)));
      const otherWins = otherTrades.filter((s) => s.status.startsWith('TP')).length;
      const winRateWhenFailed = otherTrades.length > 0 ? (otherWins / otherTrades.length) * 100 : 0;

      const marginal = winRateWhenPassed - winRateWhenFailed;
      const sampleCount = passedTrades.length;

      return {
        code: item.code,
        name: item.name,
        passCount: passedTrades.length,
        failCount: otherTrades.length,
        winRateWhenPassed: Number(winRateWhenPassed.toFixed(1)),
        winRateWhenFailed: Number(winRateWhenFailed.toFixed(1)),
        marginalContributionR: Number((marginal / 20).toFixed(2)),
        sampleCount,
        isSampleSufficient: sampleCount >= 30,
        suggestedWeightDelta: sampleCount >= 30 ? (marginal > 5 ? 2 : marginal < -5 ? -2 : 0) : 0,
      };
    });
  }
}

export const dbStore = new StoreManager();
