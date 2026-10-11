import type { ChangeFocus, ChangeKind, ItemView } from '../../../shared/types';
import { PAGE_SIZE, VIEWS } from './filters';

// Filters of the changes page /updates/:id. As in filters.ts they live in the URL; default values are omitted there.

// ChangeKind / ChangeFocus are string-literal union types from shared/types.ts (like a Java enum, but plain strings).
export const CHANGE_KINDS: ChangeKind[] = ['changed', 'added', 'removed'];
export const FOCUSES: ChangeFocus[] = ['all', 'gameTypes', 'dungeonGained', 'dungeonLost'];

export interface ChangesFilters {
    kind: ChangeKind[]; // empty = all kinds
    focus: ChangeFocus;
    type: ItemView;
    q: string;
    hidePlaceholders: boolean;
    page: number;
}

export const DEFAULT_CHANGES_FILTERS: ChangesFilters = {
    kind: [],
    focus: 'all',
    type: 'all',
    q: '',
    hidePlaceholders: true,
    page: 1,
};

/** Reads the filters from the URL query parameters; invalid or missing values fall back to defaults. */
export function parseChangesFilters(params: URLSearchParams): ChangesFilters {
    // Whitelist: keep only known kinds, in canonical order.
    const kinds = (params.get('kind') ?? '').split(',');
    const page = Number(params.get('page'));
    return {
        kind: CHANGE_KINDS.filter((kindName) => kinds.includes(kindName)),
        focus: FOCUSES.find((focus) => focus === params.get('focus')) ?? 'all',
        type: VIEWS.find((view) => view === params.get('type')) ?? 'all',
        q: params.get('q') ?? '',
        hidePlaceholders: params.get('hidePlaceholders') !== 'false',
        page: Number.isInteger(page) && page > 0 ? page : 1,
    };
}

/** Inverse of parseChangesFilters: URL parameters without default values. */
export function changesToParams(filters: ChangesFilters): URLSearchParams {
    const params = new URLSearchParams();
    if (filters.kind.length) params.set('kind', filters.kind.join(','));
    if (filters.focus !== 'all') params.set('focus', filters.focus);
    if (filters.type !== 'all') params.set('type', filters.type);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (!filters.hidePlaceholders) params.set('hidePlaceholders', 'false');
    if (filters.page > 1) params.set('page', String(filters.page));
    return params;
}

/** Path (with query string) of the changes page of one update. */
export function changesUrl(updateId: number, filters: ChangesFilters = DEFAULT_CHANGES_FILTERS): string {
    const queryString = changesToParams(filters).toString();
    return queryString ? `/updates/${updateId}?${queryString}` : `/updates/${updateId}`;
}

/** Comparison of two states: /updates/compare?from=A&to=B plus filters. */
export function compareUrl(from: number, to: number, filters: ChangesFilters = DEFAULT_CHANGES_FILTERS): string {
    const params = changesToParams(filters);
    return `/updates/compare?from=${from}&to=${to}${params.size ? `&${params}` : ''}`;
}

/** Query string for GET /api/updates/:id/changes and /api/updates/compare (which add from and to). */
export function toChangesApiQuery(filters: ChangesFilters): string {
    const params = changesToParams(filters);
    params.set('hidePlaceholders', String(filters.hidePlaceholders));
    params.set('page', String(filters.page));
    params.set('pageSize', String(PAGE_SIZE));
    return params.toString();
}
