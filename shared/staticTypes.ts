// Dateiformat der statischen Fassung (Ordner site-data/, im Pages-Build unter data/).
// Das Export-Skript schreibt diese Dateien, die statische Datenschicht im Browser liest sie.
// Alle Dateien sind kompaktes JSON. Leere Werte (null, false, leere Listen) fehlen, um Platz zu sparen.

import type { GameType, Rarity, TestStatus, UpdateDetail, UpdateSummary } from './types.js';

/** Wird bei jeder inkompatiblen Änderung am Dateiformat erhöht. */
export const STATIC_SCHEMA_VERSION = 1;

/** Items pro Datei in details/<n>.json (nach ID sortiert, 0-basiert). */
export const DETAIL_BLOCK_SIZE = 500;

/** meta.json */
export interface StaticMeta {
  schemaVersion: number;
  exportedAt: string; // ISO-Zeitpunkt
  build: number | null; // Build-ID des letzten abgeschlossenen Updates
  itemCount: number; // Anzahl Items in items.json
  detailBlockSize: number;
  detailBlocks: number;
  lastUpdate: UpdateSummary | null; // letzter abgeschlossener Stand
}

/** Teststatus eines Items (nur vorhanden, wenn es eine Zeile in item_tests gibt). */
export interface StaticTest {
  status: TestStatus;
  note?: string;
  testedAt?: string;
  gameTypesAtTest?: GameType[];
}

/** Übersetzung (item_texts, lang=de). Vorhanden = es gibt eine Zeile; fehlender Name = englischer Name. */
export interface StaticGerman {
  name?: string;
  description?: string;
}

/** items.json: Array, nach ID aufsteigend sortiert. */
export interface StaticItem {
  id: number;
  name: string; // englisch
  type: string;
  subtype?: string; // details.type
  rarity: Rarity;
  level: number;
  icon?: string; // ohne ICON_PREFIX
  gameTypes: GameType[];
  flags?: string[];
  isCandidate: boolean;
  removed?: true;
  lastChanged: number; // last_changed_update
  description?: string; // englisch
  de?: StaticGerman;
  chatLink?: string; // nur wenn er vom Standard (Typ 2, Anzahl 1, ID) abweicht
  test?: StaticTest;
  needsRetest?: true;
}

/**
 * details/<n>.json: Objekt ID → restliche API-Antwort (englisch). Felder, die schon in items.json stehen
 * (id, name, description, type, rarity, level, icon, chat_link, game_types, flags), fehlen hier.
 */
export type StaticDetailBlock = Record<string, Record<string, unknown>>;

/** Felder der API-Antwort, die items.json schon enthält. */
export const DETAIL_OMITTED_FIELDS = ['id', 'name', 'description', 'type', 'rarity', 'level', 'icon', 'chat_link', 'game_types', 'flags'] as const;

/** updates.json: wie GET /api/updates, aber nur abgeschlossene Stände und ohne Löschinfos. */
export type StaticUpdate = Omit<UpdateDetail, 'deletable' | 'deleteBlockedReason'>;

/** Eintrag in changes.json (item_changes aller abgeschlossenen Updates außer dem ersten Vollimport). */
export interface StaticChange {
  updateId: number;
  itemId: number;
  kind: 'added' | 'changed' | 'removed';
  changedFields?: string[];
  gameTypesBefore?: GameType[];
  gameTypesAfter?: GameType[];
  valuesBefore?: Record<string, unknown>;
  valuesAfter?: Record<string, unknown>;
  /** Nur bei added/removed: summarize() der API-Antwort (Name, game_types, flags, description, rarity, details.type). */
  summary?: Record<string, unknown>;
}
