import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { HealthResponse, StatsResponse, UpdateSummary } from '../../shared/types.js';

interface UpdateRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  build_id: number | null;
  added: number;
  changed: number;
  removed: number;
}

// Baut die Hono-App. Getrennt von index.ts, damit sie sich ohne laufenden Server testen lässt.
export function createApp(db: DatabaseSync, webDist: string | null): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json<HealthResponse>({ status: 'ok', version: '0.1.0' }));

  app.get('/api/stats', (c) => {
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    const last = db
      .prepare(`SELECT * FROM updates WHERE status = 'done' ORDER BY id DESC LIMIT 1`)
      .get() as UpdateRow | undefined;

    return c.json<StatsResponse>({
      items: count('SELECT COUNT(*) AS n FROM items WHERE removed = 0'),
      candidates: {
        gizmo: count(`SELECT COUNT(*) AS n FROM items WHERE removed = 0 AND is_candidate = 1 AND type = 'Gizmo'`),
        consumable: count(`SELECT COUNT(*) AS n FROM items WHERE removed = 0 AND is_candidate = 1 AND type = 'Consumable'`),
      },
      lastUpdate: last ? toUpdateSummary(last) : null,
    });
  });

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));

  // In Produktion liefert der Server auch das gebaute Frontend aus.
  // Unbekannte Pfade bekommen index.html, damit clientseitiges Routing funktioniert.
  if (webDist) {
    const indexHtml = fs.readFileSync(`${webDist}/index.html`, 'utf8');
    app.use('/*', serveStatic({ root: webDist }));
    app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
  }

  return app;
}

function toUpdateSummary(row: UpdateRow): UpdateSummary {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    buildId: row.build_id,
    added: row.added,
    changed: row.changed,
    removed: row.removed,
  };
}
