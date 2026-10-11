import { createHash } from 'node:crypto';
import type { Gw2Item } from '../gw2/client.js';

/**
 * JSON with recursively sorted object keys. The API does not guarantee a fixed key order,
 * without sorting the same item could get different hashes.
 * Array order is preserved (it can be relevant).
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

/** SHA-256 hex digest of the item's stable JSON; used to detect changes cheaply. */
export function hashItem(item: Gw2Item): string {
    return createHash('sha256').update(stableStringify(item)).digest('hex');
}

/** Top-level fields that differ between the old and new API response (sorted). */
// Compares each key by its stable JSON, so nested objects are compared by value.
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => stableStringify(before[key]) !== stableStringify(after[key])).sort();
}

/** Previous state of an item in the DB, as far as needed for the comparison. */
export interface StoredItem {
    hash: string;
    rawJson: string;
    removed: boolean;
    gameTypes: string[];
}

// Discriminated union: `kind` tells which fields are present.
export type ItemDiff =
    | { kind: 'unchanged' }
    | { kind: 'added'; gameTypesAfter: string[] }
    | {
          kind: 'changed';
          changedFields: string[];
          gameTypesBefore: string[];
          gameTypesAfter: string[];
          /** Only the changed top-level fields with their old and new value (missing field = not present). */
          valuesBefore: Record<string, unknown>;
          valuesAfter: Record<string, unknown>;
      };

/**
 * Compares a freshly loaded item with the stored state.
 * - no stored state -> added
 * - was marked as removed and is back -> also added
 * - hash differs -> changed, with a list of the changed top-level fields
 */
export function diffItem(stored: StoredItem | undefined, item: Gw2Item, hash: string): ItemDiff {
    const gameTypesAfter = normalizeGameTypes(item.game_types);
    if (!stored || stored.removed) return { kind: 'added', gameTypesAfter };
    if (stored.hash === hash) return { kind: 'unchanged' };
    const before = JSON.parse(stored.rawJson) as Record<string, unknown>;
    const fields = changedFields(before, item);
    // Keeps only the changed fields of an object.
    const pick = (source: Record<string, unknown>) =>
        Object.fromEntries(
            fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]),
        );
    return {
        kind: 'changed',
        changedFields: fields,
        gameTypesBefore: stored.gameTypes,
        gameTypesAfter,
        valuesBefore: pick(before),
        valuesAfter: pick(item),
    };
}

/**
 * game_types sorted and without duplicates. Stored this way, two states can be
 * compared as sets with a plain string comparison (important for "retest").
 */
export function normalizeGameTypes(gameTypes: unknown): string[] {
    if (!Array.isArray(gameTypes)) return [];
    return [...new Set(gameTypes.filter((gameType): gameType is string => typeof gameType === 'string'))].sort();
}
