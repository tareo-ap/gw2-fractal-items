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

// Exports the database as JSON files for the static version on GitHub Pages.
// Usage: npm run export:static [-- file.db]. Output: site-data/ in the repo root (emptied beforehand).

/** Folder in the repo root that is committed and copied to web/dist/data during the Pages build. */
export const DEFAULT_OUT_DIR = path.resolve(import.meta.dirname, '../../../site-data');

/** The script warns from this size (uncompressed). */
export const SIZE_WARNING_BYTES = 15 * 1024 * 1024;

/** Entire content of the export before it is written to files. */
export interface StaticExport {
    meta: StaticMeta;
    items: StaticItem[];
    updates: StaticUpdate[];
    changes: StaticChange[];
    detailBlocks: StaticDetailBlock[];
}

// Row of the big item query in buildStaticExport (items + test result + German texts, snake_case columns).
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

// Row of the changes query; raw_json is needed to summarize added/removed items.
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
 * Reads the data for the static version. Published are
 * - all non-removed fractal candidates of type Gizmo or Consumable, and
 * - all items that appear in a change from the second completed update on (including removed ones),
 *   so that e.g. "Dungeon gone" stays visible.
 * The changes of the first completed update (full import, everything "new") are not included.
 */
export function buildStaticExport(db: DatabaseSync, now: Date = new Date()): StaticExport {
    const updates: StaticUpdate[] = listUpdates(db)
        .filter((update) => update.status === 'done')
        // Rest destructuring: drops the two server-only fields, keeps everything else in `rest`.
        .map(({ deletable: _deletable, deleteBlockedReason: _reason, ...rest }) => rest);
    // listUpdates returns the newest first; the full import is the last one.
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

    // Items go into one list; their bulky raw data is split into numbered blocks of DETAIL_BLOCK_SIZE
    // items, which the static site loads lazily.
    const items: StaticItem[] = [];
    const detailBlocks: StaticDetailBlock[] = [];
    for (const [index, row] of itemRows.entries()) {
        items.push(toStaticItem(row));
        const block = Math.floor(index / DETAIL_BLOCK_SIZE);
        // `??=` creates the block object on first use.
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
        ? {
              id: latest.id,
              startedAt: latest.startedAt,
              finishedAt: latest.finishedAt,
              buildId: latest.buildId,
              added: latest.added,
              changed: latest.changed,
              removed: latest.removed,
          }
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

// Converts a DB row to the compact static format: optional fields are only set when they carry information.
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
    // The chat link almost always follows from the ID; only deviations (and missing ones, as "") are stored.
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

/** The API response without the fields already present in items.json. */
function restOfRaw(rawJson: string): Record<string, unknown> {
    const raw = JSON.parse(rawJson) as Record<string, unknown>;
    for (const field of DETAIL_OMITTED_FIELDS) delete raw[field];
    return raw;
}

// Converts an item_changes row (JSON strings) to the static format.
function toStaticChange(row: ChangeRowSql): StaticChange {
    const change: StaticChange = { updateId: row.update_id, itemId: row.item_id, kind: row.kind };
    if (row.changed_fields) change.changedFields = JSON.parse(row.changed_fields) as string[];
    if (row.game_types_before) change.gameTypesBefore = JSON.parse(row.game_types_before) as GameType[];
    if (row.game_types_after) change.gameTypesAfter = JSON.parse(row.game_types_after) as GameType[];
    if (row.values_before) change.valuesBefore = JSON.parse(row.values_before) as Record<string, unknown>;
    if (row.values_after) change.valuesAfter = JSON.parse(row.values_after) as Record<string, unknown>;
    // The changes page shows new and removed items with the state from the API response.
    if (row.kind !== 'changed') change.summary = summarize(JSON.parse(row.raw_json) as Record<string, unknown>);
    return change;
}

/** What writeStaticExport wrote: file paths relative to the output folder and their sizes. */
export interface WrittenFiles {
    files: { path: string; bytes: number }[];
    totalBytes: number;
}

/** Empties outDir and writes all files as compact JSON (no indentation). */
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
    data.detailBlocks.forEach((block, blockIndex) => write(`details/${blockIndex}.json`, block));
    write('updates.json', data.updates);
    write('changes.json', data.changes);
    return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

/** Opens the database read-only (a running server does not interfere) and checks the schema. */
export function openForExport(dbPath: string): DatabaseSync {
    if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
    // PRAGMA user_version holds the number of applied migrations (see db/index.ts).
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version !== migrations.length) {
        db.close();
        throw new Error(
            version < migrations.length
                ? `The database has schema ${version}, ${migrations.length} is required. Start the server once so it gets migrated.`
                : `The database comes from a newer version (schema ${version}, known: ${migrations.length}). Please update the app first.`,
        );
    }
    return db;
}

// 1536 -> "1.5 KB", larger than 1 MiB -> "x.xx MB".
const formatBytes = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

/** Human-readable summary lines for the console output. */
export function describeWritten(data: StaticExport, written: WrittenFiles, outDir: string): string[] {
    const details = written.files.filter((file) => file.path.startsWith('details/'));
    const lines = [
        `Export done: ${data.items.length} items, ${data.updates.length} states, ${data.changes.length} changes in ${outDir}`,
        ...written.files
            .filter((file) => !file.path.startsWith('details/'))
            .map((file) => `  ${file.path}: ${formatBytes(file.bytes)}`),
        `  details/ (${details.length} files): ${formatBytes(details.reduce((sum, file) => sum + file.bytes, 0))}`,
        `Total: ${written.files.length} files, ${formatBytes(written.totalBytes)} (uncompressed)`,
    ];
    if (written.totalBytes > SIZE_WARNING_BYTES)
        lines.push(`Warning: larger than ${formatBytes(SIZE_WARNING_BYTES)} (target).`);
    return lines;
}

// Entry point of `npm run export:static`.
function main(): void {
    // npm starts the script in the server/ folder; relative paths are resolved from the folder where npm was invoked.
    const arg = process.argv[2];
    const dbPath = arg ? path.resolve(process.env.INIT_CWD ?? process.cwd(), arg) : config.dbPath;
    try {
        const db = openForExport(dbPath);
        try {
            console.log(`Reading ${dbPath} (read-only)`);
            const data = buildStaticExport(db);
            const written = writeStaticExport(data, DEFAULT_OUT_DIR);
            for (const line of describeWritten(data, written, DEFAULT_OUT_DIR)) console.log(line);
        } finally {
            db.close();
        }
    } catch (err) {
        console.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

// Only run when started directly (not when imported in tests).
if (process.argv[1] && import.meta.filename === process.argv[1]) main();
