import { existsSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { fingerprint } from './sqliteSafety.ts';

const databasePath = path.resolve('data/gold_desk.db');
const backupDirectory = path.resolve('backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDirectory, `pre-purge-${timestamp}.sqlite`);
const restorePath = path.join(os.tmpdir(), `qra-restore-verify-${process.pid}-${Date.now()}.sqlite`);

async function main() {
  if (!existsSync(databasePath)) {
    throw new Error(`Database not found: ${databasePath}`);
  }

  await mkdir(backupDirectory, { recursive: true });
  if (existsSync(backupPath)) {
    throw new Error(`Refusing to overwrite existing backup: ${backupPath}`);
  }
  if (existsSync(restorePath)) {
    throw new Error(`Refusing to overwrite temporary restore file: ${restorePath}`);
  }

  const source = new DatabaseSync(databasePath, { readOnly: true });
  let backupDatabase: DatabaseSync | undefined;
  let restoredDatabase: DatabaseSync | undefined;
  let backupCreated = false;

  try {
    const sourceFingerprint = fingerprint(source);
    await backup(source, backupPath);
    backupCreated = true;

    backupDatabase = new DatabaseSync(backupPath, { readOnly: true });
    const backupFingerprint = fingerprint(backupDatabase);
    if (backupFingerprint !== sourceFingerprint) {
      throw new Error('Backup verification failed: schema or data differs from the source database.');
    }

    await backup(backupDatabase, restorePath);
    restoredDatabase = new DatabaseSync(restorePath, { readOnly: true });
    const restoreFingerprint = fingerprint(restoredDatabase);
    if (restoreFingerprint !== sourceFingerprint) {
      throw new Error('Restore verification failed: restored schema or data differs from the source database.');
    }

    console.log(`Backup created and restore-verified: ${backupPath}`);
    console.log(`Source, backup, and restored SHA-256: ${sourceFingerprint}`);
  } catch (error) {
    if (backupCreated) {
      console.error(`Backup artifact preserved for inspection: ${backupPath}`);
    }
    throw error;
  } finally {
    restoredDatabase?.close();
    backupDatabase?.close();
    source.close();
    if (existsSync(restorePath)) await unlink(restorePath);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});