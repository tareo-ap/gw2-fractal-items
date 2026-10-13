import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { parseItemListQuery } from '../../shared/params.js';
import { isGuildOrHomesteadItem } from '../../shared/rules.js';
import { listStaticItems, prepareDataset, type StaticDataset } from '../../shared/staticQuery.js';
import { buildStaticExport, type StaticExport } from './cli/exportStatic.js';
import { openDatabase } from './db/index.js';
import { migrations } from './db/schema.js';
import type { Gw2Item } from './gw2/client.js';
import { listItems } from './routes/items.js';
import { startFakeGw2Api, type FakeGw2Api } from './test/fakeGw2Api.js';
import { createTestImporter, fixtureItems, runImport } from './test/fixtures.js';

// Edge cases for the hideGuildHomestead filter that the main tests do not cover: odd guild_upgrade_id values in
// raw_json (migration and importer), homestead text in markup / non-ASCII spellings, and server vs static
// consistency for combinations with the other hide filters, subtype, item type and search.

type ColumnRow = { id: number; value: number | null };

// Reads id -> guild_upgrade_id for the given WHERE clause.
const guildUpgradeColumn = (db: DatabaseSync, where = '1 = 1'): Record<number, number | null> =>
    Object.fromEntries(
        (
            db
                .prepare(`SELECT id, guild_upgrade_id AS value FROM items WHERE ${where} ORDER BY id`)
                .all() as ColumnRow[]
        ).map((row) => [row.id, row.value]),
    );

const userVersion = (db: DatabaseSync): number =>
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('hideGuildHomestead: migration 5 with unusual raw_json', () => {
    const versionBeforeMigration = 4;

    // Creates a database at schema version 4 with one row per raw_json text; returns the file path.
    function createVersion4Db(dir: string, rawJsonByItemId: Record<number, string>): string {
        const file = path.join(dir, 'v4.db');
        const old = new DatabaseSync(file);
        for (const migration of migrations.slice(0, versionBeforeMigration)) old.exec(migration);
        old.exec(`PRAGMA user_version = ${versionBeforeMigration}`);
        old.exec(
            `INSERT INTO updates (id, started_at, status, build_id, added, changed, removed) VALUES (1, '2026-01-01T00:00:00Z', 'done', 1, 0, 0, 0)`,
        );
        const insert =
            old.prepare(`INSERT INTO items (id, name, type, rarity, level, icon, game_types, flags, is_candidate, raw_json, hash, first_seen_update, last_changed_update)
      VALUES (?, 'Item', 'Consumable', 'Rare', 0, 'x.png', '["Dungeon"]', '[]', 1, ?, 'h', 1, 1)`);
        for (const [id, rawJson] of Object.entries(rawJsonByItemId)) insert.run(Number(id), rawJson);
        old.close();
        return file;
    }

    it('sets the column only for JSON integers, leaves NULL otherwise, and is idempotent', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-items-mig5-edge-'));
        try {
            const file = createVersion4Db(dir, {
                1: '{"details":{"guild_upgrade_id":77}}',
                2: '{"details":{"guild_upgrade_id":"77"}}', // string
                3: '{"details":{"guild_upgrade_id":1.5}}', // float
                4: '{"details":{"guild_upgrade_id":0}}', // 0 counts as set
                5: '{"details":{"guild_upgrade_id":null}}',
                6: '{"details":{"type":"Generic"}}', // key missing
                7: '{"name":"no details at all"}',
                8: '{"details":[1,2]}', // details is not an object
                9: '{"details":{"guild_upgrade_id":true}}',
                10: '{"details":{"guild_upgrade_id":-3}}',
                11: '{"details":{"guild_upgrade_id":1099511627776}}', // > 32 bit
                12: '{"details":{"guild_upgrade_id":[5]}}',
                13: '{not valid json', // malformed: must not abort the migration
                14: '{"details":{"guild_upgrade_id":1e21}}', // serialized as real, not integer
            });
            const expected = {
                1: 77,
                2: null,
                3: null,
                4: 0,
                5: null,
                6: null,
                7: null,
                8: null,
                9: null,
                10: -3,
                11: 1099511627776,
                12: null,
                13: null,
                14: null,
            };

            const first = openDatabase(file);
            assert.deepEqual(guildUpgradeColumn(first), expected);
            assert.equal(userVersion(first), migrations.length);
            first.close();

            // Opening again must neither fail (duplicate ALTER TABLE) nor change anything.
            const second = openDatabase(file);
            assert.deepEqual(guildUpgradeColumn(second), expected);
            assert.equal(userVersion(second), migrations.length);
            second.close();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('hideGuildHomestead: text rule edge cases', () => {
    const check = (type: string, name: string, descriptionEn: string | null) =>
        isGuildOrHomesteadItem({ type, name, descriptionEn, hasGuildUpgrade: false });

    it('matches substrings, ignores spellings that are not ASCII "homestead"', () => {
        assert.equal(check('Consumable', 'Homesteader Kit', null), true);
        assert.equal(check('Gizmo', 'x', 'Visit the<br>Homestead<br>now'), true);
        assert.equal(check('Gizmo', 'x', '<c=@flavor>Home</c><c=@flavor>stead</c>'), false); // split by markup
        assert.equal(check('Consumable', 'ＨＯＭＥＳＴＥＡＤ', null), false); // fullwidth
        assert.equal(check('Consumable', 'Homéstead', null), false);
        assert.equal(check('Consumable', 'Homeſtead', null), false); // long s
        assert.equal(check('Consumable', 'x', 'HOME STEAD'), false);
        assert.equal(check('Consumable', 'x', 'Home-stead'), false);
    });
});

describe('hideGuildHomestead: unusual API values, and server vs static consistency', () => {
    let api: FakeGw2Api;
    let db: DatabaseSync;
    let dataset: StaticDataset;

    // Candidate Consumable/Gizmo templates (fixture 8778 is a Consumable/Generic candidate, 1 is a Gizmo).
    const consumable = fixtureItems().find((i) => i.id === 8778)!;
    const gizmo = fixtureItems().find((i) => i.id === 1)!;
    const make = (id: number, name: string, overrides: Partial<Gw2Item> = {}): Gw2Item => ({
        ...consumable,
        id,
        name,
        description: 'Neutral text.',
        game_types: ['Dungeon', 'Pve'],
        ...overrides,
    });

    // Shown by default: 801-803, 806, 808, 809. Everything else below is hidden by hideGuildHomestead.
    const items: Gw2Item[] = [
        make(801, 'String Upgrade', { details: { type: 'Generic', guild_upgrade_id: '12' } as never }),
        make(802, 'Float Upgrade', { details: { type: 'Generic', guild_upgrade_id: 1.5 } as never }),
        { ...gizmo, id: 803, name: 'No Details Gizmo', description: 'Neutral text.', details: undefined },
        make(804, 'Negative Upgrade', { details: { type: 'Generic', guild_upgrade_id: -1 } }),
        make(805, 'Homesteader Kit'),
        make(806, 'Split Markup', { description: '<c=@flavor>Home</c><c=@flavor>stead</c>' }),
        make(807, 'Markup Hit', { description: '<c=@flavor>HoMeStEaD</c> bench' }),
        make(808, 'ＨＯＭＥＳＴＥＡＤ'),
        // Cyrillic capital En. Not the long s: FTS5 folds it to "s" while the static search does not, which would be
        // a (pre-existing, unrelated) search difference.
        make(809, 'Нomestead'),
        make(810, 'Homestead Soup', { details: { type: 'Food' } }),
        make(811, 'Auto Both', { description: 'Consumed automatically when acquired. Homestead.' }),
        make(812, 'Utility Bench', { description: 'A Homestead bench.', details: { type: 'Utility' } }),
        make(813, 'Homestead Tonic', { flags: ['Tonic'] }),
        { ...gizmo, id: 814, name: 'Garden Tonic', description: 'For the homestead.', flags: ['Tonic'] },
        make(815, 'Huge Upgrade', { details: { type: 'Generic', guild_upgrade_id: 1099511627776 } }),
    ];
    const defaultShown = [801, 802, 803, 806, 808, 809];

    before(async () => {
        api = await startFakeGw2Api(items);
        const created = createTestImporter(api.url);
        db = created.db;
        await runImport(created.importer);
        dataset = prepareDataset(JSON.parse(JSON.stringify(buildStaticExport(db))) as StaticExport);
    });
    after(() => api.close());

    const ids = (rows: { id: number }[]) => rows.map((row) => row.id).filter((id) => id >= 800 && id < 900);
    const params = (queryString: string) =>
        parseItemListQuery({ ...Object.fromEntries(new URLSearchParams(queryString)), pageSize: '200', page: '1' });
    const serverIds = (queryString: string) => ids(listItems(db, params(queryString)).items);
    const staticIds = (queryString: string) => ids(listStaticItems(dataset, params(queryString)).items);

    it('the importer stores the column only for integers (string, float, missing details stay NULL)', () => {
        const stored = guildUpgradeColumn(db, 'id >= 800');
        assert.equal(stored[801], null);
        assert.equal(stored[802], null);
        assert.equal(stored[803], null);
        assert.equal(stored[804], -1);
        assert.equal(stored[815], 1099511627776);
    });

    it('default view=all hides exactly the guild/homestead items, on server and static', () => {
        const query = 'view=all&candidate=all&hideCommon=false&hideAutoConsumed=false&sort=id';
        assert.deepEqual(serverIds(query), defaultShown);
        assert.deepEqual(staticIds(query), defaultShown);
        // 811 (auto-consumed and homestead) stays hidden by hideGuildHomestead alone.
        assert.ok(!serverIds(query).includes(811));
    });

    it('server and static agree for combinations with the other filters, subtype, item type and search', () => {
        const views = ['gizmo', 'consumable', 'tonic', 'all'];
        const extras = [
            '',
            '&subtype=Food',
            '&subtype=Utility,Generic',
            '&itemType=Gizmo',
            '&q=homestead',
            '&q=bench',
            '&q=tonic',
        ];
        let compared = 0;
        for (const view of views)
            for (const hideCommon of ['true', 'false'])
                for (const hideAutoConsumed of ['true', 'false'])
                    for (const hideGuildHomestead of ['true', 'false'])
                        for (const lang of ['en', 'de'])
                            for (const extra of extras) {
                                const query = `view=${view}&candidate=all&sort=id&hideCommon=${hideCommon}&hideAutoConsumed=${hideAutoConsumed}&hideGuildHomestead=${hideGuildHomestead}&lang=${lang}${extra}`;
                                assert.deepEqual(staticIds(query), serverIds(query), query);
                                compared++;
                            }
        assert.equal(compared, views.length * 2 * 2 * 2 * 2 * extras.length);
    });

    it('subtype filter combined with hideGuildHomestead: homestead items drop out; off: they come back', () => {
        const base = 'view=consumable&candidate=all&hideCommon=false&hideAutoConsumed=false&sort=id';
        assert.deepEqual(serverIds(`${base}&subtype=Food`), []);
        assert.deepEqual(serverIds(`${base}&subtype=Food&hideGuildHomestead=false`), [810]);
        assert.deepEqual(serverIds(`${base}&subtype=Utility&hideGuildHomestead=false`), [812]);
        assert.deepEqual(staticIds(`${base}&subtype=Utility&hideGuildHomestead=false`), [812]);
    });

    it('search results never contain hidden items, even when the search term is "homestead"', () => {
        const base = 'view=all&candidate=all&hideCommon=false&hideAutoConsumed=false&sort=id';
        assert.deepEqual(serverIds(`${base}&q=homestead`), []);
        assert.deepEqual(staticIds(`${base}&q=homestead`), []);
        assert.deepEqual(
            serverIds(`${base}&q=homestead&hideGuildHomestead=false`),
            staticIds(`${base}&q=homestead&hideGuildHomestead=false`),
        );
    });
});
