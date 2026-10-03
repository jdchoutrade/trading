import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fingerprint } from './sqliteSafety.ts';

const databasePath = path.resolve('data/gold_desk.db');
const backupDirectory = path.resolve('backups');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const confirm = args.has('--confirm');

type SignalRow = Record<string, unknown> & { id: string; source: string; origin?: string; source_feed: string; tags: string | null };
interface ClassifiedSignal {
  signal: SignalRow;
  kind: 'DEMO_CONFIRMED' | 'SUSPECT';
  reason: string;
}

function rowsForIds(database: DatabaseSync, table: string, ids: string[]) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return database.prepare(`SELECT * FROM ${table} WHERE signal_id IN (${placeholders})`).all(...ids) as Array<Record<string, unknown>>;
}

function classify(database: DatabaseSync): { purge: ClassifiedSignal[]; quarantine: ClassifiedSignal[]; unknown: SignalRow[] } {
  const signalColumns = new Set((database.prepare('PRAGMA table_info(signals)').all() as Array<{ name: string }>).map(({ name }) => name));
  const signals = database.prepare('SELECT * FROM signals ORDER BY created_ts, id').all() as SignalRow[];
  const known: Array<{ signal: SignalRow; reason: string }> = [];
  const unknown: SignalRow[] = [];

  for (const signal of signals) {
    const testLifecycleOrigin = signalColumns.has('origin') ? signal.origin === 'UNKNOWN_LEGACY' : signal.source === 'live';
    const replayLifecycleOrigin = signalColumns.has('origin') ? signal.origin === 'replay' : signal.source === 'replay';
    const testFixture = /^test_immut_\d+$/.test(signal.id)
      && testLifecycleOrigin
      && signal.source_feed === 'TEST'
      && signal.entry_price === 2650
      && signal.sl === 2640
      && signal.tp1 === 2670
      && signal.tp2 === 2680
      && signal.tp3 === 2690;
    const tags = (() => {
      try { return JSON.parse(signal.tags || '[]') as string[]; } catch { return []; }
    })();
    const syntheticReplay = /^replay_\d+$/.test(signal.id)
      && replayLifecycleOrigin
      && signal.source_feed === 'HISTORICAL_REPLAY'
      && tags.includes('replay')
      && tags.includes('backtest');

    if (testFixture) {
      known.push({ signal, reason: 'source_feed=TEST and exact immutable-test fixture ID/levels; non-production signal' });
    } else if (syntheticReplay) {
      known.push({ signal, reason: 'HISTORICAL_REPLAY plus replay tags; source script generated input candles from formulas, not market history' });
    } else {
      unknown.push(signal);
    }
  }

  const knownIds = known.map(({ signal }) => signal.id);
  const notes = rowsForIds(database, 'signal_notes', knownIds);
  const trades = rowsForIds(database, 'my_trades', knownIds);
  const protectedIds = new Set<string>();
  for (const row of [...notes, ...trades]) protectedIds.add(String(row.signal_id));

  const purge: ClassifiedSignal[] = [];
  const quarantine: ClassifiedSignal[] = [];
  for (const item of known) {
    if (item.signal.source_feed === 'TEST' || protectedIds.has(item.signal.id)) {
      const reason = item.signal.source_feed === 'TEST'
        ? `${item.reason}; linked tick transitions/outcome have unverifiable provenance and are retained in quarantine`
        : `${item.reason}; linked journal data requires preservation`;
      quarantine.push({ ...item, kind: 'SUSPECT', reason });
    } else {
      purge.push({ ...item, kind: 'DEMO_CONFIRMED', reason: item.reason });
    }
  }

  return { purge, quarantine, unknown };
}

function latestPrePurgeBackup(): string {
  if (!existsSync(backupDirectory)) throw new Error('No backup directory found. Run npm run backup:verify first.');
  const backups = readdirSync(backupDirectory).filter((name) => /^pre-purge-.*\.sqlite$/.test(name)).sort();
  if (backups.length === 0) throw new Error('No pre-purge backup found. Run npm run backup:verify first.');
  return path.join(backupDirectory, backups[backups.length - 1]);
}

function assertBackupMatches(database: DatabaseSync): string {
  const backupPath = latestPrePurgeBackup();
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    if (fingerprint(database) !== fingerprint(backup)) {
      throw new Error('Current DB differs from the latest verified pre-purge backup; create a fresh backup before proceeding.');
    }
  } finally {
    backup.close();
  }
  return backupPath;
}

function countForIds(database: DatabaseSync, table: string, ids: string[]): number {
  return rowsForIds(database, table, ids).length;
}

function report(database: DatabaseSync, backupPath: string) {
  const { purge, quarantine, unknown } = classify(database);
  const purgeIds = purge.map(({ signal }) => signal.id);
  const quarantineIds = quarantine.map(({ signal }) => signal.id);
  const allIds = [...purgeIds, ...quarantineIds];

  console.log(`Verified matching backup: ${backupPath}`);
  console.log(`DEMO_CONFIRMED signals to delete: ${purge.length}`);
  console.log(`  linked events: ${countForIds(database, 'signal_events', purgeIds)}`);
  console.log(`  linked outcomes: ${countForIds(database, 'signal_outcomes', purgeIds)}`);
  console.log(`SUSPECT bundles to archive in quarantine_signals: ${quarantine.length}`);
  console.log(`  linked events: ${countForIds(database, 'signal_events', quarantineIds)}`);
  console.log(`  linked outcomes: ${countForIds(database, 'signal_outcomes', quarantineIds)}`);
  console.log(`REAL_VERIFIED / REPLAY_LEGIT retained: 0`);
  console.log(`Unclassified signals preserved: ${unknown.length}`);
  console.log(`All confirmed candidate signal IDs: ${allIds.length}`);

  for (const item of [...purge, ...quarantine]) {
    const signal = item.signal;
    const created = new Date(Number(signal.created_ts) * 1000).toISOString();
    console.log(`${item.kind} ${signal.id} | ${created} | ${signal.direction} | entry ${signal.entry_price} | ${item.reason}`);
  }
  for (const signal of unknown) {
    console.log(`SUSPECT/PRESERVE ${signal.id} | ${signal.source_feed} | source=${signal.source} | origin=${signal.origin || 'pre-migration'}`);
  }

  console.log('Dry run only. No schema or row changes were made.');
  console.log('Review the audit and this row list. Explicit user approval is required before invoking --confirm.');
  return { purge, quarantine, unknown };
}

function quarantineSignal(database: DatabaseSync, item: ClassifiedSignal) {
  const signalId = item.signal.id;
  const signal = item.signal;
  const events = rowsForIds(database, 'signal_events', [signalId]);
  const outcomes = rowsForIds(database, 'signal_outcomes', [signalId]);
  const notes = rowsForIds(database, 'signal_notes', [signalId]);
  const trades = rowsForIds(database, 'my_trades', [signalId]);

  database.prepare(`
    INSERT INTO quarantine_signals
      (signal_id, quarantined_at, classification, reason, signal_json, events_json, outcomes_json, notes_json, trades_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    signalId,
    Math.floor(Date.now() / 1000),
    item.kind,
    item.reason,
    JSON.stringify(signal),
    JSON.stringify(events),
    JSON.stringify(outcomes),
    JSON.stringify(notes),
    JSON.stringify(trades)
  );
}

function purge(database: DatabaseSync, backupPath: string) {
  database.exec('BEGIN IMMEDIATE');
  try {
    assertBackupMatches(database);
    const { purge: demo, quarantine, unknown } = classify(database);
    if (unknown.length > 0) {
      throw new Error('Purge aborted: unclassified signal rows exist. Preserve hash-chain continuity and review them before retrying.');
    }
    const candidateIds = [...demo, ...quarantine].map(({ signal }) => signal.id);
    const remainingSignals = database.prepare('SELECT COUNT(*) AS count FROM signals').get() as { count: number };
    if (Number(remainingSignals.count) !== candidateIds.length) {
      throw new Error('Purge aborted: the reviewed candidate set no longer covers the signal table.');
    }
    if (quarantine.some(({ signal }) => rowsForIds(database, 'my_trades', [signal.id]).length > 0)) {
      throw new Error('Purge aborted: candidate rows have manual trades. Resolve journal preservation before deleting signal parents.');
    }
    const eventTrigger = database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_prevent_event_delete'").get();
    if (!eventTrigger && demo.length + quarantine.length > 0) {
      throw new Error('Purge aborted: expected append-only event trigger is missing.');
    }

    database.exec(`
      CREATE TABLE IF NOT EXISTS quarantine_signals (
        signal_id TEXT PRIMARY KEY,
        quarantined_at INTEGER NOT NULL,
        classification TEXT NOT NULL,
        reason TEXT NOT NULL,
        signal_json TEXT NOT NULL,
        events_json TEXT NOT NULL,
        outcomes_json TEXT NOT NULL,
        notes_json TEXT NOT NULL,
        trades_json TEXT NOT NULL
      );
    `);
    for (const item of quarantine) quarantineSignal(database, item);

    const ids = candidateIds;
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const demoIds = demo.map(({ signal }) => signal.id);
      const quarantineIds = quarantine.map(({ signal }) => signal.id);
      const demoEventsToDelete = countForIds(database, 'signal_events', demoIds);
      const demoOutcomesToDelete = countForIds(database, 'signal_outcomes', demoIds);
      const quarantineEventsToArchive = countForIds(database, 'signal_events', quarantineIds);
      const quarantineOutcomesToArchive = countForIds(database, 'signal_outcomes', quarantineIds);
      const eventsToDelete = demoEventsToDelete + quarantineEventsToArchive;
      const notesToDelete = countForIds(database, 'signal_notes', ids);
      database.exec('DROP TRIGGER IF EXISTS trg_prevent_event_delete');
      database.prepare(`DELETE FROM signal_events WHERE signal_id IN (${placeholders})`).run(...ids);
      database.prepare(`DELETE FROM signal_outcomes WHERE signal_id IN (${placeholders})`).run(...ids);
      database.prepare(`DELETE FROM signal_notes WHERE signal_id IN (${placeholders})`).run(...ids);
      const deletedSignals = database.prepare(`DELETE FROM signals WHERE id IN (${placeholders})`).run(...ids);
      if (Number(deletedSignals.changes) !== ids.length) throw new Error('Deleted signal count differed from the reviewed candidate count.');
      database.exec(`
        CREATE TRIGGER trg_prevent_event_delete
        BEFORE DELETE ON signal_events
        BEGIN
          SELECT RAISE(ABORT, 'IMMUTABILITY_VIOLATION: Signal events are append-only.');
        END;
      `);
      database.exec('COMMIT');
      database.exec('VACUUM');
      console.log(`Deleted DEMO_CONFIRMED: ${demo.length} signals, ${demoEventsToDelete} events, ${demoOutcomesToDelete} outcomes.`);
      console.log(`Archived SUSPECT: ${quarantine.length} signals, ${quarantineEventsToArchive} events, ${quarantineOutcomesToArchive} outcomes in quarantine_signals.`);
      console.log(`Removed ${eventsToDelete - quarantineEventsToArchive} events and ${notesToDelete} notes from active history. Backup retained at ${backupPath}`);
    } else {
      database.exec('COMMIT');
      console.log('No confirmed candidate rows found.');
    }
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw error;
  }
}

async function assertTerminalStopped() {
  try {
    await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(1000) });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === 'ECONNREFUSED') return;
    throw new Error('Cannot confirm the Terminal is stopped; purge aborted for safety.');
  }
  throw new Error('Terminal server is responding on port 3000; stop it before running a confirmed purge.');
}

async function main() {
  if (args.size !== 1 || (!dryRun && !confirm)) throw new Error('Use exactly one mode: npm run purge:fake -- --dry-run or --confirm.');
  if (!existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  if (confirm) await assertTerminalStopped();

  const database = new DatabaseSync(databasePath, { readOnly: dryRun });
  try {
    const backupPath = assertBackupMatches(database);
    if (dryRun) report(database, backupPath);
    else purge(database, backupPath);
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
