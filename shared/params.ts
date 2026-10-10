// Query-Parameter von GET /api/items und /api/updates/:id/changes einlesen und mit Defaults auffüllen.
// Der Server liest damit die HTTP-Query, die statische Fassung im Browser denselben Query-String.

import type { ChangeKind, ItemListQuery, Lang, UpdateChangesQuery } from './types.js';
import { GAME_TYPES, ITEM_SORTS, RARITIES, TEST_STATUSES } from './rules.js';

/** Fehler in den Eingaben, wird als HTTP 400 beantwortet. */
export class ValidationError extends Error {}

const LANGS: readonly Lang[] = ['en', 'de'];
export const CHANGE_KIND_VALUES: readonly ChangeKind[] = ['added', 'changed', 'removed'];

export function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${name} muss einer dieser Werte sein: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function bool(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new ValidationError(`${name} muss true oder false sein`);
}

export function int(name: string, value: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new ValidationError(`${name} muss eine ganze Zahl ≥ ${min} sein`);
  return n;
}

export function list<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map((v) => oneOf(name, v, allowed)!);
}

/** Liest den Parameter lang (Default en). Wirft ValidationError. */
export function parseLang(value: string | undefined): Lang {
  return oneOf('lang', value, LANGS) ?? 'en';
}

/** ItemListQuery mit aufgefüllten Defaults; nur q, testStatus und updateId bleiben optional. */
export type ParsedItemListQuery = Required<Omit<ItemListQuery, 'q' | 'testStatus' | 'updateId'>> &
  Pick<ItemListQuery, 'q' | 'testStatus' | 'updateId'>;

/** Liest die Query-Parameter von GET /api/items und füllt Defaults auf. Wirft ValidationError. */
export function parseItemListQuery(params: Record<string, string | undefined>): ParsedItemListQuery {
  const q = params.q?.trim();
  return {
    q: q ? q : undefined,
    lang: parseLang(params.lang),
    view: oneOf('view', params.view, ['gizmo', 'consumable', 'tonic', 'all'] as const) ?? 'gizmo',
    candidate: oneOf('candidate', params.candidate, ['yes', 'no', 'all'] as const) ?? 'yes',
    hideCommon: bool('hideCommon', params.hideCommon) ?? true,
    hidePlaceholders: bool('hidePlaceholders', params.hidePlaceholders) ?? true,
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

export type ParsedUpdateChangesQuery = Required<Omit<UpdateChangesQuery, 'q'>> & Pick<UpdateChangesQuery, 'q'>;

/** Liest die Query-Parameter von GET /api/updates/:id/changes und füllt Defaults auf. Wirft ValidationError. */
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
