// Typen, die Server und Web gemeinsam nutzen.
// Nur Typen, kein Laufzeitcode: Die Imports verschwinden beim Kompilieren.

export type ItemType = 'Gizmo' | 'Consumable' | (string & {});

export type GameType = 'Activity' | 'Dungeon' | 'Pve' | 'Pvp' | 'PvpLobby' | 'Wvw';

export type TestStatus = 'untested' | 'works' | 'broken';

/** Sprache der Item-Namen und -Beschreibungen (Query-Parameter lang, Default 'en'). */
export type Lang = 'en' | 'de';

export interface StatsResponse {
  items: number;
  candidates: { gizmo: number; consumable: number; tonic: number };
  germanTexts: number; // Anzahl Items mit deutschem Namen (item_texts, lang=de); 0 = noch kein Update mit Deutsch
  lastUpdate: UpdateSummary | null;
  autoCheck: AutoCheckStatus | null; // null = Server hat keinen Watcher (UPDATE_CHECK nicht on)
}

/** Ergebnis der letzten automatischen Prüfung auf eine neue Game-Build. */
export type AutoCheckResult = 'unchanged' | 'started' | 'running' | 'error' | 'noBaseline';

/** Zeitplan des Auto-Checks: täglich um dailyAt, dazu im Patch-Fenster alle patchEveryMinutes (Ortszeit in timeZone). */
export interface AutoCheckSchedule {
  timeZone: string; // IANA, z. B. Europe/Berlin
  dailyAt: string; // HH:MM
  patchWindow: { day: 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'; start: string; end: string } | null;
  patchEveryMinutes: number;
}

/** Zustand des automatischen Update-Checks (UPDATE_CHECK=on). */
export interface AutoCheckStatus {
  enabled: boolean;
  schedule: AutoCheckSchedule;
  lastCheckAt: string | null; // ISO-Zeitpunkt
  lastSeenBuild: number | null;
  lastResult: AutoCheckResult | null;
  nextCheckAt: string | null; // ISO-Zeitpunkt
}

export interface UpdateSummary {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  buildId: number | null;
  added: number;
  changed: number;
  removed: number;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}

// ---------------------------------------------------------------------------
// API-Vertrag ab Meilenstein 2/3. Server und Web halten sich beide daran.
// ---------------------------------------------------------------------------

export type Rarity = 'Junk' | 'Basic' | 'Fine' | 'Masterwork' | 'Rare' | 'Exotic' | 'Ascended' | 'Legendary';

/** Ansicht in der UI: Gizmos und Consumables sind getrennt, Tonics sind eine eigene Ansicht über beide Typen. */
export type ItemView = 'gizmo' | 'consumable' | 'tonic' | 'all';

/** Eintrag in der Ergebnisliste. */
export interface ItemListItem {
  id: number;
  name: string; // in der gewählten Sprache (lang), Fallback Englisch
  nameEn: string; // immer der englische Name
  type: ItemType;
  subtype: string | null; // details.type, z. B. Food, Utility, Generic
  rarity: Rarity;
  level: number;
  icon: string | null;
  gameTypes: GameType[];
  isCandidate: boolean; // gameTypes enthält "Dungeon"
  removed: boolean; // nicht mehr in der API vorhanden
  testStatus: TestStatus;
  needsRetest: boolean; // getestet, aber gameTypes haben sich seit dem Test geändert
}

/**
 * Query-Parameter für GET /api/items (alle optional).
 * Mehrfachwerte (rarity, gameType) als kommagetrennte Liste, z. B. rarity=Rare,Exotic.
 */
export interface ItemListQuery {
  lang?: Lang; // Default 'en'
  q?: string; // Volltext über Name + Beschreibung; reine Zahl = Item-ID; "[&...]" = Chat-Link
  view?: ItemView; // Default 'gizmo'
  candidate?: 'yes' | 'no' | 'all'; // Default 'yes'
  hidePlaceholders?: boolean; // Default true; blendet Platzhalter aus (Name leer, kein Icon oder Name wie "((906936))" oder "[[913817]]"), in allen Ansichten
  hideCommon?: boolean; // Default true; gilt nicht in der Ansicht tonic; blendet Consumables mit subtype Food, Utility, Unlock, Transmutation, Currency sowie Mastery Points, Emote Tomes und Währungspakete aus
  rarity?: Rarity[];
  gameType?: GameType[]; // Item muss alle genannten enthalten
  testStatus?: TestStatus | 'retest';
  updateId?: number; // nur Items, die in diesem Update neu oder geändert sind
  includeRemoved?: boolean; // Default false
  sort?: 'name' | 'id' | 'rarity' | 'level' | 'lastChanged'; // Default 'name'
  order?: 'asc' | 'desc'; // Default 'asc'
  page?: number; // ab 1, Default 1
  pageSize?: number; // Default 50, max 200
}

export interface ItemListResponse {
  items: ItemListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ItemTest {
  status: TestStatus;
  note: string | null;
  testedAt: string | null; // ISO-Zeitpunkt
  gameTypesAtTest: GameType[] | null;
}

export type ChangeKind = 'added' | 'changed' | 'removed';

export interface ItemChange {
  updateId: number;
  updateStartedAt: string;
  kind: ChangeKind;
  changedFields: string[]; // Top-Level-Felder der API-Antwort, z. B. ["game_types","description"]
  gameTypesBefore: GameType[] | null;
  gameTypesAfter: GameType[] | null;
}

/** GET /api/items/:id */
export interface ItemDetail extends ItemListItem {
  description: string | null; // in der gewählten Sprache; kann GW2-Markup wie <c=@flavor>…</c> enthalten
  chatLink: string | null;
  flags: string[];
  restrictions: string[];
  vendorValue: number;
  details: Record<string, unknown> | null; // details-Objekt der API, roh
  wikiUrl: string; // en: https://wiki.guildwars2.com/wiki/Special:Search/<Name>, de: https://wiki-de.guildwars2.com/wiki/Spezial:Suche/<Name>
  test: ItemTest;
  history: ItemChange[]; // neueste zuerst
}

/** PUT /api/items/:id/test, Body */
export interface ItemTestUpdate {
  status: TestStatus;
  note?: string | null;
}

/** GET /api/updates: Liste aller Update-Läufe, neueste zuerst → UpdateDetail[] */

/** Zusätzlich pro Update: wie viele Kandidaten haben Dungeon verloren/gewonnen. */
export interface UpdateDetail extends UpdateSummary {
  status: 'running' | 'done' | 'failed';
  error: string | null;
  dungeonGained: number;
  dungeonLost: number;
  /** Darf der Stand gelöscht werden? Dieselbe Regel nutzt der Server bei DELETE /api/updates/:id. */
  deletable: boolean;
  /** Grund, wenn nicht löschbar: läuft noch, enthält Änderungen (abgeschlossen) oder Items verweisen darauf. */
  deleteBlockedReason: 'running' | 'hasChanges' | 'referenced' | null;
}

/** GET /api/updates/status: Fortschritt des laufenden Imports. POST /api/updates startet einen. */
export interface ImportStatus {
  running: boolean;
  updateId: number | null;
  phase: 'idle' | 'ids' | 'details' | 'details_de' | 'diff' | 'done' | 'failed';
  processed: number; // Items mit geladenen Details (in details_de: deutsche Texte)
  total: number; // Anzahl Item-IDs laut API (in details_de: Anzahl geladener Items)
  startedAt: string | null;
  error: string | null; // bei phase 'done' nur gesetzt, wenn die deutschen Texte nicht vollständig geladen wurden
}

// ---------------------------------------------------------------------------
// Änderungsseite: GET /api/updates/:id/changes
// ---------------------------------------------------------------------------

/** Fokus auf game_types: alle, nur game_types-Änderungen, Dungeon dazugekommen oder weggefallen (nur kind=changed). */
export type ChangeFocus = 'all' | 'gameTypes' | 'dungeonGained' | 'dungeonLost';

/**
 * Query-Parameter (alle optional). kind als kommagetrennte Liste, z. B. kind=added,changed.
 */
export interface UpdateChangesQuery {
  lang?: Lang; // Default 'en'; Name und Suche, Alt/Neu-Werte bleiben englisch
  kind?: ChangeKind[]; // Default: alle
  focus?: ChangeFocus; // Default 'all'
  type?: ItemView; // Default 'all'
  q?: string; // Name enthält (ohne Groß-/Kleinschreibung) oder exakte Item-ID
  hidePlaceholders?: boolean; // Default true
  page?: number; // ab 1, Default 1
  pageSize?: number; // Default 50, max 200
}

/** Zähler für das gesamte Update, unabhängig von den Filtern. */
export interface UpdateChangeCounts {
  added: number;
  changed: number;
  removed: number;
  gameTypesChanged: number; // kind=changed und game_types unterscheiden sich
  dungeonGained: number;
  dungeonLost: number;
}

export interface UpdateChangeEntry extends Omit<ItemChange, 'updateId' | 'updateStartedAt'> {
  id: number;
  name: string; // in der gewählten Sprache, Fallback Englisch
  nameEn: string;
  type: ItemType;
  subtype: string | null;
  rarity: Rarity;
  icon: string | null;
  removed: boolean; // Item ist heute (nicht nur in diesem Update) entfernt
  isCandidate: boolean;
  /**
   * Alte und neue Werte pro Top-Level-Feld der API-Antwort.
   * changed: nur die geänderten Felder; null, wenn das Update vor Einführung der Spalten importiert wurde.
   * added: before = null, after = name, game_types, flags, description, rarity, details.type.
   * removed: before = dieselben Felder (letzter bekannter Stand), after = null.
   */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Nur bei compare: geänderte Felder, deren alter Wert nicht gespeichert ist (Update vor Migration 3). */
  unknownFields?: string[];
}

export interface UpdateChangesResponse {
  update: UpdateDetail;
  counts: UpdateChangeCounts;
  items: UpdateChangeEntry[];
  total: number;
  page: number;
  pageSize: number;
  legacyValues: boolean; // mindestens eine Änderung ohne gespeicherte alte Werte (vor Migration 3)
}

/** GET /api/updates/compare?from=A&to=B: Stand nach Update A gegen Stand nach Update B (A < B). Gleiche Filter wie /changes. */
export interface UpdateCompareResponse extends Omit<UpdateChangesResponse, 'update'> {
  from: UpdateDetail;
  to: UpdateDetail;
}
