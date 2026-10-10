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
