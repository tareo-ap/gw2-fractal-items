import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  ChangeKind,
  GameType,
  Rarity,
  UpdateChangeCounts,
  UpdateChangeEntry,
  UpdateChangesQuery,
  UpdateChangesResponse,
  UpdateDetail,
  UpdateSummary,
} from '../../../shared/types.js';
import { bool, int, list, oneOf, PLACEHOLDER_SQL, TONIC_SQL } from './items.js';

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

type UpdateRowWithDungeon = UpdateRow & { dungeon_gained: number; dungeon_lost: number };

function selectUpdates(db: DatabaseSync, id?: number): UpdateDetail[] {
  const rows = db
    .prepare(
      `SELECT u.*,
         (SELECT COUNT(*) FROM item_changes c WHERE c.update_id = u.id AND ${DUNGEON_GAINED_SQL}) AS dungeon_gained,
         (SELECT COUNT(*) FROM item_changes c WHERE c.update_id = u.id AND ${DUNGEON_LOST_SQL}) AS dungeon_lost
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
  }));
}

export function listUpdates(db: DatabaseSync): UpdateDetail[] {
  return selectUpdates(db);
}

export function getUpdate(db: DatabaseSync, id: number): UpdateDetail | null {
  return selectUpdates(db, id)[0] ?? null;
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
  type: string;
  subtype: string | null;
  rarity: string;
  icon: string | null;
  removed: number;
  is_candidate: number;
}

const FROM_CHANGES_SQL = 'FROM item_changes c JOIN items i ON i.id = c.item_id';

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

  if (query.type === 'gizmo') where.push(`i.type = 'Gizmo'`);
  if (query.type === 'consumable') where.push(`i.type = 'Consumable'`);
  if (query.type === 'tonic') where.push(TONIC_SQL);
  if (query.hidePlaceholders) where.push(`NOT ${PLACEHOLDER_SQL}`);
  if (query.q) {
    // %, _ und \ sind in LIKE Sonderzeichen und werden mit \ maskiert. Eine reine Zahl findet zusätzlich die ID.
    const pattern = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    if (/^\d+$/.test(query.q)) {
      where.push(`(i.name LIKE ? ESCAPE '\\' OR i.id = ?)`);
      params.push(pattern, Number(query.q));
    } else {
      where.push(`i.name LIKE ? ESCAPE '\\'`);
      params.push(pattern);
    }
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${FROM_CHANGES_SQL} ${whereSql}`).get(...params) as { total: number };

  // Dungeon-Änderungen zuerst, dann geändert, neu, entfernt, dann nach Name.
  const rows = db
    .prepare(
      `SELECT c.item_id, c.kind, c.changed_fields, c.game_types_before, c.game_types_after,
              c.values_before, c.values_after, i.raw_json,
              i.name, i.type, i.subtype, i.rarity, i.icon, i.removed, i.is_candidate
       ${FROM_CHANGES_SQL} ${whereSql}
       ORDER BY CASE WHEN (${DUNGEON_GAINED_SQL}) OR (${DUNGEON_LOST_SQL}) THEN 0 ELSE 1 END,
                CASE c.kind WHEN 'changed' THEN 0 WHEN 'added' THEN 1 ELSE 2 END,
                i.name COLLATE NOCASE, i.id
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as unknown as ChangeRow[];

  const parseTypes = (json: string | null) => (json ? (JSON.parse(json) as GameType[]) : null);
  const parseValues = (json: string | null) => (json ? (JSON.parse(json) as Record<string, unknown>) : null);
  const items: UpdateChangeEntry[] = rows.map((row) => ({
    id: row.item_id,
    name: row.name,
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

  return { update, counts: countChanges(db, update.id), items, total, page: query.page, pageSize: query.pageSize };
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
