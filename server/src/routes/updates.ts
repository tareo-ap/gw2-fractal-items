import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  ChangeKind,
  GameType,
  Lang,
  Rarity,
  UpdateChangeCounts,
  UpdateChangeEntry,
  UpdateChangesQuery,
  UpdateChangesResponse,
  UpdateCompareResponse,
  UpdateDetail,
  UpdateSummary,
} from '../../../shared/types.js';
import { stableStringify } from '../importer/diff.js';
import { bool, int, list, nameSql, oneOf, parseLang, PLACEHOLDER_SQL, textsJoin, TONIC_SQL } from './items.js';

export interface UpdateRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  build_id: number | null;
  status: UpdateDetail['status'];
  error: string | null;
  added: number;
  changed: number;
  removed: number;
}

// Gezählt werden nur geänderte Items (kind = 'changed'), bei denen "Dungeon" in game_types
// dazugekommen bzw. weggefallen ist. Neue und entfernte Items stehen schon in added/removed;
// sonst wäre beim ersten Vollimport jeder Kandidat ein "Dungeon gewonnen".
const HAS_DUNGEON = (column: string) => `EXISTS (SELECT 1 FROM json_each(c.${column}) WHERE value = 'Dungeon')`;

const DUNGEON_GAINED_SQL = `c.kind = 'changed' AND ${HAS_DUNGEON('game_types_after')} AND NOT ${HAS_DUNGEON('game_types_before')}`;
const DUNGEON_LOST_SQL = `c.kind = 'changed' AND ${HAS_DUNGEON('game_types_before')} AND NOT ${HAS_DUNGEON('game_types_after')}`;
// game_types sind sortierte JSON-Arrays (siehe normalizeGameTypes): ungleiche Strings = andere Menge.
// Eine reine Umsortierung in der API-Antwort steht zwar in changed_fields, zählt hier aber nicht.
const GAME_TYPES_CHANGED_SQL = `c.kind = 'changed' AND EXISTS (SELECT 1 FROM json_each(c.changed_fields) WHERE value = 'game_types')
  AND c.game_types_before IS NOT c.game_types_after`;

type UpdateRowWithDungeon = UpdateRow & { dungeon_gained: number; dungeon_lost: number; change_rows: number; item_refs: number };

/**
 * Löschregel für Stände: fehlgeschlagene immer, abgeschlossene nur ohne Änderungen, laufende nie.
 * Verweist noch ein Item oder ein item_changes-Eintrag auf den Stand, bleibt er, sonst würde der Verlauf verfälscht.
 */
function deleteState(row: UpdateRowWithDungeon): Pick<UpdateDetail, 'deletable' | 'deleteBlockedReason'> {
  const blocked = (reason: NonNullable<UpdateDetail['deleteBlockedReason']>) => ({ deletable: false, deleteBlockedReason: reason });
  if (row.status === 'running') return blocked('running');
  if (row.status === 'done' && (row.added !== 0 || row.changed !== 0 || row.removed !== 0 || row.change_rows > 0)) return blocked('hasChanges');
  if (row.item_refs > 0) return blocked('referenced');
  return { deletable: true, deleteBlockedReason: null };
}

function selectUpdates(db: DatabaseSync, id?: number): UpdateDetail[] {
  const rows = db
    .prepare(
      `SELECT u.*,
         (SELECT COUNT(*) FROM item_changes c WHERE c.update_id = u.id AND ${DUNGEON_GAINED_SQL}) AS dungeon_gained,
         (SELECT COUNT(*) FROM item_changes c WHERE c.update_id = u.id AND ${DUNGEON_LOST_SQL}) AS dungeon_lost,
         (SELECT COUNT(*) FROM item_changes c WHERE c.update_id = u.id) AS change_rows,
         (SELECT COUNT(*) FROM items i WHERE i.first_seen_update = u.id OR i.last_changed_update = u.id) AS item_refs
       FROM updates u
       ${id === undefined ? '' : 'WHERE u.id = ?'}
       ORDER BY u.id DESC`,
    )
    .all(...(id === undefined ? [] : [id])) as unknown as UpdateRowWithDungeon[];

  return rows.map((row) => ({
    ...toUpdateSummary(row),
    status: row.status,
    error: row.error,
    dungeonGained: row.dungeon_gained,
    dungeonLost: row.dungeon_lost,
    ...deleteState(row),
  }));
}

export function listUpdates(db: DatabaseSync): UpdateDetail[] {
  return selectUpdates(db);
}

export function getUpdate(db: DatabaseSync, id: number): UpdateDetail | null {
  return selectUpdates(db, id)[0] ?? null;
}

export type DeleteUpdateResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

const BLOCKED_MESSAGES = {
  running: 'Der Stand läuft noch und kann nicht gelöscht werden',
  hasChanges: 'Der Stand enthält Änderungen; Löschen würde den Verlauf verfälschen',
  referenced: 'Items verweisen noch auf diesen Stand; Löschen würde den Verlauf verfälschen',
} as const;

/** Löscht einen Stand samt seinen item_changes in einer Transaktion, sofern die Regel (deleteState) es erlaubt. */
export function deleteUpdate(db: DatabaseSync, id: number): DeleteUpdateResult {
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = getUpdate(db, id);
    if (!update) {
      db.exec('ROLLBACK');
      return { ok: false, status: 404, error: 'Update nicht gefunden' };
    }
    if (!update.deletable) {
      db.exec('ROLLBACK');
      return { ok: false, status: 409, error: BLOCKED_MESSAGES[update.deleteBlockedReason!] };
    }
    db.prepare('DELETE FROM item_changes WHERE update_id = ?').run(id);
    db.prepare('DELETE FROM updates WHERE id = ?').run(id);
    db.exec('COMMIT');
    return { ok: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Änderungen eines Updates
// ---------------------------------------------------------------------------

export type ParsedUpdateChangesQuery = Required<Omit<UpdateChangesQuery, 'q'>> & Pick<UpdateChangesQuery, 'q'>;

const CHANGE_KINDS: readonly ChangeKind[] = ['added', 'changed', 'removed'];

/** Liest die Query-Parameter von GET /api/updates/:id/changes und füllt Defaults auf. Wirft ValidationError. */
export function parseUpdateChangesQuery(params: Record<string, string | undefined>): ParsedUpdateChangesQuery {
  const q = params.q?.trim();
  return {
    lang: parseLang(params.lang),
    kind: list('kind', params.kind, CHANGE_KINDS),
    focus: oneOf('focus', params.focus, ['all', 'gameTypes', 'dungeonGained', 'dungeonLost'] as const) ?? 'all',
    type: oneOf('type', params.type, ['gizmo', 'consumable', 'tonic', 'all'] as const) ?? 'all',
    q: q ? q : undefined,
    hidePlaceholders: bool('hidePlaceholders', params.hidePlaceholders) ?? true,
    page: params.page ? int('page', params.page, 1) : 1,
    pageSize: params.pageSize ? Math.min(int('pageSize', params.pageSize, 1), 200) : 50,
  };
}

interface ChangeRow {
  item_id: number;
  kind: ChangeKind;
  changed_fields: string | null;
  game_types_before: string | null;
  game_types_after: string | null;
  values_before: string | null;
  values_after: string | null;
  raw_json: string;
  name: string;
  name_en: string;
  type: string;
  subtype: string | null;
  rarity: string;
  icon: string | null;
  removed: number;
  is_candidate: number;
}

const fromChangesSql = (lang: Lang) => `FROM item_changes c JOIN items i ON i.id = c.item_id ${textsJoin(lang)}`;

/** Bedingungen auf den Items (Typ, Platzhalter, Suche); gemeinsam für /changes und /compare. Alias i. */
function itemFilter(query: ParsedUpdateChangesQuery): { conditions: string[]; params: SQLInputValue[] } {
  const conditions: string[] = [];
  const params: SQLInputValue[] = [];
  if (query.type === 'gizmo') conditions.push(`i.type = 'Gizmo'`);
  if (query.type === 'consumable') conditions.push(`i.type = 'Consumable'`);
  if (query.type === 'tonic') conditions.push(TONIC_SQL);
  if (query.hidePlaceholders) conditions.push(`NOT ${PLACEHOLDER_SQL}`);
  if (query.q) {
    // %, _ und \ sind in LIKE Sonderzeichen und werden mit \ maskiert. Eine reine Zahl findet zusätzlich die ID.
    const pattern = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    // Deutsch: Treffer im deutschen oder im englischen Namen genügt.
    const nameLike = query.lang === 'de' ? `(i.name LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\')` : `i.name LIKE ? ESCAPE '\\'`;
    const patterns = query.lang === 'de' ? [pattern, pattern] : [pattern];
    if (/^\d+$/.test(query.q)) {
      conditions.push(`(${nameLike} OR i.id = ?)`);
      params.push(...patterns, Number(query.q));
    } else {
      conditions.push(nameLike);
      params.push(...patterns);
    }
  }
  return { conditions, params };
}

export function getUpdateChanges(db: DatabaseSync, update: UpdateDetail, query: ParsedUpdateChangesQuery): UpdateChangesResponse {
  const where: string[] = ['c.update_id = ?'];
  const params: SQLInputValue[] = [update.id];

  if (query.kind.length > 0) {
    where.push(`c.kind IN (${query.kind.map(() => '?').join(', ')})`);
    params.push(...query.kind);
  }
  if (query.focus === 'gameTypes') where.push(GAME_TYPES_CHANGED_SQL);
  if (query.focus === 'dungeonGained') where.push(DUNGEON_GAINED_SQL);
  if (query.focus === 'dungeonLost') where.push(DUNGEON_LOST_SQL);
  const filter = itemFilter(query);
  where.push(...filter.conditions);
  params.push(...filter.params);

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${fromChangesSql(query.lang)} ${whereSql}`).get(...params) as { total: number };

  // Dungeon-Änderungen zuerst, dann geändert, neu, entfernt, dann nach Name.
  const rows = db
    .prepare(
      `SELECT c.item_id, c.kind, c.changed_fields, c.game_types_before, c.game_types_after,
              c.values_before, c.values_after, i.raw_json,
              ${nameSql(query.lang)} AS name, i.name AS name_en, i.type, i.subtype, i.rarity, i.icon, i.removed, i.is_candidate
       ${fromChangesSql(query.lang)} ${whereSql}
       ORDER BY CASE WHEN (${DUNGEON_GAINED_SQL}) OR (${DUNGEON_LOST_SQL}) THEN 0 ELSE 1 END,
                CASE c.kind WHEN 'changed' THEN 0 WHEN 'added' THEN 1 ELSE 2 END,
                ${nameSql(query.lang)} COLLATE NOCASE, i.id
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as unknown as ChangeRow[];

  const parseTypes = (json: string | null) => (json ? (JSON.parse(json) as GameType[]) : null);
  const parseValues = (json: string | null) => (json ? (JSON.parse(json) as Record<string, unknown>) : null);
  const items: UpdateChangeEntry[] = rows.map((row) => ({
    id: row.item_id,
    name: row.name,
    nameEn: row.name_en,
    type: row.type,
    subtype: row.subtype,
    rarity: row.rarity as Rarity,
    icon: row.icon,
    removed: row.removed === 1,
    isCandidate: row.is_candidate === 1,
    kind: row.kind,
    changedFields: row.changed_fields ? (JSON.parse(row.changed_fields) as string[]) : [],
    gameTypesBefore: parseTypes(row.game_types_before),
    gameTypesAfter: parseTypes(row.game_types_after),
    // Neue und entfernte Items: Der Stand steht in raw_json (bei entfernten der letzte bekannte).
    before: row.kind === 'removed' ? summarize(row.raw_json) : row.kind === 'changed' ? parseValues(row.values_before) : null,
    after: row.kind === 'added' ? summarize(row.raw_json) : row.kind === 'changed' ? parseValues(row.values_after) : null,
  }));

  const legacy = db
    .prepare(`SELECT EXISTS (SELECT 1 FROM item_changes WHERE update_id = ? AND kind = 'changed' AND values_before IS NULL) AS legacy`)
    .get(update.id) as { legacy: number };
  return { update, counts: countChanges(db, update.id), items, total, page: query.page, pageSize: query.pageSize, legacyValues: legacy.legacy === 1 };
}

// ---------------------------------------------------------------------------
// Vergleich zweier Stände (Update A gegen Update B)
// ---------------------------------------------------------------------------

interface RangeRow {
  update_id: number;
  item_id: number;
  kind: ChangeKind;
  changed_fields: string | null;
  game_types_before: string | null;
  game_types_after: string | null;
  values_before: string | null;
  values_after: string | null;
  name: string;
  name_en: string;
  matches: number;
}

/** Netto-Änderung eines Items über alle Updates im Bereich (from, to]. */
interface NetChange {
  itemId: number;
  name: string;
  nameEn: string;
  matches: boolean;
  kind: ChangeKind;
  gameTypesBefore: string | null; // JSON-Array
  gameTypesAfter: string | null;
  gameTypesChanged: boolean;
  changedFields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  unknownFields: string[];
}

const hasDungeon = (json: string | null) => json !== null && (JSON.parse(json) as string[]).includes('Dungeon');

/**
 * Fasst die Änderungen eines Items (nach update_id sortiert) zusammen:
 * - erste Änderung added und letzte removed: gab es in keinem der beiden Stände, entfällt
 * - erste added: neu; sonst letzte removed: entfernt; sonst geändert
 * - game_types: vorher der Wert der ersten, nachher der Wert der letzten Änderung; netto gleich = keine Änderung
 * - Felder: alter Wert aus der ersten, neuer Wert aus der letzten Änderung, die das Feld betrifft; netto gleiche entfallen
 */
function aggregate(rows: RangeRow[]): NetChange | null {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  if (first.kind === 'added' && last.kind === 'removed') return null;
  const kind: ChangeKind = first.kind === 'added' ? 'added' : last.kind === 'removed' ? 'removed' : 'changed';

  const net: NetChange = {
    itemId: first.item_id,
    name: first.name,
    nameEn: first.name_en,
    matches: first.matches === 1,
    kind,
    gameTypesBefore: kind === 'added' ? null : first.game_types_before,
    gameTypesAfter: kind === 'removed' ? null : last.game_types_after,
    gameTypesChanged: false,
    changedFields: [],
    before: {},
    after: {},
    unknownFields: [],
  };
  if (kind !== 'changed') return net;

  net.gameTypesChanged = net.gameTypesBefore !== net.gameTypesAfter;
  if (net.gameTypesChanged) net.changedFields.push('game_types');

  // Zwischenzeitlich entfernt und wieder da: Dafür sind keine Feldwerte gespeichert, der Eintrag bleibt trotzdem.
  const changedRows = rows.filter((r) => r.kind === 'changed');
  const fieldsOf = (r: RangeRow) => (r.changed_fields ? (JSON.parse(r.changed_fields) as string[]) : []);
  const names = [...new Set(changedRows.flatMap(fieldsOf))].filter((n) => n !== 'game_types').sort();
  for (const name of names) {
    const firstRow = changedRows.find((r) => fieldsOf(r).includes(name))!;
    const lastRow = [...changedRows].reverse().find((r) => fieldsOf(r).includes(name))!;
    if (firstRow.values_before === null || lastRow.values_after === null) {
      net.changedFields.push(name);
      net.unknownFields.push(name);
      continue;
    }
    const oldValue = (JSON.parse(firstRow.values_before) as Record<string, unknown>)[name];
    const newValue = (JSON.parse(lastRow.values_after) as Record<string, unknown>)[name];
    if (stableStringify(oldValue) === stableStringify(newValue)) continue;
    net.changedFields.push(name);
    if (oldValue !== undefined) net.before[name] = oldValue;
    if (newValue !== undefined) net.after[name] = newValue;
  }
  if (net.changedFields.length === 0 && changedRows.length === rows.length) return null;
  return net;
}

/**
 * Vergleicht den Stand nach Update from mit dem Stand nach Update to anhand der gespeicherten Änderungen
 * im Bereich (from, to]. Die Zusammenfassung läuft in TypeScript: alle Änderungen des Bereichs laden,
 * pro Item zusammenfassen, filtern, sortieren, paginieren.
 */
export function compareUpdates(db: DatabaseSync, from: UpdateDetail, to: UpdateDetail, query: ParsedUpdateChangesQuery): UpdateCompareResponse {
  const filter = itemFilter(query);
  const rows = db
    .prepare(
      `SELECT c.update_id, c.item_id, c.kind, c.changed_fields, c.game_types_before, c.game_types_after,
              c.values_before, c.values_after, ${nameSql(query.lang)} AS name, i.name AS name_en, (${filter.conditions.join(' AND ') || '1'}) AS matches
       ${fromChangesSql(query.lang)}
       WHERE c.update_id > ? AND c.update_id <= ?
       ORDER BY c.item_id, c.update_id`,
    )
    .all(...filter.params, from.id, to.id) as unknown as RangeRow[];

  // Gruppieren (Zeilen sind nach item_id sortiert), zusammenfassen und zählen (ungefiltert).
  const all: NetChange[] = [];
  const counts: UpdateChangeCounts = { added: 0, changed: 0, removed: 0, gameTypesChanged: 0, dungeonGained: 0, dungeonLost: 0 };
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i < rows.length && rows[i]!.item_id === rows[start]!.item_id) continue;
    const net = aggregate(rows.slice(start, i));
    start = i;
    if (!net) continue;
    all.push(net);
    counts[net.kind]++;
    if (net.gameTypesChanged) counts.gameTypesChanged++;
    if (isDungeonGained(net)) counts.dungeonGained++;
    if (isDungeonLost(net)) counts.dungeonLost++;
  }

  const dungeonChange = (n: NetChange) => isDungeonGained(n) || isDungeonLost(n);
  const kindRank = { changed: 0, added: 1, removed: 2 };
  const selected = all
    .filter((n) => {
      if (!n.matches) return false;
      if (query.kind.length > 0 && !query.kind.includes(n.kind)) return false;
      if (query.focus === 'gameTypes') return n.gameTypesChanged;
      if (query.focus === 'dungeonGained') return isDungeonGained(n);
      if (query.focus === 'dungeonLost') return isDungeonLost(n);
      return true;
    })
    .sort(
      (a, b) =>
        Number(dungeonChange(b)) - Number(dungeonChange(a)) ||
        kindRank[a.kind] - kindRank[b.kind] ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.itemId - b.itemId,
    );

  const pageNets = selected.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  const info = new Map<number, ItemInfoRow>();
  if (pageNets.length > 0) {
    const infoRows = db
      .prepare(
        `SELECT id, type, subtype, rarity, icon, removed, is_candidate, raw_json FROM items WHERE id IN (${pageNets.map(() => '?').join(', ')})`,
      )
      .all(...pageNets.map((n) => n.itemId)) as unknown as ItemInfoRow[];
    for (const row of infoRows) info.set(row.id, row);
  }

  const parseTypes = (json: string | null) => (json ? (JSON.parse(json) as GameType[]) : null);
  const items: UpdateChangeEntry[] = pageNets.map((n) => {
    const row = info.get(n.itemId)!;
    return {
      id: n.itemId,
      name: n.name,
      nameEn: n.nameEn,
      type: row.type,
      subtype: row.subtype,
      rarity: row.rarity as Rarity,
      icon: row.icon,
      removed: row.removed === 1,
      isCandidate: row.is_candidate === 1,
      kind: n.kind,
      changedFields: n.changedFields,
      gameTypesBefore: parseTypes(n.gameTypesBefore),
      gameTypesAfter: parseTypes(n.gameTypesAfter),
      before: n.kind === 'removed' ? summarize(row.raw_json) : n.kind === 'changed' ? n.before : null,
      after: n.kind === 'added' ? summarize(row.raw_json) : n.kind === 'changed' ? n.after : null,
      unknownFields: n.unknownFields,
    };
  });

  const legacy = db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM item_changes WHERE update_id > ? AND update_id <= ? AND kind = 'changed' AND values_before IS NULL) AS legacy`,
    )
    .get(from.id, to.id) as { legacy: number };
  return { from, to, counts, items, total: selected.length, page: query.page, pageSize: query.pageSize, legacyValues: legacy.legacy === 1 };
}

const isDungeonGained = (n: NetChange) => n.kind === 'changed' && hasDungeon(n.gameTypesAfter) && !hasDungeon(n.gameTypesBefore);
const isDungeonLost = (n: NetChange) => n.kind === 'changed' && hasDungeon(n.gameTypesBefore) && !hasDungeon(n.gameTypesAfter);

interface ItemInfoRow {
  id: number;
  type: string;
  subtype: string | null;
  rarity: string;
  icon: string | null;
  removed: number;
  is_candidate: number;
  raw_json: string;
}

/** Die für den Vergleich relevanten Felder eines Items aus raw_json. */
function summarize(rawJson: string): Record<string, unknown> {
  const raw = JSON.parse(rawJson) as Record<string, unknown>;
  const details = raw.details as { type?: unknown } | undefined;
  const out: Record<string, unknown> = {};
  for (const field of ['name', 'game_types', 'flags', 'description', 'rarity']) {
    if (raw[field] !== undefined) out[field] = raw[field];
  }
  if (details?.type !== undefined) out['details.type'] = details.type;
  return out;
}

/** Zähler über das ganze Update, ohne Filter. */
function countChanges(db: DatabaseSync, updateId: number): UpdateChangeCounts {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(c.kind = 'added'), 0) AS added,
         COALESCE(SUM(c.kind = 'changed'), 0) AS changed,
         COALESCE(SUM(c.kind = 'removed'), 0) AS removed,
         COALESCE(SUM(${GAME_TYPES_CHANGED_SQL}), 0) AS game_types_changed,
         COALESCE(SUM(${DUNGEON_GAINED_SQL}), 0) AS dungeon_gained,
         COALESCE(SUM(${DUNGEON_LOST_SQL}), 0) AS dungeon_lost
       FROM item_changes c WHERE c.update_id = ?`,
    )
    .get(updateId) as Record<'added' | 'changed' | 'removed' | 'game_types_changed' | 'dungeon_gained' | 'dungeon_lost', number>;
  return {
    added: row.added,
    changed: row.changed,
    removed: row.removed,
    gameTypesChanged: row.game_types_changed,
    dungeonGained: row.dungeon_gained,
    dungeonLost: row.dungeon_lost,
  };
}

export function toUpdateSummary(row: UpdateRow): UpdateSummary {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    buildId: row.build_id,
    added: row.added,
    changed: row.changed,
    removed: row.removed,
  };
}
