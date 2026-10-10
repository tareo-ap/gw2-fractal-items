// Abfragen der statischen Fassung als reine Funktionen auf den geladenen JSON-Dateien.
// Sie bilden die Antworten von /api/* nach (Liste, Details, Updates, Änderungen, Vergleich, Export) und
// folgen der Logik von server/src/routes/*.ts: gleiche Filter, gleiche Sortierung, gleiche Antwortformen.
// Keine Browser- und keine Node-Abhängigkeiten, damit ein Test beide Seiten vergleichen kann.

import type {
  ItemChange,
  ItemDetail,
  ItemListItem,
  ItemListResponse,
  Lang,
  Rarity,
  StatsResponse,
  TestStatus,
  UpdateChangeEntry,
  UpdateChangesResponse,
  UpdateCompareResponse,
  UpdateDetail,
} from './types.js';
import type { ExportRow } from './exportFormat.js';
import type { ParsedItemListQuery, ParsedUpdateChangesQuery } from './params.js';
import {
  RARITIES,
  chatLinkForId,
  compareNoCase,
  asciiLower,
  hideCommonApplies,
  isCommonConsumable,
  isPlaceholder,
  isTonic,
  itemIdFromChatLink,
  ICON_PREFIX,
  wikiUrl,
} from './rules.js';
import {
  aggregateRange,
  compareChangeEntries,
  countChangeRows,
  matchesFocus,
  selectNetChanges,
  type RangeChange,
} from './changes.js';
import type { StaticChange, StaticItem, StaticMeta, StaticUpdate } from './staticTypes.js';
import { DETAIL_BLOCK_SIZE } from './staticTypes.js';

/** Inhalt von meta.json, items.json, updates.json und changes.json. */
export interface StaticFiles {
  meta: StaticMeta;
  items: StaticItem[];
  updates: StaticUpdate[];
  changes: StaticChange[];
}

/** Item mit vorberechneten Werten, damit Filtern und Sortieren im Browser schnell bleiben. */
export interface PreparedItem {
  src: StaticItem;
  id: number;
  nameEn: string;
  nameDe: string | null; // nicht leer; null = englischen Namen verwenden
  hasDe: boolean; // es gibt eine Zeile in item_texts
  descriptionEn: string | null;
  descriptionDe: string | null;
  subtype: string | null;
  icon: string | null;
  flags: string[];
  testStatus: TestStatus;
  needsRetest: boolean;
  placeholder: boolean;
  tonic: boolean;
  common: boolean;
  rarityRank: number;
  chatLink: string | null;
  /** Wörter für die Volltextsuche je Spalte [Name, Beschreibung], erst bei der ersten Suche berechnet. */
  tokensEn?: string[][];
  tokensDe?: string[][];
}

export interface StaticDataset {
  meta: StaticMeta;
  items: PreparedItem[]; // nach ID sortiert
  byId: Map<number, PreparedItem>;
  indexById: Map<number, number>; // Position in items, bestimmt den Block in details/<n>.json
  updates: StaticUpdate[]; // neueste zuerst
  updatesById: Map<number, StaticUpdate>;
  baselineId: number | null; // erster abgeschlossener Stand (Vollimport), dessen Änderungen nicht exportiert werden
  changes: StaticChange[]; // nach itemId, dann updateId sortiert
  changesByUpdate: Map<number, StaticChange[]>;
  summaries: Map<number, Record<string, unknown>>; // Item → summarize() der API-Antwort (aus added/removed-Einträgen)
}

export function prepareDataset(files: StaticFiles): StaticDataset {
  const items = [...files.items].sort((a, b) => a.id - b.id).map(prepareItem);
  const changes = [...files.changes].sort((a, b) => a.itemId - b.itemId || a.updateId - b.updateId);
  const changesByUpdate = new Map<number, StaticChange[]>();
  const summaries = new Map<number, Record<string, unknown>>();
  for (const change of changes) {
    let list = changesByUpdate.get(change.updateId);
    if (!list) changesByUpdate.set(change.updateId, (list = []));
    list.push(change);
    if (change.summary && !summaries.has(change.itemId)) summaries.set(change.itemId, change.summary);
  }
  const updates = [...files.updates].sort((a, b) => b.id - a.id);
  return {
    meta: files.meta,
    items,
    byId: new Map(items.map((item) => [item.id, item])),
    indexById: new Map(items.map((item, index) => [item.id, index])),
    updates,
    updatesById: new Map(updates.map((u) => [u.id, u])),
    baselineId: updates.length > 0 ? updates[updates.length - 1]!.id : null,
    changes,
    changesByUpdate,
    summaries,
  };
}

function prepareItem(src: StaticItem): PreparedItem {
  const flags = src.flags ?? [];
  const subtype = src.subtype ?? null;
  const icon = src.icon === undefined ? null : src.icon.startsWith('http') ? src.icon : ICON_PREFIX + src.icon;
  const rule = { name: src.name, type: src.type, subtype, icon, flags };
  return {
    src,
    id: src.id,
    nameEn: src.name,
    nameDe: src.de?.name ? src.de.name : null,
    hasDe: src.de !== undefined,
    descriptionEn: src.description ?? null,
    descriptionDe: src.de?.description ?? null,
    subtype,
    icon,
    flags,
    testStatus: src.test?.status ?? 'untested',
    needsRetest: src.needsRetest === true,
    placeholder: isPlaceholder(rule),
    tonic: isTonic(rule),
    common: isCommonConsumable(rule),
    rarityRank: rarityRank(src.rarity),
    chatLink: src.chatLink === undefined ? chatLinkForId(src.id) : src.chatLink || null,
  };
}

function rarityRank(rarity: string): number {
  const index = (RARITIES as readonly string[]).indexOf(rarity);
  return index < 0 ? 99 : index;
}

/** Name in der Sprache der Ansicht, Fallback Englisch (wie COALESCE(NULLIF(d.name, ''), i.name)). */
const nameOf = (item: PreparedItem, lang: Lang): string => (lang === 'de' && item.nameDe ? item.nameDe : item.nameEn);
const descriptionOf = (item: PreparedItem, lang: Lang): string | null =>
  lang === 'de' && item.hasDe ? item.descriptionDe : item.descriptionEn;

// ---------------------------------------------------------------------------
// Volltextsuche (bildet FTS5 mit dem Tokenizer unicode61 nach)
// ---------------------------------------------------------------------------

/**
 * Zerlegt Text in Wörter wie der FTS5-Tokenizer unicode61: Buchstaben und Ziffern bilden Wörter,
 * alles andere trennt; Groß-/Kleinschreibung und Akzente (ä → a) spielen keine Rolle.
 */
export function tokenize(text: string): string[] {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().match(/[\p{L}\p{N}\p{Co}]+/gu) ?? [];
}

/**
 * Suchbegriffe wie toFtsQuery im Server: Jedes Wort ist eine Phrase, deren letztes Wort als Präfix gilt.
 * Alle Wörter müssen vorkommen. Leere Liste = keine Einschränkung.
 */
export function searchPhrases(input: string): string[][] {
  return input
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ''))
    .filter((term) => /[\p{L}\p{N}]/u.test(term))
    .map(tokenize)
    .filter((tokens) => tokens.length > 0);
}

function phraseMatches(tokens: string[], phrase: string[]): boolean {
  const last = phrase.length - 1;
  outer: for (let i = 0; i + last < tokens.length; i++) {
    for (let k = 0; k < last; k++) if (tokens[i + k] !== phrase[k]) continue outer;
    if (tokens[i + last]!.startsWith(phrase[last]!)) return true;
  }
  return false;
}

/** Alle Phrasen kommen vor (je in Name oder Beschreibung). */
const allPhrasesMatch = (columns: string[][], phrases: string[][]): boolean =>
  phrases.every((phrase) => columns.some((tokens) => phraseMatches(tokens, phrase)));

function tokensEn(item: PreparedItem): string[][] {
  return (item.tokensEn ??= [tokenize(item.nameEn), tokenize(item.descriptionEn ?? '')]);
}

function tokensDe(item: PreparedItem): string[][] | null {
  if (!item.hasDe) return null;
  return (item.tokensDe ??= [tokenize(item.src.de?.name ?? ''), tokenize(item.descriptionDe ?? '')]);
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

/** Filter der Liste, einmal vorbereitet. */
function compileFilter(ds: StaticDataset, query: ParsedItemListQuery): (item: PreparedItem) => boolean {
  const q = query.q;
  const phrases = q && !/^\d+$/.test(q) && !q.startsWith('[&') ? searchPhrases(q) : [];
  const idQuery = q && /^\d+$/.test(q) ? Number(q) : null;
  const chatQuery = q && q.startsWith('[&') ? { link: q, id: itemIdFromChatLink(q) ?? -1 } : null;
  const changed = query.updateId !== undefined ? new Set((ds.changesByUpdate.get(query.updateId) ?? []).map((c) => c.itemId)) : null;
  const hideCommon = query.hideCommon && hideCommonApplies(query.view) && query.view !== 'tonic';

  return (item) => {
    if (idQuery !== null) {
      if (item.id !== idQuery) return false;
    } else if (chatQuery) {
      if (item.chatLink !== chatQuery.link && item.id !== chatQuery.id) return false;
    } else if (phrases.length > 0) {
      const de = query.lang === 'de' ? tokensDe(item) : null;
      // Deutsch: Treffer im deutschen oder im englischen Index genügt (Eigennamen, Chat-Begriffe).
      if (!(de && allPhrasesMatch(de, phrases)) && !allPhrasesMatch(tokensEn(item), phrases)) return false;
    }

    if (query.view === 'gizmo' && item.src.type !== 'Gizmo') return false;
    if (query.view === 'consumable' && item.src.type !== 'Consumable') return false;
    if (query.view === 'tonic' && !item.tonic) return false;
    if (query.candidate !== 'all' && item.src.isCandidate !== (query.candidate === 'yes')) return false;
    // In der Tonic-Ansicht gilt hideCommon nicht: Tonics können den Untertyp Food oder Utility haben.
    if (hideCommon && item.common) return false;
    if (query.hidePlaceholders && item.placeholder) return false;
    if (query.rarity.length > 0 && !query.rarity.includes(item.src.rarity)) return false;
    for (const gameType of query.gameType) if (!item.src.gameTypes.includes(gameType)) return false;
    if (query.testStatus === 'retest') {
      if (!item.needsRetest) return false;
    } else if (query.testStatus && item.testStatus !== query.testStatus) {
      return false;
    }
    if (changed && !changed.has(item.id)) return false;
    if (!query.includeRemoved && item.src.removed) return false;
    return true;
  };
}

/** Alle Treffer in der gewählten Sortierung (ohne Paginierung). */
export function filterItems(ds: StaticDataset, query: ParsedItemListQuery): PreparedItem[] {
  const matches = ds.items.filter(compileFilter(ds, query));
  const sign = query.order === 'desc' ? -1 : 1;
  const lang = query.lang;
  const compare = (a: PreparedItem, b: PreparedItem): number => {
    switch (query.sort) {
      case 'name':
        return compareNoCase(nameOf(a, lang), nameOf(b, lang));
      case 'rarity':
        return a.rarityRank - b.rarityRank;
      case 'level':
        return a.src.level - b.src.level;
      case 'lastChanged':
        return a.src.lastChanged - b.src.lastChanged;
      default:
        return 0; // id: entscheidet der Gleichstand unten
    }
  };
  return matches.sort((a, b) => sign * (compare(a, b) || a.id - b.id));
}

export function toListItem(item: PreparedItem, lang: Lang): ItemListItem {
  return {
    id: item.id,
    name: nameOf(item, lang),
    nameEn: item.nameEn,
    type: item.src.type,
    subtype: item.subtype,
    rarity: item.src.rarity,
    level: item.src.level,
    icon: item.icon,
    gameTypes: item.src.gameTypes,
    isCandidate: item.src.isCandidate,
    removed: item.src.removed === true,
    testStatus: item.testStatus,
    needsRetest: item.needsRetest,
  };
}

export function listStaticItems(ds: StaticDataset, query: ParsedItemListQuery): ItemListResponse {
  const matches = filterItems(ds, query);
  const start = (query.page - 1) * query.pageSize;
  return {
    items: matches.slice(start, start + query.pageSize).map((item) => toListItem(item, query.lang)),
    total: matches.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Alle Treffer als Zeilen für CSV/JSON (siehe exportItems im Server). */
export function exportStaticItems(ds: StaticDataset, query: ParsedItemListQuery): ExportRow[] {
  return filterItems(ds, query).map((item) => {
    const name = nameOf(item, query.lang);
    return {
      id: item.id,
      name,
      type: item.src.type,
      subtype: item.subtype,
      rarity: item.src.rarity,
      level: item.src.level,
      game_types: item.src.gameTypes,
      flags: item.flags,
      is_candidate: item.src.isCandidate,
      removed: item.src.removed === true,
      test_status: item.testStatus,
      test_note: item.src.test?.note ?? null,
      tested_at: item.src.test?.testedAt ?? null,
      needs_retest: item.needsRetest,
      chat_link: item.chatLink,
      wiki_url: wikiUrl(query.lang, name),
      icon: item.icon,
    };
  });
}

export function staticStats(ds: StaticDataset): StatsResponse {
  let items = 0;
  let germanTexts = 0;
  const candidates = { gizmo: 0, consumable: 0, tonic: 0 };
  for (const item of ds.items) {
    if (item.hasDe) germanTexts++;
    if (item.src.removed) continue;
    items++;
    if (!item.src.isCandidate) continue;
    if (item.src.type === 'Gizmo') candidates.gizmo++;
    if (item.src.type === 'Consumable') candidates.consumable++;
    if (item.tonic) candidates.tonic++;
  }
  const last = ds.updates[0];
  return {
    items,
    candidates,
    germanTexts,
    lastUpdate: last
      ? { id: last.id, startedAt: last.startedAt, finishedAt: last.finishedAt, buildId: last.buildId, added: last.added, changed: last.changed, removed: last.removed }
      : null,
    autoCheck: null,
  };
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Nummer der Datei details/<n>.json, in der das Item steht; null = unbekannte ID. */
export function detailBlockOf(ds: StaticDataset, id: number): number | null {
  const index = ds.indexById.get(id);
  return index === undefined ? null : Math.floor(index / DETAIL_BLOCK_SIZE);
}

/** Verlauf eines Items, neueste zuerst. */
function historyOf(ds: StaticDataset, id: number): ItemChange[] {
  return ds.changes
    .filter((c) => c.itemId === id)
    .sort((a, b) => b.updateId - a.updateId)
    .map((c) => ({
      updateId: c.updateId,
      updateStartedAt: ds.updatesById.get(c.updateId)?.startedAt ?? '',
      kind: c.kind,
      changedFields: c.changedFields ?? [],
      gameTypesBefore: c.gameTypesBefore ?? null,
      gameTypesAfter: c.gameTypesAfter ?? null,
    }));
}

/**
 * Details eines Items. rest ist der Eintrag des Items aus details/<n>.json (restliche API-Antwort).
 * Null, wenn das Item nicht veröffentlicht ist.
 */
export function staticItemDetail(ds: StaticDataset, id: number, lang: Lang, rest: Record<string, unknown> | undefined): ItemDetail | null {
  const item = ds.byId.get(id);
  if (!item) return null;
  const raw = rest ?? {};
  const base = toListItem(item, lang);
  const test = item.src.test;
  return {
    ...base,
    description: descriptionOf(item, lang),
    chatLink: item.chatLink,
    flags: item.flags,
    restrictions: Array.isArray(raw.restrictions) ? (raw.restrictions as string[]) : [],
    vendorValue: typeof raw.vendor_value === 'number' ? raw.vendor_value : 0,
    details: isObject(raw.details) ? raw.details : null,
    wikiUrl: wikiUrl(lang, base.name),
    test: {
      status: item.testStatus,
      note: test?.note ?? null,
      testedAt: test?.testedAt ?? null,
      gameTypesAtTest: test?.gameTypesAtTest ?? null,
    },
    history: historyOf(ds, id),
  };
}

// ---------------------------------------------------------------------------
// Änderungen eines Updates und Vergleich
// ---------------------------------------------------------------------------

/** Bedingungen auf den Items (Typ, Platzhalter, Suche); gemeinsam für /changes und /compare. */
function compileChangeItemFilter(query: ParsedUpdateChangesQuery): (item: PreparedItem) => boolean {
  const q = query.q;
  // LIKE '%q%' ohne Beachtung der ASCII-Groß-/Kleinschreibung; eine reine Zahl findet zusätzlich die ID.
  const needle = q ? asciiLower(q) : null;
  const idQuery = q && /^\d+$/.test(q) ? Number(q) : null;
  return (item) => {
    if (query.type === 'gizmo' && item.src.type !== 'Gizmo') return false;
    if (query.type === 'consumable' && item.src.type !== 'Consumable') return false;
    if (query.type === 'tonic' && !item.tonic) return false;
    if (query.hidePlaceholders && item.placeholder) return false;
    if (needle !== null) {
      // Deutsch: Treffer im deutschen oder im englischen Namen genügt.
      const hit = asciiLower(item.nameEn).includes(needle) || (query.lang === 'de' && item.nameDe !== null && asciiLower(item.nameDe).includes(needle));
      if (!hit && item.id !== idQuery) return false;
    }
    return true;
  };
}

/** Eintrag für die Tabelle; before/after je nach Art aus den gespeicherten Werten oder der Zusammenfassung. */
function toEntry(
  item: PreparedItem,
  lang: Lang,
  fields: Pick<UpdateChangeEntry, 'kind' | 'changedFields' | 'gameTypesBefore' | 'gameTypesAfter' | 'before' | 'after'> & { unknownFields?: string[] },
): UpdateChangeEntry {
  return {
    id: item.id,
    name: nameOf(item, lang),
    nameEn: item.nameEn,
    type: item.src.type,
    subtype: item.subtype,
    rarity: item.src.rarity as Rarity,
    icon: item.icon,
    removed: item.src.removed === true,
    isCandidate: item.src.isCandidate,
    ...fields,
  };
}

/**
 * Änderungen eines Updates (gegen den Vorgänger). Für den ersten Stand (Vollimport) enthält die statische
 * Fassung keine Einträge; die Zähler stammen dann aus dem Update selbst.
 */
export function staticUpdateChanges(ds: StaticDataset, update: UpdateDetail, query: ParsedUpdateChangesQuery): UpdateChangesResponse {
  const rows = ds.changesByUpdate.get(update.id) ?? [];
  const itemFilter = compileChangeItemFilter(query);
  const candidates = rows
    .map((row) => ({ row, item: ds.byId.get(row.itemId) }))
    .filter((e): e is { row: StaticChange; item: PreparedItem } => e.item !== undefined)
    .map((e) => ({ ...e, view: toView(e.row) }));

  const selected = candidates
    .filter(
      ({ row, item, view }) =>
        itemFilter(item) && (query.kind.length === 0 || query.kind.includes(row.kind)) && matchesFocus(query.focus, view),
    )
    .map((e) => ({ ...e, name: nameOf(e.item, query.lang) }))
    .sort((a, b) => compareChangeEntries({ ...a.view, name: a.name, itemId: a.row.itemId }, { ...b.view, name: b.name, itemId: b.row.itemId }));

  const start = (query.page - 1) * query.pageSize;
  const items = selected.slice(start, start + query.pageSize).map(({ row, item, view }) => {
    const summary = row.summary ?? ds.summaries.get(row.itemId) ?? null;
    return toEntry(item, query.lang, {
      kind: row.kind,
      changedFields: view.changedFields ?? [],
      gameTypesBefore: view.gameTypesBefore,
      gameTypesAfter: view.gameTypesAfter,
      // Neue und entfernte Items: Der Stand steht in der Zusammenfassung (bei entfernten der letzte bekannte).
      before: row.kind === 'removed' ? summary : row.kind === 'changed' ? (row.valuesBefore ?? null) : null,
      after: row.kind === 'added' ? summary : row.kind === 'changed' ? (row.valuesAfter ?? null) : null,
    });
  });

  const isBaseline = update.id === ds.baselineId;
  return {
    update,
    counts: isBaseline
      ? { added: update.added, changed: update.changed, removed: update.removed, gameTypesChanged: 0, dungeonGained: 0, dungeonLost: 0 }
      : countChangeRows(rows.map(toView)),
    items,
    total: selected.length,
    page: query.page,
    pageSize: query.pageSize,
    legacyValues: rows.some((r) => r.kind === 'changed' && r.valuesBefore === undefined),
  };
}

function toView(row: StaticChange) {
  return {
    kind: row.kind,
    changedFields: row.changedFields ?? null,
    gameTypesBefore: row.gameTypesBefore ?? null,
    gameTypesAfter: row.gameTypesAfter ?? null,
  };
}

/** Stand nach Update from gegen Stand nach Update to (from < to): Änderungen im Bereich pro Item zusammengefasst. */
export function staticCompare(ds: StaticDataset, from: UpdateDetail, to: UpdateDetail, query: ParsedUpdateChangesQuery): UpdateCompareResponse {
  const itemFilter = compileChangeItemFilter(query);
  const rows: RangeChange[] = [];
  for (const change of ds.changes) {
    if (change.updateId <= from.id || change.updateId > to.id) continue;
    const item = ds.byId.get(change.itemId);
    if (!item) continue;
    rows.push({
      updateId: change.updateId,
      itemId: change.itemId,
      kind: change.kind,
      changedFields: change.changedFields ?? null,
      gameTypesBefore: change.gameTypesBefore ?? null,
      gameTypesAfter: change.gameTypesAfter ?? null,
      valuesBefore: change.valuesBefore ?? null,
      valuesAfter: change.valuesAfter ?? null,
      name: nameOf(item, query.lang),
      nameEn: item.nameEn,
      matches: itemFilter(item),
    });
  }

  const { all, counts } = aggregateRange(rows);
  const selected = selectNetChanges(all, query);
  const start = (query.page - 1) * query.pageSize;
  const items = selected.slice(start, start + query.pageSize).map((n) => {
    const item = ds.byId.get(n.itemId)!;
    const summary = ds.summaries.get(n.itemId) ?? null;
    return toEntry(item, query.lang, {
      kind: n.kind,
      changedFields: n.changedFields,
      gameTypesBefore: n.gameTypesBefore,
      gameTypesAfter: n.gameTypesAfter,
      before: n.kind === 'removed' ? summary : n.kind === 'changed' ? n.before : null,
      after: n.kind === 'added' ? summary : n.kind === 'changed' ? n.after : null,
      unknownFields: n.unknownFields,
    });
  });

  return {
    from,
    to,
    counts,
    items,
    total: selected.length,
    page: query.page,
    pageSize: query.pageSize,
    legacyValues: rows.some((r) => r.kind === 'changed' && r.valuesBefore === null),
  };
}
