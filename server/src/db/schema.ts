// Database schema as numbered migrations.
// Always append new changes as a new entry, never modify existing ones.
// SQLite tracks which migrations have run in PRAGMA user_version.

export const migrations: string[] = [
  // 1: base schema
  `
  -- One entry per update run (the first full import is an update too).
  CREATE TABLE updates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT    NOT NULL,
    finished_at TEXT,
    build_id    INTEGER,
    status      TEXT    NOT NULL DEFAULT 'running', -- running | done | failed
    added       INTEGER NOT NULL DEFAULT 0,
    changed     INTEGER NOT NULL DEFAULT 0,
    removed     INTEGER NOT NULL DEFAULT 0,
    error       TEXT
  );

  -- Current state of each item. raw_json holds the complete API response,
  -- the other columns are derived from it so they can be filtered on.
  CREATE TABLE items (
    id                  INTEGER PRIMARY KEY,
    name                TEXT    NOT NULL,
    description         TEXT,
    type                TEXT    NOT NULL,
    subtype             TEXT,             -- details.type, e.g. Food, Utility
    rarity              TEXT    NOT NULL,
    level               INTEGER NOT NULL,
    icon                TEXT,
    chat_link           TEXT,
    game_types          TEXT    NOT NULL, -- JSON array
    flags               TEXT    NOT NULL, -- JSON array
    is_candidate        INTEGER NOT NULL, -- 1 if game_types contains "Dungeon"
    raw_json            TEXT    NOT NULL,
    hash                TEXT    NOT NULL, -- Hash of raw_json, for comparison on update
    first_seen_update   INTEGER NOT NULL REFERENCES updates(id),
    last_changed_update INTEGER NOT NULL REFERENCES updates(id),
    removed             INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX items_type_candidate ON items(type, is_candidate);
  CREATE INDEX items_last_changed ON items(last_changed_update);

  -- What changed on an item in an update.
  CREATE TABLE item_changes (
    update_id         INTEGER NOT NULL REFERENCES updates(id),
    item_id           INTEGER NOT NULL,
    kind              TEXT    NOT NULL, -- added | changed | removed
    changed_fields    TEXT,             -- JSON array of the changed top-level fields
    game_types_before TEXT,
    game_types_after  TEXT,
    PRIMARY KEY (update_id, item_id)
  );
  CREATE INDEX item_changes_item ON item_changes(item_id);

  -- Result of own in-game tests.
  CREATE TABLE item_tests (
    item_id            INTEGER PRIMARY KEY,
    status             TEXT NOT NULL DEFAULT 'untested', -- untested | works | broken
    note               TEXT,
    tested_at          TEXT,
    game_types_at_test TEXT -- State at test time, to detect "retest"
  );

  -- Full-text search over name and description. Maintained during import.
  CREATE VIRTUAL TABLE items_fts USING fts5(name, description, content='items', content_rowid='id');
  `,
  // 2: keep the full-text index in sync via triggers, additional indexes for the filters
  `
  -- items_fts is an "external content" table: it only stores the index, the texts
  -- live in items. On delete/update FTS5 must receive the old values via the special
  -- 'delete' command, otherwise the index becomes inconsistent.
  CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
  END;
  CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
  END;
  CREATE TRIGGER items_fts_update AFTER UPDATE OF name, description ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
    INSERT INTO items_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
  END;
  -- If data was already written without triggers: rebuild the index once.
  INSERT INTO items_fts(items_fts) VALUES ('rebuild');

  CREATE INDEX items_chat_link ON items(chat_link);
  CREATE INDEX item_changes_update ON item_changes(update_id, kind);
  `,
  // 3: old and new values of the changed top-level fields (JSON objects) for the "Changes" view
  `
  ALTER TABLE item_changes ADD COLUMN values_before TEXT;
  ALTER TABLE item_changes ADD COLUMN values_after TEXT;
  `,
  // 4: translated names and descriptions (so far only lang=de), separate from the English state in items
  `
  -- Hash, diff and item_changes do not know this table: pure translation changes do not count as a change.
  CREATE TABLE item_texts (
    item_id     INTEGER NOT NULL,
    lang        TEXT    NOT NULL, -- de
    name        TEXT    NOT NULL,
    description TEXT,
    PRIMARY KEY (item_id, lang)
  );

  -- Full-text index for the German texts (own content, rowid = item_id). The importer maintains it.
  CREATE VIRTUAL TABLE items_fts_de USING fts5(name, description);
  `,
];
