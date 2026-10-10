// Logic of the changes page shared by the server and the static version:
// Dungeon gained/lost, merging several updates into one net change (comparison of two states)
// and the selection and sorting of the entries.

import type { ChangeFocus, ChangeKind, GameType, UpdateChangeCounts } from './types.js';
import { compareNoCase, hasDungeon, stableStringify } from './rules.js';

/** A row from item_changes with parsed JSON columns. */
export interface ChangeRow {
  updateId: number;
  itemId: number;
  kind: ChangeKind;
  changedFields: string[] | null;
  gameTypesBefore: GameType[] | null;
  gameTypesAfter: GameType[] | null;
  valuesBefore: Record<string, unknown> | null;
  valuesAfter: Record<string, unknown> | null;
}

/** game_types are sorted arrays (see normalizeGameTypes): same order = same set. */
export function sameGameTypes(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Only changed items (kind = 'changed') are counted where "Dungeon" was added to or removed from
// game_types. New and removed items are already in added/removed;
// otherwise every candidate would be a "Dungeon gained" on the first full import.
interface DungeonView {
  kind: ChangeKind;
  gameTypesBefore: readonly string[] | null;
  gameTypesAfter: readonly string[] | null;
}

export const isDungeonGained = (c: DungeonView): boolean => c.kind === 'changed' && hasDungeon(c.gameTypesAfter) && !hasDungeon(c.gameTypesBefore);
export const isDungeonLost = (c: DungeonView): boolean => c.kind === 'changed' && hasDungeon(c.gameTypesBefore) && !hasDungeon(c.gameTypesAfter);

/**
 * game_types really changed: a pure reordering in the API response is listed in changed_fields,
 * but does not count here.
 */
export const isGameTypesChanged = (c: DungeonView & { changedFields: readonly string[] | null }): boolean =>
  c.kind === 'changed' && (c.changedFields?.includes('game_types') ?? false) && !sameGameTypes(c.gameTypesBefore, c.gameTypesAfter);

/** Counters over the rows of a single update. */
export function countChangeRows(rows: readonly (DungeonView & { changedFields: readonly string[] | null })[]): UpdateChangeCounts {
  const counts: UpdateChangeCounts = { added: 0, changed: 0, removed: 0, gameTypesChanged: 0, dungeonGained: 0, dungeonLost: 0 };
  for (const row of rows) {
    counts[row.kind]++;
    if (isGameTypesChanged(row)) counts.gameTypesChanged++;
    if (isDungeonGained(row)) counts.dungeonGained++;
    if (isDungeonLost(row)) counts.dungeonLost++;
  }
  return counts;
}

/** Does the row match the focus filter (only kind=changed can belong, except for 'all')? */
export function matchesFocus(focus: ChangeFocus, c: DungeonView & { changedFields: readonly string[] | null }): boolean {
  if (focus === 'gameTypes') return isGameTypesChanged(c);
  if (focus === 'dungeonGained') return isDungeonGained(c);
  if (focus === 'dungeonLost') return isDungeonLost(c);
  return true;
}

export const CHANGE_KIND_RANK: Record<ChangeKind, number> = { changed: 0, added: 1, removed: 2 };

/** Sort order of the entries: Dungeon changes first, then changed, new, removed, then by name and ID. */
export function compareChangeEntries(
  a: DungeonView & { name: string; itemId: number },
  b: DungeonView & { name: string; itemId: number },
): number {
  const dungeon = (c: DungeonView) => Number(isDungeonGained(c) || isDungeonLost(c));
  return (
    dungeon(b) - dungeon(a) ||
    CHANGE_KIND_RANK[a.kind] - CHANGE_KIND_RANK[b.kind] ||
    compareNoCase(a.name, b.name) ||
    a.itemId - b.itemId
  );
}

/** The fields of an item relevant for the comparison, from the raw API response. */
export function summarize(raw: Record<string, unknown>): Record<string, unknown> {
  const details = raw.details as { type?: unknown } | undefined;
  const out: Record<string, unknown> = {};
  for (const field of ['name', 'game_types', 'flags', 'description', 'rarity']) {
    if (raw[field] !== undefined) out[field] = raw[field];
  }
  if (details?.type !== undefined) out['details.type'] = details.type;
  return out;
}

// ---------------------------------------------------------------------------
// Comparison of two states
// ---------------------------------------------------------------------------

/** Change row with the item's name and whether it satisfies the item filters (type, search …). */
export interface RangeChange extends ChangeRow {
  name: string;
  nameEn: string;
  matches: boolean;
}

/** Net change of an item across all updates in the range (from, to]. */
export interface NetChange {
  itemId: number;
  name: string;
  nameEn: string;
  matches: boolean;
  kind: ChangeKind;
  gameTypesBefore: GameType[] | null;
  gameTypesAfter: GameType[] | null;
  gameTypesChanged: boolean;
  changedFields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  unknownFields: string[];
}

/**
 * Summarizes the changes of an item (sorted by updateId):
 * - first change added and last removed: existed in neither state, dropped
 * - first added: new; otherwise last removed: removed; otherwise changed
 * - game_types: before = value of the first, after = value of the last change; net equal = no change
 * - fields: old value from the first, new value from the last change that touches the field; net-equal ones are dropped
 */
export function aggregateChanges(rows: RangeChange[]): NetChange | null {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  if (first.kind === 'added' && last.kind === 'removed') return null;
  const kind: ChangeKind = first.kind === 'added' ? 'added' : last.kind === 'removed' ? 'removed' : 'changed';

  const net: NetChange = {
    itemId: first.itemId,
    name: first.name,
    nameEn: first.nameEn,
    matches: first.matches,
    kind,
    gameTypesBefore: kind === 'added' ? null : first.gameTypesBefore,
    gameTypesAfter: kind === 'removed' ? null : last.gameTypesAfter,
    gameTypesChanged: false,
    changedFields: [],
    before: {},
    after: {},
    unknownFields: [],
  };
  if (kind !== 'changed') return net;

  net.gameTypesChanged = !sameGameTypes(net.gameTypesBefore, net.gameTypesAfter);
  if (net.gameTypesChanged) net.changedFields.push('game_types');

  // Removed in between and back again: no field values are stored for that, the entry stays anyway.
  const changedRows = rows.filter((r) => r.kind === 'changed');
  const fieldsOf = (r: RangeChange) => r.changedFields ?? [];
  const names = [...new Set(changedRows.flatMap(fieldsOf))].filter((n) => n !== 'game_types').sort();
  for (const name of names) {
    const firstRow = changedRows.find((r) => fieldsOf(r).includes(name))!;
    const lastRow = [...changedRows].reverse().find((r) => fieldsOf(r).includes(name))!;
    if (firstRow.valuesBefore === null || lastRow.valuesAfter === null) {
      net.changedFields.push(name);
      net.unknownFields.push(name);
      continue;
    }
    const oldValue = firstRow.valuesBefore[name];
    const newValue = lastRow.valuesAfter[name];
    if (stableStringify(oldValue) === stableStringify(newValue)) continue;
    net.changedFields.push(name);
    if (oldValue !== undefined) net.before[name] = oldValue;
    if (newValue !== undefined) net.after[name] = newValue;
  }
  if (net.changedFields.length === 0 && changedRows.length === rows.length) return null;
  return net;
}

/**
 * Groups the rows of the range (sorted by itemId, updateId) per item, summarizes them and counts
 * (unfiltered). Returns the net changes in item order.
 */
export function aggregateRange(rows: RangeChange[]): { all: NetChange[]; counts: UpdateChangeCounts } {
  const all: NetChange[] = [];
  const counts: UpdateChangeCounts = { added: 0, changed: 0, removed: 0, gameTypesChanged: 0, dungeonGained: 0, dungeonLost: 0 };
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i < rows.length && rows[i]!.itemId === rows[start]!.itemId) continue;
    const net = aggregateChanges(rows.slice(start, i));
    start = i;
    if (!net) continue;
    all.push(net);
    counts[net.kind]++;
    if (net.gameTypesChanged) counts.gameTypesChanged++;
    if (isDungeonGained(net)) counts.dungeonGained++;
    if (isDungeonLost(net)) counts.dungeonLost++;
  }
  return { all, counts };
}

/** Filters (item filter, kind, focus) and sorts the net changes. */
export function selectNetChanges(all: NetChange[], query: { kind: readonly ChangeKind[]; focus: ChangeFocus }): NetChange[] {
  return all
    .filter((n) => n.matches && (query.kind.length === 0 || query.kind.includes(n.kind)) && matchesFocus(query.focus, n))
    .sort((a, b) => compareChangeEntries(a, b));
}
