import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  ChangeKind,
  GameType,
  Lang,
  Rarity,
  UpdateChangeCounts,
  UpdateChangeEntry,
  UpdateChangesResponse,
  UpdateCompareResponse,
  UpdateDetail,
  UpdateSummary,
} from '../../../shared/types.js';
import { parseUpdateChangesQuery, type ParsedUpdateChangesQuery } from '../../../shared/params.js';
import {
  aggregateRange,
  selectNetChanges,
  summarize,
  type RangeChange,
} from '../../../shared/changes.js';
import { nameSql, PLACEHOLDER_SQL, textsJoin, TONIC_SQL } from './items.js';

export { parseUpdateChangesQuery, type ParsedUpdateChangesQuery };

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
    before: row.kind === 'removed' ? summarizeJson(row.raw_json) : row.kind === 'changed' ? parseValues(row.values_before) : null,
    after: row.kind === 'added' ? summarizeJson(row.raw_json) : row.kind === 'changed' ? parseValues(row.values_after) : null,
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

const parseTypes = (json: string | null) => (json ? (JSON.parse(json) as GameType[]) : null);
const parseValues = (json: string | null) => (json ? (JSON.parse(json) as Record<string, unknown>) : null);

/**
 * Vergleicht den Stand nach Update from mit dem Stand nach Update to anhand der gespeicherten Änderungen
 * im Bereich (from, to]. Die Zusammenfassung (shared/changes.ts, dieselbe Logik wie in der statischen Fassung)
 * läuft in TypeScript: alle Änderungen des Bereichs laden, pro Item zusammenfassen, filtern, sortieren, paginieren.
 */
export function compareUpdates(db: DatabaseSync, from: UpdateDetail, to: UpdateDetail, query: ParsedUpdateChangesQuery): UpdateCompareResponse {
  const filter = itemFilter(query);
  const dbRows = db
    .prepare(
      `SELECT c.update_id, c.item_id, c.kind, c.changed_fields, c.game_types_before, c.game_types_after,
              c.values_before, c.values_after, ${nameSql(query.lang)} AS name, i.name AS name_en, (${filter.conditions.join(' AND ') || '1'}) AS matches
       ${fromChangesSql(query.lang)}
       WHERE c.update_id > ? AND c.update_id <= ?
       ORDER BY c.item_id, c.update_id`,
    )
    .all(...filter.params, from.id, to.id) as unknown as RangeRow[];
  const rows: RangeChange[] = dbRows.map((r) => ({
    updateId: r.update_id,
    itemId: r.item_id,
    kind: r.kind,
    changedFields: r.changed_fields ? (JSON.parse(r.changed_fields) as string[]) : null,
    gameTypesBefore: parseTypes(r.game_types_before),
    gameTypesAfter: parseTypes(r.game_types_after),
    valuesBefore: parseValues(r.values_before),
    valuesAfter: parseValues(r.values_after),
    name: r.name,
    nameEn: r.name_en,
    matches: r.matches === 1,
  }));

  // Gruppieren (Zeilen sind nach item_id sortiert), zusammenfassen und zählen (ungefiltert).
  const { all, counts } = aggregateRange(rows);
  const selected = selectNetChanges(all, query);

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
      gameTypesBefore: n.gameTypesBefore,
      gameTypesAfter: n.gameTypesAfter,
      before: n.kind === 'removed' ? summarizeJson(row.raw_json) : n.kind === 'changed' ? n.before : null,
      after: n.kind === 'added' ? summarizeJson(row.raw_json) : n.kind === 'changed' ? n.after : null,
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

/** Die für den Vergleich relevanten Felder eines Items aus raw_json (siehe summarize in shared/changes.ts). */
export const summarizeJson = (rawJson: string): Record<string, unknown> => summarize(JSON.parse(rawJson) as Record<string, unknown>);

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
