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
  // 2: Volltextindex per Trigger synchron halten, zusätzliche Indizes für die Filter
  `
  -- items_fts ist eine "external content"-Tabelle: Sie speichert nur den Index, die Texte
  -- liegen in items. Beim Löschen/Ändern muss FTS5 die alten Werte über das spezielle
  -- 'delete'-Kommando bekommen, sonst bleibt der Index inkonsistent.
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
  -- Falls schon Daten ohne Trigger geschrieben wurden: Index einmal neu aufbauen.
  INSERT INTO items_fts(items_fts) VALUES ('rebuild');

  CREATE INDEX items_chat_link ON items(chat_link);
  CREATE INDEX item_changes_update ON item_changes(update_id, kind);
  `,
  // 3: alte und neue Werte der geänderten Top-Level-Felder (JSON-Objekte) für die Ansicht "Änderungen"
  `
  ALTER TABLE item_changes ADD COLUMN values_before TEXT;
  ALTER TABLE item_changes ADD COLUMN values_after TEXT;
  `,
];
