import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import type { Hono } from 'hono';
import type { ImportStatus, ItemDetail, ItemListResponse, UpdateDetail } from '../../shared/types.js';
import { createApp } from './app.js';
import type { Importer } from './importer/importer.js';
import { startFakeGw2Api, type FakeGw2Api } from './test/fakeGw2Api.js';
import { chatLinkFor, createTestImporter, fixtureItems, runImport } from './test/fixtures.js';

let api: FakeGw2Api;
let db: DatabaseSync;
let importer: Importer;
let app: Hono;

async function getJson<T>(path: string, expectedStatus = 200): Promise<T> {
  const res = await app.request(path);
  assert.equal(res.status, expectedStatus, `${path} → ${res.status}`);
  return (await res.json()) as T;
}
const ids = async (query: string) =>
  (await getJson<ItemListResponse>(`/api/items${query}`)).items.map((item) => item.id);
const putTest = (id: number | string, body: unknown) =>
  app.request(`/api/items/${id}/test`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

before(async () => {
  api = await startFakeGw2Api(fixtureItems());
  ({ db, importer } = createTestImporter(api.url));
  app = createApp(db, null, importer);
  await runImport(importer);
});
after(() => api.close());

describe('GET /api/items', () => {
  it('Default: Gizmo-Kandidaten, nach Name sortiert', async () => {
    const res = await getJson<ItemListResponse>('/api/items');
    assert.deepEqual(res.items.map((i) => i.name), ['Mini Golem Kit', 'Old Gizmo']);
    assert.equal(res.total, 2);
    assert.equal(res.page, 1);
    assert.equal(res.pageSize, 50);
    const kit = res.items[0]!;
    assert.deepEqual(kit.gameTypes, ['Dungeon', 'Pve', 'Wvw']);
    assert.equal(kit.isCandidate, true);
    assert.equal(kit.testStatus, 'untested');
    assert.equal(kit.needsRetest, false);
    assert.equal(kit.subtype, 'Default');
  });

  it('Consumables: Food/Utility standardmäßig ausgeblendet', async () => {
    assert.deepEqual(await ids('?view=consumable'), [8778]);
    assert.deepEqual(await ids('?view=consumable&hideCommon=false&sort=id'), [4, 5, 8778]);
  });

  it('candidate und view=all', async () => {
    assert.deepEqual(await ids('?view=gizmo&candidate=no'), [2]);
    assert.deepEqual(await ids('?view=all&candidate=all&sort=id'), [1, 2, 3, 6, 8778]);
  });

  it('Suche: ID, Chat-Link, Volltext-Präfix, Sonderzeichen', async () => {
    assert.deepEqual(await ids('?view=all&q=8778'), [8778]);
    assert.deepEqual(await ids(`?view=all&q=${encodeURIComponent(chatLinkFor(8778))}`), [8778]);
    // Ingame-Link mit anderer Anzahl → trotzdem über die enthaltene ID gefunden
    const withQuantity = `[&${Buffer.from([2, 5, 0x4a, 0x22, 0, 0]).toString('base64')}]`;
    assert.deepEqual(await ids(`?view=all&q=${encodeURIComponent(withQuantity)}`), [8778]);
    assert.deepEqual(await ids('?view=all&q=gol&sort=id'), [1, 8778]);
    assert.deepEqual(await ids('?view=all&q=mini%20bom'), [8778]);
    assert.deepEqual(await ids('?view=all&candidate=all&q=description%20banner'), [2]);
    // FTS-Syntax darf nicht ausgewertet werden und keinen Fehler werfen
    assert.deepEqual(await ids(`?view=all&q=${encodeURIComponent('"golem" OR -NEAR( name:*')}`), []);
    assert.deepEqual(await ids(`?view=all&q=${encodeURIComponent('---')}&sort=id`), [1, 3, 8778]);
  });

  it('Filter rarity und gameType', async () => {
    assert.deepEqual(await ids('?view=all&candidate=all&rarity=Rare,Exotic&sort=id'), [1, 2]);
    assert.deepEqual(await ids('?view=all&candidate=all&gameType=Pve,Wvw&sort=id'), [1, 2, 8778]);
  });

  it('Sortierung und Paginierung', async () => {
    assert.deepEqual(await ids('?view=all&candidate=all&sort=rarity&order=desc'), [2, 1, 8778, 3, 6]);
    const page2 = await getJson<ItemListResponse>('/api/items?view=all&candidate=all&sort=id&pageSize=2&page=2');
    assert.deepEqual(page2.items.map((i) => i.id), [3, 6]);
    assert.equal(page2.total, 5);
    const capped = await getJson<ItemListResponse>('/api/items?pageSize=1000');
    assert.equal(capped.pageSize, 200);
  });

  it('ungültige Parameter → 400', async () => {
    await getJson('/api/items?view=foo', 400);
    await getJson('/api/items?rarity=Shiny', 400);
    await getJson('/api/items?page=0', 400);
  });
});

describe('GET /api/items/:id', () => {
  it('liefert Details inkl. Verlauf und Wiki-Link', async () => {
    const item = await getJson<ItemDetail>('/api/items/8778');
    assert.equal(item.name, 'Mini Golem Bomb');
    assert.equal(item.chatLink, chatLinkFor(8778));
    assert.equal(item.wikiUrl, 'https://wiki.guildwars2.com/wiki/Special:Search/Mini%20Golem%20Bomb');
    assert.deepEqual(item.flags, ['NoSell']);
    assert.deepEqual(item.restrictions, []);
    assert.equal(item.vendorValue, 10);
    assert.deepEqual(item.details, { type: 'Generic' });
    assert.deepEqual(item.test, { status: 'untested', note: null, testedAt: null, gameTypesAtTest: null });
    assert.equal(item.history.length, 1);
    assert.equal(item.history[0]!.kind, 'added');
  });

  it('404 für unbekannte, 400 für ungültige IDs', async () => {
    await getJson('/api/items/424242', 404);
    await getJson('/api/items/abc', 400);
  });
});

describe('Teststatus und Updates', () => {
  it('PUT test validiert den Body', async () => {
    assert.equal((await putTest(1, { status: 'maybe' })).status, 400);
    assert.equal((await putTest(1, { status: 'works', note: 5 })).status, 400);
    assert.equal((await putTest(1, 'kein json')).status, 400);
    assert.equal((await putTest(424242, { status: 'works' })).status, 404);
  });

  it('PUT test speichert und needsRetest greift nach Änderung der game_types', async () => {
    const res = await putTest(1, { status: 'works', note: '  klappt in Fraktal 40  ' });
    assert.equal(res.status, 200);
    const saved = (await res.json()) as ItemDetail;
    assert.equal(saved.test.status, 'works');
    assert.equal(saved.test.note, 'klappt in Fraktal 40');
    assert.ok(saved.test.testedAt);
    assert.deepEqual(saved.test.gameTypesAtTest, ['Dungeon', 'Pve', 'Wvw']);
    assert.equal(saved.needsRetest, false);
    assert.deepEqual(await ids('?testStatus=works'), [1]);
    assert.deepEqual(await ids('?testStatus=untested'), [3]);

    // Item 2 auch testen; seine game_types ändern sich nur in der Reihenfolge → kein Retest
    await putTest(2, { status: 'broken' });

    // Neues Update: Item 1 verliert Dungeon, Item 2 bekommt andere Reihenfolge, Item 3 verschwindet
    api.items.get(1)!.game_types = ['Wvw', 'Pve'];
    api.items.get(2)!.game_types = ['Wvw', 'Pve'];
    api.items.delete(3);
    const started = await app.request('/api/updates', { method: 'POST' });
    assert.equal(started.status, 202);
    const status = (await started.json()) as ImportStatus;
    assert.equal(status.running, true);
    assert.equal((await app.request('/api/updates', { method: 'POST' })).status, 409);
    await importer.waitForIdle();
    const finished = await getJson<ImportStatus>('/api/updates/status');
    assert.equal(finished.phase, 'done');

    const kit = await getJson<ItemDetail>('/api/items/1');
    assert.equal(kit.isCandidate, false);
    assert.equal(kit.needsRetest, true);
    assert.equal(kit.history.length, 2);
    assert.deepEqual(kit.history[0]!.changedFields, ['game_types']);
    assert.deepEqual(kit.history[0]!.gameTypesBefore, ['Dungeon', 'Pve', 'Wvw']);
    assert.deepEqual(kit.history[0]!.gameTypesAfter, ['Pve', 'Wvw']);

    assert.deepEqual(await ids('?view=all&candidate=all&testStatus=retest'), [1]);
    assert.equal((await getJson<ItemDetail>('/api/items/2')).needsRetest, false);

    // Nur Items aus diesem Update; entfernte nur mit includeRemoved
    assert.deepEqual(await ids(`?view=all&candidate=all&updateId=${status.updateId}&sort=id`), [1, 2]);
    assert.deepEqual(await ids(`?view=all&candidate=all&updateId=${status.updateId}&includeRemoved=true&sort=id`), [1, 2, 3]);
    const removed = await getJson<ItemDetail>('/api/items/3');
    assert.equal(removed.removed, true);

    // Erneut testen → Retest erledigt
    await putTest(1, { status: 'broken' });
    assert.equal((await getJson<ItemDetail>('/api/items/1')).needsRetest, false);
  });

  it('GET /api/updates: neueste zuerst mit Dungeon-Zählern', async () => {
    const updates = await getJson<UpdateDetail[]>('/api/updates');
    assert.equal(updates.length, 2);
    const [latest, first] = updates;
    assert.equal(latest!.status, 'done');
    assert.equal(latest!.buildId, 123456);
    assert.deepEqual(
      { added: latest!.added, changed: latest!.changed, removed: latest!.removed },
      { added: 0, changed: 2, removed: 1 },
    );
    assert.equal(latest!.dungeonLost, 1);
    assert.equal(latest!.dungeonGained, 0);
    assert.equal(first!.added, 7);
    assert.equal(first!.dungeonGained, 0);
    assert.equal(latest!.error, null);
  });

  it('/api/stats funktioniert weiterhin', async () => {
    const stats = await getJson<{ items: number; candidates: { gizmo: number; consumable: number } }>('/api/stats');
    assert.equal(stats.items, 6);
    assert.deepEqual(stats.candidates, { gizmo: 0, consumable: 3 });
  });
});
