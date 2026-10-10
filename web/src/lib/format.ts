import type { Rarity } from '../../../shared/types';
import { wikiUrl } from '../../../shared/rules';
import type { UpdateListEntry } from '../api';
import type { I18n } from './i18n';

/** CSS-Klasse, die --rc auf die passende Seltenheitsfarbe setzt. */
export function rarityClass(rarity: Rarity | string): string {
  return `rarity-${rarity.toLowerCase()}`;
}

/** Kurzbeschreibung eines Updates für das Dropdown, z. B. "10.10.2026, 14:03 · 12 neu · 30 geändert". */
/** Wiki-Suche nach dem Item-Namen (dieselbe Funktion wie im Server, siehe shared/rules.ts). */
export const wikiSearchUrl = wikiUrl;

/** Zeitpunkt in UTC als "YYYY-MM-DD_HH:MM", unabhängig von Sprache und Zeitzone des Browsers. */
export function utcStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 10)}_${date.toISOString().slice(11, 16)}`;
}

/** Name eines Stands: "<YYYY-MM-DD>_<HH:MM UTC>_<Game-Build>", z. B. "2026-10-10_11:23_208039". */
export function stateName(u: { startedAt: string; buildId: number | null }): string {
  return `${utcStamp(u.startedAt)}_${u.buildId ?? '?'}`;
}

/** Eintrag im Auswahlfeld: Name des Stands, bei laufenden oder fehlgeschlagenen Updates mit Hinweis. */
export function describeUpdate(u: UpdateListEntry, { t }: Pick<I18n, 't'>): string {
  if (u.status === 'running') return `${stateName(u)} · ${t('update.describeRunning')}`;
  if (u.status === 'failed') return `${stateName(u)} · ${t('update.describeFailed')}`;
  return stateName(u);
}

/** Händlerwert in Kupfer → "1g 2s 3c". */
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
