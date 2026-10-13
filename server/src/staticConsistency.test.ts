import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import type { ItemDetail, Lang } from '../../shared/types.js';
import { parseItemListQuery, parseUpdateChangesQuery } from '../../shared/params.js';
import {
    detailBlockOf,
    exportStaticItems,
    listStaticItems,
    prepareDataset,
    staticCompare,
    staticItemDetail,
    staticStats,
    staticUpdateChanges,
    type StaticDataset,
} from '../../shared/staticQuery.js';
import { toCsv } from '../../shared/exportFormat.js';
import { buildStaticExport, type StaticExport } from './cli/exportStatic.js';
import { exportItems, getItemDetail, listItems, saveItemTest } from './routes/items.js';
import { compareUpdates, getUpdate, getUpdateChanges, listUpdates } from './routes/updates.js';
import { startFakeGw2Api, type FakeGw2Api } from './test/fakeGw2Api.js';
import {
    autoConsumedFixtureItems,
    chatLinkFor,
    createTestImporter,
    fixtureItems,
    guildHomesteadFixtureItems,
    runImport,
} from './test/fixtures.js';

// Consistency test: the browser logic of the static version (shared/staticQuery.ts, reading from the export)
// must return the same results as the server's SQL queries (same IDs, same order).
// The server knows all items, the static version only the published ones; therefore the
// server responses are restricted to the published items.

let api: FakeGw2Api;
let db: DatabaseSync;
let exported: StaticExport;
let staticDataset: StaticDataset;
let published: Set<number>;
let baselineId: number;
let updateIds: number[];

const gizmo = fixtureItems()[0]!;
const consumable = fixtureItems().find((i) => i.id === 8778)!;
const entries = (queryString: string): Record<string, string> => Object.fromEntries(new URLSearchParams(queryString));

before(async () => {
    api = await startFakeGw2Api([
        ...fixtureItems(),
        // Placeholders
        { ...gizmo, id: 101, name: '   ', game_types: ['Dungeon', 'Pve'] },
        { ...gizmo, id: 102, name: 'Ohne Icon', icon: undefined },
        { ...gizmo, id: 103, name: '((906936))' },
        { ...gizmo, id: 106, name: '[[913817]]' },
        // hideCommon: Mastery Points, Emote Tomes, currency packs, Currency
        { ...consumable, id: 104, name: ' Mastery Point', details: { type: 'Immediate' } },
        { ...consumable, id: 105, name: '"/Clap" Emote Tome', details: { type: 'Generic' } },
        { ...consumable, id: 107, name: '300 Geodes', details: { type: 'Immediate' } },
        { ...consumable, id: 108, name: 'Magnetite Shard', details: { type: 'Currency' } },
        { ...consumable, id: 109, name: '2nd Place Finisher', details: { type: 'Generic' } },
        { ...consumable, id: 110, name: '2 Gold', details: { type: 'Immediate' } },
        // Tonics
        { ...consumable, id: 201, name: "Belcher's Bluff Kit", flags: ['NoSell', 'Tonic'] },
        { ...gizmo, id: 202, name: 'Feisty Feline Tonic' },
        { ...consumable, id: 203, name: 'Endless Mystery Tonic', details: { type: 'Food' } },
        { ...consumable, id: 204, name: 'Recipe: Wolf Tonic', details: { type: 'Unlock' } },
        // Language, markup, other types
        { ...consumable, id: 301, name: 'Sweet Cheese', description: 'A tasty cheese.', details: { type: 'Generic' } },
        {
            ...gizmo,
            id: 302,
            name: 'Flavor Gizmo',
            description: '<c=@flavor>Flavor text</c>\nSecond line',
            rarity: 'Legendary',
            level: 80,
        },
        { ...gizmo, id: 303, name: 'zebra gizmo', game_types: ['Pve', 'Pvp'], level: 40 },
        { ...gizmo, id: 304, name: 'Älterer Gizmo', level: 40 },
        // hideAutoConsumed (404 has the phrase only in German)
        ...autoConsumedFixtureItems(),
        // hideAutoConsumed edge cases: no description (NULL), a non-candidate and a placeholder with the phrase
        { ...consumable, id: 405, name: 'Silent Trophy', description: undefined, game_types: ['Dungeon', 'Pve'] },
        {
            ...consumable,
            id: 406,
            name: 'Remote Trophy',
            description: 'Consumed immediately when acquired.',
            game_types: ['Pve'],
        },
        {
            ...consumable,
            id: 407,
            name: '((777))',
            description: 'Consumed automatically when acquired.',
            game_types: ['Dungeon'],
        },
        // hideGuildHomestead (701-709, see guildHomesteadFixtureItems)
        ...guildHomesteadFixtureItems(),
    ]);
    api.german.set(705, { name: 'Rezept: Bank', description: 'Eine Bank.' });
    api.german.set(706, { name: 'Jukebox-Lied', description: 'Fügt ein Lied hinzu.' });
    api.german.set(404, { name: 'Manuelle Trophäe', description: 'Consumed automatically when acquired.' });
    api.german.set(1, { name: 'Mini-Golem-Bausatz', description: 'Beschreibung des Bausatzes.' });
    api.german.set(8778, { name: 'Mini-Golem-Bombe' });
    api.german.set(301, { name: 'Süßer Käse', description: 'Ein leckerer Käse für Ärger.' });
    api.german.set(302, { name: '', description: 'Zweite Beschreibung' });
    api.german.set(304, { name: 'Ärgerlicher Gizmo' });
    api.german.set(201, { name: 'Belchers Bluff-Bausatz' });

    const created = createTestImporter(api.url);
    db = created.db;
    const importer = created.importer;
    baselineId = (await runImport(importer)).updateId!;

    // Test status; then the second update changes the game_types (-> "retest").
    saveItemTest(db, 1, { status: 'works', note: 'works; "good"' });
    saveItemTest(db, 8778, { status: 'works', note: null });
    saveItemTest(db, 2, { status: 'broken', note: 'line 1\nline 2' });
    saveItemTest(db, 301, { status: 'untested', note: 'note only' });

    api.items.get(1)!.game_types = ['Pve', 'Wvw'];
    api.items.get(2)!.game_types = ['Dungeon', 'Pve', 'Wvw'];
    api.items.delete(3);
    api.items.set(9, { ...gizmo, id: 9, name: 'New Gizmo', game_types: ['Dungeon'], description: 'Brand new.' });
    api.items.set(10, { ...gizmo, id: 10, name: '((123456))', game_types: ['Dungeon'] });
    api.items.get(5)!.description = 'Neue Beschreibung';
    api.items.get(6)!.name = 'Shiny Rock Deluxe';
    api.items.get(8778)!.game_types = ['Wvw', 'Pve', 'Dungeon'];
    api.items.get(301)!.name = 'Sweet Cheddar';
    api.items.get(4)!.level = 5;
    api.items.get(709)!.level = 3; // the non-candidate 709 gets published through this change
    api.buildId = 123457;
    await runImport(importer);

    api.items.get(1)!.game_types = ['Dungeon', 'Pve', 'Wvw'];
    api.items.set(3, { ...gizmo, id: 3, name: 'Old Gizmo', game_types: ['Dungeon', 'Pve'] }); // back again
    api.items.delete(9);
    api.items.get(2)!.game_types = ['Pve'];
    api.items.get(5)!.description = 'Another description';
    api.items.get(6)!.name = 'Shiny Rock';
    api.items.get(204)!.flags = ['NoSell', 'Tonic'];
    api.items.get(303)!.game_types = ['Dungeon', 'Pve'];
    api.items.delete(110);
    api.buildId = 123458;
    await runImport(importer);
    saveItemTest(db, 3, { status: 'broken', note: 'entfernt' });
    saveItemTest(db, 302, { status: 'works', note: null });

    // Item without German texts (row missing) -> fall back to English
    db.exec(`DELETE FROM item_texts WHERE item_id IN (4, 304); DELETE FROM items_fts_de WHERE rowid IN (4, 304)`);

    // Simulate export and "files": round-trip through JSON, as the browser loads them.
    exported = JSON.parse(JSON.stringify(buildStaticExport(db))) as StaticExport;
    staticDataset = prepareDataset(exported);
    published = new Set(staticDataset.items.map((i) => i.id));
    updateIds = listUpdates(db)
        .map((u) => u.id)
        .sort((a, b) => a - b);
});
after(() => api.close());

/** Server list response, restricted to published items. */
function serverList(queryString: string) {
    const query = parseItemListQuery({ ...entries(queryString), pageSize: '200', page: '1' });
    const res = listItems(db, query);
    assert.ok(res.total <= 200, 'Test data fits on one page');
    return res.items.filter((i) => published.has(i.id));
}

function staticList(queryString: string) {
    return listStaticItems(staticDataset, parseItemListQuery({ ...entries(queryString), pageSize: '200', page: '1' }))
        .items;
}

function checkList(queryString: string) {
    assert.deepEqual(staticList(queryString), serverList(queryString), `List: ${queryString}`);
}

describe('Export: item selection', () => {
    it('publishes candidates (Gizmo/Consumable) and items from changes from the second update on', () => {
        const candidates = db
            .prepare(`SELECT id FROM items WHERE removed = 0 AND is_candidate = 1 AND type IN ('Gizmo', 'Consumable')`)
            .all()
            .map((r) => r.id as number);
        const changed = db
            .prepare(`SELECT DISTINCT item_id FROM item_changes WHERE update_id <> ?`)
            .all(baselineId)
            .map((r) => r.item_id as number);
        const expected = [...new Set([...candidates, ...changed])].sort((a, b) => a - b);
        assert.deepEqual(
            exported.items.map((i) => i.id),
            expected,
        );
        // The full import alone does not publish non-candidates: trophy 6 is only included because of the change.
        assert.ok(published.has(6) && published.has(3) && published.has(9) && published.has(2));
        assert.ok(!published.has(204) || changed.includes(204));
        assert.ok(!published.has(102) || candidates.includes(102));
        // Items without a change that are not candidates are missing (item 303 became a candidate in the third update).
        assert.ok(!exported.items.some((i) => i.id === 304 && !i.isCandidate));
    });

    it('contains only the changes from the second completed update on', () => {
        assert.ok(exported.changes.length > 0);
        assert.ok(exported.changes.every((c) => c.updateId !== baselineId));
        assert.equal(exported.updates.length, 3);
        assert.deepEqual(
            exported.updates.map((u) => u.id),
            updateIds.slice().reverse(),
        );
        assert.ok(exported.updates.every((u) => u.status === 'done' && !('deletable' in u)));
        assert.equal(exported.meta.build, 123458);
        assert.equal(exported.meta.itemCount, exported.items.length);
    });

    it('items.json is sorted by ID, details are in blocks', () => {
        assert.deepEqual(
            exported.items.map((i) => i.id),
            [...published].sort((a, b) => a - b),
        );
        for (const item of exported.items) {
            const block = detailBlockOf(staticDataset, item.id)!;
            assert.ok(exported.detailBlocks[block]![item.id], `Detail for ${item.id}`);
        }
    });
});

describe('List: browser logic against server', () => {
    it('Views × candidate × filter × language', () => {
        for (const view of ['gizmo', 'consumable', 'tonic', 'all']) {
            for (const candidate of ['yes', 'no', 'all']) {
                for (const hideCommon of ['true', 'false']) {
                    for (const hidePlaceholders of ['true', 'false']) {
                        for (const includeRemoved of ['true', 'false']) {
                            for (const hideAutoConsumed of ['true', 'false']) {
                                for (const hideGuildHomestead of ['true', 'false']) {
                                    for (const lang of ['en', 'de']) {
                                        checkList(
                                            `view=${view}&candidate=${candidate}&hideCommon=${hideCommon}&hidePlaceholders=${hidePlaceholders}&includeRemoved=${includeRemoved}&hideAutoConsumed=${hideAutoConsumed}&hideGuildHomestead=${hideGuildHomestead}&lang=${lang}`,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    it('hideAutoConsumed hides 401-403 (English phrase only), 404 stays', () => {
        const base = 'view=all&candidate=all&hideCommon=false&sort=id';
        const idsOf = (queryString: string) => staticList(queryString).map((i) => i.id);
        for (const lang of ['en', 'de']) {
            const shown = idsOf(`${base}&hideAutoConsumed=false&lang=${lang}`);
            const hidden = idsOf(`${base}&lang=${lang}`);
            assert.deepEqual(
                shown.filter((id) => !hidden.includes(id)),
                [401, 402, 403],
            );
            assert.ok(hidden.includes(404));
        }
    });

    it('hideGuildHomestead hides the guild upgrade and homestead fixtures (701-709), 704 stays (trophy 707 is not exported)', () => {
        const base = 'view=all&candidate=all&hideCommon=false&sort=id';
        const fixtureIds = (queryString: string) =>
            staticList(queryString)
                .map((i) => i.id)
                .filter((id) => id >= 700 && id < 800);
        for (const lang of ['en', 'de']) {
            assert.deepEqual(fixtureIds(`${base}&lang=${lang}`), [704]);
            assert.deepEqual(
                fixtureIds(`${base}&hideGuildHomestead=false&lang=${lang}`),
                [701, 702, 703, 704, 705, 706, 708, 709],
            );
            assert.deepEqual(
                fixtureIds(`${base}&hideGuildHomestead=0&lang=${lang}`),
                [701, 702, 703, 704, 705, 706, 708, 709],
            );
        }
        // The export carries the flag only for the guild upgrade fixtures (0 counts as set).
        const flagged = exported.items.filter((i) => i.guildUpgrade).map((i) => i.id);
        assert.deepEqual(flagged, [701, 702, 703, 708]);
        for (const query of [
            `${base}&q=homestead`,
            `${base}&hideGuildHomestead=false&q=homestead`,
            `${base}&pageSize=3&page=2`,
            'view=gizmo&candidate=all&hideGuildHomestead=false',
            'view=consumable&candidate=all&hideCommon=false&hideGuildHomestead=false',
        ]) {
            checkList(query);
        }
    });

    it('hideAutoConsumed edge cases: missing description, non-candidate, placeholder, search, paging, bool values', () => {
        const base = 'view=all&hideCommon=false&sort=id&lang=en';
        for (const extra of [
            'candidate=all',
            'candidate=no',
            'candidate=all&hidePlaceholders=false',
            'candidate=all&includeRemoved=true',
            'candidate=all&q=trophy',
            'candidate=all&q=trophy&hideAutoConsumed=false',
            'candidate=all&pageSize=2&page=2',
            'candidate=all&hideAutoConsumed=false&pageSize=2&page=2',
            'candidate=all&hideAutoConsumed=0',
            'candidate=all&hideAutoConsumed=1',
            'candidate=all&sort=name&order=desc',
        ]) {
            checkList(`${base}&${extra}`);
        }
        const idsOf = (queryString: string) => staticList(queryString).map((i) => i.id);
        // 405 has no description and must stay visible; 407 is a placeholder with the phrase.
        // The export holds candidates only, so the non-candidate 406 never reaches the static version.
        const shown = idsOf(`${base}&candidate=all&hidePlaceholders=false`);
        assert.ok(shown.includes(405));
        assert.ok(!shown.includes(407));
        assert.ok(!shown.includes(406));
        const unfiltered = idsOf(`${base}&candidate=all&hidePlaceholders=false&hideAutoConsumed=false`);
        assert.ok(unfiltered.includes(407));
        assert.deepEqual(idsOf(`${base}&candidate=all&hidePlaceholders=false&hideAutoConsumed=0`), unfiltered);
        assert.deepEqual(idsOf(`${base}&candidate=all&hidePlaceholders=false&hideAutoConsumed=1`), shown);
    });

    it('itemType and subtype: all views × hideCommon × hideAutoConsumed × languages', () => {
        for (const view of ['gizmo', 'consumable', 'tonic', 'all']) {
            for (const filter of [
                'itemType=Gizmo',
                'itemType=Consumable',
                'itemType=Gizmo,Consumable',
                'subtype=Food',
                'subtype=Generic,Immediate',
                'subtype=Unlock,Transmutation,Currency',
                'itemType=Gizmo&subtype=Generic',
            ]) {
                for (const hideCommon of ['true', 'false']) {
                    for (const hideAutoConsumed of ['true', 'false']) {
                        for (const lang of ['en', 'de']) {
                            checkList(
                                `view=${view}&candidate=all&${filter}&hideCommon=${hideCommon}&hideAutoConsumed=${hideAutoConsumed}&lang=${lang}&sort=id`,
                            );
                        }
                    }
                }
            }
        }
    });

    it('itemType and subtype narrow only their own view', () => {
        const idsOf = (queryString: string) => staticList(queryString).map((i) => i.id);
        const tonics = idsOf('view=tonic&candidate=all&sort=id');
        assert.ok(tonics.includes(201) && tonics.includes(202) && tonics.includes(203));
        const gizmoTonics = idsOf('view=tonic&candidate=all&itemType=Gizmo&sort=id');
        assert.ok(gizmoTonics.includes(202) && !gizmoTonics.includes(201) && !gizmoTonics.includes(203));
        // Tonics of subtype Food stay in the tonic view despite hideCommon, and the subtype filter does not apply there.
        assert.deepEqual(idsOf('view=tonic&candidate=all&subtype=Utility&sort=id'), tonics);
        const foods = idsOf('view=consumable&candidate=all&hideCommon=false&subtype=Food&sort=id');
        assert.ok(foods.includes(4) && foods.includes(203) && !foods.includes(8778));
        assert.deepEqual(idsOf('view=consumable&candidate=all&subtype=Food&sort=id'), []);
        assert.deepEqual(
            idsOf('view=all&candidate=all&hideCommon=false&itemType=Gizmo&sort=id'),
            idsOf('view=all&candidate=all&hideCommon=false&sort=id'),
        );
    });

    it('itemType and subtype edge cases: duplicates, empty elements, search, paging, sorting, removed items', () => {
        const views = ['consumable', 'tonic'];
        for (const view of views) {
            for (const filter of [
                'subtype=Food,Food',
                'subtype=Food,',
                'subtype=,Generic,,Utility',
                'itemType=Gizmo,Gizmo',
                'itemType=Consumable,',
                'itemType=',
                'subtype=',
            ]) {
                for (const extra of [
                    '',
                    '&q=tonic',
                    '&q=kit',
                    '&pageSize=2&page=2',
                    '&sort=name&order=desc',
                    '&sort=rarity&order=asc',
                    '&includeRemoved=true',
                    '&hideCommon=false&includeRemoved=true&hidePlaceholders=false',
                ]) {
                    checkList(`view=${view}&candidate=all&${filter}${extra}`);
                    checkList(`view=${view}&candidate=yes&${filter}${extra}&lang=de`);
                }
            }
        }
        const idsOf = (queryString: string) => staticList(queryString).map((i) => i.id);
        assert.deepEqual(
            idsOf('view=consumable&candidate=all&hideCommon=false&subtype=Food,Food&sort=id'),
            idsOf('view=consumable&candidate=all&hideCommon=false&subtype=Food&sort=id'),
        );
        assert.deepEqual(
            idsOf('view=tonic&candidate=all&itemType=&sort=id'),
            idsOf('view=tonic&candidate=all&sort=id'),
        );
    });

    it('Sorting (all fields, ascending and descending, both languages)', () => {
        for (const sort of ['name', 'id', 'rarity', 'level', 'lastChanged']) {
            for (const order of ['asc', 'desc']) {
                for (const lang of ['en', 'de']) {
                    checkList(
                        `view=all&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true&sort=${sort}&order=${order}&lang=${lang}`,
                    );
                }
            }
        }
    });

    it('Rarity, game types and test status', () => {
        for (const rarity of ['Rare', 'Rare,Exotic', 'Legendary', 'Basic,Fine,Masterwork']) {
            checkList(`view=all&candidate=all&rarity=${rarity}&includeRemoved=true`);
        }
        for (const gameType of ['Dungeon', 'Pve,Wvw', 'Pvp', 'Dungeon,Pve,Wvw']) {
            checkList(`view=all&candidate=all&gameType=${gameType}&includeRemoved=true`);
        }
        for (const testStatus of ['untested', 'works', 'broken', 'retest']) {
            for (const candidate of ['yes', 'all']) {
                checkList(
                    `view=all&candidate=${candidate}&testStatus=${testStatus}&includeRemoved=true&hidePlaceholders=false`,
                );
            }
        }
        assert.ok(staticList('view=all&candidate=all&testStatus=retest').length > 0, 'Test data contains a "retest"');
    });

    it('Update filter (every state except the full import)', () => {
        for (const id of updateIds.filter((u) => u !== baselineId)) {
            for (const includeRemoved of ['true', 'false']) {
                checkList(
                    `view=all&candidate=all&updateId=${id}&includeRemoved=${includeRemoved}&hidePlaceholders=false`,
                );
            }
        }
        assert.ok(staticList(`view=all&candidate=all&updateId=${updateIds[1]}&includeRemoved=true`).length > 0);
    });

    it('Search: text, ID, chat link, special characters, umlauts', () => {
        const queries = [
            'mini',
            'golem bomb',
            'GOLEM',
            'gol',
            'mini bom',
            'description banner',
            'description',
            'a tasty',
            'tasty cheese',
            '8778',
            '301',
            '99999',
            chatLinkFor(8778),
            chatLinkFor(1),
            '[&AgEAWgAA]',
            `[&${Buffer.from([2, 5, 0x4a, 0x22, 0, 0]).toString('base64')}]`,
            'käse',
            'kaese',
            'kase',
            'Käse',
            'süß',
            'suss',
            'ärger',
            'aerger',
            'Ärger',
            'bausatz',
            'mini-golem',
            'Mini-Golem-Bomb',
            "belcher's",
            'belcher',
            'belchers',
            'bluff kit',
            'tonic',
            'tonics',
            'flavor',
            'c',
            'second line',
            'zweite',
            '"golem" OR -NEAR( name:*',
            '---',
            '"',
            '*',
            "o'",
            'new',
            'brand new',
            'cheddar',
            'deluxe',
            'ohne icon',
            '((',
            '[[913817]]',
            '906936',
        ];
        for (const q of queries) {
            for (const lang of ['en', 'de']) {
                for (const view of ['all', 'consumable']) {
                    checkList(
                        `view=${view}&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true&lang=${lang}&q=${encodeURIComponent(q)}`,
                    );
                }
            }
        }
        assert.deepEqual(
            staticList('view=all&candidate=all&q=8778').map((i) => i.id),
            [8778],
        );
        assert.deepEqual(
            staticList('view=all&candidate=all&lang=de&q=kase').map((i) => i.id),
            [301],
        );
        assert.deepEqual(
            staticList('view=all&candidate=all&lang=en&q=kaese').map((i) => i.id),
            [],
        );
    });

    it('description in the list entries and the description search behave the same in both modes', () => {
        const all = 'view=all&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true&sort=id';
        for (const lang of ['en', 'de']) {
            const entriesFromStatic = staticList(`${all}&lang=${lang}`);
            assert.ok(entriesFromStatic.length > 0);
            assert.deepEqual(
                entriesFromStatic.map((i) => [i.id, i.description]),
                serverList(`${all}&lang=${lang}`).map((i) => [i.id, i.description]),
                `description (${lang})`,
            );
        }
        const descriptionOfItem = (id: number, lang: string) =>
            staticList(`${all}&lang=${lang}`).find((i) => i.id === id)!.description;
        assert.equal(descriptionOfItem(1, 'en'), 'Description of Mini Golem Kit.');
        assert.equal(descriptionOfItem(1, 'de'), 'Beschreibung des Bausatzes.');
        assert.equal(descriptionOfItem(2, 'de'), 'Description of Banner of Strength.'); // no German row: English
        assert.equal(descriptionOfItem(8778, 'de'), 'Description of Mini Golem Bomb.'); // German text without own description

        // "description" only occurs in English descriptions, "beschreibung" only in German ones.
        // lang=en searches only the English index; lang=de searches the German OR the English index.
        const searchIds = (word: string, lang: string) => staticList(`${all}&lang=${lang}&q=${word}`).map((i) => i.id);
        assert.deepEqual(searchIds('beschreibung', 'en'), []);
        assert.deepEqual(searchIds('beschreibung', 'de'), [1, 302]);
        assert.ok(searchIds('description', 'en').includes(1));
        assert.ok(searchIds('description', 'de').includes(2)); // item 2 has no German row, so English text counts
        assert.ok(searchIds('description', 'de').includes(1)); // English index still counts in German
        for (const word of ['beschreibung', 'description', 'tasty', 'leckerer', 'zweite']) {
            for (const lang of ['en', 'de']) checkList(`${all}&lang=${lang}&q=${word}`);
        }
    });

    it('Pagination', () => {
        const base =
            'view=all&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true&sort=level&order=desc';
        for (const pageSize of [1, 3, 7]) {
            for (const page of [1, 2, 4]) {
                const query = parseItemListQuery({ ...entries(base), pageSize: String(pageSize), page: String(page) });
                const fromStatic = listStaticItems(staticDataset, query);
                assert.equal(fromStatic.page, page);
                assert.equal(fromStatic.pageSize, pageSize);
                assert.equal(fromStatic.total, staticList(base).length);
                assert.deepEqual(fromStatic.items, staticList(base).slice((page - 1) * pageSize, page * pageSize));
            }
        }
    });

    it('Export CSV/JSON: same rows as the server, CSV with semicolon and BOM', () => {
        for (const queryString of [
            'view=all&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true',
            'view=gizmo&sort=id&order=desc',
            'view=consumable&lang=de&testStatus=works',
            'view=tonic&lang=de',
        ]) {
            const query = parseItemListQuery(entries(queryString));
            const serverRows = exportItems(db, query).filter((r) => published.has(r.id));
            const staticRows = exportStaticItems(staticDataset, query);
            assert.deepEqual(staticRows, serverRows, queryString);
            assert.equal(toCsv(staticRows), toCsv(serverRows));
        }
        const csv = toCsv(exportStaticItems(staticDataset, parseItemListQuery(entries('view=all'))));
        assert.ok(csv.startsWith('﻿id;name;'));
        assert.ok(csv.includes('\r\n'));
    });

    it('Key figures', () => {
        const stats = staticStats(staticDataset);
        const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
        assert.equal(
            stats.candidates.gizmo,
            count(`SELECT COUNT(*) AS n FROM items WHERE removed = 0 AND is_candidate = 1 AND type = 'Gizmo'`),
        );
        assert.equal(
            stats.candidates.consumable,
            count(`SELECT COUNT(*) AS n FROM items WHERE removed = 0 AND is_candidate = 1 AND type = 'Consumable'`),
        );
        assert.equal(stats.lastUpdate?.id, updateIds.at(-1));
        assert.equal(stats.autoCheck, null);
    });
});

describe('Details: browser logic against server', () => {
    it('all published items, both languages', () => {
        for (const id of published) {
            for (const lang of ['en', 'de'] as Lang[]) {
                const rest = exported.detailBlocks[detailBlockOf(staticDataset, id)!]![id];
                const fromStatic = staticItemDetail(staticDataset, id, lang, rest)!;
                const fromServer = getItemDetail(db, id, lang)!;
                // The changes of the first update (everything "new") are not part of the static version.
                const expected: ItemDetail = {
                    ...fromServer,
                    history: fromServer.history.filter((h) => h.updateId !== baselineId),
                };
                assert.deepEqual(fromStatic, expected, `Detail ${id} (${lang})`);
            }
        }
    });

    it('unknown ID -> null', () => {
        assert.equal(staticItemDetail(staticDataset, 424242, 'en', undefined), null);
        assert.equal(detailBlockOf(staticDataset, 424242), null);
    });
});

describe('Changes: browser logic against server', () => {
    const queries = [''];
    for (const kind of ['', 'added', 'changed', 'removed', 'added,removed', 'changed,added']) {
        for (const focus of ['all', 'gameTypes', 'dungeonGained', 'dungeonLost']) {
            queries.push(`kind=${kind}&focus=${focus}`);
        }
    }
    for (const type of ['gizmo', 'consumable', 'tonic', 'all']) queries.push(`type=${type}`);
    for (const q of ['gizmo', 'GIZMO', '5', '9', 'ost', '%', '_', 'cheese', 'käse', 'sweet', 'rock'])
        queries.push(`q=${encodeURIComponent(q)}`);
    queries.push(
        'hidePlaceholders=false',
        'hidePlaceholders=false&kind=added',
        'pageSize=2&page=2',
        'pageSize=3&page=3',
    );

    it('entries, counters and total per state (without the full import)', () => {
        for (const id of updateIds.filter((u) => u !== baselineId)) {
            const update = getUpdate(db, id)!;
            for (const lang of ['en', 'de']) {
                for (const queryString of queries) {
                    const params = { ...entries(queryString), lang };
                    const fromServer = getUpdateChanges(db, update, parseUpdateChangesQuery(params));
                    const fromStatic = staticUpdateChanges(staticDataset, update, parseUpdateChangesQuery(params));
                    assert.deepEqual(fromStatic, fromServer, `Changes ${id} ${lang} ${queryString}`);
                }
            }
        }
    });

    it('Comparison of two states', () => {
        let nonEmpty = 0;
        for (const from of updateIds) {
            for (const to of updateIds.filter((u) => u > from)) {
                const fromUpdate = getUpdate(db, from)!;
                const toUpdate = getUpdate(db, to)!;
                for (const lang of ['en', 'de']) {
                    for (const queryString of queries) {
                        const params = { ...entries(queryString), lang };
                        const fromServer = compareUpdates(db, fromUpdate, toUpdate, parseUpdateChangesQuery(params));
                        const fromStatic = staticCompare(
                            staticDataset,
                            fromUpdate,
                            toUpdate,
                            parseUpdateChangesQuery(params),
                        );
                        assert.deepEqual(fromStatic, fromServer, `Compare ${from}→${to} ${lang} ${queryString}`);
                        if (fromStatic.items.length > 0) nonEmpty++;
                    }
                }
            }
        }
        assert.ok(nonEmpty > 20, 'Test data produces real comparison results');
    });

    it('the first state has no entries, the counters come from the update', () => {
        const baseline = getUpdate(db, baselineId)!;
        const res = staticUpdateChanges(staticDataset, baseline, parseUpdateChangesQuery({}));
        assert.equal(res.total, 0);
        assert.equal(res.counts.added, baseline.added);
    });
});
