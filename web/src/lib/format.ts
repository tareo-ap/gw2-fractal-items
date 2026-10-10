import type { ChangeKind, ImportStatus, Rarity, TestStatus } from '../../../shared/types';
import type { UpdateListEntry } from '../api';

export function formatNumber(n: number): string {
  return n.toLocaleString('de-DE');
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

/** CSS-Klasse, die --rc auf die passende Seltenheitsfarbe setzt. */
export function rarityClass(rarity: Rarity | string): string {
  return `rarity-${rarity.toLowerCase()}`;
}

export const TEST_LABELS: Record<TestStatus, string> = {
  untested: 'Ungetestet',
  works: 'Funktioniert',
  broken: 'Funktioniert nicht',
};

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  added: 'Neu',
  changed: 'Geändert',
  removed: 'Entfernt',
};

export const PHASE_LABELS: Record<ImportStatus['phase'], string> = {
  idle: 'Bereit',
  ids: 'Lade Item-IDs',
  details: 'Lade Item-Details',
  diff: 'Vergleiche mit Cache',
  done: 'Fertig',
  failed: 'Fehlgeschlagen',
};

/** Kurzbeschreibung eines Updates für das Dropdown, z. B. "10.10.2026, 14:03 · +12 neu · 30 geändert". */
export function describeUpdate(u: UpdateListEntry): string {
  const parts = [formatDateTime(u.startedAt), `${u.added} neu`, `${u.changed} geändert`, `${u.removed} entfernt`];
  if (u.dungeonGained !== undefined || u.dungeonLost !== undefined) {
    parts.push(`Dungeon +${u.dungeonGained ?? 0} / −${u.dungeonLost ?? 0}`);
  }
  if (u.status === 'running') parts.push('läuft');
  if (u.status === 'failed') parts.push('fehlgeschlagen');
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
