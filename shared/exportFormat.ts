// Format of the list export (CSV/JSON). The server delivers it via /api/items/export,
// the static version generates the same files in the browser.

import type { GameType, TestStatus } from './types.js';

/** One row of the export (field names as in the CSV header). */
export interface ExportRow {
  id: number;
  name: string;
  type: string;
  subtype: string | null;
  rarity: string;
  level: number;
  game_types: GameType[];
  flags: string[];
  is_candidate: boolean;
  removed: boolean;
  test_status: TestStatus;
  test_note: string | null;
  tested_at: string | null;
  needs_retest: boolean;
  chat_link: string | null;
  wiki_url: string;
  icon: string | null;
}

export const EXPORT_FIELDS: readonly (keyof ExportRow)[] = [
  'id', 'name', 'type', 'subtype', 'rarity', 'level', 'game_types', 'flags', 'is_candidate', 'removed',
  'test_status', 'test_note', 'tested_at', 'needs_retest', 'chat_link', 'wiki_url', 'icon',
];

/**
 * CSV for German Excel: semicolon, CRLF, UTF-8 with BOM. Arrays are joined with "|".
 * Texts starting with =, +, -, @ (or tab/CR) get a ' prepended (formula injection).
 */
export function toCsv(rows: ExportRow[]): string {
  const cell = (value: ExportRow[keyof ExportRow]): string => {
    let text = value === null ? '' : Array.isArray(value) ? value.join('|') : String(value);
    if ((typeof value === 'string' || Array.isArray(value)) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [EXPORT_FIELDS.join(';'), ...rows.map((row) => EXPORT_FIELDS.map((f) => cell(row[f])).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** File name of the download, e.g. gw2-items-gizmo-2026-10-10.csv */
export function exportFilename(view: string, format: 'csv' | 'json', now: Date = new Date()): string {
  return `gw2-items-${view}-${now.toISOString().slice(0, 10)}.${format}`;
}

/** Content of the JSON file. */
export const toJson = (rows: ExportRow[]): string => JSON.stringify(rows, null, 2);
