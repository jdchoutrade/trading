import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function fingerprint(database: DatabaseSync): string {
  const integrity = database.prepare('PRAGMA integrity_check').get() as Record<string, string>;
  if (integrity.integrity_check !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
  }

  const schema = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
  const tables = database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;
  const contents = tables.map(({ name }) => ({
    name,
    rows: database.prepare(`SELECT * FROM ${quoteIdentifier(name)} ORDER BY rowid`).all(),
  }));

  return createHash('sha256').update(JSON.stringify({ schema, contents })).digest('hex');
}
