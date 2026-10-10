// Typen, die Server und Web gemeinsam nutzen.
// Nur Typen, kein Laufzeitcode: Die Imports verschwinden beim Kompilieren.

export type ItemType = 'Gizmo' | 'Consumable' | (string & {});

export type GameType = 'Activity' | 'Dungeon' | 'Pve' | 'Pvp' | 'PvpLobby' | 'Wvw';

export type TestStatus = 'untested' | 'works' | 'broken';

export interface StatsResponse {
  items: number;
  candidates: { gizmo: number; consumable: number };
  lastUpdate: UpdateSummary | null;
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

/** Ansicht in der UI: Gizmos und Consumables sind getrennt. */
export type ItemView = 'gizmo' | 'consumable' | 'all';

/** Eintrag in der Ergebnisliste. */
export interface ItemListItem {
  id: number;
  name: string;
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
  q?: string; // Volltext über Name + Beschreibung; reine Zahl = Item-ID; "[&...]" = Chat-Link
  view?: ItemView; // Default 'gizmo'
  candidate?: 'yes' | 'no' | 'all'; // Default 'yes'
  hideCommon?: boolean; // Default true; blendet Consumables mit subtype Food, Utility, Unlock, Transmutation aus
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
  description: string | null; // kann GW2-Markup wie <c=@flavor>…</c> enthalten
  chatLink: string | null;
  flags: string[];
  restrictions: string[];
  vendorValue: number;
  details: Record<string, unknown> | null; // details-Objekt der API, roh
  wikiUrl: string; // https://wiki.guildwars2.com/wiki/Special:Search/<Name>
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
}

/** GET /api/updates/status: Fortschritt des laufenden Imports. POST /api/updates startet einen. */
export interface ImportStatus {
  running: boolean;
  updateId: number | null;
  phase: 'idle' | 'ids' | 'details' | 'diff' | 'done' | 'failed';
  processed: number; // Items mit geladenen Details
  total: number; // Anzahl Item-IDs laut API
  startedAt: string | null;
  error: string | null;
}
