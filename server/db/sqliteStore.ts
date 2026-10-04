import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  CompareTradeRecord,
  HistorySummaryStats,
  MyTradeEntity,
  SignalEntity,
  SignalEvent,
  SignalLifecycleStatus,
  SignalOutcome,
  SignalAgreement,
  SignalOrigin,
  SignalSource,
} from '../types.ts';
import { DEFAULT_WEIGHTS, RegimeWeightsConfig } from '../engine/defaultWeights.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.resolve(process.env.GOLD_DESK_DB_PATH || path.join(DATA_DIR, 'gold_desk.db'));
const LEGACY_JSON_FILE = path.join(DATA_DIR, 'db.json');

export class SqliteStore {
  private db: DatabaseSync;
  private readonly databasePath: string;
  private latestHash: string = '0000000000000000000000000000000000000000000000000000000000000000';

  constructor(databasePath: string = DB_FILE) {
    this.databasePath = databasePath;
    if (databasePath !== ':memory:' && !fs.existsSync(path.dirname(databasePath))) {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    this.initDatabase();
    if (databasePath === DB_FILE) this.migrateLegacyJson();
    this.refreshLatestHash();
  }

  public close() {
    this.db.close();
  }

  public exportSnapshot(): Buffer {
    const snapshotPath = path.join(DATA_DIR, `.gold_desk.${process.pid}.${Date.now()}.snapshot.db`);
    const escapedPath = snapshotPath.replace(/'/g, "''");
    try {
      this.db.exec('PRAGMA wal_checkpoint(FULL);');
      this.db.exec(`VACUUM INTO '${escapedPath}';`);
      return fs.readFileSync(snapshotPath);
    } finally {
      if (fs.existsSync(snapshotPath)) fs.rmSync(snapshotPath, { force: true });
    }
  }

  public restoreSnapshot(snapshot: Buffer) {
    if (this.databasePath === ':memory:' || snapshot.length < 100 || snapshot.toString('utf8', 0, 16) !== 'SQLite format 3\u0000') {
      throw new Error('Invalid SQLite snapshot.');
    }

    this.db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = `${this.databasePath}${suffix}`;
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    }
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    fs.writeFileSync(this.databasePath, snapshot);
    this.db = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    this.initDatabase();
    this.refreshLatestHash();
  }

  private initDatabase() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        created_ts INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        source_feed TEXT NOT NULL,
        direction TEXT NOT NULL,
        trigger_tf TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        entry_price REAL NOT NULL,
        sl REAL NOT NULL,
        tp1 REAL NOT NULL,
        tp2 REAL NOT NULL,
        tp3 REAL NOT NULL,
        rr_planned REAL NOT NULL,
        score REAL NOT NULL,
        grade TEXT NOT NULL,
        regime TEXT NOT NULL,
        session TEXT NOT NULL,
        factors_json TEXT NOT NULL,
        weights_version TEXT NOT NULL,
        config_version TEXT NOT NULL,
        ai_verdict_json TEXT,
        price_feed_snapshot TEXT NOT NULL,
        mgmt_plan_json TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        broker_offset_at_signal REAL NOT NULL DEFAULT 0,
        tags TEXT,
        source TEXT NOT NULL DEFAULT 'UNKNOWN_LEGACY',
        origin TEXT NOT NULL DEFAULT 'legacy',
        candle_close_ts INTEGER NOT NULL DEFAULT 0,
        group_id TEXT,
        agreement TEXT NOT NULL DEFAULT 'UNKNOWN_LEGACY',
        input_provenance_json TEXT NOT NULL DEFAULT '{}',
        ai_state TEXT NOT NULL DEFAULT 'UNKNOWN',
        hash_version INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_signals_created_ts ON signals(created_ts);
      CREATE INDEX IF NOT EXISTS idx_signals_direction ON signals(direction);
      CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source);

      CREATE TABLE IF NOT EXISTS signal_events (
        id TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        type TEXT NOT NULL,
        price REAL NOT NULL,
        bid REAL NOT NULL,
        ask REAL NOT NULL,
        spread REAL NOT NULL,
        ts_utc INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'tick',
        note TEXT,
        FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_signal_id ON signal_events(signal_id);
      CREATE INDEX IF NOT EXISTS idx_events_ts ON signal_events(ts_utc);

      CREATE TABLE IF NOT EXISTS signal_outcomes (
        signal_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        fill_price REAL,
        exit_price_effective REAL,
        r_final REAL,
        r_max_mfe REAL DEFAULT 0,
        r_max_mae REAL DEFAULT 0,
        mfe_price REAL,
        mfe_ts INTEGER,
        mae_price REAL,
        mae_ts INTEGER,
        time_to_tp1 INTEGER,
        time_to_tp2 INTEGER,
        time_to_tp3 INTEGER,
        time_to_sl INTEGER,
        duration INTEGER,
        first_hit TEXT DEFAULT 'none',
        reconstructed_flag INTEGER DEFAULT 0,
        ambiguous_flag INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_outcomes_status ON signal_outcomes(status);

      CREATE TABLE IF NOT EXISTS my_trades (
        id TEXT PRIMARY KEY,
        signal_id TEXT,
        taken_ts INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        actual_entry REAL NOT NULL,
        actual_sl REAL NOT NULL,
        actual_tp REAL NOT NULL,
        lot REAL NOT NULL,
        actual_exit REAL,
        exit_ts INTEGER,
        actual_r REAL,
        notes TEXT,
        screenshot_ref TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN'
      );

      CREATE TABLE IF NOT EXISTS signal_notes (
        id TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL UNIQUE,
        notes TEXT NOT NULL,
        tags TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS drawings (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        points_json TEXT NOT NULL,
        color TEXT NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Immutability enforcement triggers: Prevent updating core signals and deleting events
      CREATE TRIGGER IF NOT EXISTS trg_prevent_signal_update
      BEFORE UPDATE ON signals
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABILITY_VIOLATION: Registered signals cannot be modified.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_event_delete
      BEFORE DELETE ON signal_events
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABILITY_VIOLATION: Signal events are append-only.');
      END;
    `);

    this.migrateSignalSourceSchema();

    // Record migration version
    const checkMig = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
    if (!checkMig.get('v2_institutional_history')) {
      const insMig = this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
      insMig.run('v2_institutional_history', Math.floor(Date.now() / 1000));
    }
    if (!checkMig.get('v3_signal_sources')) {
      const insMig = this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
      insMig.run('v3_signal_sources', Math.floor(Date.now() / 1000));
    }
  }

  private migrateSignalSourceSchema() {
    const columns = () => new Set(
      (this.db.prepare('PRAGMA table_info(signals)').all() as Array<{ name: string }>).map((column) => column.name)
    );
    let names = columns();

    if (names.has('source') && !names.has('origin')) {
      this.db.exec('ALTER TABLE signals RENAME COLUMN source TO origin');
      names = columns();
    }

    const additions: Array<[string, string]> = [
      ['source', "TEXT NOT NULL DEFAULT 'UNKNOWN_LEGACY'"],
      ['origin', "TEXT NOT NULL DEFAULT 'legacy'"],
      ['candle_close_ts', 'INTEGER NOT NULL DEFAULT 0'],
      ['group_id', 'TEXT'],
      ['agreement', "TEXT NOT NULL DEFAULT 'UNKNOWN_LEGACY'"],
      ['input_provenance_json', "TEXT NOT NULL DEFAULT '{}'"],
      ['ai_state', "TEXT NOT NULL DEFAULT 'UNKNOWN'"],
      ['hash_version', 'INTEGER NOT NULL DEFAULT 1'],
    ];
    for (const [name, declaration] of additions) {
      if (!names.has(name)) this.db.exec(`ALTER TABLE signals ADD COLUMN ${name} ${declaration}`);
    }

    const immutableTrigger = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_prevent_signal_update'").get();
    if (immutableTrigger) this.db.exec('DROP TRIGGER trg_prevent_signal_update');
    try {
      this.db.exec(`
        UPDATE signals SET origin = 'UNKNOWN_LEGACY' WHERE origin IN ('live', 'paper');
        UPDATE signals SET origin = 'legacy_v1' WHERE origin = 'legacy';
      `);
    } finally {
      if (immutableTrigger) {
        this.db.exec(`
          CREATE TRIGGER trg_prevent_signal_update
          BEFORE UPDATE ON signals
          BEGIN
            SELECT RAISE(ABORT, 'IMMUTABILITY_VIOLATION: Registered signals cannot be modified.');
          END;
        `);
      }
    }

    this.db.exec(`
      DROP INDEX IF EXISTS idx_signals_source;
      CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source);
      CREATE INDEX IF NOT EXISTS idx_signals_origin ON signals(origin);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_engine_idempotency
        ON signals(source, symbol, trigger_tf, candle_close_ts, direction, config_version)
        WHERE source IN ('INDICATOR', 'ANALYSIS') AND candle_close_ts > 0;
    `);
  }

  private refreshLatestHash() {
    const row: any = this.db.prepare('SELECT snapshot_hash FROM signals ORDER BY created_ts DESC, id DESC LIMIT 1').get();
    if (row && row.snapshot_hash) {
      this.latestHash = row.snapshot_hash;
    }
  }

  // Migrate existing data from db.json without generating fake records
  private migrateLegacyJson() {
    if (!fs.existsSync(LEGACY_JSON_FILE)) return;
    try {
      const raw = fs.readFileSync(LEGACY_JSON_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed) return;

      // Migrate existing signals
      if (Array.isArray(parsed.signals) && parsed.signals.length > 0) {
        const checkSig = this.db.prepare('SELECT id FROM signals WHERE id = ?');
        for (const s of parsed.signals) {
          if (!s.id || checkSig.get(s.id)) continue;

          // Compute legitimate snapshot hash
          const hash = this.computeHash({
            id: s.id,
            createdTs: s.createdAt || Math.floor(Date.now() / 1000),
            symbol: s.symbol || 'XAUUSD',
            direction: s.direction || 'BUY',
            entryPrice: s.entryPrice || 0,
            sl: s.stopLoss || 0,
            tp1: s.tp1 || 0,
            prevHash: this.latestHash,
          });

          this.insertSignalDirect({
            id: s.id,
            createdTs: s.createdAt || Math.floor(Date.now() / 1000),
            symbol: s.symbol || 'XAUUSD',
            sourceFeed: 'OANDA:XAUUSD',
            direction: s.direction || 'BUY',
            triggerTf: s.timeframe || '15m',
            entryType: 'MARKET',
            entryPrice: s.entryPrice || 0,
            sl: s.stopLoss || 0,
            tp1: s.tp1 || 0,
            tp2: s.tp2 || 0,
            tp3: s.tp3 || 0,
            rrPlanned: s.rr || 2.0,
            score: s.score || 75,
            grade: s.grade || 'B',
            regime: (s.regime as any) || 'TREND_BULL',
            session: s.session || 'London',
            factors: s.topFactors || [],
            weightsVersion: '2.0',
            configVersion: '2.0',
            aiVerdict: s.aiAgreement ? { agreement: s.aiAgreement } : undefined,
            priceFeedSnapshot: {
              primaryPrice: s.entryPrice || 0,
              spread: 0.35,
              latencyMs: 35,
            },
            mgmtPlan: {
              partialCloseTp1Percent: 50,
              partialCloseTp2Percent: 30,
              moveSlToBreakEvenAtTp1: true,
              maxCandlesTimeStop: 48,
            },
            snapshotHash: hash,
            prevHash: this.latestHash,
            brokerOffset: 0,
            tags: ['legacy'],
            source: 'UNKNOWN_LEGACY',
            origin: 'legacy_v1',
            candleCloseTs: 0,
            agreement: 'UNKNOWN_LEGACY',
            inputProvenance: {},
            aiState: 'UNKNOWN',
            hashVersion: 1,
          });

          // Create legacy outcome record
          const status = (s.status as SignalLifecycleStatus) || 'TRIGGERED';
          const r = s.realizedR !== undefined ? s.realizedR : status.startsWith('TP') ? s.rr : status === 'SL_HIT' ? -1 : 0;

          this.db.prepare(`
            INSERT OR REPLACE INTO signal_outcomes
            (signal_id, status, fill_price, exit_price_effective, r_final, r_max_mfe, r_max_mae, time_to_tp1, duration, first_hit, reconstructed_flag, ambiguous_flag, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            s.id,
            status,
            s.entryPrice || 0,
            status.startsWith('TP') ? s.tp1 : s.stopLoss || 0,
            r,
            s.maxFavorableExcursion || 0,
            s.maxAdverseExcursion || 0,
            s.outcomeTime && s.createdAt ? s.outcomeTime - s.createdAt : 0,
            s.outcomeTime && s.createdAt ? s.outcomeTime - s.createdAt : 0,
            status.startsWith('TP') ? 'TP1' : status === 'SL_HIT' ? 'SL' : 'none',
            1, // marked reconstructed / legacy
            0,
            Math.floor(Date.now() / 1000)
          );

          this.latestHash = hash;
        }
      }

      // Migrate paper trades
      if (Array.isArray(parsed.paperTrades) && parsed.paperTrades.length > 0) {
        const checkTrade = this.db.prepare('SELECT id FROM my_trades WHERE id = ?');
        for (const t of parsed.paperTrades) {
          if (!t.id || checkTrade.get(t.id)) continue;
          this.db.prepare(`
            INSERT INTO my_trades
            (id, signal_id, taken_ts, symbol, direction, actual_entry, actual_sl, actual_tp, lot, actual_exit, exit_ts, actual_r, notes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            t.id,
            t.signalId || null,
            t.openTime || Math.floor(Date.now() / 1000),
            t.symbol || 'XAUUSD',
            t.direction || 'BUY',
            t.entryPrice || 0,
            t.stopLoss || 0,
            t.takeProfit || 0,
            t.lotSize || 0.1,
            t.status === 'CLOSED' ? (t.direction === 'BUY' ? t.entryPrice + (t.pnlPips || 0) : t.entryPrice - (t.pnlPips || 0)) : null,
            t.closeTime || null,
            t.status === 'CLOSED' ? Number(((t.pnlPips || 0) / Math.max(1, Math.abs(t.entryPrice - t.stopLoss))).toFixed(2)) : null,
            t.closeReason || '',
            t.status || 'OPEN'
          );
        }
      }
    } catch (e) {
      console.warn('Failed to migrate legacy db.json data:', e);
    }
  }

  public computeHash(params: {
    id: string;
    createdTs: number;
    symbol: string;
    direction: string;
    entryPrice: number;
    sl: number;
    tp1: number;
    prevHash: string;
    hashVersion?: number;
    tp2?: number;
    tp3?: number;
    score?: number;
    grade?: string;
    source?: string;
    origin?: string;
    candleCloseTs?: number;
    groupId?: string;
    agreement?: string;
    weightsVersion?: string;
    configVersion?: string;
    inputProvenance?: Record<string, unknown>;
    factors?: unknown[];
    aiVerdict?: unknown;
    priceFeedSnapshot?: Record<string, unknown>;
    mgmtPlan?: Record<string, unknown>;
  }): string {
    const raw = params.hashVersion === 2
      ? JSON.stringify([
          params.id, params.createdTs, params.symbol, params.direction,
          params.entryPrice, params.sl, params.tp1, params.tp2, params.tp3,
          params.score, params.grade, params.source, params.origin,
          params.candleCloseTs, params.groupId, params.agreement,
          params.weightsVersion, params.configVersion, params.factors,
          params.aiVerdict, params.priceFeedSnapshot, params.mgmtPlan, params.inputProvenance,
          params.prevHash,
        ])
      : `${params.id}|${params.createdTs}|${params.symbol}|${params.direction}|${params.entryPrice}|${params.sl}|${params.tp1}|${params.prevHash}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  public createFromEngine(
    source: Exclude<SignalSource, 'UNKNOWN_LEGACY'>,
    signalInput: Omit<SignalEntity, 'snapshotHash' | 'prevHash' | 'source' | 'hashVersion'>
  ): SignalEntity {
    return this.createFromEngineBatch([{ source, signalInput }]).signals[0];
  }

  public createFromEngineBatch(entries: Array<{
    source: Exclude<SignalSource, 'UNKNOWN_LEGACY'>;
    signalInput: Omit<SignalEntity, 'snapshotHash' | 'prevHash' | 'source' | 'hashVersion'>;
  }>): { signals: SignalEntity[]; createdSignals: SignalEntity[] } {
    if (entries.some(({ signalInput }) => signalInput.candleCloseTs <= 0)) {
      throw new Error('Engine signals require a valid signal timestamp.');
    }
    if (entries.some(({ signalInput }) => signalInput.groupId !== entries[0]?.signalInput.groupId)) {
      throw new Error('A source batch must share one signal group.');
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      let previousHash = this.latestHash;
      const results: SignalEntity[] = [];
      const createdSignals: SignalEntity[] = [];
      const findExisting = this.db.prepare(`
        SELECT * FROM signals
        WHERE source = ? AND symbol = ? AND trigger_tf = ? AND candle_close_ts = ?
          AND direction = ? AND config_version = ?
      `);
      for (const { source, signalInput } of [...entries].sort((left, right) => left.signalInput.id.localeCompare(right.signalInput.id))) {
        const repeated = findExisting.get(source, signalInput.symbol, signalInput.triggerTf, signalInput.candleCloseTs, signalInput.direction, signalInput.configVersion) as any;
        if (repeated) {
          results.push(this.mapSignalRow(repeated));
          continue;
        }

        const signalWithoutHash = { ...signalInput, source, hashVersion: 2 };
        const snapshotHash = this.computeHash({ ...signalWithoutHash, prevHash: previousHash });
        const signal: SignalEntity = { ...signalWithoutHash, snapshotHash, prevHash: previousHash };
        this.insertSignalDirect(signal);

        const initialStatus: SignalLifecycleStatus = signal.entryType === 'MARKET' ? 'TRIGGERED' : 'PENDING';
        this.db.prepare(`
          INSERT INTO signal_outcomes
          (signal_id, status, fill_price, r_final, r_max_mfe, r_max_mae, time_to_tp1, duration, first_hit, reconstructed_flag, ambiguous_flag, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          signal.id,
          initialStatus,
          signal.entryType === 'MARKET' ? signal.entryPrice : null,
          0,
          0,
          0,
          null,
          0,
          'none',
          0,
          0,
          Math.floor(Date.now() / 1000)
        );
        this.addSignalEvent({
          id: `ev_${crypto.randomUUID()}`,
          signalId: signal.id,
          type: initialStatus,
          price: signal.entryPrice,
          bid: signal.priceFeedSnapshot.primaryPrice - signal.priceFeedSnapshot.spread / 2,
          ask: signal.priceFeedSnapshot.primaryPrice + signal.priceFeedSnapshot.spread / 2,
          spread: signal.priceFeedSnapshot.spread,
          tsUtc: signal.createdTs,
          source: 'tick',
          note: signal.entryType === 'MARKET' ? 'Market order filled on signal generation' : 'Pending limit order awaiting retest',
        });
        previousHash = snapshotHash;
        results.push(signal);
        createdSignals.push(signal);
      }
      this.db.exec('COMMIT');
      this.latestHash = previousHash;
      for (const signal of results) {
        signal.outcome = this.getSignalOutcome(signal.id) || undefined;
      }
      return { signals: results, createdSignals };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    }
  }

  private insertSignalDirect(signal: SignalEntity) {
    const stmt = this.db.prepare(`
      INSERT INTO signals (
        id, created_ts, symbol, source_feed, direction, trigger_tf, entry_type,
        entry_price, sl, tp1, tp2, tp3, rr_planned, score, grade, regime,
        session, factors_json, weights_version, config_version, ai_verdict_json,
        price_feed_snapshot, mgmt_plan_json, snapshot_hash, prev_hash,
        broker_offset_at_signal, tags, source, origin, candle_close_ts, group_id,
        agreement, input_provenance_json, ai_state, hash_version
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      signal.id,
      signal.createdTs,
      signal.symbol,
      signal.sourceFeed,
      signal.direction,
      signal.triggerTf,
      signal.entryType,
      signal.entryPrice,
      signal.sl,
      signal.tp1,
      signal.tp2,
      signal.tp3,
      signal.rrPlanned,
      signal.score,
      signal.grade,
      signal.regime,
      signal.session,
      JSON.stringify(signal.factors || []),
      signal.weightsVersion || '2.0',
      signal.configVersion || '2.0',
      signal.aiVerdict ? JSON.stringify(signal.aiVerdict) : null,
      JSON.stringify(signal.priceFeedSnapshot || {}),
      JSON.stringify(signal.mgmtPlan || {}),
      signal.snapshotHash,
      signal.prevHash,
      signal.brokerOffset || 0,
      signal.tags ? JSON.stringify(signal.tags) : null,
      signal.source,
      signal.origin,
      signal.candleCloseTs,
      signal.groupId || null,
      signal.agreement,
      JSON.stringify(signal.inputProvenance || {}),
      signal.aiState,
      signal.hashVersion
    );
  }

  public addSignalEvent(event: SignalEvent) {
    this.db.prepare(`
      INSERT INTO signal_events
      (id, signal_id, type, price, bid, ask, spread, ts_utc, source, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.signalId,
      event.type,
      event.price,
      event.bid,
      event.ask,
      event.spread,
      event.tsUtc,
      event.source,
      event.note || null
    );

    // Update outcome table to reflect newest event
    this.db.prepare(`
      UPDATE signal_outcomes
      SET status = ?, updated_at = ?
      WHERE signal_id = ?
    `).run(event.type, Math.floor(Date.now() / 1000), event.signalId);
  }

  public updateSignalOutcome(outcome: Partial<SignalOutcome> & { signalId: string }) {
    const current = this.getSignalOutcome(outcome.signalId);
    if (!current) return;

    this.db.prepare(`
      UPDATE signal_outcomes
      SET
        status = coalesce(?, status),
        fill_price = coalesce(?, fill_price),
        exit_price_effective = coalesce(?, exit_price_effective),
        r_final = coalesce(?, r_final),
        r_max_mfe = coalesce(?, r_max_mfe),
        r_max_mae = coalesce(?, r_max_mae),
        mfe_price = coalesce(?, mfe_price),
        mfe_ts = coalesce(?, mfe_ts),
        mae_price = coalesce(?, mae_price),
        mae_ts = coalesce(?, mae_ts),
        time_to_tp1 = coalesce(?, time_to_tp1),
        time_to_tp2 = coalesce(?, time_to_tp2),
        time_to_tp3 = coalesce(?, time_to_tp3),
        time_to_sl = coalesce(?, time_to_sl),
        duration = coalesce(?, duration),
        first_hit = coalesce(?, first_hit),
        reconstructed_flag = coalesce(?, reconstructed_flag),
        ambiguous_flag = coalesce(?, ambiguous_flag),
        updated_at = ?
      WHERE signal_id = ?
    `).run(
      outcome.status ?? null,
      outcome.fillPrice ?? null,
      outcome.exitPriceEffective ?? null,
      outcome.rFinal ?? null,
      outcome.rMaxMfe ?? null,
      outcome.rMaxMae ?? null,
      outcome.mfePrice ?? null,
      outcome.mfeTs ?? null,
      outcome.maePrice ?? null,
      outcome.maeTs ?? null,
      outcome.timeToTp1 ?? null,
      outcome.timeToTp2 ?? null,
      outcome.timeToTp3 ?? null,
      outcome.timeToSl ?? null,
      outcome.duration ?? null,
      outcome.firstHit ?? null,
      outcome.reconstructedFlag !== undefined ? (outcome.reconstructedFlag ? 1 : 0) : null,
      outcome.ambiguousFlag !== undefined ? (outcome.ambiguousFlag ? 1 : 0) : null,
      Math.floor(Date.now() / 1000),
      outcome.signalId
    );
  }

  public getSignal(id: string): SignalEntity | null {
    const row: any = this.db.prepare('SELECT * FROM signals WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapSignalRow(row);
  }

  public getSignalOutcome(signalId: string): SignalOutcome | null {
    const row: any = this.db.prepare('SELECT * FROM signal_outcomes WHERE signal_id = ?').get(signalId);
    if (!row) return null;
    return {
      signalId: row.signal_id,
      status: row.status as SignalLifecycleStatus,
      fillPrice: row.fill_price ?? undefined,
      exitPriceEffective: row.exit_price_effective ?? undefined,
      rFinal: row.r_final ?? undefined,
      rMaxMfe: row.r_max_mfe ?? 0,
      rMaxMae: row.r_max_mae ?? 0,
      mfePrice: row.mfe_price ?? undefined,
      mfeTs: row.mfe_ts ?? undefined,
      maePrice: row.mae_price ?? undefined,
      maeTs: row.mae_ts ?? undefined,
      timeToTp1: row.time_to_tp1 ?? undefined,
      timeToTp2: row.time_to_tp2 ?? undefined,
      timeToTp3: row.time_to_tp3 ?? undefined,
      timeToSl: row.time_to_sl ?? undefined,
      duration: row.duration ?? undefined,
      firstHit: row.first_hit || 'none',
      reconstructedFlag: Boolean(row.reconstructed_flag),
      ambiguousFlag: Boolean(row.ambiguous_flag),
      updatedAt: row.updated_at,
    };
  }

  public getSignalEvents(signalId: string): SignalEvent[] {
    const rows: any[] = this.db.prepare('SELECT * FROM signal_events WHERE signal_id = ? ORDER BY ts_utc ASC').all(signalId);
    return rows.map((r) => ({
      id: r.id,
      signalId: r.signal_id,
      type: r.type as SignalLifecycleStatus,
      price: r.price,
      bid: r.bid,
      ask: r.ask,
      spread: r.spread,
      tsUtc: r.ts_utc,
      source: r.source,
      note: r.note ?? undefined,
    }));
  }

  public getAllSignals(filter?: {
    source?: string;
    sources?: string[];
    origin?: string;
    agreement?: string;
    grade?: string;
    session?: string;
    regime?: string;
    status?: string;
    direction?: string;
    limit?: number;
    offset?: number;
  }): { signals: SignalEntity[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.source && filter.source !== 'ALL') {
      conditions.push('s.source = ?');
      params.push(filter.source);
    }
    if (filter?.sources?.length) {
      conditions.push(`s.source IN (${filter.sources.map(() => '?').join(', ')})`);
      params.push(...filter.sources);
    }
    if (filter?.origin && filter.origin !== 'ALL') {
      conditions.push('s.origin = ?');
      params.push(filter.origin);
    }
    if (filter?.agreement && filter.agreement !== 'ALL') {
      conditions.push('s.agreement = ?');
      params.push(filter.agreement);
    }
    if (filter?.grade && filter.grade !== 'ALL') {
      conditions.push('s.grade = ?');
      params.push(filter.grade);
    }
    if (filter?.session && filter.session !== 'ALL') {
      conditions.push('s.session = ?');
      params.push(filter.session);
    }
    if (filter?.regime && filter.regime !== 'ALL') {
      conditions.push('s.regime = ?');
      params.push(filter.regime);
    }
    if (filter?.direction && filter.direction !== 'ALL') {
      conditions.push('s.direction = ?');
      params.push(filter.direction);
    }
    if (filter?.status && filter.status !== 'ALL') {
      conditions.push('o.status = ?');
      params.push(filter.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow: any = this.db.prepare(`
      SELECT count(*) as count
      FROM signals s
      LEFT JOIN signal_outcomes o ON s.id = o.signal_id
      ${whereClause}
    `).get(...params);

    const total = countRow ? Number(countRow.count) : 0;
    const limit = filter?.limit || 500;
    const offset = filter?.offset || 0;

    const rows: any[] = this.db.prepare(`
      SELECT s.*, o.status as outcome_status, o.fill_price, o.exit_price_effective,
             o.r_final, o.r_max_mfe, o.r_max_mae, o.time_to_tp1, o.time_to_tp2,
             o.time_to_tp3, o.time_to_sl, o.duration, o.first_hit,
             o.reconstructed_flag, o.ambiguous_flag, o.updated_at as outcome_updated_at
      FROM signals s
      LEFT JOIN signal_outcomes o ON s.id = o.signal_id
      ${whereClause}
      ORDER BY s.created_ts DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      signals: rows.map((r) => this.mapSignalRow(r)),
      total,
    };
  }

  public getOpenSignals(filter?: { source?: string; origin?: string }): SignalEntity[] {
    const conditions = ["o.status IN ('PENDING', 'TRIGGERED', 'TP1_HIT', 'TP2_HIT')"];
    const params: string[] = [];
    if (filter?.source && filter.source !== 'ALL') {
      conditions.push('s.source = ?');
      params.push(filter.source);
    }
    if (filter?.origin && filter.origin !== 'ALL') {
      conditions.push('s.origin = ?');
      params.push(filter.origin);
    }
    const rows: any[] = this.db.prepare(`
      SELECT s.*, o.status as outcome_status, o.fill_price, o.exit_price_effective,
             o.r_final, o.r_max_mfe, o.r_max_mae, o.time_to_tp1, o.time_to_tp2,
             o.time_to_tp3, o.time_to_sl, o.duration, o.first_hit,
             o.reconstructed_flag, o.ambiguous_flag, o.updated_at as outcome_updated_at
      FROM signals s
      JOIN signal_outcomes o ON s.id = o.signal_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.created_ts ASC
    `).all(...params);

    return rows.map((r) => this.mapSignalRow(r));
  }

  private computeSignalRowHash(row: any): string {
    return this.computeHash({
      id: row.id,
      createdTs: row.created_ts,
      symbol: row.symbol,
      direction: row.direction,
      entryPrice: row.entry_price,
      sl: row.sl,
      tp1: row.tp1,
      tp2: row.tp2,
      tp3: row.tp3,
      score: row.score,
      grade: row.grade,
      source: row.source,
      origin: row.origin,
      candleCloseTs: row.candle_close_ts,
      groupId: row.group_id ?? undefined,
      agreement: row.agreement,
      weightsVersion: row.weights_version,
      configVersion: row.config_version,
      factors: JSON.parse(row.factors_json || '[]'),
      aiVerdict: row.ai_verdict_json ? JSON.parse(row.ai_verdict_json) : undefined,
      priceFeedSnapshot: JSON.parse(row.price_feed_snapshot || '{}'),
      mgmtPlan: JSON.parse(row.mgmt_plan_json || '{}'),
      inputProvenance: JSON.parse(row.input_provenance_json || '{}'),
      hashVersion: row.hash_version ?? 1,
      prevHash: row.prev_hash,
    });
  }

  // Verify hash of single signal
  public verifySignal(id: string): { isValid: boolean; expectedHash: string; storedHash: string; prevHash: string } {
    const row: any = this.db.prepare('SELECT * FROM signals WHERE id = ?').get(id);
    if (!row) {
      throw new Error(`Signal ${id} not found.`);
    }

    const expected = this.computeSignalRowHash(row);

    return {
      isValid: expected === row.snapshot_hash,
      expectedHash: expected,
      storedHash: row.snapshot_hash,
      prevHash: row.prev_hash,
    };
  }

  // Verify entire hash chain from genesis
  public verifyChain(): { isValid: boolean; totalChecked: number; brokenAt?: string } {
    const rows: any[] = this.db.prepare('SELECT * FROM signals ORDER BY created_ts ASC, id ASC').all();
    let prev = '0000000000000000000000000000000000000000000000000000000000000000';

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (i > 0 && r.prev_hash !== prev) {
        return { isValid: false, totalChecked: i, brokenAt: r.id };
      }

      const expected = this.computeSignalRowHash(r);

      if (expected !== r.snapshot_hash) {
        return { isValid: false, totalChecked: i, brokenAt: r.id };
      }

      prev = r.snapshot_hash;
    }

    return { isValid: true, totalChecked: rows.length };
  }

  // My Trades management
  public addMyTrade(trade: MyTradeEntity) {
    this.db.prepare(`
      INSERT INTO my_trades
      (id, signal_id, taken_ts, symbol, direction, actual_entry, actual_sl, actual_tp, lot, actual_exit, exit_ts, actual_r, notes, screenshot_ref, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.id,
      trade.signalId || null,
      trade.takenTs,
      trade.symbol,
      trade.direction,
      trade.actualEntry,
      trade.actualSl,
      trade.actualTp,
      trade.lot,
      trade.actualExit ?? null,
      trade.exitTs ?? null,
      trade.actualR ?? null,
      trade.notes || null,
      trade.screenshotRef || null,
      trade.status
    );
  }

  public closeMyTrade(id: string, actualExit: number, exitTs: number, actualR: number, notes?: string) {
    this.db.prepare(`
      UPDATE my_trades
      SET actual_exit = ?, exit_ts = ?, actual_r = ?, notes = coalesce(?, notes), status = 'CLOSED'
      WHERE id = ?
    `).run(actualExit, exitTs, actualR, notes || null, id);
  }

  public getMyTrades(): MyTradeEntity[] {
    const rows: any[] = this.db.prepare('SELECT * FROM my_trades ORDER BY taken_ts DESC').all();
    return rows.map((r) => ({
      id: r.id,
      signalId: r.signal_id ?? undefined,
      takenTs: r.taken_ts,
      symbol: r.symbol,
      direction: r.direction as 'BUY' | 'SELL',
      actualEntry: r.actual_entry,
      actualSl: r.actual_sl,
      actualTp: r.actual_tp,
      lot: r.lot,
      actualExit: r.actual_exit ?? undefined,
      exitTs: r.exit_ts ?? undefined,
      actualR: r.actual_r ?? undefined,
      notes: r.notes ?? undefined,
      screenshotRef: r.screenshot_ref ?? undefined,
      status: r.status as 'OPEN' | 'CLOSED',
    }));
  }

  public getCompareTrades(): CompareTradeRecord[] {
    const rows: any[] = this.db.prepare(`
      SELECT s.id as signal_id, s.direction, s.created_ts, s.entry_price, s.sl,
             o.r_final as signal_r, o.status as signal_status,
             m.id as trade_id, m.actual_entry, m.actual_r, m.status as my_status
      FROM signals s
      LEFT JOIN signal_outcomes o ON s.id = o.signal_id
      LEFT JOIN my_trades m ON s.id = m.signal_id
      ORDER BY s.created_ts DESC
      LIMIT 100
    `).all();

    return rows.map((r) => {
      const taken = Boolean(r.trade_id);
      const signalR = r.signal_r ?? 0;
      const myR = r.actual_r ?? (taken ? signalR : 0);
      const executionGapR = taken ? Number((myR - signalR).toFixed(2)) : 0;
      const slippagePoints = taken && r.entry_price && r.actual_entry
        ? Number(Math.abs(r.actual_entry - r.entry_price).toFixed(2))
        : 0;

      return {
        signalId: r.signal_id,
        tradeId: r.trade_id ?? undefined,
        taken,
        direction: r.direction as 'BUY' | 'SELL',
        createdAt: r.created_ts,
        signalR,
        myR,
        executionGapR,
        slippagePoints,
        status: r.signal_status || 'PENDING',
      };
    });
  }

  // Signal Notes
  public setSignalNotes(signalId: string, notes: string, tags?: string[]) {
    const existing: any = this.db.prepare('SELECT id FROM signal_notes WHERE signal_id = ?').get(signalId);
    const now = Math.floor(Date.now() / 1000);
    if (existing) {
      this.db.prepare('UPDATE signal_notes SET notes = ?, tags = ?, updated_at = ? WHERE signal_id = ?')
        .run(notes, tags ? JSON.stringify(tags) : null, now, signalId);
    } else {
      const id = `sn_${Date.now()}`;
      this.db.prepare('INSERT INTO signal_notes (id, signal_id, notes, tags, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, signalId, notes, tags ? JSON.stringify(tags) : null, now);
    }
  }

  public getSignalNotes(signalId: string): { notes: string; tags: string[] } | null {
    const row: any = this.db.prepare('SELECT * FROM signal_notes WHERE signal_id = ?').get(signalId);
    if (!row) return null;
    return {
      notes: row.notes,
      tags: row.tags ? JSON.parse(row.tags) : [],
    };
  }

  // Chart Drawings
  public getDrawings(symbol: string): any[] {
    const rows: any[] = this.db.prepare('SELECT * FROM drawings WHERE symbol = ?').all(symbol);
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      type: r.type,
      points: JSON.parse(r.points_json || '[]'),
      color: r.color,
      label: r.label ?? undefined,
      createdAt: r.created_at,
    }));
  }

  public saveDrawing(drawing: any) {
    this.db.prepare(`
      INSERT OR REPLACE INTO drawings (id, symbol, type, points_json, color, label, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      drawing.id,
      drawing.symbol || 'XAUUSD',
      drawing.type,
      JSON.stringify(drawing.points || []),
      drawing.color || '#F5C451',
      drawing.label || null,
      drawing.createdAt || Date.now()
    );
  }

  public deleteDrawing(id: string) {
    this.db.prepare('DELETE FROM drawings WHERE id = ?').run(id);
  }

  // Weights configuration
  public getWeights(): RegimeWeightsConfig {
    const row: any = this.db.prepare("SELECT value_json FROM settings WHERE key = 'regime_weights'").get();
    if (row && row.value_json) {
      try {
        return JSON.parse(row.value_json);
      } catch {}
    }
    return DEFAULT_WEIGHTS;
  }

  public updateWeights(weights: RegimeWeightsConfig) {
    this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value_json, updated_at)
      VALUES ('regime_weights', ?, ?)
    `).run(JSON.stringify(weights), Math.floor(Date.now() / 1000));
  }

  private mapSignalRow(r: any): SignalEntity {
    return {
      id: r.id,
      createdTs: r.created_ts,
      candleCloseTs: r.candle_close_ts ?? 0,
      symbol: r.symbol,
      sourceFeed: r.source_feed,
      direction: r.direction as 'BUY' | 'SELL',
      triggerTf: r.trigger_tf,
      entryType: r.entry_type,
      entryPrice: r.entry_price,
      sl: r.sl,
      tp1: r.tp1,
      tp2: r.tp2,
      tp3: r.tp3,
      rrPlanned: r.rr_planned,
      score: r.score,
      grade: r.grade,
      regime: r.regime,
      session: r.session,
      factors: JSON.parse(r.factors_json || '[]'),
      weightsVersion: r.weights_version,
      configVersion: r.config_version,
      aiVerdict: r.ai_verdict_json ? JSON.parse(r.ai_verdict_json) : undefined,
      priceFeedSnapshot: JSON.parse(r.price_feed_snapshot || '{}'),
      mgmtPlan: JSON.parse(r.mgmt_plan_json || '{}'),
      snapshotHash: r.snapshot_hash,
      prevHash: r.prev_hash,
      brokerOffset: r.broker_offset_at_signal,
      source: (r.source || 'UNKNOWN_LEGACY') as SignalSource,
      origin: (r.origin || 'legacy') as SignalOrigin,
      groupId: r.group_id ?? undefined,
      agreement: (r.agreement || 'UNKNOWN_LEGACY') as SignalAgreement,
      inputProvenance: JSON.parse(r.input_provenance_json || '{}'),
      aiState: r.ai_state || 'UNKNOWN',
      hashVersion: r.hash_version ?? 1,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      outcome: r.outcome_status
        ? {
            signalId: r.id,
            status: r.outcome_status as SignalLifecycleStatus,
            fillPrice: r.fill_price ?? undefined,
            exitPriceEffective: r.exit_price_effective ?? undefined,
            rFinal: r.r_final ?? undefined,
            rMaxMfe: r.r_max_mfe ?? 0,
            rMaxMae: r.r_max_mae ?? 0,
            timeToTp1: r.time_to_tp1 ?? undefined,
            timeToTp2: r.time_to_tp2 ?? undefined,
            timeToTp3: r.time_to_tp3 ?? undefined,
            timeToSl: r.time_to_sl ?? undefined,
            duration: r.duration ?? undefined,
            firstHit: r.first_hit || 'none',
            reconstructedFlag: Boolean(r.reconstructed_flag),
            ambiguousFlag: Boolean(r.ambiguous_flag),
            updatedAt: r.outcome_updated_at || r.created_ts,
          }
        : undefined,
    };
  }
}

let defaultStore: SqliteStore | undefined;
export const sqliteStore = new Proxy({} as SqliteStore, {
  get(_target, property) {
    defaultStore ??= new SqliteStore();
    const value = Reflect.get(defaultStore, property, defaultStore);
    return typeof value === 'function' ? value.bind(defaultStore) : value;
  },
});
