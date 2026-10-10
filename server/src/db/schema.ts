// Datenbankschema als nummerierte Migrationen.
// Neue Änderungen immer als neuen Eintrag anhängen, bestehende nie verändern.
// Welche Migrationen gelaufen sind, merkt sich SQLite in PRAGMA user_version.

export const migrations: string[] = [
  // 1: Grundschema laut PRD
  `
  -- Ein Eintrag pro Update-Lauf (auch der erste Vollimport ist ein Update).
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

  -- Aktueller Stand jedes Items. raw_json enthält die komplette API-Antwort,
  -- die übrigen Spalten sind daraus abgeleitet, damit man danach filtern kann.
  CREATE TABLE items (
    id                  INTEGER PRIMARY KEY,
    name                TEXT    NOT NULL,
    description         TEXT,
    type                TEXT    NOT NULL,
    subtype             TEXT,             -- details.type, z. B. Food, Utility
    rarity              TEXT    NOT NULL,
    level               INTEGER NOT NULL,
    icon                TEXT,
    chat_link           TEXT,
    game_types          TEXT    NOT NULL, -- JSON-Array
    flags               TEXT    NOT NULL, -- JSON-Array
    is_candidate        INTEGER NOT NULL, -- 1, wenn game_types "Dungeon" enthält
    raw_json            TEXT    NOT NULL,
    hash                TEXT    NOT NULL, -- Hash über raw_json, für den Vergleich beim Update
    first_seen_update   INTEGER NOT NULL REFERENCES updates(id),
    last_changed_update INTEGER NOT NULL REFERENCES updates(id),
    removed             INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX items_type_candidate ON items(type, is_candidate);
  CREATE INDEX items_last_changed ON items(last_changed_update);

  -- Was sich an einem Item in einem Update geändert hat.
  CREATE TABLE item_changes (
    update_id         INTEGER NOT NULL REFERENCES updates(id),
    item_id           INTEGER NOT NULL,
    kind              TEXT    NOT NULL, -- added | changed | removed
    changed_fields    TEXT,             -- JSON-Array der geänderten Top-Level-Felder
    game_types_before TEXT,
    game_types_after  TEXT,
    PRIMARY KEY (update_id, item_id)
  );
  CREATE INDEX item_changes_item ON item_changes(item_id);

  -- Ergebnis eigener Tests im Spiel.
  CREATE TABLE item_tests (
    item_id            INTEGER PRIMARY KEY,
    status             TEXT NOT NULL DEFAULT 'untested', -- untested | works | broken
    note               TEXT,
    tested_at          TEXT,
    game_types_at_test TEXT -- Stand beim Test, um "neu testen" zu erkennen
  );

  -- Volltextsuche über Name und Beschreibung. Wird beim Import mitgepflegt.
  CREATE VIRTUAL TABLE items_fts USING fts5(name, description, content='items', content_rowid='id');
  `,
];
