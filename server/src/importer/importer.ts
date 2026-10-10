import type { DatabaseSync } from 'node:sqlite';
import type { ImportStatus } from '../../../shared/types.js';
import { transaction } from '../db/index.js';
import { IDS_PER_REQUEST, type Gw2Client, type Gw2Item } from '../gw2/client.js';
import { diffItem, hashItem, normalizeGameTypes } from './diff.js';

/** Wie viele Items pro DB-Transaktion geschrieben werden. */
const WRITE_BLOCK_SIZE = 1000;

export class ImportAlreadyRunningError extends Error {
  constructor() {
    super('Es läuft bereits ein Import');
    this.name = 'ImportAlreadyRunningError';
  }
}

/** Hinweis an Update und Status, wenn der deutsche Teil nicht vollständig geladen werden konnte. */
const GERMAN_INCOMPLETE = 'Deutsche Texte nicht vollständig geladen';

const idleStatus = (): ImportStatus => ({
  running: false,
  updateId: null,
  phase: 'idle',
  processed: 0,
  total: 0,
  startedAt: null,
  error: null,
});

/** Setzt Update-Läufe, die beim letzten Beenden des Servers noch liefen, auf 'failed'. */
export function failOrphanedUpdates(db: DatabaseSync): void {
  db.prepare(
    `UPDATE updates SET status = 'failed', error = 'Server wurde während des Imports beendet', finished_at = ?
     WHERE status = 'running'`,
  ).run(new Date().toISOString());
}

/**
 * Import/Update aller Items als Hintergrundjob im selben Prozess. Es läuft immer nur einer.
 *
 * Ablauf: IDs laden → alle Details laden (nur im Speicher) → deutsche Texte laden → mit der DB vergleichen und schreiben.
 * Erst wenn alle Details da sind, wird geschrieben. Bricht der Download ab, bleibt die DB unverändert.
 * Ausnahme: Scheitert nur der deutsche Teil, gilt das Update trotzdem (siehe run).
 */
export class Importer {
  private status: ImportStatus = idleStatus();
  private job: Promise<void> | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly client: Gw2Client,
  ) {}

  getStatus(): ImportStatus {
    return { ...this.status };
  }

  /** Startet einen Import und kehrt sofort zurück. Wirft ImportAlreadyRunningError, wenn schon einer läuft. */
  start(): ImportStatus {
    if (this.status.running) throw new ImportAlreadyRunningError();

    const startedAt = new Date().toISOString();
    const { lastInsertRowid } = this.db
      .prepare(`INSERT INTO updates (started_at, status) VALUES (?, 'running')`)
      .run(startedAt);
    const updateId = Number(lastInsertRowid);

    this.status = { ...idleStatus(), running: true, updateId, phase: 'ids', startedAt };
    this.job = this.run(updateId).catch((err: unknown) => this.fail(updateId, err));
    return this.getStatus();
  }

  /** Wartet, bis der laufende Import beendet ist (für Tests und sauberes Herunterfahren). */
  async waitForIdle(): Promise<void> {
    await this.job;
  }

  private async run(updateId: number): Promise<void> {
    // Phase 1: Build-ID und Item-IDs
    const buildId = await this.client.getBuildId();
    this.db.prepare('UPDATE updates SET build_id = ? WHERE id = ?').run(buildId, updateId);
    const ids = [...new Set(await this.client.getItemIds())];
    this.status.total = ids.length;

    // Phase 2: Details in Blöcken zu 200 IDs
    this.status.phase = 'details';
    const items = new Map<number, Gw2Item>();
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + IDS_PER_REQUEST);
      for (const item of await this.client.getItems(chunk)) items.set(item.id, item);
      // Zählt angefragte IDs, damit der Fortschritt auch bei fehlenden Items 100 % erreicht.
      this.status.processed += chunk.length;
    }

    // Phase 3: deutsche Texte (nur Name und Beschreibung) in denselben Blöcken, nur für Items mit englischen Details.
    // Scheitert dieser Teil (nach den Retries des Clients), wäre es schade um den fertigen englischen Download:
    // Das Update wird trotzdem geschrieben und als 'done' markiert, die bis dahin geladenen deutschen Texte
    // werden behalten. Der Hinweis steht in updates.error bzw. ImportStatus.error; das nächste Update holt alles nach.
    this.status.phase = 'details_de';
    this.status.processed = 0;
    this.status.total = items.size;
    const texts = new Map<number, ItemText>();
    let germanError: string | null = null;
    const loadedIds = [...items.keys()];
    try {
      for (let i = 0; i < loadedIds.length; i += IDS_PER_REQUEST) {
        const chunk = loadedIds.slice(i, i + IDS_PER_REQUEST);
        for (const item of await this.client.getItems(chunk, 'de')) texts.set(item.id, toText(item));
        this.status.processed += chunk.length;
      }
    } catch (err) {
      console.error(`Import ${updateId}: deutsche Texte nicht vollständig geladen:`, err);
      germanError = GERMAN_INCOMPLETE;
    }

    this.status.total = ids.length; // Zähler der Details-Phase wiederherstellen
    this.status.processed = ids.length;

    // Phase 4: Vergleich mit der DB und Schreiben (Hash und Diff nur über den englischen Stand)
    this.status.phase = 'diff';
    const counts = writeItems(this.db, updateId, [...items.values()], new Set(ids));
    writeTexts(this.db, 'de', texts);

    this.db
      .prepare(
        `UPDATE updates SET status = 'done', finished_at = ?, added = ?, changed = ?, removed = ?, error = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), counts.added, counts.changed, counts.removed, germanError, updateId);
    this.status.phase = 'done';
    this.status.error = germanError;
    this.status.running = false;
  }

  private fail(updateId: number, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Import ${updateId} fehlgeschlagen:`, err);
    try {
      this.db
        .prepare(`UPDATE updates SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`)
        .run(message, new Date().toISOString(), updateId);
    } catch (dbErr) {
      console.error('Konnte Fehlerstatus nicht speichern:', dbErr);
    }
    this.status = { ...this.status, running: false, phase: 'failed', error: message };
  }
}

export interface DiffCounts {
  added: number;
  changed: number;
  removed: number;
}

interface StoredRow {
  hash: string;
  raw_json: string;
  removed: number;
  game_types: string;
}

/**
 * Vergleicht die geladenen Items mit der DB und schreibt items + item_changes.
 * liveIds = alle IDs, die /v2/items aktuell liefert. Items in der DB, die dort fehlen, gelten als entfernt.
 * Exportiert, damit sich die Diff-Logik ohne HTTP testen lässt.
 */
export function writeItems(db: DatabaseSync, updateId: number, items: Gw2Item[], liveIds: Set<number>): DiffCounts {
  const counts: DiffCounts = { added: 0, changed: 0, removed: 0 };

  const selectStored = db.prepare('SELECT hash, raw_json, removed, game_types FROM items WHERE id = ?');
  const insertItem = db.prepare(`
    INSERT INTO items (id, name, description, type, subtype, rarity, level, icon, chat_link, game_types, flags,
                       is_candidate, raw_json, hash, first_seen_update, last_changed_update, removed)
    VALUES (:id, :name, :description, :type, :subtype, :rarity, :level, :icon, :chat_link, :game_types, :flags,
            :is_candidate, :raw_json, :hash, :update_id, :update_id, 0)`);
  const updateItem = db.prepare(`
    UPDATE items SET name = :name, description = :description, type = :type, subtype = :subtype,
      rarity = :rarity, level = :level, icon = :icon, chat_link = :chat_link, game_types = :game_types,
      flags = :flags, is_candidate = :is_candidate, raw_json = :raw_json, hash = :hash,
      last_changed_update = :update_id, removed = 0
    WHERE id = :id`);
  const insertChange = db.prepare(`
    INSERT INTO item_changes (update_id, item_id, kind, changed_fields, game_types_before, game_types_after,
                              values_before, values_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  for (let i = 0; i < items.length; i += WRITE_BLOCK_SIZE) {
    const block = items.slice(i, i + WRITE_BLOCK_SIZE);
    transaction(db, () => {
      for (const item of block) {
        const row = selectStored.get(item.id) as StoredRow | undefined;
        const hash = hashItem(item);
        const diff = diffItem(
          row && {
            hash: row.hash,
            rawJson: row.raw_json,
            removed: row.removed === 1,
            gameTypes: JSON.parse(row.game_types) as string[],
          },
          item,
          hash,
        );
        if (diff.kind === 'unchanged') continue;

        const params = { ...toColumns(item), hash, update_id: updateId };
        if (row) updateItem.run(params);
        else insertItem.run(params);

        if (diff.kind === 'added') {
          counts.added++;
          insertChange.run(updateId, item.id, 'added', null, null, JSON.stringify(diff.gameTypesAfter), null, null);
        } else {
          counts.changed++;
          insertChange.run(
            updateId,
            item.id,
            'changed',
            JSON.stringify(diff.changedFields),
            JSON.stringify(diff.gameTypesBefore),
            JSON.stringify(diff.gameTypesAfter),
            JSON.stringify(diff.valuesBefore),
            JSON.stringify(diff.valuesAfter),
          );
        }
      }
    });
  }

  // Entfernte Items: nicht löschen, nur markieren, damit Teststatus und Verlauf erhalten bleiben.
  transaction(db, () => {
    const active = db.prepare('SELECT id, game_types FROM items WHERE removed = 0').all() as {
      id: number;
      game_types: string;
    }[];
    const markRemoved = db.prepare('UPDATE items SET removed = 1, last_changed_update = ? WHERE id = ?');
    for (const { id, game_types } of active) {
      if (liveIds.has(id)) continue;
      markRemoved.run(updateId, id);
      insertChange.run(updateId, id, 'removed', null, game_types, null, null, null);
      counts.removed++;
    }
  });

  return counts;
}

export interface ItemText {
  name: string;
  description: string | null;
}

function toText(item: Gw2Item): ItemText {
  return {
    name: typeof item.name === 'string' ? item.name : '',
    description: typeof item.description === 'string' && item.description !== '' ? item.description : null,
  };
}

/**
 * Speichert übersetzte Texte in item_texts und im Volltextindex der Sprache (derzeit nur 'de').
 * Unveränderte Texte werden übersprungen. Entfernte Items behalten ihre Texte (es wird nie gelöscht).
 * Kein Teil des Vergleichs: erzeugt weder Hash-Änderungen noch item_changes.
 */
export function writeTexts(db: DatabaseSync, lang: 'de', texts: Map<number, ItemText>): void {
  const select = db.prepare('SELECT name, description FROM item_texts WHERE item_id = ? AND lang = ?');
  const upsert = db.prepare(`
    INSERT INTO item_texts (item_id, lang, name, description) VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id, lang) DO UPDATE SET name = excluded.name, description = excluded.description`);
  // items_fts_de hat eigenen Inhalt: alten Eintrag über die rowid löschen, neuen einfügen.
  const deleteFts = db.prepare('DELETE FROM items_fts_de WHERE rowid = ?');
  const insertFts = db.prepare('INSERT INTO items_fts_de (rowid, name, description) VALUES (?, ?, ?)');

  const entries = [...texts];
  for (let i = 0; i < entries.length; i += WRITE_BLOCK_SIZE) {
    transaction(db, () => {
      for (const [id, text] of entries.slice(i, i + WRITE_BLOCK_SIZE)) {
        const old = select.get(id, lang) as { name: string; description: string | null } | undefined;
        if (old && old.name === text.name && old.description === text.description) continue;
        upsert.run(id, lang, text.name, text.description);
        deleteFts.run(id);
        insertFts.run(id, text.name, text.description);
      }
    });
  }
}

/** Abgeleitete Spalten für die Tabelle items. */
function toColumns(item: Gw2Item) {
  const gameTypes = normalizeGameTypes(item.game_types);
  const subtype = item.details?.type;
  return {
    id: item.id,
    name: typeof item.name === 'string' ? item.name : '',
    description: typeof item.description === 'string' && item.description !== '' ? item.description : null,
    type: typeof item.type === 'string' ? item.type : 'Unknown',
    subtype: typeof subtype === 'string' ? subtype : null,
    rarity: typeof item.rarity === 'string' ? item.rarity : 'Basic',
    level: typeof item.level === 'number' ? item.level : 0,
    icon: typeof item.icon === 'string' ? item.icon : null,
    chat_link: typeof item.chat_link === 'string' ? item.chat_link : null,
    game_types: JSON.stringify(gameTypes),
    flags: JSON.stringify(Array.isArray(item.flags) ? item.flags : []),
    is_candidate: gameTypes.includes('Dungeon') ? 1 : 0,
    raw_json: JSON.stringify(item),
  };
}
