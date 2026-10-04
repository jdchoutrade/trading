import { Candle, Timeframe } from '../types.ts';
import { tickAggregator } from './aggregator.ts';
import TradingViewModule from '@mathieuc/tradingview';

// TradingView library instance from default or module export
const TradingView = (TradingViewModule as any).default || TradingViewModule;

export interface TvTickData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  volume: number;
  time: number; // Unix timestamp in seconds
  latencyMs: number;
  isDelayed: boolean;
  isDelayed15m: boolean;
}

export type TvTickCallback = (tick: TvTickData) => void;
export type TvCandleCloseCallback = (tf: Timeframe, candle: Candle) => void;

export class TvFeedService {
  private client: any = null;
  private quoteSession: any = null;
  private quoteMarket: any = null;
  private chartSessions: Map<Timeframe, any> = new Map();

  private primarySymbol: string;
  private isConnected: boolean = false;
  private isReconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimeoutId: any = null;

  // Stored state
  private latestQuote: {
    price: number;
    bid: number;
    ask: number;
    spread: number;
    volume: number;
    time: number;
  } = { price: 0, bid: 0, ask: 0, spread: 0.35, volume: 0, time: 0 };

  private latencies: number[] = [];
  private consecutiveDelayedCount: number = 0;
  private isDelayed: boolean = false;
  private isDelayed15m: boolean = false;
  private lastTickReceivedTime: number = 0;

  // Cached candles by timeframe (sorted chronologically ascending)
  private candles: Map<Timeframe, Candle[]> = new Map([
    ['1m', []],
    ['5m', []],
    ['15m', []],
    ['1h', []],
    ['4h', []],
    ['D', []],
  ]);

  private tickListeners: Set<TvTickCallback> = new Set();
  private candleCloseListeners: Set<TvCandleCloseCallback> = new Set();

  private static readonly TF_MAP: Record<Timeframe, string> = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '1h': '60',
    '4h': '240',
    'D': 'D',
  };

  constructor(symbol: string = process.env.PRIMARY_SYMBOL || 'OANDA:XAUUSD') {
    this.primarySymbol = symbol;
  }

  public getPrimarySymbol(): string {
    return this.primarySymbol;
  }

  public setPrimarySymbol(sym: string) {
    if (this.primarySymbol === sym) return;
    this.primarySymbol = sym;
    this.reconnect();
  }

  public async start() {
    this.initTradingViewClient();
  }

  private initTradingViewClient() {
    try {
      const token = process.env.TV_SESSION;
      const signature = process.env.TV_SIGNATURE;

      const clientOptions: any = {};
      if (token) clientOptions.token = token;
      if (signature) clientOptions.signature = signature;

      this.client = new TradingView.Client(clientOptions);

      this.client.onConnected(() => {
        this.isConnected = true;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.setupSessions();
      });

      this.client.onDisconnected(() => {
        this.isConnected = false;
        this.handleDisconnect();
      });

      this.client.onError((...err: any[]) => {
        console.warn('TradingView client error:', ...err);
      });
    } catch (err) {
      console.error('Failed to initialize TradingView client:', err);
      this.handleDisconnect();
    }
  }

  private setupSessions() {
    if (!this.client) return;

    // 1. Setup Quote Session for sub-second tick stream
    try {
      if (this.quoteSession) {
        this.quoteSession.delete();
      }

      this.quoteSession = new this.client.Session.Quote({
        customFields: ['lp', 'bid', 'ask', 'volume', 'lp_time', 'ch', 'chp'],
      });

      this.quoteMarket = new this.quoteSession.Market(this.primarySymbol);

      this.quoteMarket.onData((data: any) => {
        this.handleQuoteData(data);
      });

      this.quoteMarket.onError((...err: any[]) => {
        console.warn(`TradingView quote error on ${this.primarySymbol}:`, ...err);
      });
    } catch (e) {
      console.warn('Quote session init error:', e);
    }

    // 2. Setup Chart Sessions for each timeframe to backfill and subscribe to official candles
    const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', 'D'];
    for (const tf of timeframes) {
      this.setupChartSession(tf);
    }
  }

  private setupChartSession(tf: Timeframe) {
    try {
      const existing = this.chartSessions.get(tf);
      if (existing) {
        existing.delete();
      }

      const chart = new this.client.Session.Chart();
      this.chartSessions.set(tf, chart);

      const tvTf = TvFeedService.TF_MAP[tf];
      // Backfill 350 periods
      chart.setMarket(this.primarySymbol, {
        timeframe: tvTf,
        range: 350,
      });

      chart.onUpdate((changes: string[]) => {
        this.handleChartUpdate(tf, chart);
      });

      chart.onError((...err: any[]) => {
        console.warn(`TradingView chart error on ${this.primarySymbol} (${tf}):`, ...err);
      });
    } catch (e) {
      console.warn(`Chart session init error for ${tf}:`, e);
    }
  }

  private handleQuoteData(data: any) {
    const now = Date.now();
    this.lastTickReceivedTime = now;

    // Last price
    if (data.lp !== undefined && typeof data.lp === 'number') {
      this.latestQuote.price = data.lp;
    }

    // Bid & Ask
    if (data.bid !== undefined && typeof data.bid === 'number') {
      this.latestQuote.bid = data.bid;
    }
    if (data.ask !== undefined && typeof data.ask === 'number') {
      this.latestQuote.ask = data.ask;
    }

    // Compute spread
    if (this.latestQuote.bid > 0 && this.latestQuote.ask >= this.latestQuote.bid) {
      this.latestQuote.spread = Number((this.latestQuote.ask - this.latestQuote.bid).toFixed(2));
    }

    if (data.volume !== undefined && typeof data.volume === 'number') {
      this.latestQuote.volume = data.volume;
    }

    // Tick timestamp (TradingView lp_time is in UTC seconds)
    const tickTimeSec = data.lp_time ? data.lp_time : Math.floor(now / 1000);
    this.latestQuote.time = tickTimeSec;

    // Latency & Delay detection
    const tickTimeMs = tickTimeSec * 1000;
    const latencyMs = Math.max(0, now - tickTimeMs);

    this.latencies.push(latencyMs);
    if (this.latencies.length > 50) this.latencies.shift();

    if (latencyMs > 3000) {
      this.consecutiveDelayedCount++;
      if (this.consecutiveDelayedCount >= 3) {
        this.isDelayed = true;
      }
    } else {
      this.consecutiveDelayedCount = 0;
      this.isDelayed = false;
    }

    // 15-minute delayed feed flag (~900,000 ms)
    this.isDelayed15m = latencyMs > 800000;

    const tickPayload: TvTickData = {
      symbol: this.primarySymbol,
      price: this.latestQuote.price,
      bid: this.latestQuote.bid || this.latestQuote.price - 0.2,
      ask: this.latestQuote.ask || this.latestQuote.price + 0.2,
      spread: this.latestQuote.spread,
      volume: this.latestQuote.volume,
      time: tickTimeSec,
      latencyMs,
      isDelayed: this.isDelayed,
      isDelayed15m: this.isDelayed15m,
    };

    // Update forming candle in aggregator for each active timeframe
    const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', 'D'];
    for (const tf of timeframes) {
      const res = tickAggregator.aggregateTick(this.primarySymbol, tf, {
        price: tickPayload.price,
        time: tickPayload.time,
        volume: tickPayload.volume,
        // Quote volume is cumulative/unspecified for these ticks, so it must not
        // be summed and presented as observed per-candle volume.
        volumeIsSynthetic: true,
        bid: tickPayload.bid,
        ask: tickPayload.ask,
      });

      if (res.isClosed && res.closedCandle) {
        // Candle completed: push to history and notify listeners
        const list = this.candles.get(tf) || [];
        const existingIdx = list.findIndex((c) => c.time === res.closedCandle!.time);
        if (existingIdx >= 0) {
          list[existingIdx] = res.closedCandle;
        } else {
          list.push(res.closedCandle);
          if (list.length > 500) list.shift();
        }
        for (const cb of this.candleCloseListeners) {
          cb(tf, res.closedCandle);
        }
      }
    }

    // Dispatch tick event to subscribers
    for (const listener of this.tickListeners) {
      listener(tickPayload);
    }
  }

  private handleChartUpdate(tf: Timeframe, chart: any) {
    if (!chart || !chart.periods || chart.periods.length === 0) return;

    // Convert TradingView periods to Candle[]
    // TradingView returns periods sorted descending (newest first): { time, open, max (high), min (low), close, volume }
    const tvPeriods = chart.periods;
    const formatted: Candle[] = [];

    // Reverse to chronological order (oldest first)
    for (let i = tvPeriods.length - 1; i >= 0; i--) {
      const p = tvPeriods[i];
      if (p && Number.isFinite(Number(p.time))) {
        const open = Number(p.open);
        const close = Number(p.close);
        const high = Number(p.max ?? Math.max(open, close));
        const low = Number(p.min ?? Math.min(open, close));
        const time = Number(p.time);
        const rawVolume = Number(p.volume);
        const hasObservedVolume = Number.isFinite(rawVolume) && rawVolume > 0;
        const prices = [open, high, low, close];
        if (time <= 0 || prices.some((price) => !Number.isFinite(price) || price <= 0)
          || high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;

        // Gold candles with impossible zero or extreme OHLC values can flatten the
        // chart autoscale and contaminate ATR, regime, and signal calculations.
        const goldRangeLimit = tf === '1m' ? 0.02 : tf === '5m' ? 0.03 : tf === '15m' ? 0.05 : tf === '1h' ? 0.10 : tf === '4h' ? 0.20 : 0.35;
        if (this.primarySymbol.toUpperCase().includes('XAU') && (high - low) / close > goldRangeLimit) continue;

        formatted.push({
          time,
          open: Number(open.toFixed(2)),
          high: Number(high.toFixed(2)),
          low: Number(low.toFixed(2)),
          close: Number(close.toFixed(2)),
          volume: hasObservedVolume ? rawVolume : 0,
          volumeIsSynthetic: !hasObservedVolume,
          isForming: i === 0, // newest bar is forming
        });
      }
    }

    if (formatted.length > 0) {
      this.candles.set(tf, formatted);

      // Latest official bar reconciliation
      const latestOfficial = formatted[formatted.length - 1];
      if (latestOfficial) {
        tickAggregator.reconcileOfficialCandle(
          this.primarySymbol,
          tf,
          {
            time: latestOfficial.time,
            open: latestOfficial.open,
            high: latestOfficial.high,
            low: latestOfficial.low,
            close: latestOfficial.close,
            volume: latestOfficial.volume,
            volumeIsSynthetic: latestOfficial.volumeIsSynthetic,
          },
          0.2
        );
      }
    }
  }

  private handleDisconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(30000, 1000 * Math.pow(1.5, this.reconnectAttempts));
    console.log(`TradingView feed disconnected. Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt #${this.reconnectAttempts})...`);

    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  public async reconnect() {
    this.cleanup();
    this.initTradingViewClient();
  }

  public cleanup() {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    for (const [, chart] of this.chartSessions) {
      try {
        chart.delete();
      } catch (e) {
        // ignore
      }
    }
    this.chartSessions.clear();

    if (this.quoteMarket) {
      try {
        this.quoteMarket.close();
      } catch (e) {
        // ignore
      }
      this.quoteMarket = null;
    }

    if (this.quoteSession) {
      try {
        this.quoteSession.delete();
      } catch (e) {
        // ignore
      }
      this.quoteSession = null;
    }

    if (this.client) {
      try {
        this.client.end();
      } catch (e) {
        // ignore
      }
      this.client = null;
    }
  }

  // Public Getters for Market Data Provider
  public getLatestQuote() {
    return this.latestQuote;
  }

  public getCandles(tf: Timeframe): Candle[] {
    return this.candles.get(tf) || [];
  }

  public getFormingCandle(tf: Timeframe): Candle | undefined {
    return tickAggregator.getFormingCandle(this.primarySymbol, tf);
  }

  public onTick(cb: TvTickCallback): () => void {
    this.tickListeners.add(cb);
    return () => this.tickListeners.delete(cb);
  }

  public onCandleClose(cb: TvCandleCloseCallback): () => void {
    this.candleCloseListeners.add(cb);
    return () => this.candleCloseListeners.delete(cb);
  }

  public getHealth() {
    const now = Date.now();
    const lastTickAgeSec = this.lastTickReceivedTime > 0 ? Number(((now - this.lastTickReceivedTime) / 1000).toFixed(1)) : 999;
    const isStale = lastTickAgeSec > 3.0 || !this.isConnected;

    const latenciesSorted = [...this.latencies].sort((a, b) => a - b);
    const avgLatency = latenciesSorted.length > 0 ? Math.round(latenciesSorted.reduce((a, b) => a + b, 0) / latenciesSorted.length) : 0;
    const p95Latency = latenciesSorted.length > 0 ? latenciesSorted[Math.floor(latenciesSorted.length * 0.95)] || latenciesSorted[latenciesSorted.length - 1] : 0;

    return {
      source: this.primarySymbol,
      isConnected: this.isConnected,
      isStale,
      isDelayed: this.isDelayed,
      isDelayed15m: this.isDelayed15m,
      lastTickAgeSec,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      reconnectAttempts: this.reconnectAttempts,
      mismatchCount: tickAggregator.getMismatchCount(),
      candlesSynced: {
        '1m': (this.candles.get('1m') || []).length,
        '5m': (this.candles.get('5m') || []).length,
        '15m': (this.candles.get('15m') || []).length,
        '1h': (this.candles.get('1h') || []).length,
        '4h': (this.candles.get('4h') || []).length,
        'D': (this.candles.get('D') || []).length,
      },
    };
  }
}

export const tvFeed = new TvFeedService();
