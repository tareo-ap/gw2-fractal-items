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
    UpdateSummary,
} from '../../shared/types';
import { ApiError } from './lib/apiError';
import { staticApi } from './lib/staticApi';

export { ApiError };

/**
 * Entry from GET /api/updates. By contract UpdateSummary; if the server also
 * returns the fields from UpdateDetail, the UI displays them.
 */
export type UpdateListEntry = UpdateSummary &
    Partial<Pick<UpdateDetail, 'status' | 'dungeonGained' | 'dungeonLost' | 'deletable' | 'deleteBlockedReason'>>;

/** Sends a JSON request and returns the parsed response body. Throws ApiError on network or HTTP errors. */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
    let res: Response; // declared outside try so it is usable afterwards
    try {
        res = await fetch(url, {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new ApiError('Backend unreachable', 0);
    }
    if (!res.ok) {
        // The server returns errors as { error: "…" }; otherwise the status code is enough.
        let message = `HTTP ${res.status}`;
        try {
            const data = (await res.json()) as { error?: unknown };
            if (typeof data.error === 'string') message = data.error;
        } catch {
            /* not JSON */
        }
        throw new ApiError(message, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
}

// All backend calls in one place; components never call fetch directly. queryString is an already built "a=b&c=d".
const restApi = {
    stats: () => request<StatsResponse>('GET', '/api/stats'),
    items: (queryString: string, lang: Lang) =>
        request<ItemListResponse>('GET', `/api/items?${queryString}&lang=${lang}`),
    item: (id: number, lang: Lang) => request<ItemDetail>('GET', `/api/items/${id}?lang=${lang}`),
    setTest: (id: number, update: ItemTestUpdate) => request<unknown>('PUT', `/api/items/${id}/test`, update),
    updates: () => request<UpdateListEntry[]>('GET', '/api/updates'),
    updateChanges: (id: number, queryString: string, lang: Lang) =>
        request<UpdateChangesResponse>('GET', `/api/updates/${id}/changes?${queryString}&lang=${lang}`),
    compareUpdates: (from: number, to: number, queryString: string, lang: Lang) =>
        request<UpdateCompareResponse>('GET', `/api/updates/compare?from=${from}&to=${to}&${queryString}&lang=${lang}`),
    importStatus: () => request<ImportStatus>('GET', '/api/updates/status'),
    deleteUpdate: (id: number) => request<void>('DELETE', `/api/updates/${id}`),
    startUpdate: () => request<unknown>('POST', '/api/updates'),
};

/**
 * Data source of the app, fixed at build time (VITE_DATA_MODE): "api" (default) queries the server, "static" reads the
 * JSON files of the Pages version. The condition is written right here so Vite drops the other branch.
 */
// `typeof restApi` makes the static variant satisfy the same shape, so callers do not care which one is active.
export const api: typeof restApi = import.meta.env.VITE_DATA_MODE === 'static' ? staticApi : restApi;
