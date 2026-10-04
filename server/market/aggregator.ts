import { Candle, Timeframe } from '../types.ts';

export interface Tick {
  price: number;
  time: number; // Unix timestamp in seconds
  volume?: number;
  volumeIsSynthetic?: boolean;
  bid?: number;
  ask?: number;
}

export interface AggregationResult {
  candle: Candle;
  isNew: boolean;
  isClosed: boolean;
  closedCandle?: Candle;
}

export interface IntegrityLogEntry {
  symbol: string;
  timeframe: Timeframe;
  candleTime: number;
  aggregated: { open: number; high: number; low: number; close: number; volume: number };
  official: { open: number; high: number; low: number; close: number; volume: number };
  mismatchDiff: number;
  tolerance: number;
  timestamp: number;
}

export class TickAggregator {
  private currentForming: Map<string, Candle> = new Map();
  private lastTickTimes: Map<string, number> = new Map();
  private integrityLogs: IntegrityLogEntry[] = [];

  public static getTimeframeSeconds(tf: Timeframe): number {
    switch (tf) {
      case '1m':
        return 60;
      case '5m':
        return 300;
      case '15m':
        return 900;
      case '1h':
        return 3600;
      case '4h':
        return 14400;
      case 'D':
        return 86400;
      default:
        return 900;
    }
  }

  public static computeBucket(timestampSec: number, tf: Timeframe): number {
    const tfSec = TickAggregator.getTimeframeSeconds(tf);
    return Math.floor(timestampSec / tfSec) * tfSec;
  }

  /**
   * Pure aggregation function: Takes incoming tick and updates or rolls the candle.
   */
  public aggregateTick(symbol: string, tf: Timeframe, tick: Tick): AggregationResult {
    const key = `${symbol}_${tf}`;
    const tfSec = TickAggregator.getTimeframeSeconds(tf);
    const bucket = Math.floor(tick.time / tfSec) * tfSec;

    const lastTime = this.lastTickTimes.get(key) || 0;
    // Out-of-order drop or deduplication protection (ignore ticks older than 10s into the past)
    if (tick.time < lastTime - 10) {
      const existing = this.currentForming.get(key);
      if (existing) {
        return { candle: existing, isNew: false, isClosed: false };
      }
    }
    this.lastTickTimes.set(key, Math.max(lastTime, tick.time));

    let current = this.currentForming.get(key);

    // If no forming candle or tick belongs to a new time bucket
    if (!current || bucket > current.time) {
      let closedCandle: Candle | undefined;
      if (current) {
        closedCandle = { ...current, isForming: false };
      }

      // Initialize new forming candle for this bucket
      current = {
        time: bucket,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volumeIsSynthetic || !Number.isFinite(tick.volume) || (tick.volume || 0) <= 0 ? 0 : tick.volume!,
        volumeIsSynthetic: tick.volumeIsSynthetic || !Number.isFinite(tick.volume) || (tick.volume || 0) <= 0,
        isForming: true,
      };

      this.currentForming.set(key, current);
      return {
        candle: current,
        isNew: true,
        isClosed: !!closedCandle,
        closedCandle,
      };
    }

    // Update existing forming candle
    current.high = Math.max(current.high, tick.price);
    current.low = Math.min(current.low, tick.price);
    current.close = tick.price;
    if (!tick.volumeIsSynthetic && Number.isFinite(tick.volume) && (tick.volume || 0) > 0) {
      current.volume = (current.volumeIsSynthetic ? 0 : current.volume) + tick.volume!;
      current.volumeIsSynthetic = false;
    } else {
      current.volumeIsSynthetic = true;
    }
    current.isForming = true;

    return {
      candle: current,
      isNew: false,
      isClosed: false,
    };
  }

  /**
   * Reconcile aggregated candle against official broker period.
   * Returns corrected candle if mismatch exceeds tolerance.
   */
  public reconcileOfficialCandle(
    symbol: string,
    tf: Timeframe,
    official: { time: number; open: number; high: number; low: number; close: number; volume: number; volumeIsSynthetic?: boolean },
    tolerance: number = 0.2 // in points ($)
  ): { isMismatch: boolean; corrected?: Candle; log?: IntegrityLogEntry } {
    const key = `${symbol}_${tf}`;
    const current = this.currentForming.get(key);

    if (!current || current.time !== official.time) {
      // Official candle is for a different period (e.g. past closed bar); no collision
      return { isMismatch: false };
    }

    const diffO = Math.abs(current.open - official.open);
    const diffH = Math.abs(current.high - official.high);
    const diffL = Math.abs(current.low - official.low);
    const diffC = Math.abs(current.close - official.close);
    const maxDiff = Math.max(diffO, diffH, diffL, diffC);

    if (maxDiff > tolerance) {
      const logEntry: IntegrityLogEntry = {
        symbol,
        timeframe: tf,
        candleTime: official.time,
        aggregated: {
          open: current.open,
          high: current.high,
          low: current.low,
          close: current.close,
          volume: current.volume,
        },
        official: { ...official },
        mismatchDiff: Number(maxDiff.toFixed(3)),
        tolerance,
        timestamp: Date.now(),
      };

      this.integrityLogs.unshift(logEntry);
      if (this.integrityLogs.length > 200) this.integrityLogs.pop();

      // Correct local state to strictly match official broker candle
      current.open = official.open;
      current.high = Math.max(current.high, official.high);
      current.low = Math.min(current.low, official.low);
      current.close = official.close;
      if (!official.volumeIsSynthetic && Number.isFinite(official.volume) && official.volume > 0) {
        current.volume = official.volume;
        current.volumeIsSynthetic = false;
      } else if (current.volumeIsSynthetic) {
        current.volume = 0;
      }

      return {
        isMismatch: true,
        corrected: { ...current },
        log: logEntry,
      };
    }

    if (!official.volumeIsSynthetic && Number.isFinite(official.volume) && official.volume > 0) {
      current.volume = official.volume;
      current.volumeIsSynthetic = false;
    }

    return { isMismatch: false };
  }

  public getFormingCandle(symbol: string, tf: Timeframe): Candle | undefined {
    return this.currentForming.get(`${symbol}_${tf}`);
  }

  public setFormingCandle(symbol: string, tf: Timeframe, candle: Candle): void {
    this.currentForming.set(`${symbol}_${tf}`, candle);
  }

  public getIntegrityLogs(): IntegrityLogEntry[] {
    return this.integrityLogs;
  }

  public getMismatchCount(): number {
    return this.integrityLogs.length;
  }
}

export const tickAggregator = new TickAggregator();
