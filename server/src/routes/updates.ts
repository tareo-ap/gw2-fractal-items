import type { DatabaseSync } from 'node:sqlite';
import type { UpdateDetail, UpdateSummary } from '../../../shared/types.js';

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

export function listUpdates(db: DatabaseSync): UpdateDetail[] {
  const rows = db
    .prepare(
      `SELECT u.*,
         (SELECT COUNT(*) FROM item_changes c WHERE c.update_id = u.id AND c.kind = 'changed'
            AND ${HAS_DUNGEON('game_types_after')} AND NOT ${HAS_DUNGEON('game_types_before')}) AS dungeon_gained,
         (SELECT COUNT(*) FROM item_changes c WHERE c.update_id = u.id AND c.kind = 'changed'
            AND ${HAS_DUNGEON('game_types_before')} AND NOT ${HAS_DUNGEON('game_types_after')}) AS dungeon_lost
       FROM updates u
       ORDER BY u.id DESC`,
    )
    .all() as unknown as (UpdateRow & { dungeon_gained: number; dungeon_lost: number })[];

  return rows.map((row) => ({
    ...toUpdateSummary(row),
    status: row.status,
    error: row.error,
    dungeonGained: row.dungeon_gained,
    dungeonLost: row.dungeon_lost,
  }));
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
