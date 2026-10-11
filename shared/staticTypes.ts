// File format of the static version (folder site-data/, under data/ in the Pages build).
// The export script writes these files, the static data layer in the browser reads them.
// All files are compact JSON. Empty values (null, false, empty lists) are omitted to save space.

import type { GameType, Rarity, TestStatus, UpdateDetail, UpdateSummary } from './types.js';

/** Incremented on every incompatible change to the file format. */
export const STATIC_SCHEMA_VERSION = 1;

/** Items per file in details/<n>.json (sorted by ID, 0-based). */
export const DETAIL_BLOCK_SIZE = 500;

/** meta.json */
export interface StaticMeta {
    schemaVersion: number;
    exportedAt: string; // ISO timestamp
    build: number | null; // build ID of the last completed update
    itemCount: number; // number of items in items.json
    detailBlockSize: number;
    detailBlocks: number;
    lastUpdate: UpdateSummary | null; // last completed state
}

/** Test status of an item (only present if there is a row in item_tests). */
export interface StaticTest {
    status: TestStatus;
    note?: string;
    testedAt?: string;
    gameTypesAtTest?: GameType[];
}

/** Translation (item_texts, lang=de). Present = there is a row; missing name = English name. */
export interface StaticGerman {
    name?: string;
    description?: string;
}

/** items.json: array, sorted by ID ascending. */
export interface StaticItem {
    id: number;
    name: string; // English
    type: string;
    subtype?: string; // details.type
    rarity: Rarity;
    level: number;
    icon?: string; // without ICON_PREFIX
    gameTypes: GameType[];
    flags?: string[];
    isCandidate: boolean;
    removed?: true;
    lastChanged: number; // last_changed_update
    description?: string; // English
    de?: StaticGerman;
    chatLink?: string; // only if it differs from the default (type 2, quantity 1, ID)
    test?: StaticTest;
    needsRetest?: true;
}

/**
 * details/<n>.json: object ID -> rest of the API response (English). Fields already present in items.json
 * (id, name, description, type, rarity, level, icon, chat_link, game_types, flags) are omitted here.
 */
export type StaticDetailBlock = Record<string, Record<string, unknown>>;

/** Fields of the API response that items.json already contains. */
export const DETAIL_OMITTED_FIELDS = [
    'id',
    'name',
    'description',
    'type',
    'rarity',
    'level',
    'icon',
    'chat_link',
    'game_types',
    'flags',
] as const;

/** updates.json: like GET /api/updates, but only completed states and without deletion info. */
export type StaticUpdate = Omit<UpdateDetail, 'deletable' | 'deleteBlockedReason'>;

/** Entry in changes.json (item_changes of all completed updates except the first full import). */
export interface StaticChange {
    updateId: number;
    itemId: number;
    kind: 'added' | 'changed' | 'removed';
    changedFields?: string[];
    gameTypesBefore?: GameType[];
    gameTypesAfter?: GameType[];
    valuesBefore?: Record<string, unknown>;
    valuesAfter?: Record<string, unknown>;
    /** Only for added/removed: summarize() of the API response (name, game_types, flags, description, rarity, details.type). */
    summary?: Record<string, unknown>;
}
