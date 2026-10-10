import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { Hono } from 'hono';
import type { ItemDetail, ItemListResponse, UpdateChangesResponse } from '../../shared/types.js';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { migrations } from './db/schema.js';
import { Gw2Client } from './gw2/client.js';
import { Importer } from './importer/importer.js';
import { startFakeGw2Api, type FakeGw2Api } from './test/fakeGw2Api.js';
import { createTestImporter, fixtureItems, runImport } from './test/fixtures.js';

describe('Language (lang=de)', () => {
  let api: FakeGw2Api;
  let app: Hono;
  let db: DatabaseSync;

  const get = async <T>(url: string, status = 200): Promise<T> => {
    const res = await app.request(url);
    assert.equal(res.status, status, `${url} → ${res.status}`);
    return (await res.json()) as T;
  };
  const idsOf = async (query: string) => (await get<ItemListResponse>(`/api/items?${query}`)).items.map((i) => i.id);

  before(async () => {
    api = await startFakeGw2Api(fixtureItems());
    api.german.set(1, { name: 'Mini-Golem-Bausatz', description: 'Ein Bausatz für Golems.' });
    api.german.set(3, { name: 'Alter Apparat' });
    const created = createTestImporter(api.url);
    db = created.db;
    app = createApp(db, null, created.importer);
    await runImport(created.importer);
    // Item 2 ("Banner of Strength") should have no German text (fallback to English).
    db.prepare('DELETE FROM item_texts WHERE item_id = 2').run();
    db.prepare('DELETE FROM items_fts_de WHERE rowid = 2').run();
  });
  after(() => api.close());

  it('List: German name plus nameEn, sorted by the German name', async () => {
    const res = await get<ItemListResponse>('/api/items?lang=de&candidate=all');
    assert.deepEqual(
      res.items.map((i) => [i.id, i.name, i.nameEn]),
      [
        [3, 'Alter Apparat', 'Old Gizmo'],
        [2, 'Banner of Strength', 'Banner of Strength'], // English fallback
        [1, 'Mini-Golem-Bausatz', 'Mini Golem Kit'],
      ],
    );
    const en = await get<ItemListResponse>('/api/items?candidate=all');
    assert.deepEqual(en.items.map((i) => i.name), ['Banner of Strength', 'Mini Golem Kit', 'Old Gizmo']);
    assert.equal(en.items[1]!.nameEn, 'Mini Golem Kit');
  });

  it('Search: German word finds the item, English one too; in English only English', async () => {
    assert.deepEqual(await idsOf('lang=de&q=bausatz'), [1]);
    assert.deepEqual(await idsOf('lang=de&q=golems'), [1]); // description
    assert.deepEqual(await idsOf('lang=de&q=kit'), [1]); // English index
    assert.deepEqual(await idsOf('lang=en&q=bausatz'), []);
    assert.deepEqual(await idsOf('q=bausatz'), []);
  });

  it('Detail: fall back to English without German text', async () => {
    const item = await get<ItemDetail>('/api/items/2?lang=de');
    assert.equal(item.name, 'Banner of Strength');
    assert.equal(item.description, 'Description of Banner of Strength.');
  });

  it('Detail: German name, description, nameEn and wiki link', async () => {
    const item = await get<ItemDetail>('/api/items/1?lang=de');
    assert.equal(item.name, 'Mini-Golem-Bausatz');
    assert.equal(item.nameEn, 'Mini Golem Kit');
    assert.equal(item.description, 'Ein Bausatz für Golems.');
    assert.equal(item.wikiUrl, 'https://wiki-de.guildwars2.com/wiki/Spezial:Suche/Mini-Golem-Bausatz');
    const en = await get<ItemDetail>('/api/items/1');
    assert.equal(en.name, 'Mini Golem Kit');
    assert.equal(en.wikiUrl, 'https://wiki.guildwars2.com/wiki/Special:Search/Mini%20Golem%20Kit');
  });

  it('Export and changes respect lang', async () => {
    const rows = await get<{ id: number; name: string; wiki_url: string }[]>('/api/items/export?format=json&lang=de&candidate=all');
    assert.equal(rows[0]!.name, 'Alter Apparat');
    assert.match(rows[0]!.wiki_url, /^https:\/\/wiki-de\.guildwars2\.com\//);

    const changes = await get<UpdateChangesResponse>('/api/updates/1/changes?lang=de&type=gizmo&q=bausatz&hidePlaceholders=false');
    assert.deepEqual(changes.items.map((i) => [i.id, i.name, i.nameEn]), [[1, 'Mini-Golem-Bausatz', 'Mini Golem Kit']]);
    // The English name is also found in the German view; old/new stays English.
    const byEn = await get<UpdateChangesResponse>('/api/updates/1/changes?lang=de&type=gizmo&q=mini%20golem&hidePlaceholders=false');
    assert.equal(byEn.items[0]!.after?.name, 'Mini Golem Kit');
    const en = await get<UpdateChangesResponse>('/api/updates/1/changes?type=gizmo&q=bausatz&hidePlaceholders=false');
    assert.equal(en.items.length, 0);
  });

  it('invalid lang -> 400 on all endpoints', async () => {
    for (const url of [
      '/api/items?lang=fr',
      '/api/items/1?lang=fr',
      '/api/items/export?format=json&lang=fr',
      '/api/updates/1/changes?lang=fr',
      '/api/updates/compare?from=1&to=2&lang=fr',
    ]) {
      await get(url, 400);
    }
  });

  it('/api/stats reports the number of German texts', async () => {
    assert.equal((await get<{ germanTexts: number }>('/api/stats')).germanTexts, 6);
    const emptyDb = openDatabase(':memory:');
    try {
      const emptyApp = createApp(emptyDb, null, new Importer(emptyDb, new Gw2Client({ baseUrl: 'http://127.0.0.1:1' })));
      const res = await emptyApp.request('/api/stats');
      assert.equal(((await res.json()) as { germanTexts: number }).germanTexts, 0);
    } finally {
      emptyDb.close();
    }
  });
});

describe('Migration 4 (item_texts)', () => {
  it('DB at version 3 is migrated; texts can be stored and searched', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-items-mig4-'));
    const file = path.join(dir, 'v3.db');
    const old = new DatabaseSync(file);
    for (const migration of migrations.slice(0, 3)) old.exec(migration);
    old.exec('PRAGMA user_version = 3');
    old.exec(`INSERT INTO updates (id, started_at, status, build_id, added, changed, removed) VALUES (1, '2026-01-01T00:00:00Z', 'done', 1, 1, 0, 0)`);
    old.exec(`INSERT INTO items (id, name, type, rarity, level, icon, game_types, flags, is_candidate, raw_json, hash, first_seen_update, last_changed_update)
      VALUES (1, 'Old Gizmo', 'Gizmo', 'Rare', 0, 'x.png', '["Dungeon","Pve"]', '[]', 1, '{}', 'h', 1, 1)`);
    old.close();

    const db = openDatabase(file);
    try {
      assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, migrations.length);
      const client = new Gw2Client({ baseUrl: 'http://127.0.0.1:1', minIntervalMs: 0, retryBaseDelayMs: 1 });
      const migrated = createApp(db, null, new Importer(db, client));
      // Without German texts: fall back to the English name
      const before = (await (await migrated.request('/api/items?lang=de')).json()) as ItemListResponse;
      assert.deepEqual(before.items.map((i) => [i.name, i.nameEn]), [['Old Gizmo', 'Old Gizmo']]);

      db.prepare(`INSERT INTO item_texts (item_id, lang, name, description) VALUES (1, 'de', 'Alter Apparat', NULL)`).run();
      db.prepare(`INSERT INTO items_fts_de (rowid, name, description) VALUES (1, 'Alter Apparat', NULL)`).run();
      const found = (await (await migrated.request('/api/items?lang=de&q=apparat')).json()) as ItemListResponse;
      assert.deepEqual(found.items.map((i) => [i.name, i.nameEn]), [['Alter Apparat', 'Old Gizmo']]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
