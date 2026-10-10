import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { openDatabase } from '../db/index.js';
import { migrations } from '../db/schema.js';

export interface ImportDbOptions {
  /** File to import. */
  sourcePath: string;
  /** Target: the server's database. */
  dbPath: string;
  /** Checks whether the server is running; returns true if so. Omit in tests. */
  isServerRunning?: () => Promise<boolean>;
  log?: (message: string) => void;
}

/** Error with a message that can be printed directly to the user. */
export class ImportDbError extends Error {}

/**
* Replaces the server's database with an exported file (see GET /api/export).
* The old database is kept as a backup `<dbPath>.bak-<timestamp>`.
* Returns the number of items in the new database.
 */
export async function importDatabase(options: ImportDbOptions): Promise<number> {
  const { sourcePath, dbPath, isServerRunning, log = () => {} } = options;

  if (path.resolve(sourcePath) === path.resolve(dbPath)) {
    throw new ImportDbError('The file is already the server\'s database.');
  }
  checkSourceFile(sourcePath);

  if (isServerRunning && (await isServerRunning())) {
    throw new ImportDbError('The server is still running. Stop the server first, then start the import again.');
  }

  // Copy next to the target first: if the copy fails (e.g. disk full), the old DB stays untouched.
  const tmpPath = `${dbPath}.new`;
  fs.copyFileSync(sourcePath, tmpPath);

  if (fs.existsSync(dbPath)) {
    // Write back the WAL so the .db file alone contains the complete state.
    const old = new DatabaseSync(dbPath);
    try {
      old.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      old.close();
    }
    // Timestamp without colons (Windows file names), e.g. 2026-10-10T120000.
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '');
    const backupPath = `${dbPath}.bak-${stamp}`;
    fs.renameSync(dbPath, backupPath);
    log(`Previous database backed up: ${backupPath}`);
  }
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.renameSync(tmpPath, dbPath);

  // Opening applies missing migrations in case the file comes from an older version.
  const db = openDatabase(dbPath);
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/** Checks whether the file is a suitable SQLite database. Throws ImportDbError. */
function checkSourceFile(sourcePath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new ImportDbError(`File not found: ${sourcePath}`);
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(sourcePath, { readOnly: true });
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
      (t) => t.name,
    );
    for (const required of ['items', 'updates']) {
      if (!tables.includes(required)) {
        throw new ImportDbError(`The file contains no table "${required}", so it is not a GW2 items database.`);
      }
    }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version > migrations.length) {
      throw new ImportDbError(
        `The database comes from a newer version (schema ${version}, known: ${migrations.length}). Please update the app first.`,
      );
    }
  } catch (err) {
    if (err instanceof ImportDbError) throw err;
    throw new ImportDbError(`The file is not a valid SQLite database: ${sourcePath}`);
  } finally {
    db?.close();
  }
}

async function serverIsRunning(): Promise<boolean> {
  try {
    await fetch(`http://localhost:${config.port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!process.argv[2]) {
    console.error('Usage: npm run db:import -- <file.db>');
    process.exit(1);
  }
  // npm starts the script in the server/ folder; relative paths are resolved from the folder where npm was invoked.
  const sourcePath = path.resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]);
  try {
    const count = await importDatabase({ sourcePath, dbPath: config.dbPath, isServerRunning: serverIsRunning, log: console.log });
    console.log(`Import done: ${count} items in ${config.dbPath}. The server can be started again.`);
  } catch (err) {
    console.error(err instanceof ImportDbError ? err.message : `Import failed: ${String(err)}`);
    process.exit(1);
  }
}

// Only run when started directly (not when imported in tests).
if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
