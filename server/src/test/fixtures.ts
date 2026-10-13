import { openDatabase } from '../db/index.js';
import { Gw2Client, type Gw2Item } from '../gw2/client.js';
import { Importer } from '../importer/importer.js';

/** Chat link for an item ID as the game generates it (type 2, quantity 1). */
export function chatLinkFor(id: number): string {
    const bytes = Buffer.from([0x02, 0x01, id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, 0x00]);
    return `[&${bytes.toString('base64')}]`;
}

// Builds a minimal GW2 API item for the fixtures below.
function item(id: number, name: string, type: string, subtype: string, rarity: string, gameTypes: string[]): Gw2Item {
    return {
        name,
        description: `Description of ${name}.`,
        type,
        level: 0,
        rarity,
        vendor_value: 10,
        game_types: gameTypes,
        flags: ['NoSell'],
        restrictions: [],
        id,
        chat_link: chatLinkFor(id),
        icon: `https://render.guildwars2.com/file/${id}.png`,
        details: { type: subtype },
    };
}

// A function (not a constant) so every test gets fresh objects it may modify.
// Candidates (game type Dungeon): 1, 3, 8778, 4, 5. Not candidates: 2, 6 (6 is also not a Gizmo/Consumable).
export const fixtureItems = (): Gw2Item[] => [
    item(1, 'Mini Golem Kit', 'Gizmo', 'Default', 'Rare', ['Pve', 'Dungeon', 'Wvw']),
    item(2, 'Banner of Strength', 'Gizmo', 'Default', 'Exotic', ['Pve', 'Wvw']),
    item(3, 'Old Gizmo', 'Gizmo', 'Default', 'Basic', ['Dungeon', 'Pve']),
    item(8778, 'Mini Golem Bomb', 'Consumable', 'Generic', 'Fine', ['Dungeon', 'Pve', 'Wvw']),
    item(4, 'Bowl of Soup', 'Consumable', 'Food', 'Fine', ['Dungeon', 'Pve']),
    item(5, 'Sharpening Stone', 'Consumable', 'Utility', 'Masterwork', ['Dungeon', 'Pve']),
    item(6, 'Shiny Rock', 'Trophy', 'Default', 'Junk', ['Pve']),
];

/**
 * Extra candidates for the hideAutoConsumed filter (IDs 401-404), meant to be added to fixtureItems().
 * 401: plain phrase, 402: skin wording with subtype Transmutation, 403: phrase inside markup (Gizmo),
 * 404: no phrase in English (set a German text with a phrase to check that only English counts).
 */
export const autoConsumedFixtureItems = (): Gw2Item[] => {
    const base = item(401, 'Volatile Trophy', 'Consumable', 'Immediate', 'Fine', ['Dungeon', 'Pve']);
    return [
        { ...base, description: 'Consumed AUTOMATICALLY when acquired.' },
        {
            ...base,
            id: 402,
            name: 'Skin Unlock',
            details: { type: 'Transmutation' },
            description: 'Unlocks the skin. Consumed immediately when acquired.',
        },
        {
            ...base,
            id: 403,
            name: 'Marked Up Gizmo',
            type: 'Gizmo',
            details: { type: 'Default' },
            description: 'Rare. <c=@flavor>This item is consumed immediately.</c>',
        },
        { ...base, id: 404, name: 'Manual Trophy', description: 'Double-click to use.' },
    ];
};

/**
 * Extra items for the hideGuildHomestead filter (IDs 701-709), meant to be added to fixtureItems().
 * Candidates unless noted. Hidden by default: 701-703 (guild_upgrade_id set), 705 (homestead in the name only,
 * upper case), 706 (homestead in the description only), 708 (guild_upgrade_id 0 counts as set), 709 (Gizmo without
 * description, not a candidate). Shown: 704 (guild_upgrade_id null, neutral texts) and 707 (Trophy: the text rule
 * only covers Consumable and Gizmo).
 */
export const guildHomesteadFixtureItems = (): Gw2Item[] => {
    const base = item(701, 'Guild Decoration', 'Consumable', 'Generic', 'Fine', ['Dungeon', 'Pve']);
    return [
        { ...base, details: { type: 'Generic', guild_upgrade_id: 123 } },
        { ...base, id: 702, name: 'Guild Banner', details: { type: 'Immediate', guild_upgrade_id: 45 } },
        { ...base, id: 703, name: 'Guild Gizmo', type: 'Gizmo', details: { type: 'Default', guild_upgrade_id: 67 } },
        { ...base, id: 704, name: 'Plain Decoration', details: { type: 'Generic', guild_upgrade_id: null } },
        { ...base, id: 705, name: 'Recipe: HOMESTEAD Bench', details: { type: 'Unlock' } },
        {
            ...base,
            id: 706,
            name: 'Jukebox Track',
            description: 'Adds a song to your Homestead and home instance jukebox.',
        },
        { ...base, id: 707, name: 'Homestead Relic', type: 'Trophy', details: { type: 'Default' } },
        { ...base, id: 708, name: 'Zero Upgrade', details: { type: 'Generic', guild_upgrade_id: 0 } },
        {
            ...base,
            id: 709,
            name: 'Homestead Gizmo',
            type: 'Gizmo',
            description: undefined,
            game_types: ['Pve'],
            details: { type: 'Default' },
        },
    ];
};

/** In-memory DB plus importer against the fake server, without throttling and with short backoff. */
// `:memory:` = SQLite database that lives only in RAM and vanishes on close.
export function createTestImporter(apiUrl: string) {
    const db = openDatabase(':memory:');
    const client = new Gw2Client({ baseUrl: apiUrl, minIntervalMs: 0, retryBaseDelayMs: 1 });
    return { db, importer: new Importer(db, client) };
}

/** Starts an import and waits for it to finish. */
export async function runImport(importer: Importer) {
    importer.start();
    await importer.waitForIdle();
    return importer.getStatus();
}
