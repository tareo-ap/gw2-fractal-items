import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GameType, TestStatus, UpdateSummary } from '../../../shared/types.js';
import { summarize } from '../../../shared/changes.js';
import { ICON_PREFIX, chatLinkForId } from '../../../shared/rules.js';
import {
  DETAIL_BLOCK_SIZE,
  DETAIL_OMITTED_FIELDS,
  STATIC_SCHEMA_VERSION,
  type StaticChange,
  type StaticDetailBlock,
  type StaticItem,
  type StaticMeta,
  type StaticUpdate,
} from '../../../shared/staticTypes.js';
import { config } from '../config.js';
import { migrations } from '../db/schema.js';
import { NEEDS_RETEST_SQL } from '../routes/items.js';
import { listUpdates } from '../routes/updates.js';

// Exportiert die Datenbank als JSON-Dateien für die statische Fassung auf GitHub Pages (siehe docs/PRD.md,
// Meilenstein 7). Aufruf: npm run export:static [-- datei.db]. Ausgabe: site-data/ im Repo-Root (wird vorher geleert).

/** Ordner im Repo-Root, der committet und beim Pages-Build nach web/dist/data kopiert wird. */
export const DEFAULT_OUT_DIR = path.resolve(import.meta.dirname, '../../../site-data');

/** Ab dieser Größe (unkomprimiert) warnt das Skript. */
export const SIZE_WARNING_BYTES = 15 * 1024 * 1024;

/** Gesamter Inhalt des Exports, bevor er in Dateien geschrieben wird. */
export interface StaticExport {
  meta: StaticMeta;
  items: StaticItem[];
  updates: StaticUpdate[];
  changes: StaticChange[];
  detailBlocks: StaticDetailBlock[];
}

interface ItemRow {
  id: number;
  name: string;
  description: string | null;
  type: string;
  subtype: string | null;
  rarity: string;
  level: number;
  icon: string | null;
  chat_link: string | null;
  game_types: string;
  flags: string;
  is_candidate: number;
  removed: number;
  last_changed_update: number;
  raw_json: string;
  test_status: string | null;
  test_note: string | null;
  tested_at: string | null;
  game_types_at_test: string | null;
  needs_retest: number;
  de_id: number | null;
  de_name: string | null;
  de_description: string | null;
}

interface ChangeRowSql {
  update_id: number;
  item_id: number;
  kind: StaticChange['kind'];
  changed_fields: string | null;
  game_types_before: string | null;
  game_types_after: string | null;
  values_before: string | null;
  values_after: string | null;
  raw_json: string;
}

/**
 * Liest die Daten für die statische Fassung. Veröffentlicht werden
 * - alle nicht entfernten Fractal-Kandidaten vom Typ Gizmo oder Consumable und
 * - alle Items, die in einer Änderung ab dem zweiten abgeschlossenen Update vorkommen (auch entfernte),
 *   damit z. B. "Dungeon weg" sichtbar bleibt.
 * Die Änderungen des ersten abgeschlossenen Updates (Vollimport, alles "neu") gehören nicht dazu.
 */
export function buildStaticExport(db: DatabaseSync, now: Date = new Date()): StaticExport {
  const updates: StaticUpdate[] = listUpdates(db)
    .filter((u) => u.status === 'done')
    .map(({ deletable: _deletable, deleteBlockedReason: _reason, ...rest }) => rest);
  // listUpdates liefert die neuesten zuerst, der Vollimport ist der letzte.
  const baselineId = updates.length > 0 ? updates[updates.length - 1]!.id : -1;

  const itemRows = db
    .prepare(
      `SELECT i.id, i.name, i.description, i.type, i.subtype, i.rarity, i.level, i.icon, i.chat_link, i.game_types, i.flags,
              i.is_candidate, i.removed, i.last_changed_update, i.raw_json,
              t.status AS test_status, t.note AS test_note, t.tested_at, t.game_types_at_test, ${NEEDS_RETEST_SQL} AS needs_retest,
              d.item_id AS de_id, d.name AS de_name, d.description AS de_description
       FROM items i
       LEFT JOIN item_tests t ON t.item_id = i.id
       LEFT JOIN item_texts d ON d.item_id = i.id AND d.lang = 'de'
       WHERE (i.removed = 0 AND i.is_candidate = 1 AND i.type IN ('Gizmo', 'Consumable'))
          OR i.id IN (SELECT c.item_id FROM item_changes c JOIN updates u ON u.id = c.update_id WHERE u.status = 'done' AND u.id <> ?)
       ORDER BY i.id`,
    )
    .all(baselineId) as unknown as ItemRow[];

  const items: StaticItem[] = [];
  const detailBlocks: StaticDetailBlock[] = [];
  for (const [index, row] of itemRows.entries()) {
    items.push(toStaticItem(row));
    const block = Math.floor(index / DETAIL_BLOCK_SIZE);
    (detailBlocks[block] ??= {})[row.id] = restOfRaw(row.raw_json);
  }

  const changeRows = db
    .prepare(
      `SELECT c.update_id, c.item_id, c.kind, c.changed_fields, c.game_types_before, c.game_types_after,
              c.values_before, c.values_after, i.raw_json
       FROM item_changes c
       JOIN updates u ON u.id = c.update_id
       JOIN items i ON i.id = c.item_id
       WHERE u.status = 'done' AND u.id <> ?
       ORDER BY c.update_id, c.item_id`,
    )
    .all(baselineId) as unknown as ChangeRowSql[];
  const changes = changeRows.map(toStaticChange);

  const latest = updates[0];
  const lastUpdate: UpdateSummary | null = latest
    ? { id: latest.id, startedAt: latest.startedAt, finishedAt: latest.finishedAt, buildId: latest.buildId, added: latest.added, changed: latest.changed, removed: latest.removed }
    : null;
  const meta: StaticMeta = {
    schemaVersion: STATIC_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    build: lastUpdate?.buildId ?? null,
    itemCount: items.length,
    detailBlockSize: DETAIL_BLOCK_SIZE,
    detailBlocks: detailBlocks.length,
    lastUpdate,
  };
  return { meta, items, updates, changes, detailBlocks };
}

function toStaticItem(row: ItemRow): StaticItem {
  const item: StaticItem = {
    id: row.id,
    name: row.name,
    type: row.type,
    rarity: row.rarity as StaticItem['rarity'],
    level: row.level,
    gameTypes: JSON.parse(row.game_types) as GameType[],
    isCandidate: row.is_candidate === 1,
    lastChanged: row.last_changed_update,
  };
  if (row.subtype !== null) item.subtype = row.subtype;
  if (row.icon !== null) item.icon = row.icon.startsWith(ICON_PREFIX) ? row.icon.slice(ICON_PREFIX.length) : row.icon;
  const flags = JSON.parse(row.flags) as string[];
  if (flags.length > 0) item.flags = flags;
  if (row.removed === 1) item.removed = true;
  if (row.description !== null) item.description = row.description;
  if (row.de_id !== null) {
    item.de = {};
    if (row.de_name) item.de.name = row.de_name;
    if (row.de_description !== null) item.de.description = row.de_description;
  }
  // Der Chat-Link folgt fast immer aus der ID; nur Abweichungen (und fehlende, als "") werden gespeichert.
  if (row.chat_link !== chatLinkForId(row.id)) item.chatLink = row.chat_link ?? '';
  if (row.test_status !== null) {
    item.test = { status: row.test_status as TestStatus };
    if (row.test_note !== null) item.test.note = row.test_note;
    if (row.tested_at !== null) item.test.testedAt = row.tested_at;
    if (row.game_types_at_test) item.test.gameTypesAtTest = JSON.parse(row.game_types_at_test) as GameType[];
  }
  if (row.needs_retest === 1) item.needsRetest = true;
  return item;
}

/** Die API-Antwort ohne die Felder, die schon in items.json stehen. */
function restOfRaw(rawJson: string): Record<string, unknown> {
  const raw = JSON.parse(rawJson) as Record<string, unknown>;
  for (const field of DETAIL_OMITTED_FIELDS) delete raw[field];
  return raw;
}

function toStaticChange(row: ChangeRowSql): StaticChange {
  const change: StaticChange = { updateId: row.update_id, itemId: row.item_id, kind: row.kind };
  if (row.changed_fields) change.changedFields = JSON.parse(row.changed_fields) as string[];
  if (row.game_types_before) change.gameTypesBefore = JSON.parse(row.game_types_before) as GameType[];
  if (row.game_types_after) change.gameTypesAfter = JSON.parse(row.game_types_after) as GameType[];
  if (row.values_before) change.valuesBefore = JSON.parse(row.values_before) as Record<string, unknown>;
  if (row.values_after) change.valuesAfter = JSON.parse(row.values_after) as Record<string, unknown>;
  // Neue und entfernte Items zeigt die Änderungsseite mit dem Stand aus der API-Antwort.
  if (row.kind !== 'changed') change.summary = summarize(JSON.parse(row.raw_json) as Record<string, unknown>);
  return change;
}

export interface WrittenFiles {
  files: { path: string; bytes: number }[];
  totalBytes: number;
}

/** Leert outDir und schreibt alle Dateien als kompaktes JSON (ohne Einrückung). */
export function writeStaticExport(data: StaticExport, outDir: string): WrittenFiles {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'details'), { recursive: true });

  const files: WrittenFiles['files'] = [];
  const write = (relative: string, value: unknown) => {
    const text = JSON.stringify(value);
    fs.writeFileSync(path.join(outDir, relative), text, 'utf8');
    files.push({ path: relative, bytes: Buffer.byteLength(text, 'utf8') });
  };
  write('meta.json', data.meta);
  write('items.json', data.items);
  data.detailBlocks.forEach((block, n) => write(`details/${n}.json`, block));
  write('updates.json', data.updates);
  write('changes.json', data.changes);
  return { files, totalBytes: files.reduce((sum, f) => sum + f.bytes, 0) };
}

/** Öffnet die Datenbank nur lesend (ein laufender Server stört nicht) und prüft das Schema. */
export function openForExport(dbPath: string): DatabaseSync {
  if (!fs.existsSync(dbPath)) throw new Error(`Datenbank nicht gefunden: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version !== migrations.length) {
    db.close();
    throw new Error(
      version < migrations.length
        ? `Die Datenbank hat das Schema ${version}, benötigt wird ${migrations.length}. Bitte einmal den Server starten, damit sie migriert wird.`
        : `Die Datenbank stammt von einer neueren Version (Schema ${version}, bekannt: ${migrations.length}). Bitte die App zuerst aktualisieren.`,
    );
  }
  return db;
}

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`);

export function describeWritten(data: StaticExport, written: WrittenFiles, outDir: string): string[] {
  const details = written.files.filter((f) => f.path.startsWith('details/'));
  const lines = [
    `Export fertig: ${data.items.length} Items, ${data.updates.length} Stände, ${data.changes.length} Änderungen in ${outDir}`,
    ...written.files.filter((f) => !f.path.startsWith('details/')).map((f) => `  ${f.path}: ${formatBytes(f.bytes)}`),
    `  details/ (${details.length} Dateien): ${formatBytes(details.reduce((sum, f) => sum + f.bytes, 0))}`,
    `Gesamt: ${written.files.length} Dateien, ${formatBytes(written.totalBytes)} (unkomprimiert)`,
  ];
  if (written.totalBytes > SIZE_WARNING_BYTES) lines.push(`Warnung: größer als ${formatBytes(SIZE_WARNING_BYTES)} (Ziel).`);
  return lines;
}

function main(): void {
  // npm startet das Skript im Ordner server/; relative Pfade gelten ab dem Ordner, in dem npm aufgerufen wurde.
  const arg = process.argv[2];
  const dbPath = arg ? path.resolve(process.env.INIT_CWD ?? process.cwd(), arg) : config.dbPath;
  try {
    const db = openForExport(dbPath);
    try {
      console.log(`Lese ${dbPath} (nur lesend)`);
      const data = buildStaticExport(db);
      const written = writeStaticExport(data, DEFAULT_OUT_DIR);
      for (const line of describeWritten(data, written, DEFAULT_OUT_DIR)) console.log(line);
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`Export fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// Nur ausführen, wenn direkt gestartet (nicht beim Import in Tests).
if (process.argv[1] && import.meta.filename === process.argv[1]) main();
