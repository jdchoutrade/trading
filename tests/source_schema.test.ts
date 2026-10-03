import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../server/db/sqliteStore.ts';

describe('SqliteStore source migration', () => {
  let temporaryDirectory: string | undefined;
  let store: SqliteStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  });

  it('preserves origin but never guesses old live rows into an analytical source', () => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'qra-source-schema-'));
    const databasePath = path.join(temporaryDirectory, 'legacy.sqlite');
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE signals (
        id TEXT PRIMARY KEY,
        created_ts INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        trigger_tf TEXT NOT NULL,
        config_version TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'live',
        snapshot_hash TEXT NOT NULL
      );
    `);
    const insert = legacyDatabase.prepare('INSERT INTO signals (id,created_ts,symbol,direction,trigger_tf,config_version,source,snapshot_hash) VALUES (?,?,?,?,?,?,?,?)');
    insert.run('old-live', 100, 'XAUUSD', 'BUY', '15m', '2.0', 'live', 'hash-live');
    insert.run('old-replay', 200, 'XAUUSD', 'SELL', '15m', '2.0', 'replay', 'hash-replay');
    insert.run('old-legacy', 300, 'XAUUSD', 'BUY', '15m', '2.0', 'legacy', 'hash-legacy');
    legacyDatabase.close();

    store = new SqliteStore(databasePath);
    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const rows = migrated.prepare('SELECT id,source,origin,hash_version FROM signals ORDER BY id').all() as Array<{
        id: string;
        source: string;
        origin: string;
        hash_version: number;
      }>;
      expect(rows).toEqual([
        { id: 'old-legacy', source: 'UNKNOWN_LEGACY', origin: 'legacy_v1', hash_version: 1 },
        { id: 'old-live', source: 'UNKNOWN_LEGACY', origin: 'UNKNOWN_LEGACY', hash_version: 1 },
        { id: 'old-replay', source: 'UNKNOWN_LEGACY', origin: 'replay', hash_version: 1 },
      ]);
      expect(() => (store as any).db.prepare("UPDATE signals SET origin='engine_live' WHERE id='old-live'").run())
        .toThrow(/IMMUTABILITY_VIOLATION/);
    } finally {
      migrated.close();
    }
  });
});
