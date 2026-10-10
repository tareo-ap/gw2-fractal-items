// Regeln und Konstanten, die Server (SQL) und Browser (statische Fassung) gemeinsam nutzen.
// Laufzeitcode ohne Node- oder Browser-Abhängigkeiten: Der Server baut daraus seine SQL-Bedingungen,
// die statische Fassung wertet dieselben Regeln in JavaScript aus.

import type { GameType, Lang, Rarity, TestStatus } from './types.js';

export const RARITIES: readonly Rarity[] = ['Junk', 'Basic', 'Fine', 'Masterwork', 'Rare', 'Exotic', 'Ascended', 'Legendary'];
export const GAME_TYPES: readonly GameType[] = ['Activity', 'Dungeon', 'Pve', 'Pvp', 'PvpLobby', 'Wvw'];
export const TEST_STATUSES: readonly TestStatus[] = ['untested', 'works', 'broken'];
export const ITEM_SORTS = ['name', 'id', 'rarity', 'level', 'lastChanged'] as const;

/** Consumables dieser Untertypen blendet hideCommon aus (Food, Utility, Unlock, Transmutation, Currency). */
export const HIDE_COMMON_SUBTYPES = ['Food', 'Utility', 'Unlock', 'Transmutation', 'Currency'] as const;

/** Untertyp, dessen Items nie als Tonic gelten (Rezepte). */
export const TONIC_EXCLUDED_SUBTYPE = 'Unlock';

/** Präfix aller Icon-URLs; die statische Fassung speichert nur den Rest. */
export const ICON_PREFIX = 'https://render.guildwars2.com/file/';

/** Das Feld, nach dem Platzhalter, Tonics usw. beurteilt werden (englischer Stand). */
export interface RuleItem {
  name: string;
  type: string;
  subtype: string | null;
  icon: string | null;
  flags: readonly string[];
}

/**
 * Wie SQLite lower(): Nur ASCII-Großbuchstaben werden umgewandelt. LIKE und COLLATE NOCASE
 * kennen ebenfalls nur ASCII, deshalb muss der Browser genauso vergleichen.
 */
export const asciiLower = (text: string): string => text.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/** Wie SQLite trim(): entfernt nur Leerzeichen (kein Tab, kein Zeilenumbruch). */
export const sqlTrim = (text: string): string => text.replace(/^ +| +$/g, '');

/** Fractal-Kandidat: game_types enthält Dungeon. */
export const hasDungeon = (gameTypes: readonly string[] | null | undefined): boolean => !!gameTypes && gameTypes.includes('Dungeon');

/**
 * Tonics: Verwandlungs-Items. Teils als Gizmo, teils als Consumable, mal mit Flag "Tonic",
 * mal nur am Namen erkennbar. Untertyp Unlock sind die zugehörigen Rezepte.
 */
export function isTonic(item: Pick<RuleItem, 'name' | 'type' | 'subtype' | 'flags'>): boolean {
  return (
    (item.type === 'Gizmo' || item.type === 'Consumable') &&
    (item.flags.includes('Tonic') || asciiLower(item.name).includes('tonic')) &&
    (item.subtype === null || item.subtype !== TONIC_EXCLUDED_SUBTYPE)
  );
}

/** Platzhalter: leerer Name, kein Icon oder interner Name wie "((906936))" bzw. "[[913817]]". */
export function isPlaceholder(item: Pick<RuleItem, 'name' | 'icon'>): boolean {
  return sqlTrim(item.name) === '' || item.icon === null || /^\(\(.*\)\)$/s.test(item.name) || /^\[\[.*\]\]$/s.test(item.name);
}

/**
 * Das blendet hideCommon aus: Consumables der Untertypen aus HIDE_COMMON_SUBTYPES sowie Mastery Points
 * (Name teils mit führendem Leerzeichen), Emote Tomes und Währungspakete wie "300 Geodes"
 * (Untertyp Immediate, Name beginnt mit Zahl und Leerzeichen).
 */
export function isCommonConsumable(item: Pick<RuleItem, 'name' | 'type' | 'subtype'>): boolean {
  if (item.type !== 'Consumable') return false;
  if (item.subtype !== null && (HIDE_COMMON_SUBTYPES as readonly string[]).includes(item.subtype)) return true;
  return (
    sqlTrim(item.name) === 'Mastery Point' ||
    asciiLower(item.name).endsWith('emote tome') ||
    (item.subtype === 'Immediate' && /^[0-9][\s\S]* /.test(item.name))
  );
}

/** Der Filter hideCommon wirkt nur in den Ansichten Consumables und Alle. */
export const hideCommonApplies = (view: string): boolean => view === 'consumable' || view === 'all';

// ---------------------------------------------------------------------------
// Wiki-Link und Chat-Link
// ---------------------------------------------------------------------------

export const wikiUrl = (lang: Lang, name: string): string =>
  lang === 'de'
    ? `https://wiki-de.guildwars2.com/wiki/Spezial:Suche/${encodeURIComponent(name)}`
    : `https://wiki.guildwars2.com/wiki/Special:Search/${encodeURIComponent(name)}`;

/**
 * Item-ID aus einem GW2-Chat-Link wie [&AgEAWgAA]. Aufbau (Base64): Byte 0 = Typ (2 = Item),
 * Byte 1 = Anzahl, Byte 2–4 = Item-ID (little endian). Ingame kopierte Links können sich vom
 * chat_link der API unterscheiden (z. B. andere Anzahl), deshalb wird die ID ausgewertet.
 */
export function itemIdFromChatLink(link: string): number | null {
  const match = /^\[&([A-Za-z0-9+/=]+)\]$/.exec(link);
  if (!match) return null;
  let binary: string;
  try {
    binary = atob(match[1]!);
  } catch {
    return null;
  }
  if (binary.length < 5 || binary.charCodeAt(0) !== 0x02) return null;
  return binary.charCodeAt(2) | (binary.charCodeAt(3) << 8) | (binary.charCodeAt(4) << 16);
}

/** Chat-Link eines Items, so wie ihn das Spiel erzeugt (Typ 2, Anzahl 1). */
export function chatLinkForId(id: number): string {
  const bytes = [0x02, 0x01, id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, 0x00];
  return `[&${btoa(String.fromCharCode(...bytes))}]`;
}

// ---------------------------------------------------------------------------
// JSON mit stabiler Key-Reihenfolge
// ---------------------------------------------------------------------------

/**
 * JSON mit rekursiv sortierten Objekt-Keys. Die API garantiert keine feste Key-Reihenfolge,
 * ohne Sortierung würde dasselbe Item sonst unterschiedliche Hashes bekommen.
 * Reihenfolgen in Arrays bleiben erhalten (die können inhaltlich relevant sein).
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// ---------------------------------------------------------------------------
// Sortierung wie SQLite
// ---------------------------------------------------------------------------

/**
 * Vergleich wie `ORDER BY text COLLATE NOCASE` in SQLite: ASCII-Groß-/Kleinschreibung egal,
 * sonst Byte-Reihenfolge von UTF-8 (= Reihenfolge der Codepoints). JavaScript vergleicht Strings nach
 * UTF-16-Einheiten; das weicht nur bei Zeichen außerhalb der BMP gegenüber U+E000–U+FFFF ab.
 */
export function compareNoCase(a: string, b: string): number {
  return compareCodePoints(asciiLower(a), asciiLower(b));
}

export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca === cb) continue;
    const surrogateA = ca >= 0xd800 && ca <= 0xdfff;
    const surrogateB = cb >= 0xd800 && cb <= 0xdfff;
    if (surrogateA !== surrogateB) return surrogateA ? 1 : -1; // Zeichen außerhalb der BMP sind größer
    return ca < cb ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}
