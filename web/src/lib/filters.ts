import type { GameType, ItemListQuery, ItemView, Lang, Rarity, TestStatus } from '../../../shared/types';
import {
    CONSUMABLE_SUBTYPES,
    GAME_TYPES,
    ITEM_SORTS,
    ITEM_TYPE_FILTER,
    RARITIES,
    hideCommonApplies,
    itemTypeFilterApplies,
    subtypeFilterApplies,
} from '../../../shared/rules';

// All list filters live in the URL so links are shareable and "Back" works.
// Default values are omitted from the URL.

// Rarities, game types and sort options come from shared/rules.ts (the same lists as on the server).
export { CONSUMABLE_SUBTYPES, GAME_TYPES, ITEM_TYPE_FILTER, RARITIES };
export const VIEWS: ItemView[] = ['gizmo', 'consumable', 'tonic', 'all'];
export const SORTS = ITEM_SORTS;
export const PAGE_SIZE = 50;

// NonNullable<T> removes null/undefined from T; `ListFilters[...]['x']` style lookups reuse types from the shared
// module.
// Candidate = an item whose game types contain Dungeon (see CLAUDE.md glossary).
export type Candidate = NonNullable<ItemListQuery['candidate']>;
// Item types of the tonic filter (Gizmo / Consumable) and consumable subtypes (`details.type`), see shared/rules.ts.
export type ItemTypeFilter = (typeof ITEM_TYPE_FILTER)[number];
export type ConsumableSubtype = (typeof CONSUMABLE_SUBTYPES)[number];
export type TestFilter = TestStatus | 'retest';
// `typeof SORTS` is the array type; `[number]` is an indexed access type that looks up its element type, i.e. the union
// of the allowed sort field strings.
export type SortField = (typeof SORTS)[number];

export interface ListFilters {
    view: ItemView;
    q: string;
    candidate: Candidate;
    hideCommon: boolean;
    hidePlaceholders: boolean;
    // Hide items whose English description says they are consumed automatically when acquired.
    hideAutoConsumed: boolean;
    // Hide guild hall items (guild upgrade) and Consumables/Gizmos that mention the homestead (housing instance).
    hideGuildHomestead: boolean;
    // Only used in the Tonics view (empty = both types).
    itemType: ItemTypeFilter[];
    // Only used in the Consumables view (empty = all subtypes).
    subtype: ConsumableSubtype[];
    rarity: Rarity[];
    gameType: GameType[];
    testStatus: TestFilter | null;
    updateId: number | null;
    includeRemoved: boolean;
    sort: SortField;
    order: 'asc' | 'desc';
    page: number;
}

export const DEFAULT_FILTERS: ListFilters = {
    view: 'gizmo',
    q: '',
    candidate: 'yes',
    hideCommon: true,
    hidePlaceholders: true,
    hideAutoConsumed: true,
    hideGuildHomestead: true,
    itemType: [],
    subtype: [],
    rarity: [],
    gameType: [],
    testStatus: null,
    updateId: null,
    includeRemoved: false,
    sort: 'name',
    order: 'asc',
    page: 1,
};

// Returns value if it is one of the allowed strings, otherwise undefined (guards against hand-edited URLs).
function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
    return allowed.find((option) => option === value);
}

// Parses a comma-separated list, keeping only allowed entries (in the order of `allowed`).
function listOf<T extends string>(value: string | null, allowed: readonly T[]): T[] {
    if (!value) return [];
    const parts = value.split(',');
    return allowed.filter((option) => parts.includes(option));
}

// Parses a positive integer; anything else (empty, negative, decimal, text) gives null.
function positiveInt(value: string | null): number | null {
    if (!value || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
}

/** Builds ListFilters from URL parameters; every missing or invalid value falls back to its default. */
// `as const` below makes the array a readonly tuple of literal types instead of string[].
export function parseFilters(params: URLSearchParams): ListFilters {
    const defaults = DEFAULT_FILTERS;
    return {
        view: oneOf(params.get('view'), VIEWS) ?? defaults.view,
        q: params.get('q') ?? '',
        candidate: oneOf(params.get('candidate'), ['yes', 'no', 'all'] as const) ?? defaults.candidate,
        hideCommon: params.get('hideCommon') !== 'false',
        hidePlaceholders: params.get('hidePlaceholders') !== 'false',
        hideAutoConsumed: params.get('hideAutoConsumed') !== 'false',
        hideGuildHomestead: params.get('hideGuildHomestead') !== 'false',
        itemType: listOf(params.get('itemType'), ITEM_TYPE_FILTER),
        subtype: listOf(params.get('subtype'), CONSUMABLE_SUBTYPES),
        rarity: listOf(params.get('rarity'), RARITIES),
        gameType: listOf(params.get('gameType'), GAME_TYPES),
        testStatus: oneOf(params.get('testStatus'), ['untested', 'works', 'broken', 'retest'] as const) ?? null,
        updateId: positiveInt(params.get('updateId')),
        includeRemoved: params.get('includeRemoved') === 'true',
        sort: oneOf(params.get('sort'), SORTS) ?? defaults.sort,
        order: params.get('order') === 'desc' ? 'desc' : 'asc',
        page: positiveInt(params.get('page')) ?? 1,
    };
}

/** URL parameters for the address bar (without default values). */
export function filtersToParams(filters: ListFilters): URLSearchParams {
    const defaults = DEFAULT_FILTERS;
    const params = new URLSearchParams();
    if (filters.view !== defaults.view) params.set('view', filters.view);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.candidate !== defaults.candidate) params.set('candidate', filters.candidate);
    if (!filters.hideCommon) params.set('hideCommon', 'false');
    if (!filters.hidePlaceholders) params.set('hidePlaceholders', 'false');
    if (!filters.hideAutoConsumed) params.set('hideAutoConsumed', 'false');
    if (!filters.hideGuildHomestead) params.set('hideGuildHomestead', 'false');
    // itemType and subtype are left out in views where they do not apply, so links stay clean.
    if (filters.itemType.length && itemTypeFilterApplies(filters.view))
        params.set('itemType', filters.itemType.join(','));
    if (filters.subtype.length && subtypeFilterApplies(filters.view)) params.set('subtype', filters.subtype.join(','));
    if (filters.rarity.length) params.set('rarity', filters.rarity.join(','));
    if (filters.gameType.length) params.set('gameType', filters.gameType.join(','));
    if (filters.testStatus) params.set('testStatus', filters.testStatus);
    if (filters.updateId !== null) params.set('updateId', String(filters.updateId));
    if (filters.includeRemoved) params.set('includeRemoved', 'true');
    if (filters.sort !== defaults.sort) params.set('sort', filters.sort);
    if (filters.order !== defaults.order) params.set('order', filters.order);
    if (filters.page > 1) params.set('page', String(filters.page));
    return params;
}

/** In-app path of the list page for these filters, e.g. "/?view=tonic&page=2". */
export function listUrl(filters: ListFilters): string {
    const queryString = filtersToParams(filters).toString();
    return queryString ? `/?${queryString}` : '/';
}

/** Query string for GET /api/items: all values explicit so the server does not have to guess defaults. */
export function toApiQuery(filters: ListFilters): string {
    const params = filtersToParams(filters);
    params.set('view', filters.view);
    params.set('candidate', filters.candidate);
    params.set('hideCommon', String(filters.hideCommon));
    params.set('hidePlaceholders', String(filters.hidePlaceholders));
    params.set('hideAutoConsumed', String(filters.hideAutoConsumed));
    params.set('hideGuildHomestead', String(filters.hideGuildHomestead));
    params.set('page', String(filters.page));
    params.set('pageSize', String(PAGE_SIZE));
    return params.toString();
}

/** URL for downloading the filtered list (all matches; the server ignores page/pageSize). */
export function exportUrl(filters: ListFilters, format: 'csv' | 'json', lang: Lang): string {
    return `/api/items/export?${toApiQuery(filters)}&lang=${lang}&format=${format}`;
}

/** The hideCommon filter only applies in the Consumables and All views. */
export function hasHideCommon(view: ItemView): boolean {
    return hideCommonApplies(view);
}

/** The item type filter is only shown in the Tonics view. */
export function hasItemTypeFilter(view: ItemView): boolean {
    return itemTypeFilterApplies(view);
}

/** The subtype filter is only shown in the Consumables view. */
export function hasSubtypeFilter(view: ItemView): boolean {
    return subtypeFilterApplies(view);
}

/** Number of active filters in the collapsible section (shown on the button). */
export function countExtraFilters(filters: ListFilters): number {
    let count = 0;
    if (filters.rarity.length) count++;
    if (filters.itemType.length && itemTypeFilterApplies(filters.view)) count++;
    if (filters.subtype.length && subtypeFilterApplies(filters.view)) count++;
    if (filters.gameType.length) count++;
    if (filters.testStatus) count++;
    if (filters.updateId !== null) count++;
    if (filters.includeRemoved) count++;
    if (hasHideCommon(filters.view) && !filters.hideCommon) count++;
    if (!filters.hidePlaceholders) count++;
    if (!filters.hideAutoConsumed) count++;
    if (!filters.hideGuildHomestead) count++;
    return count;
}
