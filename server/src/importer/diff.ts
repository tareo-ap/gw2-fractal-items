import { createHash } from 'node:crypto';
import type { Gw2Item } from '../gw2/client.js';

/**
 * JSON mit rekursiv sortierten Objekt-Keys. Die API garantiert keine feste Key-Reihenfolge,
 * ohne Sortierung würde dasselbe Item sonst unterschiedliche Hashes bekommen.
 * Reihenfolgen in Arrays bleiben erhalten (die können inhaltlich relevant sein).
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashItem(item: Gw2Item): string {
  return createHash('sha256').update(stableStringify(item)).digest('hex');
}

/** Top-Level-Felder, die sich zwischen alter und neuer API-Antwort unterscheiden (sortiert). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => stableStringify(before[key]) !== stableStringify(after[key])).sort();
}

/** Bisheriger Stand eines Items in der DB, soweit für den Vergleich nötig. */
export interface StoredItem {
  hash: string;
  rawJson: string;
  removed: boolean;
  gameTypes: string[];
}

export type ItemDiff =
  | { kind: 'unchanged' }
  | { kind: 'added'; gameTypesAfter: string[] }
  | { kind: 'changed'; changedFields: string[]; gameTypesBefore: string[]; gameTypesAfter: string[] };

/**
 * Vergleicht ein frisch geladenes Item mit dem gespeicherten Stand.
 * - kein gespeicherter Stand → added
 * - war als entfernt markiert und ist wieder da → ebenfalls added
 * - Hash unterschiedlich → changed, mit Liste der geänderten Top-Level-Felder
 */
export function diffItem(stored: StoredItem | undefined, item: Gw2Item, hash: string): ItemDiff {
  const gameTypesAfter = normalizeGameTypes(item.game_types);
  if (!stored || stored.removed) return { kind: 'added', gameTypesAfter };
  if (stored.hash === hash) return { kind: 'unchanged' };
  const before = JSON.parse(stored.rawJson) as Record<string, unknown>;
  return {
    kind: 'changed',
    changedFields: changedFields(before, item),
    gameTypesBefore: stored.gameTypes,
    gameTypesAfter,
  };
}

/**
 * game_types sortiert und ohne Duplikate. So gespeichert lassen sich zwei Stände
 * per einfachem String-Vergleich als Menge vergleichen (wichtig für "neu testen").
 */
export function normalizeGameTypes(gameTypes: unknown): string[] {
  if (!Array.isArray(gameTypes)) return [];
  return [...new Set(gameTypes.filter((t): t is string => typeof t === 'string'))].sort();
}
