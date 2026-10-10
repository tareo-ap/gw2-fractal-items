import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { Hono } from 'hono';
import type { ImportStatus, ItemDetail, ItemListResponse, UpdateChangesResponse, UpdateCompareResponse, UpdateDetail } from '../../shared/types.js';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { migrations } from './db/schema.js';
import { Gw2Client } from './gw2/client.js';
import { Importer } from './importer/importer.js';
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
  it('Default: Gizmo candidates, sorted by name', async () => {
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

  it('Consumables: Food/Utility hidden by default', async () => {
    assert.deepEqual(await ids('?view=consumable'), [8778]);
    assert.deepEqual(await ids('?view=consumable&hideCommon=false&sort=id'), [4, 5, 8778]);
  });

  it('candidate and view=all', async () => {
    assert.deepEqual(await ids('?view=gizmo&candidate=no'), [2]);
    assert.deepEqual(await ids('?view=all&candidate=all&sort=id'), [1, 2, 3, 6, 8778]);
  });

  it('Search: ID, chat link, full-text prefix, special characters', async () => {
    assert.deepEqual(await ids('?view=all&q=8778'), [8778]);
    assert.deepEqual(await ids(`?view=all&q=${encodeURIComponent(chatLinkFor(8778))}`), [8778]);
    // In-game link with a different quantity -> still found via the contained ID
    const withQuantity = `[&${Buffer.from([2, 5, 0x4a, 0x22, 0, 0]).toString('base64')}]`;
    assert.deepEqual(await ids(`?view=all&q=${encodeURIComponent(withQuantity)}`), [8778]);
    assert.deepEqual(await ids('?view=all&q=gol&sort=id'), [1, 8778]);
    assert.deepEqual(await ids('?view=all&q=mini%20bom'), [8778]);
    assert.deepEqual(await ids('?view=all&candidate=all&q=description%20banner'), [2]);
    // FTS syntax must not be evaluated and must not throw an error
    assert.deepEqual(await ids(`?view=all&q=${encodeURIComponent('"golem" OR -NEAR( name:*')}`), []);
    assert.deepEqual(await ids(`?view=all&q=${encodeURIComponent('---')}&sort=id`), [1, 3, 8778]);
  });

  it('Filter rarity and gameType', async () => {
    assert.deepEqual(await ids('?view=all&candidate=all&rarity=Rare,Exotic&sort=id'), [1, 2]);
    assert.deepEqual(await ids('?view=all&candidate=all&gameType=Pve,Wvw&sort=id'), [1, 2, 8778]);
  });

  it('Sorting and pagination', async () => {
    assert.deepEqual(await ids('?view=all&candidate=all&sort=rarity&order=desc'), [2, 1, 8778, 3, 6]);
    const page2 = await getJson<ItemListResponse>('/api/items?view=all&candidate=all&sort=id&pageSize=2&page=2');
    assert.deepEqual(page2.items.map((i) => i.id), [3, 6]);
    assert.equal(page2.total, 5);
    const capped = await getJson<ItemListResponse>('/api/items?pageSize=1000');
    assert.equal(capped.pageSize, 200);
  });

  it('invalid parameters -> 400', async () => {
    await getJson('/api/items?view=foo', 400);
    await getJson('/api/items?rarity=Shiny', 400);
    await getJson('/api/items?page=0', 400);
    await getJson('/api/items?hidePlaceholders=maybe', 400);
  });
});

describe('Placeholder filter', () => {
  let phApi: FakeGw2Api;
  let phApp: Hono;

  before(async () => {
    const base = fixtureItems()[0]!;
    const consumable = fixtureItems().find((i) => i.id === 8778)!;
    phApi = await startFakeGw2Api([
      base,
      { ...base, id: 101, name: '   ' },
      { ...base, id: 102, name: 'Ohne Icon', icon: undefined },
      { ...base, id: 103, name: '((906936))' },
      consumable,
      { ...consumable, id: 104, name: ' Mastery Point' },
      { ...consumable, id: 105, name: '"/Clap" Emote Tome' },
      { ...base, id: 106, name: '[[913817]]' },
      { ...consumable, id: 107, name: '300 Geodes', details: { type: 'Immediate' } },
      { ...consumable, id: 108, name: 'Magnetite Shard', details: { type: 'Currency' } },
      { ...consumable, id: 109, name: '2nd Place Finisher', details: { type: 'Generic' } },
    ]);
    const { db: phDb, importer: phImporter } = createTestImporter(phApi.url);
    phApp = createApp(phDb, null, phImporter);
    await runImport(phImporter);
  });
  after(() => phApi.close());

  const phIds = async (query: string) =>
    ((await (await phApp.request(`/api/items${query}`)).json()) as ItemListResponse).items.map((i) => i.id);

  it('hides items with an empty name, without an icon or with ((ID)) or [[ID]] names by default', async () => {
    assert.deepEqual(await phIds('?sort=id'), [1]);
    assert.deepEqual(await phIds('?view=all&sort=id'), [1, 109, 8778]);
  });

  it('hidePlaceholders=false shows them', async () => {
    assert.deepEqual(await phIds('?hidePlaceholders=false&sort=id'), [1, 101, 102, 103, 106]);
  });

  it('hideCommon hides Mastery Points, Emote Tomes and currencies', async () => {
    assert.deepEqual(await phIds('?view=consumable&sort=id'), [109, 8778]);
    assert.deepEqual(await phIds('?view=consumable&hideCommon=false&sort=id'), [104, 105, 107, 108, 109, 8778]);
  });
});

describe('Tonic view', () => {
  let tonicApi: FakeGw2Api;
  let tonicApp: Hono;

  before(async () => {
    const base = fixtureItems()[0]!;
    const consumable = fixtureItems().find((i) => i.id === 8778)!;
    tonicApi = await startFakeGw2Api([
      base,
      { ...consumable, id: 201, name: "Belcher's Bluff Kit", flags: ['NoSell', 'Tonic'] },
      { ...base, id: 202, name: 'Feisty Feline Tonic' },
      { ...consumable, id: 203, name: 'Endless Mystery Tonic', details: { type: 'Food' } },
      { ...consumable, id: 204, name: 'Recipe: Wolf Tonic', details: { type: 'Unlock' } },
      { ...consumable, id: 205, name: 'Sharpening Stone', details: { type: 'Utility' } },
    ]);
    const { db: tonicDb, importer: tonicImporter } = createTestImporter(tonicApi.url);
    tonicApp = createApp(tonicDb, null, tonicImporter);
    await runImport(tonicImporter);
  });
  after(() => tonicApi.close());

  it('finds tonics by flag or name, also with subtype Food, but no recipes', async () => {
    const res = (await (await tonicApp.request('/api/items?view=tonic&sort=id')).json()) as ItemListResponse;
    assert.deepEqual(res.items.map((i) => i.id), [201, 202, 203]);
  });

  it('/api/stats counts tonic candidates', async () => {
    const stats = (await (await tonicApp.request('/api/stats')).json()) as { candidates: { tonic: number } };
    assert.equal(stats.candidates.tonic, 3);
  });
});

describe('GET /api/export', () => {
  it('returns the database as a SQLite download', async () => {
    const res = await app.request('/api/export');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/vnd.sqlite3');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="gw2-items-\d{4}-\d{2}-\d{2}\.db"$/);
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.subarray(0, 15).toString('latin1'), 'SQLite format 3');
  });
});

describe('GET /api/items/:id', () => {
  it('returns details including history and wiki link', async () => {
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

  it('404 for unknown, 400 for invalid IDs', async () => {
    await getJson('/api/items/424242', 404);
    await getJson('/api/items/abc', 400);
  });
});

describe('Test status and updates', () => {
  it('PUT test validates the body', async () => {
    assert.equal((await putTest(1, { status: 'maybe' })).status, 400);
    assert.equal((await putTest(1, { status: 'works', note: 5 })).status, 400);
    assert.equal((await putTest(1, 'not json')).status, 400);
    assert.equal((await putTest(424242, { status: 'works' })).status, 404);
  });

  it('PUT test saves and needsRetest applies after game_types change', async () => {
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

    // Also test item 2; its game_types only change in order -> no retest
    await putTest(2, { status: 'broken' });

    // New update: item 1 loses Dungeon, item 2 gets a different order, item 3 disappears
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

    // Only items from this update; removed ones only with includeRemoved
    assert.deepEqual(await ids(`?view=all&candidate=all&updateId=${status.updateId}&sort=id`), [1, 2]);
    assert.deepEqual(await ids(`?view=all&candidate=all&updateId=${status.updateId}&includeRemoved=true&sort=id`), [1, 2, 3]);
    const removed = await getJson<ItemDetail>('/api/items/3');
    assert.equal(removed.removed, true);

    // Test again -> retest done
    await putTest(1, { status: 'broken' });
    assert.equal((await getJson<ItemDetail>('/api/items/1')).needsRetest, false);
  });

  it('GET /api/updates: newest first with Dungeon counters', async () => {
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

  it('/api/stats still works', async () => {
    const stats = await getJson<{ items: number; candidates: { gizmo: number; consumable: number; tonic: number } }>('/api/stats');
    assert.equal(stats.items, 6);
    assert.deepEqual(stats.candidates, { gizmo: 0, consumable: 3, tonic: 0 });
  });
});

// Runs after "Test status and updates": items 1 and 2 are then tested (broken), item 3 is removed.
describe('GET /api/items/export', () => {
  const exportJson = async (query: string) => {
    const res = await app.request(`/api/items/export?${query}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="gw2-items-[a-z]+-\d{4}-\d{2}-\d{2}\.json"$/);
    return (await res.json()) as Record<string, unknown>[];
  };

  it('JSON: all matches without pagination, real types', async () => {
    const rows = await exportJson('format=json&view=all&candidate=all&sort=id&pageSize=1&page=2');
    assert.deepEqual(rows.map((r) => r.id), [1, 2, 6, 8778]);
    const kit = rows[0]!;
    assert.deepEqual(kit.game_types, ['Pve', 'Wvw']);
    assert.deepEqual(kit.flags, ['NoSell']);
    assert.equal(kit.is_candidate, false);
    assert.equal(kit.removed, false);
    assert.equal(kit.needs_retest, false);
    assert.equal(kit.test_status, 'broken');
    assert.equal(kit.test_note, null);
    assert.equal(typeof kit.tested_at, 'string');
    assert.equal(kit.chat_link, chatLinkFor(1));
    assert.equal(kit.wiki_url, 'https://wiki.guildwars2.com/wiki/Special:Search/Mini%20Golem%20Kit');
    assert.deepEqual(Object.keys(kit), [
      'id', 'name', 'type', 'subtype', 'rarity', 'level', 'game_types', 'flags', 'is_candidate', 'removed',
      'test_status', 'test_note', 'tested_at', 'needs_retest', 'chat_link', 'wiki_url', 'icon',
    ]);
  });

  it('JSON: respects view, testStatus and sorting', async () => {
    const consumables = await exportJson('format=json&view=consumable&hideCommon=false&sort=id&order=desc');
    assert.deepEqual(consumables.map((r) => r.id), [8778, 5, 4]);
    const broken = await exportJson('format=json&view=all&candidate=all&testStatus=broken&sort=id');
    assert.deepEqual(broken.map((r) => r.id), [1, 2]);
  });

  it('CSV: BOM, semicolon, header, quoting and formula protection', async () => {
    await putTest(8778, { status: 'works', note: 'a;b "c"\nzweite Zeile' });
    await putTest(6, { status: 'works', note: '=1+1' });
    const res = await app.request('/api/items/export?format=csv&view=all&candidate=all&testStatus=works&sort=id');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="gw2-items-all-\d{4}-\d{2}-\d{2}\.csv"$/);
    // text() would swallow the BOM, so check the raw bytes
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const body = bytes.subarray(3).toString('utf8');
    const header = 'id;name;type;subtype;rarity;level;game_types;flags;is_candidate;removed;test_status;test_note;tested_at;needs_retest;chat_link;wiki_url;icon';
    assert.ok(body.startsWith(`${header}\r\n`));
    assert.ok(body.endsWith('\r\n'));
    assert.ok(body.includes(';"a;b ""c""\nzweite Zeile";'));
    assert.ok(body.includes(";'=1+1;"));
    assert.ok(body.includes(';false;false;works;'));
  });

  it('invalid or missing format -> 400', async () => {
    await getJson('/api/items/export?format=xml', 400);
    await getJson('/api/items/export', 400);
    await getJson('/api/items/export?format=csv&view=foo', 400);
  });
});

describe('GET /api/updates/:id/changes (second import round)', () => {
  let chApi: FakeGw2Api;
  let chApp: Hono;
  let firstId: number;
  let secondId: number;

  before(async () => {
    const gizmo = fixtureItems()[0]!;
    const potion = fixtureItems().find((i) => i.id === 8778)!;
    chApi = await startFakeGw2Api([
      { ...gizmo, id: 1, name: 'Stable Gizmo', game_types: ['Dungeon', 'Pve'] },
      { ...gizmo, id: 2, name: 'Lost Gizmo', game_types: ['Dungeon', 'Pve', 'Wvw'] },
      { ...gizmo, id: 3, name: 'Gained Gizmo', game_types: ['Pve'] },
      { ...gizmo, id: 4, name: 'Removed Gizmo', game_types: ['Dungeon', 'Pve'] },
      { ...gizmo, id: 5, name: 'Desc Gizmo', game_types: ['Dungeon', 'Pve'] },
      { ...gizmo, id: 6, name: 'Reorder Gizmo', game_types: ['Pve', 'Dungeon'] },
      { ...potion, id: 7, name: 'Lost Potion', game_types: ['Dungeon', 'Pve'] },
      potion,
    ]);
    const { db: chDb, importer: chImporter } = createTestImporter(chApi.url);
    chApp = createApp(chDb, null, chImporter);
    firstId = (await runImport(chImporter)).updateId!;

    chApi.items.get(2)!.game_types = ['Pve', 'Wvw'];
    chApi.items.get(3)!.game_types = ['Dungeon', 'Pve'];
    chApi.items.delete(4);
    chApi.items.get(5)!.description = 'Neue Beschreibung';
    chApi.items.get(6)!.game_types = ['Dungeon', 'Pve'];
    chApi.items.get(7)!.game_types = ['Pve'];
    chApi.items.set(9, { ...gizmo, id: 9, name: 'New Gizmo', game_types: ['Dungeon'] });
    chApi.items.set(10, { ...gizmo, id: 10, name: '((123456))', game_types: ['Dungeon'] });
    chApi.buildId = 123457;
    secondId = (await runImport(chImporter)).updateId!;
  });
  after(() => chApi.close());

  const changes = (id: number, query = '') => chApp.request(`/api/updates/${id}/changes${query}`);
  const load = async (query = '', id = secondId) => {
    const res = await changes(id, query);
    assert.equal(res.status, 200, `${query} → ${res.status}`);
    return (await res.json()) as UpdateChangesResponse;
  };
  const changeIds = async (query: string) => (await load(query)).items.map((i) => i.id);

  it('counters cover the whole update and are unfiltered', async () => {
    const res = await load('?kind=removed&type=consumable');
    assert.equal(res.update.id, secondId);
    assert.equal(res.update.buildId, 123457);
    assert.deepEqual(res.counts, { added: 2, changed: 5, removed: 1, gameTypesChanged: 3, dungeonGained: 1, dungeonLost: 2 });
    // Reordered game_types (item 6) do not count as a game_types change
    assert.equal(res.update.dungeonLost, 2);
  });

  it('first update: everything new', async () => {
    const res = await load('?hidePlaceholders=false', firstId);
    assert.equal(res.counts.added, 8);
    assert.equal(res.counts.changed, 0);
    assert.equal(res.total, 8);
  });

  it('Sorting: Dungeon changes first, then changed, new, removed, each by name', async () => {
    // Placeholders (10) hidden by default
    assert.deepEqual(await changeIds(''), [3, 2, 7, 5, 6, 9, 4]);
    assert.deepEqual(await changeIds('?hidePlaceholders=false'), [3, 2, 7, 5, 6, 10, 9, 4]);
  });

  it('focus=dungeonLost / dungeonGained / gameTypes', async () => {
    const lost = await load('?focus=dungeonLost');
    assert.deepEqual(lost.items.map((i) => i.id), [2, 7]);
    assert.deepEqual(lost.items[0]!.gameTypesBefore, ['Dungeon', 'Pve', 'Wvw']);
    assert.deepEqual(lost.items[0]!.gameTypesAfter, ['Pve', 'Wvw']);
    assert.deepEqual(lost.items[0]!.changedFields, ['game_types']);
    assert.deepEqual(lost.items[0]!.before, { game_types: ['Dungeon', 'Pve', 'Wvw'] });
    assert.deepEqual(lost.items[0]!.after, { game_types: ['Pve', 'Wvw'] });
    assert.equal(lost.items[0]!.isCandidate, false);

    const gained = await load('?focus=dungeonGained');
    assert.deepEqual(gained.items.map((i) => i.id), [3]);
    assert.deepEqual(gained.items[0]!.gameTypesBefore, ['Pve']);
    assert.deepEqual(gained.items[0]!.gameTypesAfter, ['Dungeon', 'Pve']);
    assert.equal(gained.items[0]!.isCandidate, true);

    assert.deepEqual(await changeIds('?focus=gameTypes'), [3, 2, 7]);
  });

  it('kind=added / removed / several', async () => {
    const added = await load('?kind=added&hidePlaceholders=false');
    assert.deepEqual(added.items.map((i) => i.id), [10, 9]);
    assert.equal(added.items[1]!.gameTypesBefore, null);
    assert.deepEqual(added.items[1]!.gameTypesAfter, ['Dungeon']);
    assert.equal(added.items[1]!.before, null);
    assert.equal(added.items[1]!.after?.name, 'New Gizmo');
    assert.deepEqual(added.items[1]!.after?.game_types, ['Dungeon']);
    assert.equal(added.items[1]!.after?.['details.type'], 'Default');
    assert.equal(added.items[1]!.after?.id, undefined);

    const removed = await load('?kind=removed');
    assert.deepEqual(removed.items.map((i) => i.id), [4]);
    assert.equal(removed.items[0]!.removed, true);
    assert.deepEqual(removed.items[0]!.gameTypesBefore, ['Dungeon', 'Pve']);
    assert.equal(removed.items[0]!.gameTypesAfter, null);
    assert.equal(removed.items[0]!.after, null);
    assert.equal(removed.items[0]!.before?.name, 'Removed Gizmo');

    assert.deepEqual(await changeIds('?kind=added,removed'), [9, 4]);
    // focus only applies to changed items
    assert.deepEqual(await changeIds('?kind=added&focus=dungeonLost'), []);
    assert.deepEqual(await changeIds('?kind=changed&focus=all'), [3, 2, 7, 5, 6]);
  });

  it('before/after: only changed fields, here the description', async () => {
    const desc = (await load('?q=Desc')).items[0]!;
    assert.deepEqual(desc.changedFields, ['description']);
    assert.deepEqual(desc.before, { description: 'Description of Mini Golem Kit.' });
    assert.deepEqual(desc.after, { description: 'Neue Beschreibung' });
  });

  it('type filter, search and pagination', async () => {
    assert.deepEqual(await changeIds('?type=consumable'), [7]);
    assert.deepEqual(await changeIds('?type=gizmo&kind=changed'), [3, 2, 5, 6]);
    assert.deepEqual(await changeIds('?type=tonic'), []);
    assert.deepEqual(await changeIds('?q=GIZMO&kind=added'), [9]);
    assert.deepEqual(await changeIds('?q=5'), [5]);
    assert.deepEqual(await changeIds('?q=%25'), []);
    assert.deepEqual(await changeIds('?q=_ost'), []);

    const page2 = await load('?pageSize=3&page=2');
    assert.deepEqual(page2.items.map((i) => i.id), [5, 6, 9]);
    assert.equal(page2.total, 7);
    assert.equal(page2.pageSize, 3);
    assert.equal((await load('?pageSize=1000')).pageSize, 200);
  });

  it('404 for unknown update, 400 for invalid values', async () => {
    assert.equal((await changes(9999)).status, 404);
    assert.equal((await changes('abc' as unknown as number)).status, 400);
    for (const query of ['?kind=foo', '?focus=foo', '?type=foo', '?page=0', '?pageSize=x', '?hidePlaceholders=maybe']) {
      assert.equal((await changes(secondId, query)).status, 400, query);
    }
  });
});

describe('Migration 3 (values_before/values_after)', () => {
  it('old DB without the columns is migrated, old entries return before/after = null', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-items-mig-'));
    const file = path.join(dir, 'old.db');
    const old = new DatabaseSync(file);
    old.exec(migrations[0]!);
    old.exec(migrations[1]!);
    old.exec('PRAGMA user_version = 2');
    old.exec(`INSERT INTO updates (id, started_at, status, build_id, added, changed, removed) VALUES (1, '2026-01-01T00:00:00Z', 'done', 1, 0, 1, 0)`);
    old.exec(`INSERT INTO items (id, name, type, rarity, level, game_types, flags, is_candidate, raw_json, hash, first_seen_update, last_changed_update)
      VALUES (1, 'Alt', 'Gizmo', 'Rare', 0, '["Pve"]', '[]', 0, '{}', 'h', 1, 1)`);
    old.exec(`INSERT INTO item_changes (update_id, item_id, kind, changed_fields, game_types_before, game_types_after)
      VALUES (1, 1, 'changed', '["game_types"]', '["Dungeon","Pve"]', '["Pve"]')`);
    old.close();

    const db = openDatabase(file);
    try {
      const client = new Gw2Client({ baseUrl: 'http://127.0.0.1:1', minIntervalMs: 0, retryBaseDelayMs: 1 });
      const migrated = createApp(db, null, new Importer(db, client));
      const res = await migrated.request('/api/updates/1/changes?hidePlaceholders=false');
      assert.equal(res.status, 200);
      const body = (await res.json()) as UpdateChangesResponse;
      assert.equal(body.items.length, 1);
      assert.equal(body.items[0]!.before, null);
      assert.equal(body.items[0]!.after, null);
      assert.deepEqual(body.items[0]!.gameTypesBefore, ['Dungeon', 'Pve']);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/updates/compare (three import rounds)', () => {
  let cmpApi: FakeGw2Api;
  let cmpDb: DatabaseSync;
  let cmpApp: Hono;
  let u1: number;
  let u2: number;
  let u3: number;

  before(async () => {
    const gizmo = fixtureItems()[0]!;
    cmpApi = await startFakeGw2Api([
      { ...gizmo, id: 1, name: 'Dungeon Flip', game_types: ['Pve'] },
      { ...gizmo, id: 2, name: 'Desc Gizmo', game_types: ['Dungeon', 'Pve'] },
      { ...gizmo, id: 3, name: 'Name Bounce', game_types: ['Pve'] },
      { ...gizmo, id: 4, name: 'Stable Gizmo', game_types: ['Pve'] },
    ]);
    const created = createTestImporter(cmpApi.url);
    cmpDb = created.db;
    cmpApp = createApp(cmpDb, null, created.importer);
    u1 = (await runImport(created.importer)).updateId!;

    // Round 2: Dungeon added, description and name changed, one new item
    cmpApi.items.get(1)!.game_types = ['Dungeon', 'Pve'];
    cmpApi.items.get(2)!.description = 'Zwei';
    cmpApi.items.get(3)!.name = 'Name Bounce 2';
    cmpApi.items.set(5, { ...gizmo, id: 5, name: 'Temp Gizmo', game_types: ['Pve'] });
    u2 = (await runImport(created.importer)).updateId!;

    // Round 3: Dungeon gone again, description changed again, name reverted, the new item removed again
    cmpApi.items.get(1)!.game_types = ['Pve'];
    cmpApi.items.get(2)!.description = 'Drei';
    cmpApi.items.get(3)!.name = 'Name Bounce';
    cmpApi.items.delete(5);
    u3 = (await runImport(created.importer)).updateId!;
  });
  after(() => cmpApi.close());

  const compare = async (from: number, to: number, query = '') => {
    const res = await cmpApp.request(`/api/updates/compare?from=${from}&to=${to}${query.replace("?", "&")}`);
    assert.equal(res.status, 200, `${from}->${to}${query} → ${res.status}`);
    return (await res.json()) as UpdateCompareResponse;
  };

  it('1 -> 3: opposing changes cancel out, transient items are missing', async () => {
    const res = await compare(u1, u3);
    assert.equal(res.from.id, u1);
    assert.equal(res.to.id, u3);
    assert.deepEqual(res.counts, { added: 0, changed: 1, removed: 0, gameTypesChanged: 0, dungeonGained: 0, dungeonLost: 0 });
    assert.deepEqual(res.items.map((i) => i.id), [2]);
    const desc = res.items[0]!;
    assert.deepEqual(desc.changedFields, ['description']);
    // Old = state after update 1, New = state after update 3
    assert.deepEqual(desc.before, { description: 'Description of Mini Golem Kit.' });
    assert.deepEqual(desc.after, { description: 'Drei' });
    assert.equal(res.legacyValues, false);
    assert.equal(res.total, 1);
  });

  it('1 -> 2: Dungeon added, changed, new items; Dungeon change first', async () => {
    const res = await compare(u1, u2);
    assert.deepEqual(res.counts, { added: 1, changed: 3, removed: 0, gameTypesChanged: 1, dungeonGained: 1, dungeonLost: 0 });
    assert.deepEqual(res.items.map((i) => i.id), [1, 2, 3, 5]);
    assert.deepEqual(res.items[0]!.gameTypesBefore, ['Pve']);
    assert.deepEqual(res.items[0]!.gameTypesAfter, ['Dungeon', 'Pve']);
    assert.deepEqual(res.items[0]!.changedFields, ['game_types']);
    assert.equal(res.items[3]!.before, null);
    assert.equal(res.items[3]!.after?.name, 'Temp Gizmo');
    assert.deepEqual((await compare(u1, u2, '?focus=dungeonGained')).items.map((i) => i.id), [1]);
    assert.deepEqual((await compare(u1, u2, '?kind=added')).items.map((i) => i.id), [5]);
    assert.deepEqual((await compare(u1, u2, '?q=temp&type=gizmo')).items.map((i) => i.id), [5]);
  });

  it('2 -> 3: removed, Dungeon gone, description from Two to Three', async () => {
    const res = await compare(u2, u3);
    assert.deepEqual(res.counts, { added: 0, changed: 3, removed: 1, gameTypesChanged: 1, dungeonGained: 0, dungeonLost: 1 });
    assert.deepEqual(res.items.map((i) => i.id), [1, 2, 3, 5]);
    assert.equal(res.items[3]!.kind, 'removed');
    assert.equal(res.items[3]!.after, null);
    assert.deepEqual(res.items[1]!.before, { description: 'Zwei' });
    assert.deepEqual((await compare(u2, u3, '?focus=dungeonLost')).items.map((i) => i.id), [1]);
  });

  it('Pagination', async () => {
    const res = await compare(u1, u2, '?pageSize=2&page=2');
    assert.deepEqual(res.items.map((i) => i.id), [3, 5]);
    assert.equal(res.total, 4);
  });

  it('Validation: from < to, both present and completed', async () => {
    const status = async (query: string) => (await cmpApp.request(`/api/updates/compare${query}`)).status;
    assert.equal(await status(`?from=${u3}&to=${u1}`), 400);
    assert.equal(await status(`?from=${u1}&to=${u1}`), 400);
    assert.equal(await status(`?from=${u1}`), 400);
    assert.equal(await status('?from=abc&to=2'), 400);
    assert.equal(await status(`?from=${u1}&to=${u3}&focus=foo`), 400);
    assert.equal(await status(`?from=${u1}&to=9999`), 404);
    cmpDb.exec(`INSERT INTO updates (started_at, status) VALUES ('2026-01-01T00:00:00Z', 'failed')`);
    assert.equal(await status(`?from=${u1}&to=${u3 + 1}`), 400);
  });
});

describe('DELETE /api/updates/:id', () => {
  let delApi: FakeGw2Api;
  let delDb: DatabaseSync;
  let delApp: Hono;
  let full: number;
  let empty: number;
  let withChanges: number;

  before(async () => {
    delApi = await startFakeGw2Api(fixtureItems());
    const created = createTestImporter(delApi.url);
    delDb = created.db;
    delApp = createApp(delDb, null, created.importer);
    full = (await runImport(created.importer)).updateId!;
    empty = (await runImport(created.importer)).updateId!; // same state: no changes
    delApi.items.get(2)!.description = 'Neu';
    withChanges = (await runImport(created.importer)).updateId!;
  });
  after(() => delApi.close());

  const list = async () => (await (await delApp.request('/api/updates')).json()) as UpdateDetail[];
  const del = (id: number | string) => delApp.request(`/api/updates/${id}`, { method: 'DELETE' });
  const insertUpdate = (status: string) =>
    Number(delDb.prepare(`INSERT INTO updates (started_at, status) VALUES ('2026-01-01T00:00:00Z', ?)`).run(status).lastInsertRowid);

  it('deletable and deleteBlockedReason in the list', async () => {
    const byId = new Map((await list()).map((u) => [u.id, u]));
    assert.equal(byId.get(empty)!.deletable, true);
    assert.equal(byId.get(withChanges)!.deleteBlockedReason, 'hasChanges');
    // The full import has changes and items that reference them.
    assert.equal(byId.get(full)!.deletable, false);
  });

  it('deletes a failed update', async () => {
    const id = insertUpdate('failed');
    delDb.prepare(`INSERT INTO item_changes (update_id, item_id, kind) VALUES (?, 1, 'changed')`).run(id);
    assert.equal((await del(id)).status, 204);
    assert.equal((await list()).some((u) => u.id === id), false);
    assert.equal((delDb.prepare('SELECT COUNT(*) AS n FROM item_changes WHERE update_id = ?').get(id) as { n: number }).n, 0);
  });

  it('deletes a completed update without changes', async () => {
    assert.equal((await del(empty)).status, 204);
    assert.equal((await list()).some((u) => u.id === empty), false);
  });

  it('rejects completed updates with changes (409)', async () => {
    const res = await del(withChanges);
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /changes/);
    assert.equal((await list()).some((u) => u.id === withChanges), true);
  });

  it('rejects running updates (409)', async () => {
    const id = insertUpdate('running');
    assert.equal((await del(id)).status, 409);
  });

  it('rejects if an item references the update (409)', async () => {
    const id = insertUpdate('failed');
    delDb.prepare('UPDATE items SET last_changed_update = ? WHERE id = 1').run(id);
    assert.equal((await del(id)).status, 409);
    delDb.prepare('UPDATE items SET last_changed_update = ? WHERE id = 1').run(full);
  });

  it('404 for unknown ID, 400 for invalid', async () => {
    assert.equal((await del(99999)).status, 404);
    assert.equal((await del('abc')).status, 400);
  });
});
