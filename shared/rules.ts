// Rules and constants shared by the server (SQL) and the browser (static version).
// Runtime code without Node or browser dependencies: the server builds its SQL conditions from it,
// the static version evaluates the same rules in JavaScript.

import type { GameType, Lang, Rarity, TestStatus } from './types.js';

export const RARITIES: readonly Rarity[] = ['Junk', 'Basic', 'Fine', 'Masterwork', 'Rare', 'Exotic', 'Ascended', 'Legendary'];
export const GAME_TYPES: readonly GameType[] = ['Activity', 'Dungeon', 'Pve', 'Pvp', 'PvpLobby', 'Wvw'];
export const TEST_STATUSES: readonly TestStatus[] = ['untested', 'works', 'broken'];
export const ITEM_SORTS = ['name', 'id', 'rarity', 'level', 'lastChanged'] as const;

/** hideCommon hides consumables of these subtypes (Food, Utility, Unlock, Transmutation, Currency). */
export const HIDE_COMMON_SUBTYPES = ['Food', 'Utility', 'Unlock', 'Transmutation', 'Currency'] as const;

/** Subtype whose items never count as tonics (recipes). */
export const TONIC_EXCLUDED_SUBTYPE = 'Unlock';

/** Prefix of all icon URLs; the static version stores only the rest. */
export const ICON_PREFIX = 'https://render.guildwars2.com/file/';

/** The field by which placeholders, tonics etc. are judged (English state). */
export interface RuleItem {
  name: string;
  type: string;
  subtype: string | null;
  icon: string | null;
  flags: readonly string[];
}

/**
 * Like SQLite lower(): only ASCII uppercase letters are converted. LIKE and COLLATE NOCASE
 * also only know ASCII, so the browser must compare the same way.
 */
export const asciiLower = (text: string): string => text.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/** Like SQLite trim(): removes spaces only (no tab, no line break). */
export const sqlTrim = (text: string): string => text.replace(/^ +| +$/g, '');

/** Fractal candidate: game_types contains Dungeon. */
export const hasDungeon = (gameTypes: readonly string[] | null | undefined): boolean => !!gameTypes && gameTypes.includes('Dungeon');

/**
 * Tonics: transformation items. Partly Gizmo, partly Consumable, sometimes with the flag "Tonic",
 * sometimes recognizable only by name. Subtype Unlock are the matching recipes.
 */
export function isTonic(item: Pick<RuleItem, 'name' | 'type' | 'subtype' | 'flags'>): boolean {
  return (
    (item.type === 'Gizmo' || item.type === 'Consumable') &&
    (item.flags.includes('Tonic') || asciiLower(item.name).includes('tonic')) &&
    (item.subtype === null || item.subtype !== TONIC_EXCLUDED_SUBTYPE)
  );
}

/** Placeholders: empty name, no icon, or internal name such as "((906936))" or "[[913817]]". */
export function isPlaceholder(item: Pick<RuleItem, 'name' | 'icon'>): boolean {
  return sqlTrim(item.name) === '' || item.icon === null || /^\(\(.*\)\)$/s.test(item.name) || /^\[\[.*\]\]$/s.test(item.name);
}

/**
 * hideCommon hides these: consumables of the subtypes in HIDE_COMMON_SUBTYPES as well as Mastery Points
 * (name sometimes with a leading space), Emote Tomes and currency packs such as "300 Geodes"
 * (subtype Immediate, name starts with a number and a space).
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

/** The hideCommon filter only applies in the Consumables and All views. */
export const hideCommonApplies = (view: string): boolean => view === 'consumable' || view === 'all';

// ---------------------------------------------------------------------------
// Wiki link and chat link
// ---------------------------------------------------------------------------

export const wikiUrl = (lang: Lang, name: string): string =>
  lang === 'de'
    ? `https://wiki-de.guildwars2.com/wiki/Spezial:Suche/${encodeURIComponent(name)}`
    : `https://wiki.guildwars2.com/wiki/Special:Search/${encodeURIComponent(name)}`;

/**
 * Item ID from a GW2 chat link such as [&AgEAWgAA]. Layout (Base64): byte 0 = type (2 = item),
 * byte 1 = quantity, bytes 2–4 = item ID (little endian). Links copied in-game can differ from the
 * API's chat_link (e.g. different quantity), so the ID is evaluated.
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

/** Chat link of an item as the game generates it (type 2, quantity 1). */
export function chatLinkForId(id: number): string {
  const bytes = [0x02, 0x01, id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, 0x00];
  return `[&${btoa(String.fromCharCode(...bytes))}]`;
}

// ---------------------------------------------------------------------------
// JSON with stable key order
// ---------------------------------------------------------------------------

/**
 * JSON with recursively sorted object keys. The API does not guarantee a fixed key order,
 * without sorting the same item could get different hashes.
 * Array order is preserved (it can be relevant).
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
// Sorting like SQLite
// ---------------------------------------------------------------------------

/**
 * Comparison like `ORDER BY text COLLATE NOCASE` in SQLite: ASCII case-insensitive,
 * otherwise UTF-8 byte order (= code point order). JavaScript compares strings by
 * UTF-16 code units; this differs only for characters outside the BMP versus U+E000–U+FFFF.
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
    if (surrogateA !== surrogateB) return surrogateA ? 1 : -1; // characters outside the BMP are greater
    return ca < cb ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}
