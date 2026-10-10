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
 * Eintrag aus GET /api/updates. Laut Vertrag UpdateSummary; liefert der Server
 * zusätzlich die Felder aus UpdateDetail, zeigt die UI sie an.
 */
export type UpdateListEntry = UpdateSummary & Partial<Pick<UpdateDetail, 'status' | 'dungeonGained' | 'dungeonLost' | 'deletable' | 'deleteBlockedReason'>>;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Backend nicht erreichbar', 0);
  }
  if (!res.ok) {
    // Der Server liefert Fehler als { error: "…" }; sonst reicht der Statuscode.
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string') message = data.error;
    } catch {
      /* kein JSON */
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const restApi = {
  stats: () => request<StatsResponse>('GET', '/api/stats'),
  items: (queryString: string, lang: Lang) => request<ItemListResponse>('GET', `/api/items?${queryString}&lang=${lang}`),
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
 * Datenquelle der App, beim Build festgelegt (VITE_DATA_MODE): "api" (Standard) fragt den Server, "static" liest die
 * JSON-Dateien der Pages-Fassung. Die Bedingung steht direkt hier, damit Vite den jeweils anderen Zweig weglässt.
 */
export const api: typeof restApi = import.meta.env.VITE_DATA_MODE === 'static' ? staticApi : restApi;
