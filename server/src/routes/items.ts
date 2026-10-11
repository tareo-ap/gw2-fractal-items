import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
    GameType,
    ItemChange,
    ItemDetail,
    ItemListItem,
    ItemListResponse,
    ItemTestUpdate,
    Lang,
    Rarity,
    TestStatus,
} from '../../../shared/types.js';
import { exportFilename, toCsv, toJson, EXPORT_FIELDS, type ExportRow } from '../../../shared/exportFormat.js';
import {
    oneOf,
    parseItemListQuery,
    parseLang,
    ValidationError,
    type ParsedItemListQuery,
} from '../../../shared/params.js';
import {
    GAME_TYPES,
    HIDE_COMMON_SUBTYPES,
    ITEM_SORTS,
    RARITIES,
    TEST_STATUSES,
    TONIC_EXCLUDED_SUBTYPE,
    itemIdFromChatLink,
    wikiUrl,
} from '../../../shared/rules.js';

// The rules themselves (constants, input validation, CSV format) live in shared/ so the static version
// in the browser uses the same ones. The SQL versions stay here; other modules keep importing from here.
export {
    GAME_TYPES,
    RARITIES,
    ValidationError,
    oneOf,
    parseItemListQuery,
    parseLang,
    toCsv,
    toJson,
    exportFilename,
    EXPORT_FIELDS,
    itemIdFromChatLink,
    wikiUrl,
};
export type { ExportRow, ParsedItemListQuery };

// "Retest": there is a test result, but game_types differ today from when it was tested.
// Both columns contain sorted JSON arrays (see normalizeGameTypes), so a
// string comparison is enough for the set comparison.
export const NEEDS_RETEST_SQL = `(t.status IS NOT NULL AND t.status <> 'untested' AND t.game_types_at_test IS NOT i.game_types)`;

// Tonics: transformation items. Partly Gizmo, partly Consumable (subtype Generic, Food, Utility …),
// sometimes with the flag "Tonic", sometimes recognizable only by name. Subtype Unlock are the matching recipes.
export const TONIC_SQL = `(i.type IN ('Gizmo', 'Consumable')
  AND (EXISTS (SELECT 1 FROM json_each(i.flags) WHERE value = 'Tonic') OR i.name LIKE '%Tonic%')
  AND (i.subtype IS NULL OR i.subtype <> '${TONIC_EXCLUDED_SUBTYPE}'))`;

// Placeholders: empty name, no icon, or internal name such as "((906936))" or "[[913817]]". Expects the alias i.
export const PLACEHOLDER_SQL = `(trim(i.name) = '' OR i.icon IS NULL OR i.name GLOB '((*))' OR i.name GLOB '[[][[]*]]')`;

const RARITY_RANK_SQL = `CASE i.rarity ${RARITIES.map((r, idx) => `WHEN '${r}' THEN ${idx}`).join(' ')} ELSE 99 END`;

// Language: for 'de', name and description come from item_texts (alias d, via LEFT JOIN), otherwise from items.
// If the German text is missing, the English one is used. Placeholder/tonic checks stay on the English name.
/** JOIN on the language's texts; empty for English. Expects the alias i. */
export const textsJoin = (lang: Lang) =>
    lang === 'de' ? `LEFT JOIN item_texts d ON d.item_id = i.id AND d.lang = 'de'` : '';
export const nameSql = (lang: Lang) => (lang === 'de' ? `COALESCE(NULLIF(d.name, ''), i.name)` : 'i.name');
const descriptionSql = (lang: Lang) =>
    lang === 'de' ? `CASE WHEN d.item_id IS NOT NULL THEN d.description ELSE i.description END` : 'i.description';

const sortSql = (lang: Lang): Record<(typeof ITEM_SORTS)[number], string> => ({
    name: `${nameSql(lang)} COLLATE NOCASE`,
    id: 'i.id',
    rarity: RARITY_RANK_SQL,
    level: 'i.level',
    lastChanged: 'i.last_changed_update',
});

interface ItemRow {
    id: number;
    name: string;
    name_en: string;
    type: string;
    subtype: string | null;
    rarity: string;
    level: number;
    icon: string | null;
    game_types: string;
    is_candidate: number;
    removed: number;
    test_status: string | null;
    needs_retest: number;
}

interface ItemDetailRow extends ItemRow {
    description: string | null;
    chat_link: string | null;
    flags: string;
    raw_json: string;
    test_note: string | null;
    tested_at: string | null;
    game_types_at_test: string | null;
}

const selectItemSql = (lang: Lang) => `
  SELECT i.id, ${nameSql(lang)} AS name, i.name AS name_en, i.type, i.subtype, i.rarity, i.level, i.icon, i.game_types, i.is_candidate, i.removed,
         t.status AS test_status, ${NEEDS_RETEST_SQL} AS needs_retest
  FROM items i ${textsJoin(lang)} LEFT JOIN item_tests t ON t.item_id = i.id`;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Builds a safe FTS5 query from user input: every word is put in quotes
 * (so operators such as AND, NEAR, "-" or ":" are not evaluated) and searched as a
 * prefix. All words must occur. Returns null if no search word is left.
 */
export function toFtsQuery(input: string): string | null {
    const terms = input
        .split(/\s+/)
        .map((term) => term.replace(/"/g, ''))
        .filter((term) => /[\p{L}\p{N}]/u.test(term));
    return terms.length > 0 ? terms.map((term) => `"${term}"*`).join(' ') : null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** WHERE clause with parameters for the list filters (aliases i and t). Shared by list and export. */
function buildWhere(query: ParsedItemListQuery): { whereSql: string; params: SQLInputValue[] } {
    const where: string[] = [];
    const params: SQLInputValue[] = [];

    if (query.q) {
        if (/^\d+$/.test(query.q)) {
            where.push('i.id = ?');
            params.push(Number(query.q));
        } else if (query.q.startsWith('[&')) {
            where.push('(i.chat_link = ? OR i.id = ?)');
            params.push(query.q, itemIdFromChatLink(query.q) ?? -1);
        } else {
            const fts = toFtsQuery(query.q);
            if (fts) {
                if (query.lang === 'de') {
                    // German: a hit in the German or the English index is enough (proper names, chat terms).
                    where.push(
                        '(i.id IN (SELECT rowid FROM items_fts_de WHERE items_fts_de MATCH ?) OR i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?))',
                    );
                    params.push(fts, fts);
                } else {
                    where.push('i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)');
                    params.push(fts);
                }
            }
        }
    }

    if (query.view === 'gizmo') where.push(`i.type = 'Gizmo'`);
    if (query.view === 'consumable') where.push(`i.type = 'Consumable'`);
    if (query.view === 'tonic') where.push(TONIC_SQL);
    if (query.candidate !== 'all') where.push(`i.is_candidate = ${query.candidate === 'yes' ? 1 : 0}`);
    // In the tonic view hideCommon does not apply: tonics can have the subtype Food or Utility.
    if (query.hideCommon && query.view !== 'tonic') {
        where.push(
            `NOT (i.type = 'Consumable' AND i.subtype IS NOT NULL AND i.subtype IN (${HIDE_COMMON_SUBTYPES.map((v) => `'${v}'`).join(', ')}))`,
        );
        // Mastery Points and Emote Tomes are unlocks with no use in the fractals, but of subtype
        // Immediate or Generic. Many Mastery Points are named " Mastery Point" with a leading space.
        // Currency packs such as "300 Geodes" are Immediate and start with a number and a space.
        where.push(
            `NOT (i.type = 'Consumable' AND (trim(i.name) = 'Mastery Point' OR i.name LIKE '%Emote Tome'
        OR (COALESCE(i.subtype, '') = 'Immediate' AND i.name GLOB '[0-9]* *')))`,
        );
    }
    if (query.hidePlaceholders) where.push(`NOT ${PLACEHOLDER_SQL}`);
    if (query.rarity.length > 0) {
        where.push(`i.rarity IN (${query.rarity.map(() => '?').join(', ')})`);
        params.push(...query.rarity);
    }
    for (const gameType of query.gameType) {
        where.push('EXISTS (SELECT 1 FROM json_each(i.game_types) WHERE value = ?)');
        params.push(gameType);
    }
    if (query.testStatus === 'retest') {
        where.push(NEEDS_RETEST_SQL);
    } else if (query.testStatus === 'untested') {
        where.push(`(t.status IS NULL OR t.status = 'untested')`);
    } else if (query.testStatus) {
        where.push('t.status = ?');
        params.push(query.testStatus);
    }
    if (query.updateId !== undefined) {
        where.push('i.id IN (SELECT item_id FROM item_changes WHERE update_id = ?)');
        params.push(query.updateId);
    }
    if (!query.includeRemoved) where.push('i.removed = 0');

    return { whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listItems(db: DatabaseSync, query: ParsedItemListQuery): ItemListResponse {
    const { whereSql, params } = buildWhere(query);
    const { total } = db
        .prepare(`SELECT COUNT(*) AS total FROM items i LEFT JOIN item_tests t ON t.item_id = i.id ${whereSql}`)
        .get(...params) as { total: number };

    const direction = query.order === 'desc' ? 'DESC' : 'ASC';
    const rows = db
        .prepare(
            `${selectItemSql(query.lang)} ${whereSql}
       ORDER BY ${sortSql(query.lang)[query.sort]} ${direction}, i.id ${direction}
       LIMIT ? OFFSET ?`,
        )
        .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as unknown as ItemRow[];

    return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize };
}

/** All filter matches (without pagination) in the chosen sort order, for the CSV/JSON export. */
export function exportItems(db: DatabaseSync, query: ParsedItemListQuery): ExportRow[] {
    const { whereSql, params } = buildWhere(query);
    const direction = query.order === 'desc' ? 'DESC' : 'ASC';
    const rows = db
        .prepare(
            `SELECT i.id, ${nameSql(query.lang)} AS name, i.name AS name_en, i.type, i.subtype, i.rarity, i.level, i.icon, i.game_types, i.flags, i.chat_link,
              i.is_candidate, i.removed, t.status AS test_status, t.note AS test_note, t.tested_at,
              ${NEEDS_RETEST_SQL} AS needs_retest
       FROM items i ${textsJoin(query.lang)} LEFT JOIN item_tests t ON t.item_id = i.id ${whereSql}
       ORDER BY ${sortSql(query.lang)[query.sort]} ${direction}, i.id ${direction}`,
        )
        .all(...params) as unknown as (ItemRow & {
        flags: string;
        chat_link: string | null;
        test_note: string | null;
        tested_at: string | null;
    })[];
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        subtype: row.subtype,
        rarity: row.rarity,
        level: row.level,
        game_types: JSON.parse(row.game_types) as GameType[],
        flags: JSON.parse(row.flags) as string[],
        is_candidate: row.is_candidate === 1,
        removed: row.removed === 1,
        test_status: (row.test_status as TestStatus | null) ?? 'untested',
        test_note: row.test_note,
        tested_at: row.tested_at,
        needs_retest: row.needs_retest === 1,
        chat_link: row.chat_link,
        wiki_url: wikiUrl(query.lang, row.name),
        icon: row.icon,
    }));
}

export function getItemDetail(db: DatabaseSync, id: number, lang: Lang = 'en'): ItemDetail | null {
    const row = db
        .prepare(
            `SELECT i.id, ${nameSql(lang)} AS name, i.name AS name_en, i.type, i.subtype, i.rarity, i.level, i.icon, i.game_types, i.is_candidate, i.removed,
              ${descriptionSql(lang)} AS description, i.chat_link, i.flags, i.raw_json,
              t.status AS test_status, t.note AS test_note, t.tested_at, t.game_types_at_test,
              ${NEEDS_RETEST_SQL} AS needs_retest
       FROM items i ${textsJoin(lang)} LEFT JOIN item_tests t ON t.item_id = i.id
       WHERE i.id = ?`,
        )
        .get(id) as ItemDetailRow | undefined;
    if (!row) return null;

    const raw = JSON.parse(row.raw_json) as Record<string, unknown>;
    const history = db
        .prepare(
            `SELECT c.update_id, u.started_at, c.kind, c.changed_fields, c.game_types_before, c.game_types_after
       FROM item_changes c JOIN updates u ON u.id = c.update_id
       WHERE c.item_id = ?
       ORDER BY c.update_id DESC`,
        )
        .all(id) as {
        update_id: number;
        started_at: string;
        kind: ItemChange['kind'];
        changed_fields: string | null;
        game_types_before: string | null;
        game_types_after: string | null;
    }[];

    return {
        ...toListItem(row),
        description: row.description,
        chatLink: row.chat_link,
        flags: JSON.parse(row.flags) as string[],
        restrictions: Array.isArray(raw.restrictions) ? (raw.restrictions as string[]) : [],
        vendorValue: typeof raw.vendor_value === 'number' ? raw.vendor_value : 0,
        details: isObject(raw.details) ? raw.details : null,
        wikiUrl: wikiUrl(lang, row.name),
        test: {
            status: (row.test_status as TestStatus | null) ?? 'untested',
            note: row.test_note,
            testedAt: row.tested_at,
            gameTypesAtTest: row.game_types_at_test ? (JSON.parse(row.game_types_at_test) as GameType[]) : null,
        },
        history: history.map((h) => ({
            updateId: h.update_id,
            updateStartedAt: h.started_at,
            kind: h.kind,
            changedFields: h.changed_fields ? (JSON.parse(h.changed_fields) as string[]) : [],
            gameTypesBefore: h.game_types_before ? (JSON.parse(h.game_types_before) as GameType[]) : null,
            gameTypesAfter: h.game_types_after ? (JSON.parse(h.game_types_after) as GameType[]) : null,
        })),
    };
}

/** Validates the body of PUT /api/items/:id/test. Throws ValidationError. */
export function parseItemTestUpdate(body: unknown): ItemTestUpdate {
    if (!isObject(body)) throw new ValidationError('Body must be a JSON object');
    const status = oneOf('status', typeof body.status === 'string' ? body.status : '-', TEST_STATUSES);
    if (!status) throw new ValidationError('status is missing');
    const note = body.note;
    if (note !== undefined && note !== null && typeof note !== 'string') {
        throw new ValidationError('note must be a string or null');
    }
    if (typeof note === 'string' && note.length > 5000)
        throw new ValidationError('note is too long (max. 5000 characters)');
    const trimmed = typeof note === 'string' ? note.trim() : null;
    return { status, note: trimmed ? trimmed : null };
}

/** Stores the test result. Remembers the current game_types for the "retest" check. */
export function saveItemTest(db: DatabaseSync, id: number, update: ItemTestUpdate): boolean {
    const result = db
        .prepare(
            `INSERT INTO item_tests (item_id, status, note, tested_at, game_types_at_test)
       SELECT id, ?, ?, ?, game_types FROM items WHERE id = ?
       ON CONFLICT(item_id) DO UPDATE SET
         status = excluded.status, note = excluded.note,
         tested_at = excluded.tested_at, game_types_at_test = excluded.game_types_at_test`,
        )
        .run(update.status, update.note ?? null, new Date().toISOString(), id);
    return result.changes > 0;
}

function toListItem(row: ItemRow): ItemListItem {
    return {
        id: row.id,
        name: row.name,
        nameEn: row.name_en,
        type: row.type,
        subtype: row.subtype,
        rarity: row.rarity as Rarity,
        level: row.level,
        icon: row.icon,
        gameTypes: JSON.parse(row.game_types) as GameType[],
        isCandidate: row.is_candidate === 1,
        removed: row.removed === 1,
        testStatus: (row.test_status as TestStatus | null) ?? 'untested',
        needsRetest: row.needs_retest === 1,
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
