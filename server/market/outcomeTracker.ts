import {
  Candle,
  SignalEntity,
  SignalEvent,
  SignalLifecycleStatus,
  SignalOutcome,
} from '../types.ts';
import { sqliteStore } from '../db/sqliteStore.ts';
import { marketProvider } from './dataProvider.ts';
import { formatOutcomeAlertHtml, sendTelegramHtmlMessage } from '../telegram/bot.ts';

export type OutcomeBroadcastCallback = (data: {
  type: 'OUTCOME_EVENT';
  signalId: string;
  event: SignalEvent;
  outcome: SignalOutcome;
  signal: SignalEntity;
}) => void;

interface ActiveTrackingSession {
  signal: SignalEntity;
  armedBreakEvenPrice?: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
}

export class LiveOutcomeTracker {
  private activeSessions: Map<string, ActiveTrackingSession> = new Map();
  private broadcastCallbacks: Set<OutcomeBroadcastCallback> = new Set();
  private isRunning: boolean = false;
  private isFeedStale: boolean = false;
  private lastEvaluationTs: number = 0;

  constructor() {}

  public onBroadcast(cb: OutcomeBroadcastCallback) {
    this.broadcastCallbacks.add(cb);
    return () => this.broadcastCallbacks.delete(cb);
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Rehydrate all open signals from SQLite
    const openSignals = sqliteStore.getOpenSignals({ origin: 'engine_live' });
    for (const sig of openSignals) {
      this.registerSignal(sig);
    }

    // 2. Perform gap backfill from historical candles if server was restarted
    await this.rehydrateGapBackfill(openSignals);

    // 3. Subscribe to real-time tick stream
    marketProvider.subscribe((symbol, tick) => {
      if (symbol !== 'XAUUSD') return;
      this.handleTick(tick);
    });
  }

  public registerSignal(signal: SignalEntity) {
    if (!signal.outcome) {
      signal.outcome = sqliteStore.getSignalOutcome(signal.id) || undefined;
    }

    const isTp1 = signal.outcome?.status === 'TP1_HIT' || signal.outcome?.status === 'TP2_HIT';
    const isTp2 = signal.outcome?.status === 'TP2_HIT';

    // Calculate armed BE price if TP1 was already hit
    let armedBe: number | undefined;
    if (isTp1 && signal.outcome?.fillPrice) {
      armedBe = signal.direction === 'BUY'
        ? signal.outcome.fillPrice + 0.05
        : signal.outcome.fillPrice - 0.05;
    }

    this.activeSessions.set(signal.id, {
      signal,
      armedBreakEvenPrice: armedBe,
      tp1Hit: isTp1,
      tp2Hit: isTp2,
      tp3Hit: false,
    });
  }

  // Handle incoming live tick from TradingView feed
  public handleTick(tick: { price: number; bid: number; ask: number; spread: number; time: number }) {
    const symData = marketProvider.getSymbolData('XAUUSD');
    const isStale = symData?.isStale || false;

    // Rule 4: If feed is stale, pause tracking and log
    if (isStale) {
      if (!this.isFeedStale) {
        this.isFeedStale = true;
        console.warn('Live outcome tracking paused: Feed is STALE.');
      }
      return;
    }

    if (this.isFeedStale) {
      this.isFeedStale = false;
      console.log('Live outcome tracking resumed: Feed active.');
    }

    this.lastEvaluationTs = tick.time;

    for (const [signalId, session] of Array.from(this.activeSessions.entries())) {
      this.evaluateSignalOnPrice({
        session,
        price: tick.price,
        bid: tick.bid,
        ask: tick.ask,
        spread: tick.spread,
        time: tick.time,
        source: 'tick',
      });
    }
  }

  // Core spread-aware state machine
  private evaluateSignalOnPrice(params: {
    session: ActiveTrackingSession;
    price: number;
    bid: number;
    ask: number;
    spread: number;
    time: number;
    source: 'tick' | 'candle' | 'reconstructed';
    isAmbiguousBar?: boolean;
  }) {
    const { session, price, bid, ask, spread, time, source, isAmbiguousBar = false } = params;
    const { signal } = session;
    const currentStatus = signal.outcome?.status || 'PENDING';

    const isBuy = signal.direction === 'BUY';
    const initialRisk = Math.abs(signal.entryPrice - signal.sl);
    if (initialRisk <= 0) return;

    // 1. PENDING -> TRIGGERED
    if (currentStatus === 'PENDING') {
      let triggered = false;
      let fillPrice = signal.entryPrice;

      if (isBuy) {
        // Buy enters on Ask
        if (ask <= signal.entryPrice + 0.1) {
          triggered = true;
          fillPrice = ask;
        }
      } else {
        // Sell enters on Bid
        if (bid >= signal.entryPrice - 0.1) {
          triggered = true;
          fillPrice = bid;
        }
      }

      if (triggered) {
        this.transitionState(session, 'TRIGGERED', {
          price: fillPrice,
          bid,
          ask,
          spread,
          time,
          source,
          note: `Filled at ${fillPrice.toFixed(2)} (Spread: ${spread.toFixed(2)})`,
          fillPrice,
        });
      }
      return;
    }

    // Active trade tracking: TRIGGERED, TP1_HIT, TP2_HIT
    if (currentStatus === 'TRIGGERED' || currentStatus === 'TP1_HIT' || currentStatus === 'TP2_HIT') {
      const fillPrice = signal.outcome?.fillPrice || signal.entryPrice;
      const duration = Math.max(1, time - (signal.createdTs || time));

      // Calculate live R & MFE / MAE
      const currentR = isBuy
        ? Number(((bid - fillPrice) / initialRisk).toFixed(2))
        : Number(((fillPrice - ask) / initialRisk).toFixed(2));

      const prevMfe = signal.outcome?.rMaxMfe ?? 0;
      const prevMae = signal.outcome?.rMaxMae ?? 0;
      const rMaxMfe = Math.max(prevMfe, currentR);
      const rMaxMae = Math.min(prevMae, currentR);

      // 2. Ambiguous resolution in single bar (both SL and TP hit in same candle)
      if (isAmbiguousBar) {
        // Rule 1.2: Conservative resolution -> assume SL hit first
        const slExit = isBuy ? signal.sl : signal.sl;
        const rFinal = isBuy
          ? Number(((slExit - fillPrice) / initialRisk).toFixed(2))
          : Number(((fillPrice - slExit) / initialRisk).toFixed(2));

        this.transitionState(session, 'SL_HIT', {
          price: slExit,
          bid,
          ask,
          spread,
          time,
          source: 'reconstructed',
          note: 'Ambiguous candle resolved conservatively (SL hit before TP)',
          exitPriceEffective: slExit,
          rFinal,
          duration,
          firstHit: 'SL',
          ambiguousFlag: true,
          reconstructedFlag: true,
        });
        return;
      }

      // 3. Stop Loss hit check
      // For BUY: exit on Bid. For SELL: exit on Ask.
      const slHit = isBuy ? bid <= signal.sl : ask >= signal.sl;
      if (slHit) {
        const exitPrice = isBuy ? Math.min(bid, signal.sl) : Math.max(ask, signal.sl);
        // Include slippage beyond SL if gapped
        const rFinal = isBuy
          ? Number(((exitPrice - fillPrice) / initialRisk).toFixed(2))
          : Number(((fillPrice - exitPrice) / initialRisk).toFixed(2));

        this.transitionState(session, 'SL_HIT', {
          price: exitPrice,
          bid,
          ask,
          spread,
          time,
          source,
          note: `SL Hit at ${exitPrice.toFixed(2)} (${rFinal}R)`,
          exitPriceEffective: exitPrice,
          rFinal,
          duration,
          firstHit: session.tp1Hit ? 'TP1' : 'SL',
        });
        return;
      }

      // 4. Armed Break-Even exit check (after TP1 was hit)
      if (session.armedBreakEvenPrice !== undefined) {
        const beHit = isBuy
          ? bid <= session.armedBreakEvenPrice
          : ask >= session.armedBreakEvenPrice;

        if (beHit) {
          const exitPrice = session.armedBreakEvenPrice;
          // Weighted R: 50% partial at TP1 (e.g. +1.0R) + 50% at BE (0R) => +0.5R
          const tp1R = signal.rrPlanned > 0 ? signal.rrPlanned * 0.5 : 0.5;
          const rFinal = Number((tp1R).toFixed(2));

          this.transitionState(session, 'BE_EXIT', {
            price: exitPrice,
            bid,
            ask,
            spread,
            time,
            source,
            note: `Break-even stop triggered at ${exitPrice.toFixed(2)} (+${rFinal}R total)`,
            exitPriceEffective: exitPrice,
            rFinal,
            duration,
          });
          return;
        }
      }

      // 5. Take Profit 1 Hit
      if (!session.tp1Hit) {
        const tp1Hit = isBuy ? bid >= signal.tp1 : ask <= signal.tp1;
        if (tp1Hit) {
          session.tp1Hit = true;
          // Move SL to Break-Even with 0.05 buffer
          session.armedBreakEvenPrice = isBuy ? fillPrice + 0.05 : fillPrice - 0.05;

          const timeToTp1 = Math.max(1, time - signal.createdTs);

          this.transitionState(session, 'TP1_HIT', {
            price: signal.tp1,
            bid,
            ask,
            spread,
            time,
            source,
            note: `TP1 reached at ${signal.tp1.toFixed(2)} | SL moved to Break-Even (${session.armedBreakEvenPrice.toFixed(2)})`,
            timeToTp1,
            firstHit: 'TP1',
            rMaxMfe,
            rMaxMae,
          });
          return;
        }
      }

      // 6. Take Profit 2 Hit
      if (session.tp1Hit && !session.tp2Hit) {
        const tp2Hit = isBuy ? bid >= signal.tp2 : ask <= signal.tp2;
        if (tp2Hit) {
          session.tp2Hit = true;
          const timeToTp2 = Math.max(1, time - signal.createdTs);

          this.transitionState(session, 'TP2_HIT', {
            price: signal.tp2,
            bid,
            ask,
            spread,
            time,
            source,
            note: `TP2 reached at ${signal.tp2.toFixed(2)}`,
            timeToTp2,
            rMaxMfe,
            rMaxMae,
          });
          return;
        }
      }

      // 7. Take Profit 3 Hit (Terminal)
      if (session.tp2Hit && !session.tp3Hit) {
        const tp3Hit = isBuy ? bid >= signal.tp3 : ask <= signal.tp3;
        if (tp3Hit) {
          session.tp3Hit = true;
          const timeToTp3 = Math.max(1, time - signal.createdTs);
          const rFinal = Number((signal.rrPlanned * 1.5).toFixed(2));

          this.transitionState(session, 'TP3_HIT', {
            price: signal.tp3,
            bid,
            ask,
            spread,
            time,
            source,
            note: `TP3 maximum target achieved at ${signal.tp3.toFixed(2)} (+${rFinal}R)`,
            exitPriceEffective: signal.tp3,
            rFinal,
            timeToTp3,
            duration,
          });
          return;
        }
      }

      // Continuously update MFE/MAE
      sqliteStore.updateSignalOutcome({
        signalId: signal.id,
        rMaxMfe,
        rMaxMae,
      });
    }
  }

  // State Transition execution: writes event, updates outcome, dispatches Telegram & WebSocket
  private transitionState(
    session: ActiveTrackingSession,
    newStatus: SignalLifecycleStatus,
    details: {
      price: number;
      bid: number;
      ask: number;
      spread: number;
      time: number;
      source: 'tick' | 'candle' | 'reconstructed';
      note?: string;
      fillPrice?: number;
      exitPriceEffective?: number;
      rFinal?: number;
      duration?: number;
      timeToTp1?: number;
      timeToTp2?: number;
      timeToTp3?: number;
      firstHit?: 'TP1' | 'SL' | 'none';
      reconstructedFlag?: boolean;
      ambiguousFlag?: boolean;
      rMaxMfe?: number;
      rMaxMae?: number;
    }
  ) {
    const { signal } = session;
    const eventId = `ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const event: SignalEvent = {
      id: eventId,
      signalId: signal.id,
      type: newStatus,
      price: details.price,
      bid: details.bid,
      ask: details.ask,
      spread: details.spread,
      tsUtc: details.time,
      source: details.source,
      note: details.note,
    };

    // 1. Append immutable event to SQLite
    sqliteStore.addSignalEvent(event);

    // 2. Update materialized outcome
    sqliteStore.updateSignalOutcome({
      signalId: signal.id,
      status: newStatus,
      fillPrice: details.fillPrice,
      exitPriceEffective: details.exitPriceEffective,
      rFinal: details.rFinal,
      duration: details.duration,
      timeToTp1: details.timeToTp1,
      timeToTp2: details.timeToTp2,
      timeToTp3: details.timeToTp3,
      firstHit: details.firstHit,
      reconstructedFlag: details.reconstructedFlag,
      ambiguousFlag: details.ambiguousFlag,
      rMaxMfe: details.rMaxMfe,
      rMaxMae: details.rMaxMae,
    });

    // 3. Update memory entity
    const updatedOutcome = sqliteStore.getSignalOutcome(signal.id);
    if (updatedOutcome) {
      signal.outcome = updatedOutcome;
    }

    // 4. Auto-close matching paper trade in my_trades if registered
    if (details.exitPriceEffective !== undefined) {
      this.syncMatchingMyTrade(signal.id, details.exitPriceEffective, details.time, details.rFinal || 0);
    }

    // 5. Broadcast to WebSocket clients
    if (updatedOutcome) {
      for (const cb of this.broadcastCallbacks) {
        cb({
          type: 'OUTCOME_EVENT',
          signalId: signal.id,
          event,
          outcome: updatedOutcome,
          signal,
        });
      }
    }

    // 6. Send automated Telegram notification
    this.sendTelegramOutcomeAlert(signal, event, details.rFinal);

    // 7. If terminal state, remove from active in-memory tracker
    const terminalStatuses = new Set([
      'TP3_HIT',
      'SL_HIT',
      'BE_EXIT',
      'TRAIL_EXIT',
      'SL_AFTER_TP1',
      'INVALIDATED',
      'TIME_STOP',
      'EXPIRED',
      'CANCELLED',
    ]);

    if (terminalStatuses.has(newStatus)) {
      this.activeSessions.delete(signal.id);
    }
  }

  // Reconcile and backfill missing candle bars after server downtime
  private async rehydrateGapBackfill(openSignals: SignalEntity[]) {
    if (openSignals.length === 0) return;
    const candles1m = marketProvider.getCandles('XAUUSD', '1m');
    if (!candles1m || candles1m.length === 0) return;

    for (const session of Array.from(this.activeSessions.values())) {
      const sig = session.signal;
      const lastEvents = sqliteStore.getSignalEvents(sig.id);
      const lastEventTs = lastEvents[lastEvents.length - 1]?.tsUtc || sig.createdTs;

      // Filter candles after last known event
      const missingCandles = candles1m.filter((c) => c.time > lastEventTs);
      for (const candle of missingCandles) {
        if (!this.activeSessions.has(sig.id)) break; // already reached terminal

        // Check if both TP and SL are crossed within the same bar
        const isBuy = sig.direction === 'BUY';
        const hitSl = isBuy ? candle.low <= sig.sl : candle.high >= sig.sl;
        const hitTp = isBuy ? candle.high >= sig.tp1 : candle.low <= sig.tp1;
        const isAmbiguous = hitSl && hitTp;

        // Simulate bar chronologically: open -> low/high -> close
        this.evaluateSignalOnPrice({
          session,
          price: isBuy ? candle.low : candle.high,
          bid: candle.low,
          ask: candle.high,
          spread: 0.35,
          time: candle.time,
          source: 'reconstructed',
          isAmbiguousBar: isAmbiguous,
        });
      }
    }
  }

  // Synchronize matching trade in my_trades
  private syncMatchingMyTrade(signalId: string, exitPrice: number, exitTs: number, actualR: number) {
    const myTrades = sqliteStore.getMyTrades();
    const match = myTrades.find((t) => t.signalId === signalId && t.status === 'OPEN');
    if (match) {
      sqliteStore.closeMyTrade(match.id, exitPrice, exitTs, actualR, 'Auto-synced from system outcome plan');
    }
  }

  // Telegram alert dispatcher for lifecycle transitions
  private sendTelegramOutcomeAlert(signal: SignalEntity, event: SignalEvent, rFinal?: number) {
    try {
      const html = formatOutcomeAlertHtml(signal, event, rFinal);
      if (html) {
        sendTelegramHtmlMessage(html).catch((err) => {
          console.warn('Failed to send Telegram outcome alert:', err);
        });
      }
    } catch (e) {
      console.warn('Error formatting Telegram outcome message:', e);
    }
  }
}

export const liveOutcomeTracker = new LiveOutcomeTracker();
