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
import { chatLinkFor, createTestImporter, fixtureItems, runImport } from './test/fixtures.js';

// Konsistenz-Test: Die Browser-Logik der statischen Fassung (shared/staticQuery.ts, gelesen aus dem Export)
// muss dieselben Ergebnisse liefern wie die SQL-Abfragen des Servers (gleiche IDs, gleiche Reihenfolge).
// Der Server kennt alle Items, die statische Fassung nur die veröffentlichten; deshalb werden die
// Serverantworten auf die veröffentlichten Items beschränkt.

let api: FakeGw2Api;
let db: DatabaseSync;
let exported: StaticExport;
let ds: StaticDataset;
let published: Set<number>;
let baselineId: number;
let updateIds: number[];

const gizmo = fixtureItems()[0]!;
const consumable = fixtureItems().find((i) => i.id === 8778)!;
const entries = (qs: string): Record<string, string> => Object.fromEntries(new URLSearchParams(qs));

before(async () => {
  api = await startFakeGw2Api([
    ...fixtureItems(),
    // Platzhalter
    { ...gizmo, id: 101, name: '   ', game_types: ['Dungeon', 'Pve'] },
    { ...gizmo, id: 102, name: 'Ohne Icon', icon: undefined },
    { ...gizmo, id: 103, name: '((906936))' },
    { ...gizmo, id: 106, name: '[[913817]]' },
    // hideCommon: Mastery Points, Emote Tomes, Währungspakete, Currency
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
    // Sprache, Markup, andere Typen
    { ...consumable, id: 301, name: 'Sweet Cheese', description: 'A tasty cheese.', details: { type: 'Generic' } },
    { ...gizmo, id: 302, name: 'Flavor Gizmo', description: '<c=@flavor>Flavor text</c>\nSecond line', rarity: 'Legendary', level: 80 },
    { ...gizmo, id: 303, name: 'zebra gizmo', game_types: ['Pve', 'Pvp'], level: 40 },
    { ...gizmo, id: 304, name: 'Älterer Gizmo', level: 40 },
  ]);
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

  // Teststatus, danach ändert das zweite Update die game_types (→ "neu testen").
  saveItemTest(db, 1, { status: 'works', note: 'klappt; "gut"' });
  saveItemTest(db, 8778, { status: 'works', note: null });
  saveItemTest(db, 2, { status: 'broken', note: 'Zeile 1\nZeile 2' });
  saveItemTest(db, 301, { status: 'untested', note: 'nur Notiz' });

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
  api.buildId = 123457;
  await runImport(importer);

  api.items.get(1)!.game_types = ['Dungeon', 'Pve', 'Wvw'];
  api.items.set(3, { ...gizmo, id: 3, name: 'Old Gizmo', game_types: ['Dungeon', 'Pve'] }); // wieder da
  api.items.delete(9);
  api.items.get(2)!.game_types = ['Pve'];
  api.items.get(5)!.description = 'Noch eine Beschreibung';
  api.items.get(6)!.name = 'Shiny Rock';
  api.items.get(204)!.flags = ['NoSell', 'Tonic'];
  api.items.get(303)!.game_types = ['Dungeon', 'Pve'];
  api.items.delete(110);
  api.buildId = 123458;
  await runImport(importer);
  saveItemTest(db, 3, { status: 'broken', note: 'entfernt' });
  saveItemTest(db, 302, { status: 'works', note: null });

  // Item ohne deutsche Texte (Zeile fehlt) → Fallback auf Englisch
  db.exec(`DELETE FROM item_texts WHERE item_id IN (4, 304); DELETE FROM items_fts_de WHERE rowid IN (4, 304)`);

  // Export und "Dateien" simulieren: durch JSON schicken, wie der Browser sie lädt.
  exported = JSON.parse(JSON.stringify(buildStaticExport(db))) as StaticExport;
  ds = prepareDataset(exported);
  published = new Set(ds.items.map((i) => i.id));
  updateIds = listUpdates(db).map((u) => u.id).sort((a, b) => a - b);
});
after(() => api.close());

/** Serverantwort der Liste, beschränkt auf veröffentlichte Items. */
function serverList(qs: string) {
  const query = parseItemListQuery({ ...entries(qs), pageSize: '200', page: '1' });
  const res = listItems(db, query);
  assert.ok(res.total <= 200, 'Testdaten passen auf eine Seite');
  return res.items.filter((i) => published.has(i.id));
}

function staticList(qs: string) {
  return listStaticItems(ds, parseItemListQuery({ ...entries(qs), pageSize: '200', page: '1' })).items;
}

function checkList(qs: string) {
  assert.deepEqual(staticList(qs), serverList(qs), `Liste: ${qs}`);
}

describe('Export: Auswahl der Items', () => {
  it('veröffentlicht Kandidaten (Gizmo/Consumable) und Items aus Änderungen ab dem zweiten Update', () => {
    const candidates = db
      .prepare(`SELECT id FROM items WHERE removed = 0 AND is_candidate = 1 AND type IN ('Gizmo', 'Consumable')`)
      .all()
      .map((r) => r.id as number);
    const changed = db
      .prepare(`SELECT DISTINCT item_id FROM item_changes WHERE update_id <> ?`)
      .all(baselineId)
      .map((r) => r.item_id as number);
    const expected = [...new Set([...candidates, ...changed])].sort((a, b) => a - b);
    assert.deepEqual(exported.items.map((i) => i.id), expected);
    // Der Vollimport allein veröffentlicht keine Nicht-Kandidaten: Trophy 6 steht nur wegen der Änderung drin.
    assert.ok(published.has(6) && published.has(3) && published.has(9) && published.has(2));
    assert.ok(!published.has(204) || changed.includes(204));
    assert.ok(!published.has(102) || candidates.includes(102));
    // Items ohne Änderung, die keine Kandidaten sind, fehlen (Item 303 wurde im dritten Update Kandidat).
    assert.ok(!exported.items.some((i) => i.id === 304 && !i.isCandidate));
  });

  it('enthält nur die Änderungen ab dem zweiten abgeschlossenen Update', () => {
    assert.ok(exported.changes.length > 0);
    assert.ok(exported.changes.every((c) => c.updateId !== baselineId));
    assert.equal(exported.updates.length, 3);
    assert.deepEqual(exported.updates.map((u) => u.id), updateIds.slice().reverse());
    assert.ok(exported.updates.every((u) => u.status === 'done' && !('deletable' in u)));
    assert.equal(exported.meta.build, 123458);
    assert.equal(exported.meta.itemCount, exported.items.length);
  });

  it('items.json ist nach ID sortiert, Details stehen in Blöcken', () => {
    assert.deepEqual(exported.items.map((i) => i.id), [...published].sort((a, b) => a - b));
    for (const item of exported.items) {
      const block = detailBlockOf(ds, item.id)!;
      assert.ok(exported.detailBlocks[block]![item.id], `Detail für ${item.id}`);
    }
  });
});

describe('Liste: Browser-Logik gegen Server', () => {
  it('Ansichten × Kandidat × Filter × Sprache', () => {
    for (const view of ['gizmo', 'consumable', 'tonic', 'all']) {
      for (const candidate of ['yes', 'no', 'all']) {
        for (const hideCommon of ['true', 'false']) {
          for (const hidePlaceholders of ['true', 'false']) {
            for (const includeRemoved of ['true', 'false']) {
              for (const lang of ['en', 'de']) {
                checkList(`view=${view}&candidate=${candidate}&hideCommon=${hideCommon}&hidePlaceholders=${hidePlaceholders}&includeRemoved=${includeRemoved}&lang=${lang}`);
              }
            }
          }
        }
      }
    }
  });

  it('Sortierung (alle Felder, auf- und absteigend, beide Sprachen)', () => {
    for (const sort of ['name', 'id', 'rarity', 'level', 'lastChanged']) {
      for (const order of ['asc', 'desc']) {
        for (const lang of ['en', 'de']) {
          checkList(`view=all&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true&sort=${sort}&order=${order}&lang=${lang}`);
        }
      }
    }
  });

  it('Seltenheit, Game Types und Teststatus', () => {
    for (const rarity of ['Rare', 'Rare,Exotic', 'Legendary', 'Basic,Fine,Masterwork']) {
      checkList(`view=all&candidate=all&rarity=${rarity}&includeRemoved=true`);
    }
    for (const gameType of ['Dungeon', 'Pve,Wvw', 'Pvp', 'Dungeon,Pve,Wvw']) {
      checkList(`view=all&candidate=all&gameType=${gameType}&includeRemoved=true`);
    }
    for (const testStatus of ['untested', 'works', 'broken', 'retest']) {
      for (const candidate of ['yes', 'all']) {
        checkList(`view=all&candidate=${candidate}&testStatus=${testStatus}&includeRemoved=true&hidePlaceholders=false`);
      }
    }
    assert.ok(staticList('view=all&candidate=all&testStatus=retest').length > 0, 'Testdaten enthalten ein "neu testen"');
  });

  it('Update-Filter (jeder Stand außer dem Vollimport)', () => {
    for (const id of updateIds.filter((u) => u !== baselineId)) {
      for (const includeRemoved of ['true', 'false']) {
        checkList(`view=all&candidate=all&updateId=${id}&includeRemoved=${includeRemoved}&hidePlaceholders=false`);
      }
    }
    assert.ok(staticList(`view=all&candidate=all&updateId=${updateIds[1]}&includeRemoved=true`).length > 0);
  });

  it('Suche: Text, ID, Chat-Link, Sonderzeichen, Umlaute', () => {
    const queries = [
      'mini', 'golem bomb', 'GOLEM', 'gol', 'mini bom', 'description banner', 'description', 'a tasty', 'tasty cheese',
      '8778', '301', '99999', chatLinkFor(8778), chatLinkFor(1), '[&AgEAWgAA]', `[&${Buffer.from([2, 5, 0x4a, 0x22, 0, 0]).toString('base64')}]`,
      'käse', 'kaese', 'kase', 'Käse', 'süß', 'suss', 'ärger', 'aerger', 'Ärger', 'bausatz', 'mini-golem', 'Mini-Golem-Bomb',
      "belcher's", 'belcher', 'belchers', 'bluff kit', 'tonic', 'tonics', 'flavor', 'c', 'second line', 'zweite',
      '"golem" OR -NEAR( name:*', '---', '"', '*', 'o\'', 'new', 'brand new', 'cheddar', 'deluxe', 'ohne icon', '((', '[[913817]]', '906936',
    ];
    for (const q of queries) {
      for (const lang of ['en', 'de']) {
        for (const view of ['all', 'consumable']) {
          checkList(`view=${view}&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true&lang=${lang}&q=${encodeURIComponent(q)}`);
        }
      }
    }
    assert.deepEqual(staticList('view=all&candidate=all&q=8778').map((i) => i.id), [8778]);
    assert.deepEqual(staticList('view=all&candidate=all&lang=de&q=kase').map((i) => i.id), [301]);
    assert.deepEqual(staticList('view=all&candidate=all&lang=en&q=kaese').map((i) => i.id), []);
  });

  it('Paginierung', () => {
    const base = 'view=all&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true&sort=level&order=desc';
    for (const pageSize of [1, 3, 7]) {
      for (const page of [1, 2, 4]) {
        const query = parseItemListQuery({ ...entries(base), pageSize: String(pageSize), page: String(page) });
        const fromStatic = listStaticItems(ds, query);
        assert.equal(fromStatic.page, page);
        assert.equal(fromStatic.pageSize, pageSize);
        assert.equal(fromStatic.total, staticList(base).length);
        assert.deepEqual(fromStatic.items, staticList(base).slice((page - 1) * pageSize, page * pageSize));
      }
    }
  });

  it('Export CSV/JSON: gleiche Zeilen wie der Server, CSV mit Semikolon und BOM', () => {
    for (const qs of [
      'view=all&candidate=all&hideCommon=false&hidePlaceholders=false&includeRemoved=true',
      'view=gizmo&sort=id&order=desc',
      'view=consumable&lang=de&testStatus=works',
      'view=tonic&lang=de',
    ]) {
      const query = parseItemListQuery(entries(qs));
      const serverRows = exportItems(db, query).filter((r) => published.has(r.id));
      const staticRows = exportStaticItems(ds, query);
      assert.deepEqual(staticRows, serverRows, qs);
      assert.equal(toCsv(staticRows), toCsv(serverRows));
    }
    const csv = toCsv(exportStaticItems(ds, parseItemListQuery(entries('view=all'))));
    assert.ok(csv.startsWith('﻿id;name;'));
    assert.ok(csv.includes('\r\n'));
  });

  it('Kennzahlen', () => {
    const stats = staticStats(ds);
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    assert.equal(stats.candidates.gizmo, count(`SELECT COUNT(*) AS n FROM items WHERE removed = 0 AND is_candidate = 1 AND type = 'Gizmo'`));
    assert.equal(stats.candidates.consumable, count(`SELECT COUNT(*) AS n FROM items WHERE removed = 0 AND is_candidate = 1 AND type = 'Consumable'`));
    assert.equal(stats.lastUpdate?.id, updateIds.at(-1));
    assert.equal(stats.autoCheck, null);
  });
});

describe('Details: Browser-Logik gegen Server', () => {
  it('alle veröffentlichten Items, beide Sprachen', () => {
    for (const id of published) {
      for (const lang of ['en', 'de'] as Lang[]) {
        const rest = exported.detailBlocks[detailBlockOf(ds, id)!]![id];
        const fromStatic = staticItemDetail(ds, id, lang, rest)!;
        const fromServer = getItemDetail(db, id, lang)!;
        // Die Änderungen des ersten Updates (alles "neu") gehören nicht zur statischen Fassung.
        const expected: ItemDetail = { ...fromServer, history: fromServer.history.filter((h) => h.updateId !== baselineId) };
        assert.deepEqual(fromStatic, expected, `Detail ${id} (${lang})`);
      }
    }
  });

  it('unbekannte ID → null', () => {
    assert.equal(staticItemDetail(ds, 424242, 'en', undefined), null);
    assert.equal(detailBlockOf(ds, 424242), null);
  });
});

describe('Änderungen: Browser-Logik gegen Server', () => {
  const queries = [''];
  for (const kind of ['', 'added', 'changed', 'removed', 'added,removed', 'changed,added']) {
    for (const focus of ['all', 'gameTypes', 'dungeonGained', 'dungeonLost']) {
      queries.push(`kind=${kind}&focus=${focus}`);
    }
  }
  for (const type of ['gizmo', 'consumable', 'tonic', 'all']) queries.push(`type=${type}`);
  for (const q of ['gizmo', 'GIZMO', '5', '9', 'ost', '%', '_', 'cheese', 'käse', 'sweet', 'rock']) queries.push(`q=${encodeURIComponent(q)}`);
  queries.push('hidePlaceholders=false', 'hidePlaceholders=false&kind=added', 'pageSize=2&page=2', 'pageSize=3&page=3');

  it('Einträge, Zähler und Gesamtzahl je Stand (ohne den Vollimport)', () => {
    for (const id of updateIds.filter((u) => u !== baselineId)) {
      const update = getUpdate(db, id)!;
      for (const lang of ['en', 'de']) {
        for (const qs of queries) {
          const params = { ...entries(qs), lang };
          const fromServer = getUpdateChanges(db, update, parseUpdateChangesQuery(params));
          const fromStatic = staticUpdateChanges(ds, update, parseUpdateChangesQuery(params));
          assert.deepEqual(fromStatic, fromServer, `Änderungen ${id} ${lang} ${qs}`);
        }
      }
    }
  });

  it('Vergleich zweier Stände', () => {
    let nonEmpty = 0;
    for (const from of updateIds) {
      for (const to of updateIds.filter((u) => u > from)) {
        const fromUpdate = getUpdate(db, from)!;
        const toUpdate = getUpdate(db, to)!;
        for (const lang of ['en', 'de']) {
          for (const qs of queries) {
            const params = { ...entries(qs), lang };
            const fromServer = compareUpdates(db, fromUpdate, toUpdate, parseUpdateChangesQuery(params));
            const fromStatic = staticCompare(ds, fromUpdate, toUpdate, parseUpdateChangesQuery(params));
            assert.deepEqual(fromStatic, fromServer, `Vergleich ${from}→${to} ${lang} ${qs}`);
            if (fromStatic.items.length > 0) nonEmpty++;
          }
        }
      }
    }
    assert.ok(nonEmpty > 20, 'Testdaten liefern echte Vergleichsergebnisse');
  });

  it('der erste Stand hat keine Einträge, die Zähler stammen aus dem Update', () => {
    const baseline = getUpdate(db, baselineId)!;
    const res = staticUpdateChanges(ds, baseline, parseUpdateChangesQuery({}));
    assert.equal(res.total, 0);
    assert.equal(res.counts.added, baseline.added);
  });
});
