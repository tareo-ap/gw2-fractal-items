// Logik der Änderungsseite, die Server und statische Fassung gemeinsam nutzen:
// Dungeon dazu/weg, Zusammenfassen mehrerer Updates zu einer Netto-Änderung (Vergleich zweier Stände)
// und die Auswahl samt Sortierung der Einträge.

import type { ChangeFocus, ChangeKind, GameType, UpdateChangeCounts } from './types.js';
import { compareNoCase, hasDungeon, stableStringify } from './rules.js';

/** Eine Zeile aus item_changes mit geparsten JSON-Spalten. */
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

/** game_types sind sortierte Arrays (siehe normalizeGameTypes): gleiche Reihenfolge = gleiche Menge. */
export function sameGameTypes(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Gezählt werden nur geänderte Items (kind = 'changed'), bei denen "Dungeon" in game_types
// dazugekommen bzw. weggefallen ist. Neue und entfernte Items stehen schon in added/removed;
// sonst wäre beim ersten Vollimport jeder Kandidat ein "Dungeon gewonnen".
interface DungeonView {
  kind: ChangeKind;
  gameTypesBefore: readonly string[] | null;
  gameTypesAfter: readonly string[] | null;
}

export const isDungeonGained = (c: DungeonView): boolean => c.kind === 'changed' && hasDungeon(c.gameTypesAfter) && !hasDungeon(c.gameTypesBefore);
export const isDungeonLost = (c: DungeonView): boolean => c.kind === 'changed' && hasDungeon(c.gameTypesBefore) && !hasDungeon(c.gameTypesAfter);

/**
 * game_types wirklich geändert: Eine reine Umsortierung in der API-Antwort steht zwar in changed_fields,
 * zählt hier aber nicht.
 */
export const isGameTypesChanged = (c: DungeonView & { changedFields: readonly string[] | null }): boolean =>
  c.kind === 'changed' && (c.changedFields?.includes('game_types') ?? false) && !sameGameTypes(c.gameTypesBefore, c.gameTypesAfter);

/** Zähler über die Zeilen eines einzelnen Updates. */
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

/** Trifft die Zeile den Fokus-Filter (nur kind=changed kann dazugehören, außer bei 'all')? */
export function matchesFocus(focus: ChangeFocus, c: DungeonView & { changedFields: readonly string[] | null }): boolean {
  if (focus === 'gameTypes') return isGameTypesChanged(c);
  if (focus === 'dungeonGained') return isDungeonGained(c);
  if (focus === 'dungeonLost') return isDungeonLost(c);
  return true;
}

export const CHANGE_KIND_RANK: Record<ChangeKind, number> = { changed: 0, added: 1, removed: 2 };

/** Sortierung der Einträge: Dungeon-Änderungen zuerst, dann geändert, neu, entfernt, dann nach Name und ID. */
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

/** Die für den Vergleich relevanten Felder eines Items aus der rohen API-Antwort. */
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
// Vergleich zweier Stände
// ---------------------------------------------------------------------------

/** Änderungszeile samt Name des Items und der Info, ob es die Item-Filter (Typ, Suche …) erfüllt. */
export interface RangeChange extends ChangeRow {
  name: string;
  nameEn: string;
  matches: boolean;
}

/** Netto-Änderung eines Items über alle Updates im Bereich (from, to]. */
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
 * Fasst die Änderungen eines Items (nach updateId sortiert) zusammen:
 * - erste Änderung added und letzte removed: gab es in keinem der beiden Stände, entfällt
 * - erste added: neu; sonst letzte removed: entfernt; sonst geändert
 * - game_types: vorher der Wert der ersten, nachher der Wert der letzten Änderung; netto gleich = keine Änderung
 * - Felder: alter Wert aus der ersten, neuer Wert aus der letzten Änderung, die das Feld betrifft; netto gleiche entfallen
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

  // Zwischenzeitlich entfernt und wieder da: Dafür sind keine Feldwerte gespeichert, der Eintrag bleibt trotzdem.
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
 * Gruppiert die Zeilen des Bereichs (nach itemId, updateId sortiert) pro Item, fasst sie zusammen und zählt
 * (ungefiltert). Gibt die Netto-Änderungen in der Reihenfolge der Items zurück.
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

/** Filtert (Item-Filter, Art, Fokus) und sortiert die Netto-Änderungen. */
export function selectNetChanges(all: NetChange[], query: { kind: readonly ChangeKind[]; focus: ChangeFocus }): NetChange[] {
  return all
    .filter((n) => n.matches && (query.kind.length === 0 || query.kind.includes(n.kind)) && matchesFocus(query.focus, n))
    .sort((a, b) => compareChangeEntries(a, b));
}
