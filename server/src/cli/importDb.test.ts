import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/index.js';
import { importDatabase, ImportDbError } from './importDb.js';

let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-importdb-'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function makeDb(file: string, itemCount: number): void {
  const db = openDatabase(file);
  db.exec(`INSERT INTO updates (started_at) VALUES ('2026-01-01T00:00:00Z')`);
  const insert = db.prepare(
    `INSERT INTO items (id, name, type, rarity, level, game_types, flags, is_candidate, raw_json, hash, first_seen_update, last_changed_update)
     VALUES (?, ?, 'Gizmo', 'Basic', 0, '[]', '[]', 0, '{}', 'h', 1, 1)`,
  );
  for (let i = 1; i <= itemCount; i++) insert.run(i, `Item ${i}`);
  db.close();
}

describe('importDatabase', () => {
  it('ersetzt die DB, legt ein Backup an und entfernt WAL-Reste', async () => {
    const source = path.join(dir, 'export.db');
    const targetDir = path.join(dir, 'data');
    const target = path.join(targetDir, 'gw2-items.db');
    makeDb(source, 3);
    makeDb(target, 1);
    fs.writeFileSync(`${target}-wal`, 'rest');

    const count = await importDatabase({ sourcePath: source, dbPath: target, isServerRunning: async () => false });

    assert.equal(count, 3);
    const backups = fs.readdirSync(targetDir).filter((f) => f.startsWith('gw2-items.db.bak-'));
    assert.equal(backups.length, 1);
    assert.ok(!backups[0]!.includes(':'));
    const backup = new DatabaseSync(path.join(targetDir, backups[0]!));
    assert.equal((backup.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n, 1);
    backup.close();
  });

  it('bricht ab, wenn der Server läuft', async () => {
    const source = path.join(dir, 'export2.db');
    makeDb(source, 1);
    await assert.rejects(
      importDatabase({ sourcePath: source, dbPath: path.join(dir, 'x.db'), isServerRunning: async () => true }),
      /Server zuerst beenden/,
    );
  });

  it('lehnt Dateien ab, die keine SQLite-Datenbank sind', async () => {
    const bad = path.join(dir, 'bad.db');
    fs.writeFileSync(bad, 'das ist keine Datenbank, nur etwas Text der lang genug ist fuer einen Header');
    const target = path.join(dir, 'unchanged.db');
    await assert.rejects(importDatabase({ sourcePath: bad, dbPath: target }), ImportDbError);
    assert.ok(!fs.existsSync(target));
    await assert.rejects(importDatabase({ sourcePath: path.join(dir, 'fehlt.db'), dbPath: target }), /nicht gefunden/);
  });

  it('lehnt SQLite-Dateien ohne passende Tabellen ab', async () => {
    const other = path.join(dir, 'other.db');
    const db = new DatabaseSync(other);
    db.exec('CREATE TABLE foo (a)');
    db.close();
    await assert.rejects(importDatabase({ sourcePath: other, dbPath: path.join(dir, 'y.db') }), /keine Tabelle/);
  });
});
