// Queries of the static version as pure functions on the loaded JSON files.
// They reproduce the responses of /api/* (list, details, updates, changes, comparison, export) and
// follow the logic of server/src/routes/*.ts: same filters, same sorting, same response shapes.
// No browser or Node dependencies so a test can compare both sides.
// "Static version" = the read-only GitHub Pages build that loads JSON files (see staticTypes.ts) instead of
// calling the server. "Candidate" = item whose game_types contain Dungeon; "tonic" = transformation item;
// "placeholder" = internal dummy item (see rules.ts).
// TypeScript notes: `foo!` asserts a value is not null/undefined; `x ??= y` assigns y only if x is null/undefined;
// `(entry): entry is T =>` is a type guard that narrows the type after filter().

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

/** Content of meta.json, items.json, updates.json and changes.json. */
export interface StaticFiles {
    meta: StaticMeta;
    items: StaticItem[];
    updates: StaticUpdate[];
    changes: StaticChange[];
}

/** Item with precomputed values so filtering and sorting stay fast in the browser. */
export interface PreparedItem {
    src: StaticItem;
    id: number;
    nameEn: string;
    nameDe: string | null; // non-empty; null = use the English name
    hasDe: boolean; // there is a row in item_texts
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
    /** Words for the full-text search per column [name, description], computed on the first search. */
    tokensEn?: string[][];
    tokensDe?: string[][];
}

/** The loaded files turned into lookup tables; input for all query functions below. */
export interface StaticDataset {
    meta: StaticMeta;
    items: PreparedItem[]; // sorted by ID
    byId: Map<number, PreparedItem>;
    indexById: Map<number, number>; // position in items, determines the block in details/<n>.json
    updates: StaticUpdate[]; // newest first
    updatesById: Map<number, StaticUpdate>;
    baselineId: number | null; // first completed state (full import), whose changes are not exported
    changes: StaticChange[]; // sorted by itemId, then updateId
    changesByUpdate: Map<number, StaticChange[]>;
    summaries: Map<number, Record<string, unknown>>; // item -> summarize() of the API response (from added/removed entries)
}

/** Sorts the raw files and builds the lookup maps (done once after loading). */
export function prepareDataset(files: StaticFiles): StaticDataset {
    const items = [...files.items].sort((a, b) => a.id - b.id).map(prepareItem);
    const changes = [...files.changes].sort((a, b) => a.itemId - b.itemId || a.updateId - b.updateId);
    const changesByUpdate = new Map<number, StaticChange[]>();
    const summaries = new Map<number, Record<string, unknown>>();
    // Group changes by update and remember the first summary per item.
    for (const change of changes) {
        let updateChanges = changesByUpdate.get(change.updateId);
        if (!updateChanges) changesByUpdate.set(change.updateId, (updateChanges = []));
        updateChanges.push(change);
        if (change.summary && !summaries.has(change.itemId)) summaries.set(change.itemId, change.summary);
    }
    const updates = [...files.updates].sort((a, b) => b.id - a.id);
    return {
        meta: files.meta,
        items,
        byId: new Map(items.map((item) => [item.id, item])),
        indexById: new Map(items.map((item, index) => [item.id, index])),
        updates,
        updatesById: new Map(updates.map((update) => [update.id, update])),
        baselineId: updates.length > 0 ? updates[updates.length - 1]!.id : null,
        changes,
        changesByUpdate,
        summaries,
    };
}

/** Computes the derived values of one item (see PreparedItem). */
function prepareItem(src: StaticItem): PreparedItem {
    const flags = src.flags ?? [];
    const subtype = src.subtype ?? null;
    const icon = src.icon === undefined ? null : src.icon.startsWith('http') ? src.icon : ICON_PREFIX + src.icon;
    // The subset of fields the rules in rules.ts look at.
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

/** Position of the rarity in RARITIES; unknown values sort last. */
function rarityRank(rarity: string): number {
    const index = (RARITIES as readonly string[]).indexOf(rarity);
    return index < 0 ? 99 : index;
}

/** Name in the view's language, falling back to English (like COALESCE(NULLIF(d.name, ''), i.name)). */
const nameOf = (item: PreparedItem, lang: Lang): string => (lang === 'de' && item.nameDe ? item.nameDe : item.nameEn);
/** Description in the view's language (German only if the item has a German text row). */
const descriptionOf = (item: PreparedItem, lang: Lang): string | null =>
    lang === 'de' && item.hasDe ? item.descriptionDe : item.descriptionEn;

// ---------------------------------------------------------------------------
// Full-text search (reproduces FTS5 with the unicode61 tokenizer)
// ---------------------------------------------------------------------------

/**
 * Splits text into words like the FTS5 tokenizer unicode61: letters and digits form words,
 * everything else separates; case and accents (ä -> a) do not matter.
 */
export function tokenize(text: string): string[] {
    return (
        text
            .normalize('NFD')
            .replace(/\p{M}+/gu, '')
            .toLowerCase()
            .match(/[\p{L}\p{N}\p{Co}]+/gu) ?? []
    );
}

/**
 * Search terms like toFtsQuery on the server: every word is a phrase whose last word counts as a prefix.
 * All words must occur. Empty list = no restriction.
 */
export function searchPhrases(input: string): string[][] {
    return input
        .split(/\s+/)
        .map((term) => term.replace(/"/g, ''))
        .filter((term) => /[\p{L}\p{N}]/u.test(term))
        .map(tokenize)
        .filter((tokens) => tokens.length > 0);
}

/** Do the phrase's words appear consecutively in tokens, with the last word as a prefix? */
function phraseMatches(tokens: string[], phrase: string[]): boolean {
    const last = phrase.length - 1;
    // Try every start position; "continue outer" abandons the position on the first word that does not match.
    outer: for (let i = 0; i + last < tokens.length; i++) {
        for (let offset = 0; offset < last; offset++) if (tokens[i + offset] !== phrase[offset]) continue outer;
        if (tokens[i + last]!.startsWith(phrase[last]!)) return true;
    }
    return false;
}

/** All phrases occur (each in name or description). */
const allPhrasesMatch = (columns: string[][], phrases: string[][]): boolean =>
    phrases.every((phrase) => columns.some((tokens) => phraseMatches(tokens, phrase)));

/** Search tokens of the English name and description (cached on the item). */
function tokensEn(item: PreparedItem): string[][] {
    return (item.tokensEn ??= [tokenize(item.nameEn), tokenize(item.descriptionEn ?? '')]);
}

/** Search tokens of the German name and description; null if the item has no German text. */
function tokensDe(item: PreparedItem): string[][] | null {
    if (!item.hasDe) return null;
    return (item.tokensDe ??= [tokenize(item.src.de?.name ?? ''), tokenize(item.descriptionDe ?? '')]);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** List filter, prepared once. */
function compileFilter(dataset: StaticDataset, query: ParsedItemListQuery): (item: PreparedItem) => boolean {
    // The search text is one of: item ID (digits only), chat link ("[&..."), or full-text words.
    const searchText = query.q;
    const phrases =
        searchText && !/^\d+$/.test(searchText) && !searchText.startsWith('[&') ? searchPhrases(searchText) : [];
    const idQuery = searchText && /^\d+$/.test(searchText) ? Number(searchText) : null;
    // -1 is a fallback that matches no item (IDs are positive), so an undecodable link can still match by exact
    // chat link text but never by ID.
    const chatQuery =
        searchText && searchText.startsWith('[&')
            ? { link: searchText, id: itemIdFromChatLink(searchText) ?? -1 }
            : null;
    // IDs of the items touched by the selected update (null = no update filter).
    const changedInUpdate =
        query.updateId !== undefined
            ? new Set((dataset.changesByUpdate.get(query.updateId) ?? []).map((change) => change.itemId))
            : null;
    const hideCommon = query.hideCommon && hideCommonApplies(query.view) && query.view !== 'tonic';

    return (item) => {
        if (idQuery !== null) {
            if (item.id !== idQuery) return false;
        } else if (chatQuery) {
            if (item.chatLink !== chatQuery.link && item.id !== chatQuery.id) return false;
        } else if (phrases.length > 0) {
            const germanTokens = query.lang === 'de' ? tokensDe(item) : null;
            // German: a hit in the German or the English index is enough (proper names, chat terms).
            if (!(germanTokens && allPhrasesMatch(germanTokens, phrases)) && !allPhrasesMatch(tokensEn(item), phrases))
                return false;
        }

        if (query.view === 'gizmo' && item.src.type !== 'Gizmo') return false;
        if (query.view === 'consumable' && item.src.type !== 'Consumable') return false;
        if (query.view === 'tonic' && !item.tonic) return false;
        if (query.candidate !== 'all' && item.src.isCandidate !== (query.candidate === 'yes')) return false;
        // In the tonic view hideCommon does not apply: tonics can have the subtype Food or Utility.
        if (hideCommon && item.common) return false;
        if (query.hidePlaceholders && item.placeholder) return false;
        if (query.rarity.length > 0 && !query.rarity.includes(item.src.rarity)) return false;
        // The item must contain every requested game type.
        for (const gameType of query.gameType) if (!item.src.gameTypes.includes(gameType)) return false;
        if (query.testStatus === 'retest') {
            if (!item.needsRetest) return false;
        } else if (query.testStatus && item.testStatus !== query.testStatus) {
            return false;
        }
        if (changedInUpdate && !changedInUpdate.has(item.id)) return false;
        if (!query.includeRemoved && item.src.removed) return false;
        return true;
    };
}

/** All matches in the chosen sort order (without pagination). */
export function filterItems(dataset: StaticDataset, query: ParsedItemListQuery): PreparedItem[] {
    const matches = dataset.items.filter(compileFilter(dataset, query));
    const sign = query.order === 'desc' ? -1 : 1;
    const lang = query.lang;
    // Compares by the chosen sort key only; ties are resolved by ID below.
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
                return 0; // id: the tie-break below decides
        }
    };
    return matches.sort((a, b) => sign * (compare(a, b) || a.id - b.id));
}

/** Converts a prepared item into the list entry of the API response. */
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

/** Static counterpart of GET /api/items: filter, sort, paginate. */
export function listStaticItems(dataset: StaticDataset, query: ParsedItemListQuery): ItemListResponse {
    const matches = filterItems(dataset, query);
    const start = (query.page - 1) * query.pageSize;
    return {
        items: matches.slice(start, start + query.pageSize).map((item) => toListItem(item, query.lang)),
        total: matches.length,
        page: query.page,
        pageSize: query.pageSize,
    };
}

/** All matches as rows for CSV/JSON (see exportItems on the server). */
export function exportStaticItems(dataset: StaticDataset, query: ParsedItemListQuery): ExportRow[] {
    return filterItems(dataset, query).map((item) => {
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

/** Static counterpart of GET /api/stats (counts only items that are not removed). */
export function staticStats(dataset: StaticDataset): StatsResponse {
    let items = 0;
    let germanTexts = 0;
    const candidates = { gizmo: 0, consumable: 0, tonic: 0 };
    // Count German texts over all items, everything else only over items still in the API.
    for (const item of dataset.items) {
        if (item.hasDe) germanTexts++;
        if (item.src.removed) continue;
        items++;
        if (!item.src.isCandidate) continue;
        if (item.src.type === 'Gizmo') candidates.gizmo++;
        if (item.src.type === 'Consumable') candidates.consumable++;
        if (item.tonic) candidates.tonic++;
    }
    const last = dataset.updates[0];
    return {
        items,
        candidates,
        germanTexts,
        lastUpdate: last
            ? {
                  id: last.id,
                  startedAt: last.startedAt,
                  finishedAt: last.finishedAt,
                  buildId: last.buildId,
                  added: last.added,
                  changed: last.changed,
                  removed: last.removed,
              }
            : null,
        autoCheck: null,
    };
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

/** Type guard: tells TypeScript that the value is a plain object (not null, not an array). */
const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Number of the file details/<n>.json that contains the item; null = unknown ID. */
export function detailBlockOf(dataset: StaticDataset, id: number): number | null {
    const index = dataset.indexById.get(id);
    return index === undefined ? null : Math.floor(index / DETAIL_BLOCK_SIZE);
}

/** History of an item, newest first. */
function historyOf(dataset: StaticDataset, id: number): ItemChange[] {
    return dataset.changes
        .filter((change) => change.itemId === id)
        .sort((a, b) => b.updateId - a.updateId)
        .map((change) => ({
            updateId: change.updateId,
            updateStartedAt: dataset.updatesById.get(change.updateId)?.startedAt ?? '',
            kind: change.kind,
            changedFields: change.changedFields ?? [],
            gameTypesBefore: change.gameTypesBefore ?? null,
            gameTypesAfter: change.gameTypesAfter ?? null,
        }));
}

/**
 * Details of an item. rest is the item's entry from details/<n>.json (rest of the API response).
 * Null if the item is not published.
 */
export function staticItemDetail(
    dataset: StaticDataset,
    id: number,
    lang: Lang,
    rest: Record<string, unknown> | undefined,
): ItemDetail | null {
    const item = dataset.byId.get(id);
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
        history: historyOf(dataset, id),
    };
}

// ---------------------------------------------------------------------------
// Changes of an update and comparison
// ---------------------------------------------------------------------------

/** Conditions on the items (type, placeholders, search); shared by /changes and /compare. */
function compileChangeItemFilter(query: ParsedUpdateChangesQuery): (item: PreparedItem) => boolean {
    const searchText = query.q;
    // LIKE '%q%' ignoring ASCII case; a plain number also matches the ID.
    const needle = searchText ? asciiLower(searchText) : null;
    const idQuery = searchText && /^\d+$/.test(searchText) ? Number(searchText) : null;
    return (item) => {
        if (query.type === 'gizmo' && item.src.type !== 'Gizmo') return false;
        if (query.type === 'consumable' && item.src.type !== 'Consumable') return false;
        if (query.type === 'tonic' && !item.tonic) return false;
        if (query.hidePlaceholders && item.placeholder) return false;
        if (needle !== null) {
            // German: a hit in the German or the English name is enough.
            const hit =
                asciiLower(item.nameEn).includes(needle) ||
                (query.lang === 'de' && item.nameDe !== null && asciiLower(item.nameDe).includes(needle));
            if (!hit && item.id !== idQuery) return false;
        }
        return true;
    };
}

/** Entry for the table; before/after come from the stored values or the summary depending on the kind. */
function toEntry(
    item: PreparedItem,
    lang: Lang,
    fields: Pick<
        UpdateChangeEntry,
        'kind' | 'changedFields' | 'gameTypesBefore' | 'gameTypesAfter' | 'before' | 'after'
    > & { unknownFields?: string[] },
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
 * Changes of an update (against its predecessor). For the first state (full import) the static
 * version contains no entries; the counters then come from the update itself.
 */
export function staticUpdateChanges(
    dataset: StaticDataset,
    update: UpdateDetail,
    query: ParsedUpdateChangesQuery,
): UpdateChangesResponse {
    const rows = dataset.changesByUpdate.get(update.id) ?? [];
    const itemFilter = compileChangeItemFilter(query);
    // Pair each change row with its item (rows of unknown items are dropped) and its DungeonView-like "view".
    const candidates = rows
        .map((row) => ({ row, item: dataset.byId.get(row.itemId) }))
        .filter((entry): entry is { row: StaticChange; item: PreparedItem } => entry.item !== undefined)
        .map((entry) => ({ ...entry, view: toView(entry.row) }));

    const selected = candidates
        .filter(
            ({ row, item, view }) =>
                itemFilter(item) &&
                (query.kind.length === 0 || query.kind.includes(row.kind)) &&
                matchesFocus(query.focus, view),
        )
        .map((entry) => ({ ...entry, name: nameOf(entry.item, query.lang) }))
        .sort((a, b) =>
            compareChangeEntries(
                { ...a.view, name: a.name, itemId: a.row.itemId },
                { ...b.view, name: b.name, itemId: b.row.itemId },
            ),
        );

    const start = (query.page - 1) * query.pageSize;
    const items = selected.slice(start, start + query.pageSize).map(({ row, item, view }) => {
        const summary = row.summary ?? dataset.summaries.get(row.itemId) ?? null;
        return toEntry(item, query.lang, {
            kind: row.kind,
            changedFields: view.changedFields ?? [],
            gameTypesBefore: view.gameTypesBefore,
            gameTypesAfter: view.gameTypesAfter,
            // New and removed items: the state is in the summary (for removed ones the last known).
            before: row.kind === 'removed' ? summary : row.kind === 'changed' ? (row.valuesBefore ?? null) : null,
            after: row.kind === 'added' ? summary : row.kind === 'changed' ? (row.valuesAfter ?? null) : null,
        });
    });

    const isBaseline = update.id === dataset.baselineId;
    return {
        update,
        counts: isBaseline
            ? {
                  added: update.added,
                  changed: update.changed,
                  removed: update.removed,
                  gameTypesChanged: 0,
                  dungeonGained: 0,
                  dungeonLost: 0,
              }
            : countChangeRows(rows.map(toView)),
        items,
        total: selected.length,
        page: query.page,
        pageSize: query.pageSize,
        legacyValues: rows.some((row) => row.kind === 'changed' && row.valuesBefore === undefined),
    };
}

/** Reduces a change row to the fields the shared change logic (changes.ts) works with. */
function toView(row: StaticChange) {
    return {
        kind: row.kind,
        changedFields: row.changedFields ?? null,
        gameTypesBefore: row.gameTypesBefore ?? null,
        gameTypesAfter: row.gameTypesAfter ?? null,
    };
}

/** State after update from versus state after update to (from < to): changes in the range summarized per item. */
export function staticCompare(
    dataset: StaticDataset,
    from: UpdateDetail,
    to: UpdateDetail,
    query: ParsedUpdateChangesQuery,
): UpdateCompareResponse {
    const itemFilter = compileChangeItemFilter(query);
    const rows: RangeChange[] = [];
    // Collect the changes in (from, to] together with the item name and whether the item passes the filters.
    for (const change of dataset.changes) {
        if (change.updateId <= from.id || change.updateId > to.id) continue;
        const item = dataset.byId.get(change.itemId);
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
    const items = selected.slice(start, start + query.pageSize).map((netChange) => {
        const item = dataset.byId.get(netChange.itemId)!;
        const summary = dataset.summaries.get(netChange.itemId) ?? null;
        return toEntry(item, query.lang, {
            kind: netChange.kind,
            changedFields: netChange.changedFields,
            gameTypesBefore: netChange.gameTypesBefore,
            gameTypesAfter: netChange.gameTypesAfter,
            before: netChange.kind === 'removed' ? summary : netChange.kind === 'changed' ? netChange.before : null,
            after: netChange.kind === 'added' ? summary : netChange.kind === 'changed' ? netChange.after : null,
            unknownFields: netChange.unknownFields,
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
        legacyValues: rows.some((row) => row.kind === 'changed' && row.valuesBefore === null),
    };
}
