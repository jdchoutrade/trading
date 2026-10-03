import { Candle, Timeframe } from '../types.ts';
import { tvFeed, TvTickData } from './tvFeed.ts';
import { tickAggregator } from './aggregator.ts';

export interface SymbolData {
  symbol: string;
  name: string;
  digits: number;
  currentPrice: number;
  bid: number;
  ask: number;
  spread: number;
  lastTickTime: number;
  latencyMs: number;
  isStale: boolean;
  isDelayed: boolean;
  isDelayed15m?: boolean;
  secondaryPrice?: number;
  divergenceAtr?: number;
  isDivergent: boolean;
  ticksPerSecond: number;
  reconnectCount: number;
  candlesSynced: Record<Timeframe, number>;
  candles: Record<Timeframe, Candle[]>;
  formingCandle?: Candle;
}

export interface IDataProvider {
  subscribe(cb: (symbol: string, tick: { price: number; time: number; bid: number; ask: number; spread: number; isForming: boolean }) => void): () => void;
  getCandles(symbol: string, timeframe: Timeframe): Candle[];
  getSymbolData(symbol: string): SymbolData | undefined;
  getAllSymbols(): any[];
  getHealth(): any;
  setBrokerOffset(offset: number): void;
  getBrokerOffset(): number;
}

export class MarketDataProvider implements IDataProvider {
  private symbols: Map<string, SymbolData> = new Map();
  private subscribers: Set<(symbol: string, tick: { price: number; time: number; bid: number; ask: number; spread: number; isForming: boolean }) => void> = new Set();
  private isRunning: boolean = false;
  private tickTimestamps: number[] = [];
  private brokerOffset: number = 0; // offset in points ($)
  private secondaryPollId: any = null;

  constructor() {
    this.initializeSymbols();
  }

  private initializeSymbols() {
    const list = [
      { symbol: 'XAUUSD', name: 'Gold / US Dollar (Spot)', digits: 2, defaultPrice: 2650.0, spread: 0.35 },
      { symbol: 'BTCUSDT', name: 'Bitcoin / Tether', digits: 1, defaultPrice: 85000.0, spread: 1.5 },
      { symbol: 'EURUSD', name: 'Euro / US Dollar', digits: 5, defaultPrice: 1.0850, spread: 0.00015 },
      { symbol: 'GBPUSD', name: 'British Pound / USD', digits: 5, defaultPrice: 1.2950, spread: 0.00018 },
      { symbol: 'US30', name: 'Dow Jones Industrial', digits: 1, defaultPrice: 43500.0, spread: 2.0 },
      { symbol: 'NAS100', name: 'Nasdaq 100 Index', digits: 1, defaultPrice: 20500.0, spread: 1.2 },
      { symbol: 'USOIL', name: 'WTI Crude Oil', digits: 2, defaultPrice: 70.0, spread: 0.04 },
    ];

    for (const item of list) {
      this.symbols.set(item.symbol, {
        symbol: item.symbol,
        name: item.name,
        digits: item.digits,
        currentPrice: item.defaultPrice,
        bid: Number((item.defaultPrice - item.spread / 2).toFixed(item.digits)),
        ask: Number((item.defaultPrice + item.spread / 2).toFixed(item.digits)),
        spread: item.spread,
        lastTickTime: Date.now(),
        latencyMs: 35,
        isStale: false,
        isDelayed: false,
        isDivergent: false,
        ticksPerSecond: 1.5,
        reconnectCount: 0,
        candlesSynced: { '1m': 0, '5m': 0, '15m': 0, '1h': 0, '4h': 0, 'D': 0 },
        candles: {
          '1m': [],
          '5m': [],
          '15m': [],
          '1h': [],
          '4h': [],
          'D': [],
        },
      });
    }
  }

  public setBrokerOffset(offset: number) {
    this.brokerOffset = offset;
  }

  public getBrokerOffset(): number {
    return this.brokerOffset;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Start primary TradingView Feed (Quote Session + Chart Sessions)
    await tvFeed.start();

    // 2. Wire incoming TradingView ticks to subscribers
    tvFeed.onTick((tvTick: TvTickData) => {
      this.handleTvTick(tvTick);
    });

    // 3. Start secondary provider cross-check
    this.startSecondaryCrossCheck();
  }

  private handleTvTick(tvTick: TvTickData) {
    const now = Date.now();
    this.tickTimestamps.push(now);
    this.tickTimestamps = this.tickTimestamps.filter((t) => now - t <= 10000);
    const tps = Number((this.tickTimestamps.length / 10).toFixed(1));

    const gold = this.symbols.get('XAUUSD');
    if (gold && tvTick.price > 100) {
      gold.currentPrice = tvTick.price;
      gold.bid = tvTick.bid;
      gold.ask = tvTick.ask;
      gold.spread = tvTick.spread;
      gold.lastTickTime = now;
      gold.latencyMs = tvTick.latencyMs;
      gold.isDelayed = tvTick.isDelayed;
      gold.isDelayed15m = tvTick.isDelayed15m;
      gold.isStale = (now - gold.lastTickTime) > 3000;
      gold.ticksPerSecond = tps;

      // Broadcast tick to subscribers
      for (const cb of this.subscribers) {
        cb('XAUUSD', {
          price: Number((tvTick.price + this.brokerOffset).toFixed(2)),
          time: tvTick.time,
          bid: Number((tvTick.bid + this.brokerOffset).toFixed(2)),
          ask: Number((tvTick.ask + this.brokerOffset).toFixed(2)),
          spread: tvTick.spread,
          isForming: true,
        });
      }
    }
  }

  public subscribe(cb: (symbol: string, tick: { price: number; time: number; bid: number; ask: number; spread: number; isForming: boolean }) => void) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  public getSymbolData(symbol: string): SymbolData | undefined {
    const sym = this.symbols.get(symbol);
    if (!sym) return undefined;

    if (symbol === 'XAUUSD') {
      const tvQuote = tvFeed.getLatestQuote();
      const tvHealth = tvFeed.getHealth();

      return {
        ...sym,
        currentPrice: tvQuote.price || sym.currentPrice,
        bid: tvQuote.bid || sym.bid,
        ask: tvQuote.ask || sym.ask,
        spread: tvQuote.spread || sym.spread,
        latencyMs: tvHealth.avgLatencyMs,
        isStale: tvHealth.isStale,
        isDelayed: tvHealth.isDelayed,
        isDelayed15m: tvHealth.isDelayed15m,
        formingCandle: tvFeed.getFormingCandle('15m'),
        candlesSynced: tvHealth.candlesSynced,
      };
    }

    return sym;
  }

  public getAllSymbols(): any[] {
    return Array.from(this.symbols.values()).map((s) => {
      const price = s.symbol === 'XAUUSD' ? (tvFeed.getLatestQuote().price || s.currentPrice) : s.currentPrice;
      const bid = s.symbol === 'XAUUSD' ? (tvFeed.getLatestQuote().bid || s.bid) : s.bid;
      const ask = s.symbol === 'XAUUSD' ? (tvFeed.getLatestQuote().ask || s.ask) : s.ask;
      const spread = s.symbol === 'XAUUSD' ? (tvFeed.getLatestQuote().spread || s.spread) : s.spread;
      const isStale = s.symbol === 'XAUUSD' ? tvFeed.getHealth().isStale : (Date.now() - s.lastTickTime > 4000);
      const isDelayed = s.symbol === 'XAUUSD' ? tvFeed.getHealth().isDelayed : false;

      return {
        symbol: s.symbol,
        name: s.name,
        price: Number((price + this.brokerOffset).toFixed(s.digits)),
        rawPrice: price,
        bid: Number((bid + this.brokerOffset).toFixed(s.digits)),
        ask: Number((ask + this.brokerOffset).toFixed(s.digits)),
        spread,
        isStale,
        isDelayed,
        isDivergent: s.isDivergent,
        latencyMs: s.symbol === 'XAUUSD' ? tvFeed.getHealth().avgLatencyMs : s.latencyMs,
        ticksPerSecond: s.symbol === 'XAUUSD' ? s.ticksPerSecond : 1.0,
        lastTickAgeSeconds: s.symbol === 'XAUUSD' ? tvFeed.getHealth().lastTickAgeSec : Number(((Date.now() - s.lastTickTime) / 1000).toFixed(1)),
      };
    });
  }

  public getCandles(symbol: string, timeframe: Timeframe): Candle[] {
    if (symbol === 'XAUUSD') {
      const tvCandles = tvFeed.getCandles(timeframe);
      if (tvCandles.length > 0) {
        if (this.brokerOffset !== 0) {
          return tvCandles.map((c) => ({
            ...c,
            open: Number((c.open + this.brokerOffset).toFixed(2)),
            high: Number((c.high + this.brokerOffset).toFixed(2)),
            low: Number((c.low + this.brokerOffset).toFixed(2)),
            close: Number((c.close + this.brokerOffset).toFixed(2)),
          }));
        }
        return tvCandles;
      }
    }

    const data = this.symbols.get(symbol);
    if (!data) return [];
    const list = data.candles[timeframe] || [];
    if (this.brokerOffset !== 0) {
      return list.map((c) => ({
        ...c,
        open: Number((c.open + this.brokerOffset).toFixed(data.digits)),
        high: Number((c.high + this.brokerOffset).toFixed(data.digits)),
        low: Number((c.low + this.brokerOffset).toFixed(data.digits)),
        close: Number((c.close + this.brokerOffset).toFixed(data.digits)),
      }));
    }
    return list;
  }

  public getHealth(): any {
    const gold = this.symbols.get('XAUUSD');
    const tvHealth = tvFeed.getHealth();

    return {
      status: tvHealth.isStale ? 'STALE' : 'LIVE',
      source: tvFeed.getPrimarySymbol(),
      isConnected: tvHealth.isConnected,
      latencyMs: tvHealth.avgLatencyMs,
      p95LatencyMs: tvHealth.p95LatencyMs,
      lastTickAgeSeconds: tvHealth.lastTickAgeSec,
      isDelayed: tvHealth.isDelayed,
      isDelayed15m: tvHealth.isDelayed15m,
      isDivergent: gold?.isDivergent || false,
      divergenceAtr: gold?.divergenceAtr || 0,
      ticksPerSecond: gold?.ticksPerSecond || 0,
      primaryPrice: tvFeed.getLatestQuote().price || gold?.currentPrice || 0,
      secondaryPrice: gold?.secondaryPrice || 0,
      reconnectCount: tvHealth.reconnectAttempts,
      mismatchCount: tvHealth.mismatchCount,
      candlesSynced: tvHealth.candlesSynced,
      brokerOffset: this.brokerOffset,
    };
  }

  // Secondary provider for cross-check divergence validation
  private startSecondaryCrossCheck() {
    this.secondaryPollId = setInterval(async () => {
      try {
        // Query secondary spot gold quote from Yahoo Spot Gold (XAUUSD=X) or Binance Paxg
        const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X?interval=1m&range=1d', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (res.ok) {
          const json = await res.json();
          const meta = json.chart?.result?.[0]?.meta;
          const secPrice = meta?.regularMarketPrice;

          const gold = this.symbols.get('XAUUSD');
          if (gold && secPrice && secPrice > 1000) {
            gold.secondaryPrice = secPrice;
            const primaryPrice = tvFeed.getLatestQuote().price || gold.currentPrice;
            const diff = Math.abs(primaryPrice - secPrice);

            // Compute ATR baseline (approx 4.0 points on 15m)
            const atrEstimate = 4.0;
            const divAtr = Number((diff / atrEstimate).toFixed(2));
            gold.divergenceAtr = divAtr;

            // Divergence warning if divergence exceeds 0.6 ATR threshold
            gold.isDivergent = divAtr > 0.6;
          }
        }
      } catch (e) {
        // secondary check failure is non-fatal
      }
    }, 25000);
  }
}

export const marketProvider = new MarketDataProvider();
