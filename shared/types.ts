// Types shared by server and web.
// Types only, no runtime code: the imports disappear during compilation.

export type ItemType = 'Gizmo' | 'Consumable' | (string & {});

export type GameType = 'Activity' | 'Dungeon' | 'Pve' | 'Pvp' | 'PvpLobby' | 'Wvw';

export type TestStatus = 'untested' | 'works' | 'broken';

/** Language of item names and descriptions (query parameter lang, default 'en'). */
export type Lang = 'en' | 'de';

export interface StatsResponse {
  items: number;
  candidates: { gizmo: number; consumable: number; tonic: number };
  germanTexts: number; // number of items with a German name (item_texts, lang=de); 0 = no update with German yet
  lastUpdate: UpdateSummary | null;
  autoCheck: AutoCheckStatus | null; // null = server has no watcher (UPDATE_CHECK not on)
}

/** Result of the last automatic check for a new game build. */
export type AutoCheckResult = 'unchanged' | 'started' | 'running' | 'error' | 'noBaseline';

/** Schedule of the auto check: daily at dailyAt, plus every patchEveryMinutes in the patch window (local time in timeZone). */
export interface AutoCheckSchedule {
  timeZone: string; // IANA, e.g. Europe/Berlin
  dailyAt: string; // HH:MM
  patchWindow: { day: 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'; start: string; end: string } | null;
  patchEveryMinutes: number;
}

/** State of the automatic update check (UPDATE_CHECK=on). */
export interface AutoCheckStatus {
  enabled: boolean;
  schedule: AutoCheckSchedule;
  lastCheckAt: string | null; // ISO timestamp
  lastSeenBuild: number | null;
  lastResult: AutoCheckResult | null;
  nextCheckAt: string | null; // ISO timestamp
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
// API contract. Server and web both adhere to it.
// ---------------------------------------------------------------------------

export type Rarity = 'Junk' | 'Basic' | 'Fine' | 'Masterwork' | 'Rare' | 'Exotic' | 'Ascended' | 'Legendary';

/** View in the UI: gizmos and consumables are separate, tonics are their own view across both types. */
export type ItemView = 'gizmo' | 'consumable' | 'tonic' | 'all';

/** Entry in the result list. */
export interface ItemListItem {
  id: number;
  name: string; // in the chosen language (lang), falling back to English
  nameEn: string; // always the English name
  type: ItemType;
  subtype: string | null; // details.type, e.g. Food, Utility, Generic
  rarity: Rarity;
  level: number;
  icon: string | null;
  gameTypes: GameType[];
  isCandidate: boolean; // gameTypes contains "Dungeon"
  removed: boolean; // no longer present in the API
  testStatus: TestStatus;
  needsRetest: boolean; // tested, but gameTypes have changed since the test
}

/**
 * Query parameters for GET /api/items (all optional).
 * Multiple values (rarity, gameType) as a comma-separated list, e.g. rarity=Rare,Exotic.
 */
export interface ItemListQuery {
  lang?: Lang; // Default 'en'
  q?: string; // full text over name + description; plain number = item ID; "[&...]" = chat link
  view?: ItemView; // Default 'gizmo'
  candidate?: 'yes' | 'no' | 'all'; // Default 'yes'
  hidePlaceholders?: boolean; // Default true; hides placeholders (empty name, no icon, or name like "((906936))" or "[[913817]]"), in all views
  hideCommon?: boolean; // Default true; does not apply in the tonic view; hides consumables with subtype Food, Utility, Unlock, Transmutation, Currency as well as Mastery Points, Emote Tomes and currency packs
  rarity?: Rarity[];
  gameType?: GameType[]; // item must contain all of the listed ones
  testStatus?: TestStatus | 'retest';
  updateId?: number; // only items that are new or changed in this update
  includeRemoved?: boolean; // Default false
  sort?: 'name' | 'id' | 'rarity' | 'level' | 'lastChanged'; // Default 'name'
  order?: 'asc' | 'desc'; // Default 'asc'
  page?: number; // from 1, default 1
  pageSize?: number; // default 50, max 200
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
  testedAt: string | null; // ISO timestamp
  gameTypesAtTest: GameType[] | null;
}

export type ChangeKind = 'added' | 'changed' | 'removed';

export interface ItemChange {
  updateId: number;
  updateStartedAt: string;
  kind: ChangeKind;
  changedFields: string[]; // top-level fields of the API response, e.g. ["game_types","description"]
  gameTypesBefore: GameType[] | null;
  gameTypesAfter: GameType[] | null;
}

/** GET /api/items/:id */
export interface ItemDetail extends ItemListItem {
  description: string | null; // in the chosen language; may contain GW2 markup such as <c=@flavor>…</c>
  chatLink: string | null;
  flags: string[];
  restrictions: string[];
  vendorValue: number;
  details: Record<string, unknown> | null; // details object of the API, raw
  wikiUrl: string; // en: https://wiki.guildwars2.com/wiki/Special:Search/<Name>, de: https://wiki-de.guildwars2.com/wiki/Spezial:Suche/<Name>
  test: ItemTest;
  history: ItemChange[]; // newest first
}

/** PUT /api/items/:id/test, Body */
export interface ItemTestUpdate {
  status: TestStatus;
  note?: string | null;
}

/** GET /api/updates: list of all update runs, newest first -> UpdateDetail[] */

/** Additionally per update: how many candidates lost/gained Dungeon. */
export interface UpdateDetail extends UpdateSummary {
  status: 'running' | 'done' | 'failed';
  error: string | null;
  dungeonGained: number;
  dungeonLost: number;
  /** May the state be deleted? The server uses the same rule for DELETE /api/updates/:id. */
  deletable: boolean;
  /** Reason if not deletable: still running, contains changes (completed), or items reference it. */
  deleteBlockedReason: 'running' | 'hasChanges' | 'referenced' | null;
}

/** GET /api/updates/status: progress of the running import. POST /api/updates starts one. */
export interface ImportStatus {
  running: boolean;
  updateId: number | null;
  phase: 'idle' | 'ids' | 'details' | 'details_de' | 'diff' | 'done' | 'failed';
  processed: number; // items with loaded details (in details_de: German texts)
  total: number; // number of item IDs according to the API (in details_de: number of loaded items)
  startedAt: string | null;
  error: string | null; // at phase 'done' only set if the German texts were not loaded completely
}

// ---------------------------------------------------------------------------
// Changes page: GET /api/updates/:id/changes
// ---------------------------------------------------------------------------

/** Focus on game_types: all, only game_types changes, Dungeon gained or lost (kind=changed only). */
export type ChangeFocus = 'all' | 'gameTypes' | 'dungeonGained' | 'dungeonLost';

/**
 * Query parameters (all optional). kind as a comma-separated list, e.g. kind=added,changed.
 */
export interface UpdateChangesQuery {
  lang?: Lang; // Default 'en'; name and search; old/new values stay English
  kind?: ChangeKind[]; // Default: all
  focus?: ChangeFocus; // Default 'all'
  type?: ItemView; // Default 'all'
  q?: string; // name contains (case-insensitive) or exact item ID
  hidePlaceholders?: boolean; // Default true
  page?: number; // from 1, default 1
  pageSize?: number; // default 50, max 200
}

/** Counters for the whole update, independent of the filters. */
export interface UpdateChangeCounts {
  added: number;
  changed: number;
  removed: number;
  gameTypesChanged: number; // kind=changed and game_types differ
  dungeonGained: number;
  dungeonLost: number;
}

export interface UpdateChangeEntry extends Omit<ItemChange, 'updateId' | 'updateStartedAt'> {
  id: number;
  name: string; // in the chosen language, falling back to English
  nameEn: string;
  type: ItemType;
  subtype: string | null;
  rarity: Rarity;
  icon: string | null;
  removed: boolean; // item is removed today (not only in this update)
  isCandidate: boolean;
  /**
   * Old and new values per top-level field of the API response.
   * changed: only the changed fields; null if the update was imported before the columns were introduced.
   * added: before = null, after = name, game_types, flags, description, rarity, details.type.
   * removed: before = the same fields (last known state), after = null.
   */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Only for compare: changed fields whose old value is not stored (update before migration 3). */
  unknownFields?: string[];
}

export interface UpdateChangesResponse {
  update: UpdateDetail;
  counts: UpdateChangeCounts;
  items: UpdateChangeEntry[];
  total: number;
  page: number;
  pageSize: number;
  legacyValues: boolean; // at least one change without stored old values (before migration 3)
}

/** GET /api/updates/compare?from=A&to=B: state after update A versus state after update B (A < B). Same filters as /changes. */
export interface UpdateCompareResponse extends Omit<UpdateChangesResponse, 'update'> {
  from: UpdateDetail;
  to: UpdateDetail;
}
