import type { StatsResponse } from '../../shared/types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  stats: () => getJson<StatsResponse>('/api/stats'),
};
