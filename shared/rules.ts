// Rules and constants shared by the server (SQL) and the browser (static version).
// Runtime code without Node or browser dependencies: the server builds its SQL conditions from it,
// the static version evaluates the same rules in JavaScript.
// TypeScript notes: `readonly T[]` is an array that cannot be modified; `as const` freezes a literal to its exact
// values; `Pick<T, K>` is T reduced to the listed properties.
// GW2 terms: a "candidate" is an item whose game_types contain "Dungeon" (might work in Fractals of the Mist);
// a "gizmo" is a usable miscellaneous item; a "tonic" is a transformation item; a "placeholder" is an internal
// dummy item without real content.

import type { GameType, Lang, Rarity, TestStatus } from './types.js';

/** All rarities from worst to best; the index is the sort rank. */
export const RARITIES: readonly Rarity[] = [
    'Junk',
    'Basic',
    'Fine',
    'Masterwork',
    'Rare',
    'Exotic',
    'Ascended',
    'Legendary',
];
/** All game types the API knows. */
export const GAME_TYPES: readonly GameType[] = ['Activity', 'Dungeon', 'Pve', 'Pvp', 'PvpLobby', 'Wvw'];
/** All manual test results. */
export const TEST_STATUSES: readonly TestStatus[] = ['untested', 'works', 'broken'];
/** Sort keys of the item list (the type is derived from this tuple, see params.ts). */
export const ITEM_SORTS = ['name', 'id', 'rarity', 'level', 'lastChanged'] as const;

/** hideCommon hides consumables of these subtypes (Food, Utility, Unlock, Transmutation, Currency). */
export const HIDE_COMMON_SUBTYPES = ['Food', 'Utility', 'Unlock', 'Transmutation', 'Currency'] as const;

/** Is every consumable of this subtype hidden by hideCommon? The UI uses it to grey out such subtype options. */
export const isHiddenByHideCommon = (subtype: string): boolean =>
    (HIDE_COMMON_SUBTYPES as readonly string[]).includes(subtype);

/**
 * Selectable subtypes (`details.type`) of the consumable filter. A fixed list so the URL can be validated the same
 * way on the server and in the browser; a new subtype after a game patch stays visible when unfiltered
 * but must be added here before it can be selected.
 */
export const CONSUMABLE_SUBTYPES = [
    'AppearanceChange',
    'Booze',
    'ContractNpc',
    'Currency',
    'Food',
    'Generic',
    'Halloween',
    'Immediate',
    'MountRandomUnlock',
    'RandomUnlock',
    'TeleportToFriend',
    'Transmutation',
    'Unlock',
    'UpgradeRemoval',
    'Utility',
] as const;

/** Item types the tonic view can be narrowed to (tonics exist as Gizmo and as Consumable). */
export const ITEM_TYPE_FILTER = ['Gizmo', 'Consumable'] as const;

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
export const asciiLower = (text: string): string => text.replace(/[A-Z]+/g, (match) => match.toLowerCase());

/** Like SQLite trim(): removes spaces only (no tab, no line break). */
export const sqlTrim = (text: string): string => text.replace(/^ +| +$/g, '');

/** Fractal candidate: game_types contains Dungeon. */
export const hasDungeon = (gameTypes: readonly string[] | null | undefined): boolean =>
    !!gameTypes && gameTypes.includes('Dungeon');

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
    return (
        sqlTrim(item.name) === '' ||
        item.icon === null ||
        /^\(\(.*\)\)$/s.test(item.name) ||
        /^\[\[.*\]\]$/s.test(item.name)
    );
}

/**
 * hideCommon hides these: consumables of the subtypes in HIDE_COMMON_SUBTYPES as well as Mastery Points
 * (name sometimes with a leading space), Emote Tomes and currency packs such as "300 Geodes"
 * (subtype Immediate, name starts with a number and a space).
 */
export function isCommonConsumable(item: Pick<RuleItem, 'name' | 'type' | 'subtype'>): boolean {
    if (item.type !== 'Consumable') return false;
    if (item.subtype !== null && isHiddenByHideCommon(item.subtype)) return true;
    return (
        sqlTrim(item.name) === 'Mastery Point' ||
        asciiLower(item.name).endsWith('emote tome') ||
        (item.subtype === 'Immediate' && /^[0-9][\s\S]* /.test(item.name))
    );
}

/**
 * Lowercase phrases of the English description that mark an item as consumed automatically when it is acquired
 * (e.g. skins that unlock in the wardrobe, currency-like trophies). The API has no flag for this, so the filter
 * is text based and deliberately incomplete. Phrases must not contain '%' or '_' (they are used in SQL LIKE
 * patterns) and use ASCII characters only (LIKE and asciiLower only fold ASCII case).
 */
export const AUTO_CONSUMED_PHRASES: readonly string[] = [
    'consumed automatically when acquired',
    'consumed immediately when acquired',
    'immediately consumed on acquisition',
    'automatically consumed upon receiving',
    'this item is consumed immediately',
    // Shortened before "'s vaults" so a typographic apostrophe in a future API text still matches.
    'will automatically transfer to the consortium',
];

/** Is the item consumed automatically on acquisition, judging by its English description? */
export function isAutoConsumed(descriptionEn: string | null | undefined): boolean {
    if (!descriptionEn) return false;
    const lowered = asciiLower(descriptionEn);
    return AUTO_CONSUMED_PHRASES.some((phrase) => lowered.includes(phrase));
}

/**
 * Lowercase phrase that marks an item as belonging to the homestead (the player's personal housing instance from
 * Janthir Wilds). ASCII only and free of '%' and '_' because it is used in SQL LIKE patterns.
 */
export const HOMESTEAD_PHRASE = 'homestead';

/** Item types whose texts are checked for HOMESTEAD_PHRASE (limits false hits on trophies, containers etc.). */
export const HOMESTEAD_ITEM_TYPES = ['Consumable', 'Gizmo'] as const;

/**
 * Is the item a guild hall or homestead item? True if the API says it belongs to a guild upgrade
 * (`details.guild_upgrade_id`: the guild hall upgrade or decoration the item unlocks or deposits; the caller passes
 * whether it is set, 0 counts as set), or if a Consumable/Gizmo mentions the homestead in its English name or
 * description. The API has no homestead flag, so that part is text based. German texts never contain
 * "homestead", so only the English fields are used.
 */
export function isGuildOrHomesteadItem(item: {
    type: string;
    name: string;
    descriptionEn: string | null | undefined;
    hasGuildUpgrade: boolean;
}): boolean {
    if (item.hasGuildUpgrade) return true;
    if (!(HOMESTEAD_ITEM_TYPES as readonly string[]).includes(item.type)) return false;
    return (
        asciiLower(item.name).includes(HOMESTEAD_PHRASE) ||
        asciiLower(item.descriptionEn ?? '').includes(HOMESTEAD_PHRASE)
    );
}

/** The hideCommon filter only applies in the Consumables and All views. */
export const hideCommonApplies = (view: string): boolean => view === 'consumable' || view === 'all';

/** The itemType filter only applies in the Tonics view (tonics are the only list that mixes Gizmo and Consumable). */
export const itemTypeFilterApplies = (view: string): boolean => view === 'tonic';

/** The subtype filter only applies in the Consumables view. */
export const subtypeFilterApplies = (view: string): boolean => view === 'consumable';

// ---------------------------------------------------------------------------
// Wiki link and chat link
// ---------------------------------------------------------------------------

/** Wiki search URL for an item name, in the wiki of the given language. */
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
    // atob decodes Base64 into a "binary string": one character per byte.
    let binary: string;
    try {
        binary = atob(match[1]!);
    } catch {
        return null;
    }
    if (binary.length < 5 || binary.charCodeAt(0) !== 0x02) return null;
    // Combine three bytes to a number (little endian: lowest byte first).
    return binary.charCodeAt(2) | (binary.charCodeAt(3) << 8) | (binary.charCodeAt(4) << 16);
}

/** Chat link of an item as the game generates it (type 2, quantity 1). */
export function chatLinkForId(id: number): string {
    // The trailing 0x00 byte matches what the game generates.
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
        // Keys sorted, undefined values dropped (JSON.stringify omits them as well).
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

/** Compares strings by code point order (like SQLite's BINARY collation on UTF-8); returns -1, 0 or 1. */
export function compareCodePoints(a: string, b: string): number {
    if (a === b) return 0;
    const length = Math.min(a.length, b.length);
    // Find the first position where the strings differ.
    for (let i = 0; i < length; i++) {
        const codeUnitA = a.charCodeAt(i);
        const codeUnitB = b.charCodeAt(i);
        if (codeUnitA === codeUnitB) continue;
        // Surrogates (0xD800-0xDFFF) are the UTF-16 halves of characters outside the BMP.
        const surrogateA = codeUnitA >= 0xd800 && codeUnitA <= 0xdfff;
        const surrogateB = codeUnitB >= 0xd800 && codeUnitB <= 0xdfff;
        if (surrogateA !== surrogateB) return surrogateA ? 1 : -1; // characters outside the BMP are greater
        return codeUnitA < codeUnitB ? -1 : 1;
    }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}
