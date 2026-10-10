import type {
  ImportStatus,
  ItemDetail,
  ItemListResponse,
  ItemTestUpdate,
  StatsResponse,
  UpdateChangesResponse,
  UpdateCompareResponse,
  UpdateDetail,
  UpdateSummary,
} from '../../shared/types';

/** Fehler mit HTTP-Status, damit die UI z. B. 404 oder 409 gezielt behandeln kann. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Eintrag aus GET /api/updates. Laut Vertrag UpdateSummary; liefert der Server
 * zusätzlich die Felder aus UpdateDetail, zeigt die UI sie an.
 */
export type UpdateListEntry = UpdateSummary & Partial<Pick<UpdateDetail, 'status' | 'dungeonGained' | 'dungeonLost'>>;

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

export const api = {
  stats: () => request<StatsResponse>('GET', '/api/stats'),
  items: (queryString: string) => request<ItemListResponse>('GET', `/api/items?${queryString}`),
  item: (id: number) => request<ItemDetail>('GET', `/api/items/${id}`),
  setTest: (id: number, update: ItemTestUpdate) => request<unknown>('PUT', `/api/items/${id}/test`, update),
  updates: () => request<UpdateListEntry[]>('GET', '/api/updates'),
  updateChanges: (id: number, queryString: string) =>
    request<UpdateChangesResponse>('GET', `/api/updates/${id}/changes?${queryString}`),
  compareUpdates: (from: number, to: number, queryString: string) =>
    request<UpdateCompareResponse>('GET', `/api/updates/compare?from=${from}&to=${to}&${queryString}`),
  importStatus: () => request<ImportStatus>('GET', '/api/updates/status'),
  startUpdate: () => request<unknown>('POST', '/api/updates'),
};
