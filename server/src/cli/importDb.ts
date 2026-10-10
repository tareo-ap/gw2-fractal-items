import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { openDatabase } from '../db/index.js';
import { migrations } from '../db/schema.js';

export interface ImportDbOptions {
  /** Datei, die importiert werden soll. */
  sourcePath: string;
  /** Ziel: die Datenbank des Servers. */
  dbPath: string;
  /** Prüft, ob der Server läuft; gibt dann true zurück. Im Test weglassen. */
  isServerRunning?: () => Promise<boolean>;
  log?: (message: string) => void;
}

/** Fehler mit einer Meldung, die direkt an den Nutzer ausgegeben werden kann. */
export class ImportDbError extends Error {}

/**
 * Ersetzt die Datenbank des Servers durch eine exportierte Datei (siehe GET /api/export).
 * Die alte Datenbank bleibt als Backup `<dbPath>.bak-<Zeitstempel>` erhalten.
 * Gibt die Anzahl der Items in der neuen Datenbank zurück.
 */
export async function importDatabase(options: ImportDbOptions): Promise<number> {
  const { sourcePath, dbPath, isServerRunning, log = () => {} } = options;

  if (path.resolve(sourcePath) === path.resolve(dbPath)) {
    throw new ImportDbError('Die Datei ist bereits die Datenbank des Servers.');
  }
  checkSourceFile(sourcePath);

  if (isServerRunning && (await isServerRunning())) {
    throw new ImportDbError('Der Server läuft noch. Server zuerst beenden, dann den Import erneut starten.');
  }

  // Erst neben das Ziel kopieren: Scheitert die Kopie (z. B. Datenträger voll), bleibt die alte DB unangetastet.
  const tmpPath = `${dbPath}.new`;
  fs.copyFileSync(sourcePath, tmpPath);

  if (fs.existsSync(dbPath)) {
    // WAL zurückschreiben, damit die .db-Datei allein den vollständigen Stand enthält.
    const old = new DatabaseSync(dbPath);
    try {
      old.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      old.close();
    }
    // Zeitstempel ohne Doppelpunkte (Windows-Dateinamen), z. B. 2026-10-10T120000.
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '');
    const backupPath = `${dbPath}.bak-${stamp}`;
    fs.renameSync(dbPath, backupPath);
    log(`Bisherige Datenbank gesichert: ${backupPath}`);
  }
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.renameSync(tmpPath, dbPath);

  // Öffnen spielt fehlende Migrationen ein, falls die Datei von einer älteren Version stammt.
  const db = openDatabase(dbPath);
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/** Prüft, ob die Datei eine passende SQLite-Datenbank ist. Wirft ImportDbError. */
function checkSourceFile(sourcePath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new ImportDbError(`Datei nicht gefunden: ${sourcePath}`);
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(sourcePath, { readOnly: true });
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
      (t) => t.name,
    );
    for (const required of ['items', 'updates']) {
      if (!tables.includes(required)) {
        throw new ImportDbError(`Die Datei enthält keine Tabelle "${required}", das ist keine GW2-Items-Datenbank.`);
      }
    }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version > migrations.length) {
      throw new ImportDbError(
        `Die Datenbank stammt von einer neueren Version (Schema ${version}, bekannt: ${migrations.length}). Bitte die App zuerst aktualisieren.`,
      );
    }
  } catch (err) {
    if (err instanceof ImportDbError) throw err;
    throw new ImportDbError(`Die Datei ist keine gültige SQLite-Datenbank: ${sourcePath}`);
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
    console.error('Aufruf: npm run db:import -- <datei.db>');
    process.exit(1);
  }
  // npm startet das Skript im Ordner server/; relative Pfade gelten ab dem Ordner, in dem npm aufgerufen wurde.
  const sourcePath = path.resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]);
  try {
    const count = await importDatabase({ sourcePath, dbPath: config.dbPath, isServerRunning: serverIsRunning, log: console.log });
    console.log(`Import fertig: ${count} Items in ${config.dbPath}. Server kann wieder gestartet werden.`);
  } catch (err) {
    console.error(err instanceof ImportDbError ? err.message : `Import fehlgeschlagen: ${String(err)}`);
    process.exit(1);
  }
}

// Nur ausführen, wenn direkt gestartet (nicht beim Import in Tests).
if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
