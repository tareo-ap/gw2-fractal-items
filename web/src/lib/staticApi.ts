import type {
    ImportStatus,
    ItemDetail,
    ItemListResponse,
    ItemTestUpdate,
    Lang,
    StatsResponse,
    UpdateChangesResponse,
    UpdateCompareResponse,
    UpdateDetail,
} from '../../../shared/types';
import type { UpdateListEntry } from '../api';
import { ApiError } from './apiError';
import { exportFilename, toCsv, toJson } from '../../../shared/exportFormat';
import { parseItemListQuery, parseUpdateChangesQuery, ValidationError } from '../../../shared/params';
import {
    detailBlockOf,
    exportStaticItems,
    listStaticItems,
    prepareDataset,
    staticCompare,
    staticItemDetail,
    staticStats,
    staticUpdateChanges,
    type StaticDataset,
} from '../../../shared/staticQuery';
import {
    STATIC_SCHEMA_VERSION,
    type StaticChange,
    type StaticDetailBlock,
    type StaticItem,
    type StaticMeta,
    type StaticUpdate,
} from '../../../shared/staticTypes';

// Data layer of the static version (GitHub Pages, VITE_DATA_MODE=static): the same interface as
// the server under /api/*, but the responses are computed in the browser from the JSON files in data/.
// The logic itself (filters, search, sorting, changes, comparison) lives in shared/staticQuery.ts.

// Base URL of the JSON files; BASE_URL (from Vite's `base`) is e.g. "/" or "/gw2-fractal-items/".
const DATA_URL = `${import.meta.env.BASE_URL}data/`;

/**
 * Fetches one JSON file from data/ and parses it. `<T>` is a generic: the caller states the expected shape (not checked
 * at runtime).
 */
async function fetchJson<T>(file: string): Promise<T> {
    let res: Response;
    try {
        res = await fetch(DATA_URL + file);
    } catch {
        throw new ApiError('Data files not reachable', 0);
    }
    if (!res.ok) throw new ApiError(`HTTP ${res.status} (${file})`, res.status);
    return (await res.json()) as T;
}

// Everything needed for list, search and changes is loaded once and then served from memory.
let dataset: Promise<StaticDataset> | null = null;

// `??=` assigns only if still null/undefined, so the files are requested once and the Promise is shared by all callers.
function loadDataset(): Promise<StaticDataset> {
    dataset ??= Promise.all([
        fetchJson<StaticMeta>('meta.json'),
        fetchJson<StaticItem[]>('items.json'),
        fetchJson<StaticUpdate[]>('updates.json'),
        fetchJson<StaticChange[]>('changes.json'),
    ]).then(([meta, items, updates, changes]) => {
        if (meta.schemaVersion !== STATIC_SCHEMA_VERSION) {
            throw new ApiError(`Unsupported data version ${meta.schemaVersion} (expected ${STATIC_SCHEMA_VERSION})`, 0);
        }
        return prepareDataset({ meta, items, updates, changes });
    });
    // After an error, retry on the next call.
    dataset.catch(() => {
        dataset = null;
    });
    return dataset;
}

// Details (rest of the API response) are stored in blocks of 500 items; each block is loaded at most once.
const blocks = new Map<number, Promise<StaticDetailBlock>>();

/** Loads detail block `blockNumber` (cached; failed loads are dropped so they can be retried). */
function loadBlock(blockNumber: number): Promise<StaticDetailBlock> {
    let block = blocks.get(blockNumber);
    if (!block) {
        block = fetchJson<StaticDetailBlock>(`details/${blockNumber}.json`);
        blocks.set(blockNumber, block);
        block.catch(() => blocks.delete(blockNumber));
    }
    return block;
}

/** Input errors as a response with status 400, like on the server. */
// Runs the parser; a ValidationError (bad query parameter) becomes an ApiError 400 as the server would respond.
function validated<T>(parse: () => T): T {
    try {
        return parse();
    } catch (err) {
        if (err instanceof ValidationError) throw new ApiError(err.message, 400);
        throw err;
    }
}

// Query string + language as the key/value object the shared parsers expect (the server gets them from the request).
const paramsOf = (queryString: string, lang: Lang): Record<string, string> => ({
    ...Object.fromEntries(new URLSearchParams(queryString)),
    lang,
});

// The responses carry update/from/to without deletable fields (the Pages version deletes nothing).
// Cast only (no runtime effect): a StaticUpdate is treated as UpdateDetail.
const asDetail = (update: StaticUpdate) => update as UpdateDetail;

// Rejected Promise for all write operations.
const readOnly = (): Promise<never> => Promise.reject(new ApiError('Read-only version', 405));

// Same method names and signatures as restApi in api.ts, but answered from the in-memory dataset.
export const staticApi = {
    stats: async (): Promise<StatsResponse> => staticStats(await loadDataset()),

    items: async (queryString: string, lang: Lang): Promise<ItemListResponse> => {
        const loadedDataset = await loadDataset();
        return listStaticItems(
            loadedDataset,
            validated(() => parseItemListQuery(paramsOf(queryString, lang))),
        );
    },

    item: async (id: number, lang: Lang): Promise<ItemDetail> => {
        const loadedDataset = await loadDataset();
        const block = detailBlockOf(loadedDataset, id);
        if (block === null) throw new ApiError('Item not found', 404);
        const rest = (await loadBlock(block))[id];
        return staticItemDetail(loadedDataset, id, lang, rest)!;
    },

    updates: async (): Promise<UpdateListEntry[]> => (await loadDataset()).updates,

    updateChanges: async (id: number, queryString: string, lang: Lang): Promise<UpdateChangesResponse> => {
        const loadedDataset = await loadDataset();
        const query = validated(() => parseUpdateChangesQuery(paramsOf(queryString, lang)));
        const update = loadedDataset.updatesById.get(id);
        if (!update) throw new ApiError('Update not found', 404);
        return staticUpdateChanges(loadedDataset, asDetail(update), query);
    },

    compareUpdates: async (
        from: number,
        to: number,
        queryString: string,
        lang: Lang,
    ): Promise<UpdateCompareResponse> => {
        const loadedDataset = await loadDataset();
        if (from >= to) throw new ApiError('from must be less than to', 400);
        const query = validated(() => parseUpdateChangesQuery(paramsOf(queryString, lang)));
        const fromUpdate = loadedDataset.updatesById.get(from);
        const toUpdate = loadedDataset.updatesById.get(to);
        if (!fromUpdate || !toUpdate) throw new ApiError('Update not found', 404);
        return staticCompare(loadedDataset, asDetail(fromUpdate), asDetail(toUpdate), query);
    },

    // Write calls are stubs that always reject (readOnly): they only exist so this object has the same type as restApi.
    // The static site is a read-only snapshot, so the UI never offers editing tests or starting updates.
    setTest: (_id: number, _update: ItemTestUpdate): Promise<unknown> => readOnly(),
    importStatus: (): Promise<ImportStatus> => readOnly(),
    deleteUpdate: (_id: number): Promise<void> => readOnly(),
    startUpdate: (): Promise<unknown> => readOnly(),
};

/**
 * Downloads the filtered list (all matches) as CSV or JSON, generated in the browser.
 * Same format as GET /api/items/export (CSV with semicolon and BOM).
 */
export async function downloadStaticExport(queryString: string, lang: Lang, format: 'csv' | 'json'): Promise<void> {
    const loadedDataset = await loadDataset();
    const query = validated(() => parseItemListQuery(paramsOf(queryString, lang)));
    const rows = exportStaticItems(loadedDataset, query);
    // Blob = in-memory file; an <a download> click on an object URL makes the browser save it.
    const blob =
        format === 'json'
            ? new Blob([toJson(rows)], { type: 'application/json' })
            : new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename(query.view, format);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
