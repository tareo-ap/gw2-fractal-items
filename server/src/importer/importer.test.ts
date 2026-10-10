import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { Gw2Client } from '../gw2/client.js';
import { createTestImporter, fixtureItems, runImport } from '../test/fixtures.js';
import { startFakeGw2Api, type FakeGw2Api } from '../test/fakeGw2Api.js';
import { failOrphanedUpdates, type Importer } from './importer.js';

let api: FakeGw2Api;
let db: DatabaseSync;
let importer: Importer;

const changesOf = (updateId: number) =>
  db.prepare('SELECT item_id, kind, changed_fields, game_types_before, game_types_after FROM item_changes WHERE update_id = ? ORDER BY item_id').all(updateId) as {
    item_id: number;
    kind: string;
    changed_fields: string | null;
    game_types_before: string | null;
    game_types_after: string | null;
  }[];
const ftsIds = (match: string) =>
  (db.prepare('SELECT rowid FROM items_fts WHERE items_fts MATCH ? ORDER BY rowid').all(match) as { rowid: number }[]).map((r) => r.rowid);

const deFtsIds = (match: string) =>
  (db.prepare('SELECT rowid FROM items_fts_de WHERE items_fts_de MATCH ? ORDER BY rowid').all(match) as { rowid: number }[]).map((r) => r.rowid);

describe('Importer', () => {
  beforeEach(async () => {
    api = await startFakeGw2Api(fixtureItems());
    ({ db, importer } = createTestImporter(api.url));
  });
  afterEach(() => api.close());

  it('erster Lauf: alle Items sind added, abgeleitete Spalten stimmen', async () => {
    const status = await runImport(importer);
    assert.equal(status.phase, 'done');
    assert.equal(status.running, false);
    assert.equal(status.total, 7);
    assert.equal(status.processed, 7);

    const update = db.prepare('SELECT * FROM updates WHERE id = ?').get(status.updateId) as Record<string, unknown>;
    assert.equal(update.status, 'done');
    assert.equal(update.build_id, 123456);
    assert.equal(update.added, 7);
    assert.equal(update.changed, 0);
    assert.equal(update.removed, 0);
    assert.ok(update.finished_at);

    const kit = db.prepare('SELECT * FROM items WHERE id = 1').get() as Record<string, unknown>;
    assert.equal(kit.subtype, 'Default');
    assert.equal(kit.is_candidate, 1);
    assert.equal(kit.game_types, '["Dungeon","Pve","Wvw"]'); // sortiert gespeichert
    const banner = db.prepare('SELECT is_candidate FROM items WHERE id = 2').get() as { is_candidate: number };
    assert.equal(banner.is_candidate, 0);

    assert.deepEqual(ftsIds('"golem"*'), [1, 8778]);
  });

  it('zweiter Lauf: erkennt added, changed (inkl. game_types) und removed und hält FTS synchron', async () => {
    const first = await runImport(importer);

    // Item 1 verliert Dungeon, Item 2 wird umbenannt, Item 3 verschwindet, Item 9 ist neu.
    api.items.get(1)!.game_types = ['Pve', 'Wvw'];
    api.items.get(2)!.name = 'Banner of Courage';
    api.items.delete(3);
    api.items.set(9, { ...structuredClone(api.items.get(6)!), id: 9, name: 'Glowing Rock' });

    const second = await runImport(importer);
    assert.equal(second.phase, 'done');
    const update = db.prepare('SELECT added, changed, removed FROM updates WHERE id = ?').get(second.updateId) as Record<string, number>;
    assert.deepEqual({ ...update }, { added: 1, changed: 2, removed: 1 });

    assert.deepEqual(
      changesOf(second.updateId!).map((c) => ({ ...c })),
      [
        { item_id: 1, kind: 'changed', changed_fields: '["game_types"]', game_types_before: '["Dungeon","Pve","Wvw"]', game_types_after: '["Pve","Wvw"]' },
        { item_id: 2, kind: 'changed', changed_fields: '["name"]', game_types_before: '["Pve","Wvw"]', game_types_after: '["Pve","Wvw"]' },
        { item_id: 3, kind: 'removed', changed_fields: null, game_types_before: '["Dungeon","Pve"]', game_types_after: null },
        { item_id: 9, kind: 'added', changed_fields: null, game_types_before: null, game_types_after: '["Pve"]' },
      ],
    );

    const kit = db.prepare('SELECT is_candidate, first_seen_update, last_changed_update FROM items WHERE id = 1').get() as Record<string, number>;
    assert.deepEqual({ ...kit }, { is_candidate: 0, first_seen_update: first.updateId, last_changed_update: second.updateId });
    const old = db.prepare('SELECT removed FROM items WHERE id = 3').get() as { removed: number };
    assert.equal(old.removed, 1);

    assert.deepEqual(ftsIds('name : "strength"*'), []);
    assert.deepEqual(ftsIds('name : "courage"*'), [2]);
    // Integritätsprüfung des external-content-Index
    db.exec(`INSERT INTO items_fts(items_fts, rank) VALUES ('integrity-check', 1)`);

    // Dritter Lauf ohne Änderungen: nichts zu tun
    const third = await runImport(importer);
    assert.equal(changesOf(third.updateId!).length, 0);
  });

  it('speichert deutsche Texte in item_texts und im deutschen Index', async () => {
    api.german.set(1, { name: 'Mini-Golem-Bausatz', description: 'Beschreibung des Bausatzes.' });
    const status = await runImport(importer);
    assert.equal(status.phase, 'done');
    assert.equal(status.error, null);
    const text = db.prepare(`SELECT name, description FROM item_texts WHERE item_id = 1 AND lang = 'de'`).get() as Record<string, string>;
    assert.deepEqual({ ...text }, { name: 'Mini-Golem-Bausatz', description: 'Beschreibung des Bausatzes.' });
    // Items ohne Übersetzung bekommen den englischen Text
    const other = db.prepare(`SELECT name FROM item_texts WHERE item_id = 2`).get() as { name: string };
    assert.equal(other.name, 'Banner of Strength');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM item_texts').get() as { n: number }).n, 7);
    assert.deepEqual(deFtsIds('"bausatz"*'), [1]);
    assert.ok(api.requests.some((r) => r.includes('lang=de')));
  });

  it('reine Übersetzungsänderung erzeugt keine item_change, der deutsche Text wird aktualisiert', async () => {
    api.german.set(1, { name: 'Mini-Golem-Bausatz' });
    await runImport(importer);
    api.german.set(1, { name: 'Mini-Golem-Set' });
    const second = await runImport(importer);
    assert.equal(changesOf(second.updateId!).length, 0);
    const update = db.prepare('SELECT added, changed, removed FROM updates WHERE id = ?').get(second.updateId) as Record<string, number>;
    assert.deepEqual({ ...update }, { added: 0, changed: 0, removed: 0 });
    const text = db.prepare(`SELECT name FROM item_texts WHERE item_id = 1`).get() as { name: string };
    assert.equal(text.name, 'Mini-Golem-Set');
    assert.deepEqual(deFtsIds('"bausatz"*'), []);
    assert.deepEqual(deFtsIds('"set"*'), [1]);
  });

  it('Fehler beim deutschen Teil: englische Daten bleiben, Update ist done mit Hinweis', async () => {
    api.failGerman = true;
    const status = await runImport(importer);
    assert.equal(status.phase, 'done');
    assert.match(status.error ?? '', /Deutsche Texte nicht vollständig/);
    const update = db.prepare('SELECT status, error, added FROM updates WHERE id = ?').get(status.updateId) as Record<string, unknown>;
    assert.equal(update.status, 'done');
    assert.equal(update.added, 7);
    assert.match(String(update.error), /Deutsche Texte/);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM item_texts').get() as { n: number }).n, 0);

    // Das nächste Update holt die Texte nach und löscht den Hinweis.
    api.failGerman = false;
    const next = await runImport(importer);
    assert.equal(next.error, null);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM item_texts').get() as { n: number }).n, 7);
  });

  it('wiederholt bei 429 und 5xx und kommt mit 206 Partial Content zurecht', async () => {
    api.ghostIds = [99999]; // gelistet, aber ohne Details
    api.failures = [429, 429, 503];
    const status = await runImport(importer);
    assert.equal(status.phase, 'done', String(status.error));
    assert.equal(status.total, 8);
    // Ein Build-Request (1 Fehlschlag + Erfolg) und IDs-Request (2 Fehlschläge + Erfolg) → Retries passiert
    assert.ok(api.requests.length >= 3 + 3);
    const count = db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
    assert.equal(count.n, 7);
  });

  it('setzt das Update auf failed, wenn alle Versuche scheitern', async () => {
    api.failures = [500, 500, 500, 500, 500, 500, 500, 500, 500, 500];
    const status = await runImport(importer);
    assert.equal(status.phase, 'failed');
    assert.match(status.error ?? '', /500/);
    const update = db.prepare('SELECT status, error FROM updates WHERE id = ?').get(status.updateId) as Record<string, string>;
    assert.equal(update.status, 'failed');
    assert.match(update.error!, /500/);
    const count = db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
    assert.equal(count.n, 0);
  });

  it('lässt nur einen Import gleichzeitig zu', async () => {
    importer.start();
    assert.throws(() => importer.start(), /läuft bereits/);
    await importer.waitForIdle();
  });

  it('failOrphanedUpdates setzt verwaiste Läufe auf failed', async () => {
    db.prepare(`INSERT INTO updates (started_at, status) VALUES ('2026-01-01T00:00:00Z', 'running')`).run();
    failOrphanedUpdates(db);
    const row = db.prepare('SELECT status, error FROM updates').get() as Record<string, string>;
    assert.equal(row.status, 'failed');
    assert.ok(row.error);
  });
});

describe('Gw2Client', () => {
  let server: FakeGw2Api;
  before(async () => {
    server = await startFakeGw2Api(fixtureItems());
  });
  after(() => server.close());

  it('liefert für komplett unbekannte IDs eine leere Liste', async () => {
    const client = new Gw2Client({ baseUrl: server.url, minIntervalMs: 0, retryBaseDelayMs: 1 });
    assert.deepEqual(await client.getItems([424242]), []);
  });

  it('getBuildId liefert null bei Fehler', async () => {
    server.buildId = null;
    const client = new Gw2Client({ baseUrl: server.url, minIntervalMs: 0, retryBaseDelayMs: 1, maxAttempts: 2 });
    assert.equal(await client.getBuildId(), null);
  });

  it('drosselt auf den Mindestabstand', async () => {
    const client = new Gw2Client({ baseUrl: server.url, minIntervalMs: 50 });
    const start = Date.now();
    await Promise.all([client.getItemIds(), client.getItemIds(), client.getItemIds()]);
    assert.ok(Date.now() - start >= 100);
  });
});
