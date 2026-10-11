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

const DATA_URL = `${import.meta.env.BASE_URL}data/`;

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

function loadBlock(n: number): Promise<StaticDetailBlock> {
    let block = blocks.get(n);
    if (!block) {
        block = fetchJson<StaticDetailBlock>(`details/${n}.json`);
        blocks.set(n, block);
        block.catch(() => blocks.delete(n));
    }
    return block;
}

/** Input errors as a response with status 400, like on the server. */
function validated<T>(parse: () => T): T {
    try {
        return parse();
    } catch (err) {
        if (err instanceof ValidationError) throw new ApiError(err.message, 400);
        throw err;
    }
}

const paramsOf = (queryString: string, lang: Lang): Record<string, string> => ({
    ...Object.fromEntries(new URLSearchParams(queryString)),
    lang,
});

// The responses carry update/from/to without deletable fields (the Pages version deletes nothing).
const asDetail = (update: StaticUpdate) => update as UpdateDetail;

const readOnly = (): Promise<never> => Promise.reject(new ApiError('Read-only version', 405));

export const staticApi = {
    stats: async (): Promise<StatsResponse> => staticStats(await loadDataset()),

    items: async (queryString: string, lang: Lang): Promise<ItemListResponse> => {
        const ds = await loadDataset();
        return listStaticItems(
            ds,
            validated(() => parseItemListQuery(paramsOf(queryString, lang))),
        );
    },

    item: async (id: number, lang: Lang): Promise<ItemDetail> => {
        const ds = await loadDataset();
        const block = detailBlockOf(ds, id);
        if (block === null) throw new ApiError('Item not found', 404);
        const rest = (await loadBlock(block))[id];
        return staticItemDetail(ds, id, lang, rest)!;
    },

    updates: async (): Promise<UpdateListEntry[]> => (await loadDataset()).updates,

    updateChanges: async (id: number, queryString: string, lang: Lang): Promise<UpdateChangesResponse> => {
        const ds = await loadDataset();
        const query = validated(() => parseUpdateChangesQuery(paramsOf(queryString, lang)));
        const update = ds.updatesById.get(id);
        if (!update) throw new ApiError('Update not found', 404);
        return staticUpdateChanges(ds, asDetail(update), query);
    },

    compareUpdates: async (
        from: number,
        to: number,
        queryString: string,
        lang: Lang,
    ): Promise<UpdateCompareResponse> => {
        const ds = await loadDataset();
        if (from >= to) throw new ApiError('from must be less than to', 400);
        const query = validated(() => parseUpdateChangesQuery(paramsOf(queryString, lang)));
        const fromUpdate = ds.updatesById.get(from);
        const toUpdate = ds.updatesById.get(to);
        if (!fromUpdate || !toUpdate) throw new ApiError('Update not found', 404);
        return staticCompare(ds, asDetail(fromUpdate), asDetail(toUpdate), query);
    },

    // Write calls exist for form only; the UI does not offer them in this version.
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
    const ds = await loadDataset();
    const query = validated(() => parseItemListQuery(paramsOf(queryString, lang)));
    const rows = exportStaticItems(ds, query);
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
