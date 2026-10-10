import type { GameType, ItemListQuery, ItemView, Lang, Rarity, TestStatus } from '../../../shared/types';
import { GAME_TYPES, ITEM_SORTS, RARITIES, hideCommonApplies } from '../../../shared/rules';

// All list filters live in the URL so links are shareable and "Back" works.
// Default values are omitted from the URL.

// Rarities, game types and sort options come from shared/rules.ts (the same lists as on the server).
export { GAME_TYPES, RARITIES };
export const VIEWS: ItemView[] = ['gizmo', 'consumable', 'tonic', 'all'];
export const SORTS = ITEM_SORTS;
export const PAGE_SIZE = 50;

export type Candidate = NonNullable<ItemListQuery['candidate']>;
export type TestFilter = TestStatus | 'retest';
export type SortField = (typeof SORTS)[number];

export interface ListFilters {
  view: ItemView;
  q: string;
  candidate: Candidate;
  hideCommon: boolean;
  hidePlaceholders: boolean;
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
  rarity: [],
  gameType: [],
  testStatus: null,
  updateId: null,
  includeRemoved: false,
  sort: 'name',
  order: 'asc',
  page: 1,
};

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((a) => a === value);
}

function listOf<T extends string>(value: string | null, allowed: readonly T[]): T[] {
  if (!value) return [];
  const parts = value.split(',');
  return allowed.filter((a) => parts.includes(a));
}

function positiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

export function parseFilters(params: URLSearchParams): ListFilters {
  const d = DEFAULT_FILTERS;
  return {
    view: oneOf(params.get('view'), VIEWS) ?? d.view,
    q: params.get('q') ?? '',
    candidate: oneOf(params.get('candidate'), ['yes', 'no', 'all'] as const) ?? d.candidate,
    hideCommon: params.get('hideCommon') !== 'false',
    hidePlaceholders: params.get('hidePlaceholders') !== 'false',
    rarity: listOf(params.get('rarity'), RARITIES),
    gameType: listOf(params.get('gameType'), GAME_TYPES),
    testStatus: oneOf(params.get('testStatus'), ['untested', 'works', 'broken', 'retest'] as const) ?? null,
    updateId: positiveInt(params.get('updateId')),
    includeRemoved: params.get('includeRemoved') === 'true',
    sort: oneOf(params.get('sort'), SORTS) ?? d.sort,
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    page: positiveInt(params.get('page')) ?? 1,
  };
}

/** URL parameters for the address bar (without default values). */
export function filtersToParams(f: ListFilters): URLSearchParams {
  const d = DEFAULT_FILTERS;
  const p = new URLSearchParams();
  if (f.view !== d.view) p.set('view', f.view);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.candidate !== d.candidate) p.set('candidate', f.candidate);
  if (!f.hideCommon) p.set('hideCommon', 'false');
  if (!f.hidePlaceholders) p.set('hidePlaceholders', 'false');
  if (f.rarity.length) p.set('rarity', f.rarity.join(','));
  if (f.gameType.length) p.set('gameType', f.gameType.join(','));
  if (f.testStatus) p.set('testStatus', f.testStatus);
  if (f.updateId !== null) p.set('updateId', String(f.updateId));
  if (f.includeRemoved) p.set('includeRemoved', 'true');
  if (f.sort !== d.sort) p.set('sort', f.sort);
  if (f.order !== d.order) p.set('order', f.order);
  if (f.page > 1) p.set('page', String(f.page));
  return p;
}

export function listUrl(f: ListFilters): string {
  const qs = filtersToParams(f).toString();
  return qs ? `/?${qs}` : '/';
}

/** Query string for GET /api/items: all values explicit so the server does not have to guess defaults. */
export function toApiQuery(f: ListFilters): string {
  const p = filtersToParams(f);
  p.set('view', f.view);
  p.set('candidate', f.candidate);
  p.set('hideCommon', String(f.hideCommon));
  p.set('hidePlaceholders', String(f.hidePlaceholders));
  p.set('page', String(f.page));
  p.set('pageSize', String(PAGE_SIZE));
  return p.toString();
}

/** URL for downloading the filtered list (all matches; the server ignores page/pageSize). */
export function exportUrl(f: ListFilters, format: 'csv' | 'json', lang: Lang): string {
  return `/api/items/export?${toApiQuery(f)}&lang=${lang}&format=${format}`;
}

/** The hideCommon filter only applies in the Consumables and All views. */
export function hasHideCommon(view: ItemView): boolean {
  return hideCommonApplies(view);
}

/** Number of active filters in the collapsible section (shown on the button). */
export function countExtraFilters(f: ListFilters): number {
  let n = 0;
  if (f.rarity.length) n++;
  if (f.gameType.length) n++;
  if (f.testStatus) n++;
  if (f.updateId !== null) n++;
  if (f.includeRemoved) n++;
  if (hasHideCommon(f.view) && !f.hideCommon) n++;
  if (!f.hidePlaceholders) n++;
  return n;
}
