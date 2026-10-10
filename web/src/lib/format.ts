import type { Rarity } from '../../../shared/types';
import { wikiUrl } from '../../../shared/rules';
import type { UpdateListEntry } from '../api';
import type { I18n } from './i18n';

/** CSS class that sets --rc to the matching rarity color. */
export function rarityClass(rarity: Rarity | string): string {
  return `rarity-${rarity.toLowerCase()}`;
}

/** Short description of an update for the dropdown, e.g. "10.10.2026, 14:03 · 12 new · 30 changed". */
/** Wiki search for the item name (same function as on the server, see shared/rules.ts). */
export const wikiSearchUrl = wikiUrl;

/** Time in UTC as "YYYY-MM-DD_HH:MM", independent of the browser's language and time zone. */
export function utcStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 10)}_${date.toISOString().slice(11, 16)}`;
}

/** Name of a state: "<YYYY-MM-DD>_<HH:MM UTC>_<game build>", e.g. "2026-10-10_11:23_208039". */
export function stateName(u: { startedAt: string; buildId: number | null }): string {
  return `${utcStamp(u.startedAt)}_${u.buildId ?? '?'}`;
}

/** Select entry: name of the state, with a note for running or failed updates. */
export function describeUpdate(u: UpdateListEntry, { t }: Pick<I18n, 't'>): string {
  if (u.status === 'running') return `${stateName(u)} · ${t('update.describeRunning')}`;
  if (u.status === 'failed') return `${stateName(u)} · ${t('update.describeFailed')}`;
  return stateName(u);
}

/** Vendor value in copper -> "1g 2s 3c". */
export function formatCoins(copper: number): string {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  const parts: string[] = [];
  if (g) parts.push(`${g}g`);
  if (s) parts.push(`${s}s`);
  if (c || parts.length === 0) parts.push(`${c}c`);
  return parts.join(' ');
}
