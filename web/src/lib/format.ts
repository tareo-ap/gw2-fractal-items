import type { Rarity } from '../../../shared/types';
import { wikiUrl } from '../../../shared/rules';
import type { UpdateListEntry } from '../api';
import type { I18n } from './i18n';

/** CSS class that sets --rc to the matching rarity color. */
export function rarityClass(rarity: Rarity | string): string {
    return `rarity-${rarity.toLowerCase()}`;
}

/** Wiki search for the item name (same function as on the server, see shared/rules.ts). */
// Re-exported under a UI-facing name.
export const wikiSearchUrl = wikiUrl;

/** Time in UTC as "YYYY-MM-DD_HH:MM", independent of the browser's language and time zone. */
export function utcStamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${date.toISOString().slice(0, 10)}_${date.toISOString().slice(11, 16)}`;
}

/** Name of a state: "<YYYY-MM-DD>_<HH:MM UTC>_<game build>", e.g. "2026-10-10_11:23_208039". */
export function stateName(update: { startedAt: string; buildId: number | null }): string {
    return `${utcStamp(update.startedAt)}_${update.buildId ?? '?'}`;
}

/**
 * Select entry: name of the state (a "state" = one stored snapshot of the item database, created by an update run),
 * with a note for running or failed updates.
 */
export function describeUpdate(update: UpdateListEntry, { t }: Pick<I18n, 't'>): string {
    if (update.status === 'running') return `${stateName(update)} · ${t('update.describeRunning')}`;
    if (update.status === 'failed') return `${stateName(update)} · ${t('update.describeFailed')}`;
    return stateName(update);
}

/** Vendor value in copper -> "1g 2s 3c". */
export function formatCoins(copper: number): string {
    const gold = Math.floor(copper / 10000);
    const silver = Math.floor((copper % 10000) / 100);
    const copperRest = copper % 100;
    const parts: string[] = [];
    if (gold) parts.push(`${gold}g`);
    if (silver) parts.push(`${silver}s`);
    if (copperRest || parts.length === 0) parts.push(`${copperRest}c`);
    return parts.join(' ');
}
