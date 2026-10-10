import type { Rarity } from '../../../shared/types';
import type { UpdateListEntry } from '../api';
import type { I18n } from './i18n';

/** CSS-Klasse, die --rc auf die passende Seltenheitsfarbe setzt. */
export function rarityClass(rarity: Rarity | string): string {
  return `rarity-${rarity.toLowerCase()}`;
}

/** Kurzbeschreibung eines Updates für das Dropdown, z. B. "10.10.2026, 14:03 · 12 neu · 30 geändert". */
export function describeUpdate(u: UpdateListEntry, { t, formatDateTime }: Pick<I18n, 't' | 'formatDateTime'>): string {
  const parts = [
    formatDateTime(u.startedAt),
    t('update.describeNew', { n: u.added }),
    t('update.describeChanged', { n: u.changed }),
    t('update.describeRemoved', { n: u.removed }),
  ];
  if (u.dungeonGained !== undefined || u.dungeonLost !== undefined) {
    parts.push(`Dungeon +${u.dungeonGained ?? 0} / −${u.dungeonLost ?? 0}`);
  }
  if (u.status === 'running') parts.push(t('update.describeRunning'));
  if (u.status === 'failed') parts.push(t('update.describeFailed'));
  return parts.join(' · ');
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
