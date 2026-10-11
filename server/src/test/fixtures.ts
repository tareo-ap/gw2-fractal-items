import { openDatabase } from '../db/index.js';
import { Gw2Client, type Gw2Item } from '../gw2/client.js';
import { Importer } from '../importer/importer.js';

/** Chat link for an item ID as the game generates it (type 2, quantity 1). */
export function chatLinkFor(id: number): string {
    const bytes = Buffer.from([0x02, 0x01, id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, 0x00]);
    return `[&${bytes.toString('base64')}]`;
}

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

export const fixtureItems = (): Gw2Item[] => [
    item(1, 'Mini Golem Kit', 'Gizmo', 'Default', 'Rare', ['Pve', 'Dungeon', 'Wvw']),
    item(2, 'Banner of Strength', 'Gizmo', 'Default', 'Exotic', ['Pve', 'Wvw']),
    item(3, 'Old Gizmo', 'Gizmo', 'Default', 'Basic', ['Dungeon', 'Pve']),
    item(8778, 'Mini Golem Bomb', 'Consumable', 'Generic', 'Fine', ['Dungeon', 'Pve', 'Wvw']),
    item(4, 'Bowl of Soup', 'Consumable', 'Food', 'Fine', ['Dungeon', 'Pve']),
    item(5, 'Sharpening Stone', 'Consumable', 'Utility', 'Masterwork', ['Dungeon', 'Pve']),
    item(6, 'Shiny Rock', 'Trophy', 'Default', 'Junk', ['Pve']),
];

/** In-memory DB plus importer against the fake server, without throttling and with short backoff. */
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
