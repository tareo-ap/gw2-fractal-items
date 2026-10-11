import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { createTestImporter, fixtureItems, runImport } from '../test/fixtures.js';
import { startFakeGw2Api, type FakeGw2Api } from '../test/fakeGw2Api.js';
import { Gw2Client } from '../gw2/client.js';
import type { Importer } from './importer.js';
import { BuildWatcher } from './buildWatcher.js';
import { parseCheckSchedule } from './checkSchedule.js';

let api: FakeGw2Api;
let db: DatabaseSync;
let importer: Importer;
let watcher: BuildWatcher;

const updateCount = () => (db.prepare('SELECT COUNT(*) AS n FROM updates').get() as { n: number }).n;

describe('BuildWatcher', () => {
    beforeEach(async () => {
        api = await startFakeGw2Api(fixtureItems());
        ({ db, importer } = createTestImporter(api.url));
        const client = new Gw2Client({ baseUrl: api.url, minIntervalMs: 0, retryBaseDelayMs: 1, maxAttempts: 1 });
        watcher = new BuildWatcher(db, client, importer, parseCheckSchedule({ UPDATE_CHECK: 'on' })!);
    });
    afterEach(async () => {
        watcher.stop();
        await importer.waitForIdle();
        await api.close();
    });

    it('starts nothing without a completed update (noBaseline)', async () => {
        assert.equal(await watcher.checkNow(), 'noBaseline');
        assert.equal(updateCount(), 0);
        assert.equal(watcher.getStatus().lastSeenBuild, 123456);
    });

    it('starts nothing for the same build ID (unchanged)', async () => {
        await runImport(importer);
        assert.equal(await watcher.checkNow(), 'unchanged');
        assert.equal(updateCount(), 1);
    });

    it('starts an import for a new build ID (started)', async () => {
        await runImport(importer);
        api.buildId = 123457;
        assert.equal(await watcher.checkNow(), 'started');
        await importer.waitForIdle();
        assert.equal(updateCount(), 2);
        const last = db.prepare('SELECT build_id, status FROM updates ORDER BY id DESC LIMIT 1').get() as {
            build_id: number;
            status: string;
        };
        assert.deepEqual({ ...last }, { build_id: 123457, status: 'done' });
        const status = watcher.getStatus();
        assert.equal(status.lastResult, 'started');
        assert.equal(status.lastSeenBuild, 123457);
        assert.ok(status.lastCheckAt);
    });

    it('starts nothing while an import is running (running)', async () => {
        await runImport(importer);
        api.buildId = 123457;
        importer.start();
        assert.equal(await watcher.checkNow(), 'running');
        await importer.waitForIdle();
        assert.equal(updateCount(), 2);
    });

    it('remembers an error from /v2/build and does not throw (error)', async () => {
        await runImport(importer);
        api.buildId = null;
        const logged: unknown[][] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => void logged.push(args);
        try {
            assert.equal(await watcher.checkNow(), 'error');
        } finally {
            console.error = original;
        }
        assert.equal(logged.length, 1);
        assert.equal(watcher.getStatus().lastResult, 'error');
        assert.equal(updateCount(), 1);
    });

    it('start/stop set enabled and nextCheckAt', () => {
        assert.equal(watcher.getStatus().enabled, false);
        watcher.start();
        assert.equal(watcher.getStatus().enabled, true);
        assert.ok(watcher.getStatus().nextCheckAt);
        watcher.stop();
        assert.equal(watcher.getStatus().enabled, false);
        assert.equal(watcher.getStatus().nextCheckAt, null);
    });
});
