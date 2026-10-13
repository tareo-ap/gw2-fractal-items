// Parse the query parameters of GET /api/items and /api/updates/:id/changes and fill in defaults.
// The server reads the HTTP query with it, the static version in the browser the same query string.

import type { ChangeKind, ItemListQuery, Lang, UpdateChangesQuery } from './types.js';
import { CONSUMABLE_SUBTYPES, GAME_TYPES, ITEM_SORTS, ITEM_TYPE_FILTER, RARITIES, TEST_STATUSES } from './rules.js';

// Notes: query parameters arrive as plain strings (or undefined if missing); the helpers below validate
// them and convert them to typed values. `<T extends string>` is a generic: T is the union of allowed strings.

/** Error in the input, answered with HTTP 400. */
export class ValidationError extends Error {}

/** Allowed values of the lang parameter. */
const LANGS: readonly Lang[] = ['en', 'de'];
/** Allowed values of the kind parameter. */
export const CHANGE_KIND_VALUES: readonly ChangeKind[] = ['added', 'changed', 'removed'];

/** Value must be one of allowed (empty/missing = undefined). Throws ValidationError otherwise. */
export function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
    if (value === undefined || value === '') return undefined;
    if (!(allowed as readonly string[]).includes(value)) {
        throw new ValidationError(`${name} must be one of: ${allowed.join(', ')}`);
    }
    return value as T;
}

/** Parses "true"/"1" and "false"/"0" (empty/missing = undefined). Throws ValidationError otherwise. */
export function bool(name: string, value: string | undefined): boolean | undefined {
    if (value === undefined || value === '') return undefined;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new ValidationError(`${name} must be true or false`);
}

/** Parses an integer ≥ min. Throws ValidationError otherwise. */
export function int(name: string, value: string, min: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min) throw new ValidationError(`${name} must be an integer ≥ ${min}`);
    return parsed;
}

/** Parses a comma-separated list; every entry must be in allowed (missing = empty list). */
export function list<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T[] {
    if (!value) return [];
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
        .map((entry) => oneOf(name, entry, allowed)!);
}

/** Reads the lang parameter (default en). Throws ValidationError. */
export function parseLang(value: string | undefined): Lang {
    return oneOf('lang', value, LANGS) ?? 'en';
}

/**
 * ItemListQuery with defaults filled in; only q, testStatus and updateId stay optional.
 * Utility types: `Omit<T, K>` drops properties, `Required<T>` makes all of them mandatory,
 * `Pick<T, K>` keeps only the listed ones.
 */
export type ParsedItemListQuery = Required<Omit<ItemListQuery, 'q' | 'testStatus' | 'updateId'>> &
    Pick<ItemListQuery, 'q' | 'testStatus' | 'updateId'>;

/** Reads the query parameters of GET /api/items and fills in defaults. Throws ValidationError. */
export function parseItemListQuery(params: Record<string, string | undefined>): ParsedItemListQuery {
    const q = params.q?.trim();
    // `as const` narrows the array to a tuple of literals, so oneOf infers the union type of its entries.
    return {
        q: q ? q : undefined,
        lang: parseLang(params.lang),
        view: oneOf('view', params.view, ['gizmo', 'consumable', 'tonic', 'all'] as const) ?? 'gizmo',
        candidate: oneOf('candidate', params.candidate, ['yes', 'no', 'all'] as const) ?? 'yes',
        hideCommon: bool('hideCommon', params.hideCommon) ?? true,
        hidePlaceholders: bool('hidePlaceholders', params.hidePlaceholders) ?? true,
        hideAutoConsumed: bool('hideAutoConsumed', params.hideAutoConsumed) ?? true,
        hideGuildHomestead: bool('hideGuildHomestead', params.hideGuildHomestead) ?? true,
        itemType: list('itemType', params.itemType, ITEM_TYPE_FILTER),
        subtype: list('subtype', params.subtype, CONSUMABLE_SUBTYPES),
        rarity: list('rarity', params.rarity, RARITIES),
        gameType: list('gameType', params.gameType, GAME_TYPES),
        testStatus: oneOf('testStatus', params.testStatus, [...TEST_STATUSES, 'retest'] as const),
        updateId: params.updateId ? int('updateId', params.updateId, 1) : undefined,
        includeRemoved: bool('includeRemoved', params.includeRemoved) ?? false,
        sort: oneOf('sort', params.sort, ITEM_SORTS) ?? 'name',
        order: oneOf('order', params.order, ['asc', 'desc'] as const) ?? 'asc',
        page: params.page ? int('page', params.page, 1) : 1,
        pageSize: params.pageSize ? Math.min(int('pageSize', params.pageSize, 1), 200) : 50,
    };
}

/** UpdateChangesQuery with defaults filled in; only q stays optional. */
export type ParsedUpdateChangesQuery = Required<Omit<UpdateChangesQuery, 'q'>> & Pick<UpdateChangesQuery, 'q'>;

/** Reads the query parameters of GET /api/updates/:id/changes and fills in defaults. Throws ValidationError. */
export function parseUpdateChangesQuery(params: Record<string, string | undefined>): ParsedUpdateChangesQuery {
    const q = params.q?.trim();
    return {
        lang: parseLang(params.lang),
        kind: list('kind', params.kind, CHANGE_KIND_VALUES),
        focus: oneOf('focus', params.focus, ['all', 'gameTypes', 'dungeonGained', 'dungeonLost'] as const) ?? 'all',
        type: oneOf('type', params.type, ['gizmo', 'consumable', 'tonic', 'all'] as const) ?? 'all',
        q: q ? q : undefined,
        hidePlaceholders: bool('hidePlaceholders', params.hidePlaceholders) ?? true,
        page: params.page ? int('page', params.page, 1) : 1,
        pageSize: params.pageSize ? Math.min(int('pageSize', params.pageSize, 1), 200) : 50,
    };
}
