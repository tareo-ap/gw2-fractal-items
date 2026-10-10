import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  GameType,
  ItemChange,
  ItemDetail,
  ItemListItem,
  ItemListQuery,
  ItemListResponse,
  ItemTestUpdate,
  Rarity,
  TestStatus,
} from '../../../shared/types.js';

export const RARITIES: readonly Rarity[] = ['Junk', 'Basic', 'Fine', 'Masterwork', 'Rare', 'Exotic', 'Ascended', 'Legendary'];
export const GAME_TYPES: readonly GameType[] = ['Activity', 'Dungeon', 'Pve', 'Pvp', 'PvpLobby', 'Wvw'];
const TEST_STATUSES: readonly TestStatus[] = ['untested', 'works', 'broken'];
const SORTS = ['name', 'id', 'rarity', 'level', 'lastChanged'] as const;

/** Fehler in den Eingaben, wird als HTTP 400 beantwortet. */
export class ValidationError extends Error {}

// "Neu testen": Es gibt ein Testergebnis, aber game_types sind heute anders als beim Test.
// Beide Spalten enthalten sortierte JSON-Arrays (siehe normalizeGameTypes), daher reicht ein
// String-Vergleich für den Mengenvergleich.
const NEEDS_RETEST_SQL = `(t.status IS NOT NULL AND t.status <> 'untested' AND t.game_types_at_test IS NOT i.game_types)`;

const RARITY_RANK_SQL = `CASE i.rarity ${RARITIES.map((r, idx) => `WHEN '${r}' THEN ${idx}`).join(' ')} ELSE 99 END`;

const SORT_SQL: Record<(typeof SORTS)[number], string> = {
  name: 'i.name COLLATE NOCASE',
  id: 'i.id',
  rarity: RARITY_RANK_SQL,
  level: 'i.level',
  lastChanged: 'i.last_changed_update',
};

interface ItemRow {
  id: number;
  name: string;
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

const SELECT_ITEM_SQL = `
  SELECT i.id, i.name, i.type, i.subtype, i.rarity, i.level, i.icon, i.game_types, i.is_candidate, i.removed,
         t.status AS test_status, ${NEEDS_RETEST_SQL} AS needs_retest
  FROM items i LEFT JOIN item_tests t ON t.item_id = i.id`;

// ---------------------------------------------------------------------------
// Query-Parameter einlesen
// ---------------------------------------------------------------------------

/** ItemListQuery mit aufgefüllten Defaults; nur q, testStatus und updateId bleiben optional. */
export type ParsedItemListQuery = Required<Omit<ItemListQuery, 'q' | 'testStatus' | 'updateId'>> &
  Pick<ItemListQuery, 'q' | 'testStatus' | 'updateId'>;

/** Liest die Query-Parameter von GET /api/items und füllt Defaults auf. Wirft ValidationError. */
export function parseItemListQuery(params: Record<string, string | undefined>): ParsedItemListQuery {
  const q = params.q?.trim();
  return {
    q: q ? q : undefined,
    view: oneOf('view', params.view, ['gizmo', 'consumable', 'all'] as const) ?? 'gizmo',
    candidate: oneOf('candidate', params.candidate, ['yes', 'no', 'all'] as const) ?? 'yes',
    hideCommon: bool('hideCommon', params.hideCommon) ?? true,
    hidePlaceholders: bool('hidePlaceholders', params.hidePlaceholders) ?? true,
    rarity: list('rarity', params.rarity, RARITIES),
    gameType: list('gameType', params.gameType, GAME_TYPES),
    testStatus: oneOf('testStatus', params.testStatus, [...TEST_STATUSES, 'retest'] as const),
    updateId: params.updateId ? int('updateId', params.updateId, 1) : undefined,
    includeRemoved: bool('includeRemoved', params.includeRemoved) ?? false,
    sort: oneOf('sort', params.sort, SORTS) ?? 'name',
    order: oneOf('order', params.order, ['asc', 'desc'] as const) ?? 'asc',
    page: params.page ? int('page', params.page, 1) : 1,
    pageSize: params.pageSize ? Math.min(int('pageSize', params.pageSize, 1), 200) : 50,
  };
}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${name} muss einer dieser Werte sein: ${allowed.join(', ')}`);
  }
  return value as T;
}

function bool(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new ValidationError(`${name} muss true oder false sein`);
}

function int(name: string, value: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new ValidationError(`${name} muss eine ganze Zahl ≥ ${min} sein`);
  return n;
}

function list<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map((v) => oneOf(name, v, allowed)!);
}

// ---------------------------------------------------------------------------
// Suche
// ---------------------------------------------------------------------------

/**
 * Item-ID aus einem GW2-Chat-Link wie [&AgEAWgAA]. Aufbau (Base64): Byte 0 = Typ (2 = Item),
 * Byte 1 = Anzahl, Byte 2–4 = Item-ID (little endian). Ingame kopierte Links können sich vom
 * chat_link der API unterscheiden (z. B. andere Anzahl), deshalb wird die ID ausgewertet.
 */
export function itemIdFromChatLink(link: string): number | null {
  const match = /^\[&([A-Za-z0-9+/=]+)\]$/.exec(link);
  if (!match) return null;
  const bytes = Buffer.from(match[1]!, 'base64');
  if (bytes.length < 5 || bytes[0] !== 0x02) return null;
  return bytes[2]! | (bytes[3]! << 8) | (bytes[4]! << 16);
}

/**
 * Baut aus der Benutzereingabe eine sichere FTS5-Abfrage: Jedes Wort wird in Anführungszeichen
 * gesetzt (damit Operatoren wie AND, NEAR, "-" oder ":" nicht ausgewertet werden) und als
 * Präfix gesucht. Alle Wörter müssen vorkommen. Gibt null zurück, wenn kein Suchwort übrig bleibt.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ''))
    .filter((term) => /[\p{L}\p{N}]/u.test(term));
  return terms.length > 0 ? terms.map((term) => `"${term}"*`).join(' ') : null;
}

// ---------------------------------------------------------------------------
// Abfragen
// ---------------------------------------------------------------------------

export function listItems(db: DatabaseSync, query: ParsedItemListQuery): ItemListResponse {
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
        where.push('i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)');
        params.push(fts);
      }
    }
  }

  if (query.view === 'gizmo') where.push(`i.type = 'Gizmo'`);
  if (query.view === 'consumable') where.push(`i.type = 'Consumable'`);
  if (query.candidate !== 'all') where.push(`i.is_candidate = ${query.candidate === 'yes' ? 1 : 0}`);
  if (query.hideCommon) {
    where.push(`NOT (i.type = 'Consumable' AND i.subtype IS NOT NULL AND i.subtype IN ('Food', 'Utility', 'Unlock', 'Transmutation'))`);
    // Mastery Points und Emote Tomes sind Freischaltungen ohne Nutzen im Fraktal, aber vom Untertyp
    // Immediate bzw. Generic. Viele Mastery Points heißen " Mastery Point" mit führendem Leerzeichen.
    where.push(`NOT (i.type = 'Consumable' AND (trim(i.name) = 'Mastery Point' OR i.name LIKE '%Emote Tome'))`);
  }
  // Platzhalter: leerer Name, kein Icon oder interner Name wie "((906936))".
  if (query.hidePlaceholders) where.push(`NOT (trim(i.name) = '' OR i.icon IS NULL OR i.name GLOB '((*))')`);
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

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM items i LEFT JOIN item_tests t ON t.item_id = i.id ${whereSql}`)
    .get(...params) as { total: number };

  const direction = query.order === 'desc' ? 'DESC' : 'ASC';
  const rows = db
    .prepare(
      `${SELECT_ITEM_SQL} ${whereSql}
       ORDER BY ${SORT_SQL[query.sort]} ${direction}, i.id ${direction}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as unknown as ItemRow[];

  return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize };
}

export function getItemDetail(db: DatabaseSync, id: number): ItemDetail | null {
  const row = db
    .prepare(
      `SELECT i.id, i.name, i.type, i.subtype, i.rarity, i.level, i.icon, i.game_types, i.is_candidate, i.removed,
              i.description, i.chat_link, i.flags, i.raw_json,
              t.status AS test_status, t.note AS test_note, t.tested_at, t.game_types_at_test,
              ${NEEDS_RETEST_SQL} AS needs_retest
       FROM items i LEFT JOIN item_tests t ON t.item_id = i.id
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
    wikiUrl: `https://wiki.guildwars2.com/wiki/Special:Search/${encodeURIComponent(row.name)}`,
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

/** Prüft den Body von PUT /api/items/:id/test. Wirft ValidationError. */
export function parseItemTestUpdate(body: unknown): ItemTestUpdate {
  if (!isObject(body)) throw new ValidationError('Body muss ein JSON-Objekt sein');
  const status = oneOf('status', typeof body.status === 'string' ? body.status : '-', TEST_STATUSES);
  if (!status) throw new ValidationError('status fehlt');
  const note = body.note;
  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new ValidationError('note muss ein Text oder null sein');
  }
  if (typeof note === 'string' && note.length > 5000) throw new ValidationError('note ist zu lang (max. 5000 Zeichen)');
  const trimmed = typeof note === 'string' ? note.trim() : null;
  return { status, note: trimmed ? trimmed : null };
}

/** Speichert das Testergebnis. Merkt sich die aktuellen game_types für die "neu testen"-Prüfung. */
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
