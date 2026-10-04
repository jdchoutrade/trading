import { createHash } from 'node:crypto';
import { Pool } from 'pg';

export interface StoredSnapshot {
  key: 'latest' | 'previous';
  payload: string;
  checksumValid: boolean;
}

const TABLE_PREFIX = 'qra_terminal_snapshots';

class NeonSnapshotStore {
  private pool: Pool | null = null;
  private schemaReady: Promise<void> | null = null;
  private resolvedTableName: string | null = null;

  private getTableName(): string {
    if (this.resolvedTableName) return this.resolvedTableName;
    const scope = process.env.NEON_SNAPSHOT_SCOPE || 'cloudflare';
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(scope)) throw new Error('NEON_SNAPSHOT_SCOPE must use lowercase letters, numbers, and underscores.');
    this.resolvedTableName = `${TABLE_PREFIX}_${scope}`;
    return this.resolvedTableName;
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.NEON_DATABASE_URL;
    if (!connectionString) throw new Error('NEON_DATABASE_URL is not configured.');

    this.pool = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    return this.pool;
  }

  private async ensureSchema(): Promise<void> {
    const tableName = this.getTableName();
    if (!this.schemaReady) {
      this.schemaReady = this.getPool().query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          snapshot_key TEXT PRIMARY KEY CHECK (snapshot_key IN ('latest', 'previous')),
          created_at TIMESTAMPTZ NOT NULL,
          payload TEXT NOT NULL,
          payload_sha256 TEXT NOT NULL
        )
      `).then(() => undefined);
    }
    try {
      await this.schemaReady;
    } catch (error) {
      this.schemaReady = null;
      throw error;
    }
  }

  public async readSnapshots(): Promise<StoredSnapshot[]> {
    await this.ensureSchema();
    const tableName = this.getTableName();
    const result = await this.getPool().query<{
      snapshot_key: 'latest' | 'previous';
      payload: string;
      payload_sha256: string;
    }>(`
      SELECT snapshot_key, payload, payload_sha256
      FROM ${tableName}
      ORDER BY CASE snapshot_key WHEN 'latest' THEN 0 ELSE 1 END
    `);

    return result.rows.map((row) => ({
      key: row.snapshot_key,
      payload: row.payload,
      checksumValid: createHash('sha256').update(row.payload, 'utf8').digest('hex') === row.payload_sha256,
    }));
  }

  public async saveLatest(payload: string): Promise<void> {
    const parsed = JSON.parse(payload) as { version?: unknown };
    if (parsed?.version !== 1) throw new Error('Refusing to save an unsupported snapshot.');
    await this.ensureSchema();
    const tableName = this.getTableName();

    const client = await this.getPool().connect();
    const checksum = createHash('sha256').update(payload, 'utf8').digest('hex');
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${tableName} WHERE snapshot_key = 'previous'`);
      await client.query(`
        INSERT INTO ${tableName} (snapshot_key, created_at, payload, payload_sha256)
        SELECT 'previous', created_at, payload, payload_sha256
        FROM ${tableName}
        WHERE snapshot_key = 'latest'
      `);
      await client.query(`
        INSERT INTO ${tableName} (snapshot_key, created_at, payload, payload_sha256)
        VALUES ('latest', NOW(), $1, $2)
        ON CONFLICT (snapshot_key) DO UPDATE SET
          created_at = EXCLUDED.created_at,
          payload = EXCLUDED.payload,
          payload_sha256 = EXCLUDED.payload_sha256
      `, [payload, checksum]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export const neonSnapshotStore = new NeonSnapshotStore();
