import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DETAIL_BLOCK_SIZE, STATIC_SCHEMA_VERSION } from '../../../shared/staticTypes.js';
import { openDatabase } from '../db/index.js';
import { migrations } from '../db/schema.js';
import { startFakeGw2Api, type FakeGw2Api } from '../test/fakeGw2Api.js';
import { createTestImporter, fixtureItems, runImport } from '../test/fixtures.js';
import { buildStaticExport, describeWritten, openForExport, writeStaticExport } from './exportStatic.js';

const gizmo = fixtureItems()[0]!;
const tmpDirs: string[] = [];
const tmpDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-items-static-'));
    tmpDirs.push(dir);
    return dir;
};
after(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('buildStaticExport', () => {
    let api: FakeGw2Api;
    afterEach(() => api.close());

    it('splits the details by ID into blocks of 500 items', async () => {
        const count = DETAIL_BLOCK_SIZE * 2 + 101;
        // Insert IDs in descending order: the blocks must still be sorted by ID.
        api = await startFakeGw2Api(
            Array.from({ length: count }, (_, i) => ({ ...gizmo, id: 5000 - i, name: `Gizmo ${5000 - i}` })),
        );
        const { db, importer } = createTestImporter(api.url);
        await runImport(importer);

        const data = buildStaticExport(db);
        assert.equal(data.items.length, count);
        assert.deepEqual(
            data.items.map((i) => i.id),
            Array.from({ length: count }, (_, i) => 5000 - count + 1 + i),
        );
        assert.equal(data.detailBlocks.length, 3);
        assert.deepEqual(
            data.detailBlocks.map((b) => Object.keys(b).length),
            [500, 500, 101],
        );
        assert.deepEqual(
            Object.keys(data.detailBlocks[0]!).map(Number),
            data.items.slice(0, 500).map((i) => i.id),
        );
        assert.equal(data.meta.detailBlocks, 3);
        assert.equal(data.meta.detailBlockSize, DETAIL_BLOCK_SIZE);
        assert.equal(data.meta.itemCount, count);
        assert.equal(data.meta.schemaVersion, STATIC_SCHEMA_VERSION);
        assert.equal(data.meta.build, 123456);
        // The full import alone produces no entries in changes.json
        assert.equal(data.changes.length, 0);
        assert.equal(data.updates.length, 1);
    });

    it('selects items: Gizmo/Consumable candidates plus items from changes from the second update on', async () => {
        const consumable = fixtureItems().find((i) => i.id === 8778)!;
        api = await startFakeGw2Api([
            { ...gizmo, id: 1, name: 'Candidate Gizmo' },
            { ...consumable, id: 2, name: 'Candidate Consumable' },
            { ...gizmo, id: 3, name: 'No Dungeon', game_types: ['Pve'] },
            { ...gizmo, id: 4, name: 'Trophy Candidate', type: 'Trophy' },
            { ...gizmo, id: 5, name: 'Loses Dungeon', game_types: ['Dungeon', 'Pve'] },
            { ...gizmo, id: 6, name: 'Gets removed', game_types: ['Dungeon', 'Pve'] },
            { ...gizmo, id: 7, name: 'Trophy changes', type: 'Trophy', game_types: ['Pve'] },
            { ...gizmo, id: 8, name: 'Removed later, never changed', game_types: ['Pve'] },
        ]);
        const { db, importer } = createTestImporter(api.url);
        await runImport(importer);
        assert.deepEqual(
            buildStaticExport(db).items.map((i) => i.id),
            [1, 2, 5, 6],
        );

        api.items.get(5)!.game_types = ['Pve'];
        api.items.delete(6);
        api.items.get(7)!.name = 'Trophy changed';
        api.items.delete(8);
        api.items.set(9, { ...gizmo, id: 9, name: 'Brand new', game_types: ['Dungeon'] });
        await runImport(importer);

        const data = buildStaticExport(db);
        // 5 (lost Dungeon), 6 (removed), 7 (trophy changed), 8 (removed), 9 (new) come from changes; 3 and 4 never.
        assert.deepEqual(
            data.items.map((i) => i.id),
            [1, 2, 5, 6, 7, 8, 9],
        );
        const removed = data.items.find((i) => i.id === 6)!;
        assert.equal(removed.removed, true);
        assert.equal(removed.isCandidate, true);
        assert.deepEqual(
            data.changes.map((c) => [c.itemId, c.kind]),
            [
                [5, 'changed'],
                [6, 'removed'],
                [7, 'changed'],
                [8, 'removed'],
                [9, 'added'],
            ],
        );
        assert.deepEqual(data.changes[0]!.gameTypesAfter, ['Pve']);
        assert.equal(data.changes[0]!.summary, undefined);
        assert.equal(data.changes[1]!.summary?.name, 'Gets removed');
        assert.equal(data.changes[4]!.summary?.name, 'Brand new');
        assert.deepEqual(
            data.updates.map((u) => u.id),
            [2, 1],
        );
        assert.equal(data.meta.lastUpdate?.id, 2);
    });

    it('empty database: empty export', () => {
        const data = buildStaticExport(openDatabase(':memory:'));
        assert.deepEqual([data.items, data.updates, data.changes, data.detailBlocks], [[], [], [], []]);
        assert.equal(data.meta.lastUpdate, null);
        assert.equal(data.meta.build, null);
    });

    it('omits empty values and stores the test status', async () => {
        api = await startFakeGw2Api([
            { ...gizmo, id: 1, name: 'Plain', flags: [], description: undefined, details: undefined },
        ]);
        const { db, importer } = createTestImporter(api.url);
        await runImport(importer);
        db.exec(
            `INSERT INTO item_tests (item_id, status, note, tested_at, game_types_at_test) VALUES (1, 'works', 'ok', '2026-10-10T10:00:00.000Z', '["Dungeon","Pve","Wvw"]')`,
        );
        const [item] = buildStaticExport(db).items;
        assert.equal('flags' in item!, false);
        assert.equal('description' in item!, false);
        assert.equal('subtype' in item!, false);
        assert.equal('removed' in item!, false);
        assert.equal('chatLink' in item!, false);
        assert.equal(item!.icon, '1.png');
        assert.deepEqual(item!.test, {
            status: 'works',
            note: 'ok',
            testedAt: '2026-10-10T10:00:00.000Z',
            gameTypesAtTest: ['Dungeon', 'Pve', 'Wvw'],
        });
    });
});

describe('writeStaticExport', () => {
    let api: FakeGw2Api;
    beforeEach(async () => {
        api = await startFakeGw2Api(fixtureItems());
    });
    afterEach(() => api.close());

    it('empties the target folder and writes compact JSON', async () => {
        const { db, importer } = createTestImporter(api.url);
        await runImport(importer);
        const data = buildStaticExport(db);

        const out = tmpDir();
        fs.mkdirSync(path.join(out, 'details'));
        fs.writeFileSync(path.join(out, 'alt.json'), '{}');
        fs.writeFileSync(path.join(out, 'details', '7.json'), '{}');

        const written = writeStaticExport(data, out);
        const onDisk = fs
            .readdirSync(out, { recursive: true, withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => path.relative(out, path.join(e.parentPath, e.name)).replaceAll('\\', '/'))
            .sort();
        assert.deepEqual(onDisk, ['changes.json', 'details/0.json', 'items.json', 'meta.json', 'updates.json']);
        assert.deepEqual(written.files.map((f) => f.path).sort(), onDisk);

        for (const file of onDisk) {
            const text = fs.readFileSync(path.join(out, file), 'utf8');
            assert.ok(!text.includes('\n') && !text.includes('  '), `${file} is compact`);
            JSON.parse(text);
        }
        assert.equal(
            written.totalBytes,
            written.files.reduce((sum, f) => sum + f.bytes, 0),
        );
        assert.equal(
            written.totalBytes,
            onDisk.reduce((sum, f) => sum + fs.statSync(path.join(out, f)).size, 0),
        );

        const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8')) as {
            itemCount: number;
            schemaVersion: number;
        };
        assert.equal(meta.itemCount, data.items.length);
        assert.equal(meta.schemaVersion, STATIC_SCHEMA_VERSION);

        const summary = describeWritten(data, written, out);
        assert.match(summary.at(-1)!, /^Total: 5 files, /);
        assert.ok(!summary.some((l) => l.startsWith('Warning')));
    });
});

describe('openForExport', () => {
    it('opens read-only', () => {
        const file = path.join(tmpDir(), 'items.db');
        openDatabase(file).close();
        const db = openForExport(file);
        try {
            assert.throws(() => db.exec(`INSERT INTO updates (started_at) VALUES ('x')`));
        } finally {
            db.close();
        }
    });

    it('reports missing and outdated databases', () => {
        const dir = tmpDir();
        assert.throws(() => openForExport(path.join(dir, 'missing.db')), /not found/);

        const old = path.join(dir, 'old.db');
        const raw = new DatabaseSync(old);
        raw.exec(migrations[0]!);
        raw.exec('PRAGMA user_version = 1');
        raw.close();
        assert.throws(() => openForExport(old), /schema 1/);
    });
});
