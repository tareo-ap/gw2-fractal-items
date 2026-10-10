import type { ChangeFocus, ChangeKind, ItemView } from '../../../shared/types';
import { PAGE_SIZE, VIEWS } from './filters';

// Filters of the changes page /updates/:id. As in filters.ts they live in the URL; default values are omitted there.

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

export function parseChangesFilters(params: URLSearchParams): ChangesFilters {
  const kinds = (params.get('kind') ?? '').split(',');
  const page = Number(params.get('page'));
  return {
    kind: CHANGE_KINDS.filter((k) => kinds.includes(k)),
    focus: FOCUSES.find((f) => f === params.get('focus')) ?? 'all',
    type: VIEWS.find((v) => v === params.get('type')) ?? 'all',
    q: params.get('q') ?? '',
    hidePlaceholders: params.get('hidePlaceholders') !== 'false',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function changesToParams(f: ChangesFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.kind.length) p.set('kind', f.kind.join(','));
  if (f.focus !== 'all') p.set('focus', f.focus);
  if (f.type !== 'all') p.set('type', f.type);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (!f.hidePlaceholders) p.set('hidePlaceholders', 'false');
  if (f.page > 1) p.set('page', String(f.page));
  return p;
}

export function changesUrl(updateId: number, f: ChangesFilters = DEFAULT_CHANGES_FILTERS): string {
  const qs = changesToParams(f).toString();
  return qs ? `/updates/${updateId}?${qs}` : `/updates/${updateId}`;
}

/** Comparison of two states: /updates/compare?from=A&to=B plus filters. */
export function compareUrl(from: number, to: number, f: ChangesFilters = DEFAULT_CHANGES_FILTERS): string {
  const p = changesToParams(f);
  return `/updates/compare?from=${from}&to=${to}${p.size ? `&${p}` : ''}`;
}

/** Query string for GET /api/updates/:id/changes and /api/updates/compare (which add from and to). */
export function toChangesApiQuery(f: ChangesFilters): string {
  const p = changesToParams(f);
  p.set('hidePlaceholders', String(f.hidePlaceholders));
  p.set('page', String(f.page));
  p.set('pageSize', String(PAGE_SIZE));
  return p.toString();
}
