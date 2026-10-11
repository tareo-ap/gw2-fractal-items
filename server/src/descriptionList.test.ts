import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { parseItemListQuery } from '../../shared/params.js';
import { exportStaticItems, listStaticItems, prepareDataset, type StaticDataset } from '../../shared/staticQuery.js';
import { toCsv } from '../../shared/exportFormat.js';
import { buildStaticExport, type StaticExport } from './cli/exportStatic.js';
import { exportItems, getItemDetail, listItems } from './routes/items.js';
import { startFakeGw2Api, type FakeGw2Api } from './test/fakeGw2Api.js';
import { createTestImporter, fixtureItems, runImport } from './test/fixtures.js';

// Edge cases for ItemListItem.description and the description search; server (SQL) and static version must agree.
const markup = 'Use <c=@flavor>Fine Print</c> now.';

let api: FakeGw2Api;
let db: DatabaseSync;
let staticDataset: StaticDataset;

before(async () => {
    const gizmo = fixtureItems()[0]!;
    const consumable = fixtureItems().find((i) => i.id === 8778)!;
    api = await startFakeGw2Api([
        { ...gizmo, id: 601, name: 'Markup Gizmo', description: markup },
        { ...gizmo, id: 602, name: 'Missing Description Gizmo', description: undefined },
        { ...gizmo, id: 603, name: 'Empty Description Gizmo', description: '' },
        {
            ...consumable,
            id: 604,
            name: 'Pie',
            details: { type: 'Food' },
            description: 'Gives a golden apple pie bonus.',
        },
        {
            ...consumable,
            id: 605,
            name: 'Apple',
            details: { type: 'Utility' },
            description: 'A golden apple. Consumed immediately when acquired.',
        },
        { ...consumable, id: 606, name: 'Pear', details: { type: 'Generic' }, description: 'A golden pear.' },
    ]);
    api.german.set(604, { name: 'Kuchen', description: 'Gibt einen goldenen Apfelkuchen.' });
    const created = createTestImporter(api.url);
    db = created.db;
    await runImport(created.importer);
    const exported = JSON.parse(JSON.stringify(buildStaticExport(db))) as StaticExport;
    staticDataset = prepareDataset(exported);
});
after(() => api.close());

// Defaults: all views and candidates, nothing hidden except auto-consumed items, sorted by ID.
const parse = (queryString: string) =>
    parseItemListQuery({
        view: 'all',
        candidate: 'all',
        hideCommon: 'false',
        sort: 'id',
        pageSize: '200',
        ...Object.fromEntries(new URLSearchParams(queryString)),
    });
const serverItems = (queryString: string) => listItems(db, parse(queryString)).items;
const staticItems = (queryString: string) => listStaticItems(staticDataset, parse(queryString)).items;
// Asserts that both modes return the same IDs and returns the IDs of the test items (600 and up).
const both = (queryString: string) => {
    const fromServer = serverItems(queryString).map((i) => i.id);
    assert.deepEqual(
        staticItems(queryString).map((i) => i.id),
        fromServer,
        queryString,
    );
    return fromServer.filter((id) => id >= 600);
};

describe('Description in the list: edge cases', () => {
    it('keeps markup raw, in both modes and both languages', () => {
        for (const lang of ['en', 'de']) {
            for (const items of [serverItems(`lang=${lang}`), staticItems(`lang=${lang}`)]) {
                assert.equal(items.find((i) => i.id === 601)!.description, markup);
            }
        }
    });

    it('missing or empty description gives the same value in both modes, and the item stays in the list', () => {
        for (const id of [602, 603]) {
            const fromServer = serverItems('').find((i) => i.id === id)!;
            const fromStatic = staticItems('').find((i) => i.id === id)!;
            assert.equal(fromStatic.description, fromServer.description, String(id));
            assert.ok(!fromServer.description, `empty or null expected for ${id}`);
        }
        const shown = both('hideAutoConsumed=true');
        assert.ok(shown.includes(602) && shown.includes(603));
    });

    it('list description equals detail description', () => {
        for (const id of [601, 602, 604]) {
            for (const lang of ['en', 'de'] as const) {
                const fromList = serverItems(`lang=${lang}`).find((i) => i.id === id)!;
                assert.equal(getItemDetail(db, id, lang)!.description, fromList.description, `${id} ${lang}`);
            }
        }
    });

    it('search for a description word combined with hideAutoConsumed and subtype', () => {
        assert.deepEqual(both('q=golden&hideAutoConsumed=false'), [604, 605, 606]);
        assert.deepEqual(both('q=golden&hideAutoConsumed=true'), [604, 606]);
        assert.deepEqual(both('view=consumable&q=golden&subtype=Food&hideAutoConsumed=false'), [604]);
        assert.deepEqual(both('view=consumable&q=golden&subtype=Utility&hideAutoConsumed=true'), []);
        assert.deepEqual(both('view=consumable&q=golden&subtype=Utility,Generic&hideAutoConsumed=false'), [605, 606]);
        assert.deepEqual(both('q=golden&view=consumable&hideAutoConsumed=false&sort=name&order=desc'), [604, 606, 605]); // by name: Pie, Pear, Apple
    });

    it('a word inside markup is searchable', () => {
        assert.deepEqual(both('q=print'), [601]);
    });

    it('quotes do not make a phrase: the words are ANDed in any order and position (same in both modes)', () => {
        // toFtsQuery / searchPhrases strip the quotes and split at spaces, so "golden pie" = golden AND pie.
        assert.deepEqual(both('q=%22golden+apple%22&hideAutoConsumed=false'), [604, 605]);
        assert.deepEqual(both('q=%22golden+apple%22&hideAutoConsumed=true'), [604]);
        assert.deepEqual(both('q=%22apple+golden%22&hideAutoConsumed=false'), [604, 605]); // order does not matter
        assert.deepEqual(both('q=%22golden+pie%22&hideAutoConsumed=false'), [604]); // "apple" in between is fine
        assert.deepEqual(both('q=%22golden+pear%22&hideAutoConsumed=false'), [606]);
        assert.deepEqual(both('q=%22fine+print%22'), [601]);
        assert.deepEqual(both('q=golden+pie&hideAutoConsumed=false'), [604]);
        assert.deepEqual(both('q=%22golden+nonsense%22&hideAutoConsumed=false'), []);
    });

    it('multi-word search in the German description', () => {
        assert.deepEqual(both('lang=de&q=%22goldenen+apfelkuchen%22'), [604]);
        assert.deepEqual(both('lang=en&q=%22goldenen+apfelkuchen%22'), []);
        // 604 has its own German text, but the English index still counts in German
        assert.deepEqual(both('lang=de&q=%22golden+apple%22&hideAutoConsumed=false'), [604, 605]);
    });
});

describe('Export has no description', () => {
    it('JSON rows and CSV header (server and static) contain no description', () => {
        const query = parse('');
        const serverRows = exportItems(db, query);
        const staticRows = exportStaticItems(staticDataset, query);
        assert.ok(serverRows.length > 0);
        for (const row of [...serverRows, ...staticRows]) assert.ok(!('description' in row));
        for (const csv of [toCsv(serverRows), toCsv(staticRows)]) {
            assert.ok(!csv.split('\r\n')[0]!.toLowerCase().includes('description'));
            assert.ok(!csv.includes('golden apple'));
        }
    });
});
