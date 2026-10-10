import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type {
  HealthResponse,
  ImportStatus,
  ItemDetail,
  ItemListResponse,
  StatsResponse,
  UpdateDetail,
} from '../../shared/types.js';
import { ImportAlreadyRunningError, type Importer } from './importer/importer.js';
import {
  getItemDetail,
  listItems,
  parseItemListQuery,
  parseItemTestUpdate,
  saveItemTest,
  ValidationError,
} from './routes/items.js';
import { listUpdates, toUpdateSummary, type UpdateRow } from './routes/updates.js';

// Baut die Hono-App. Getrennt von index.ts, damit sie sich ohne laufenden Server testen lässt.
export function createApp(db: DatabaseSync, webDist: string | null, importer: Importer): Hono {
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

  // --- Items ---------------------------------------------------------------

  app.get('/api/items', (c) => c.json<ItemListResponse>(listItems(db, parseItemListQuery(c.req.query()))));

  app.get('/api/items/:id', (c) => {
    const item = getItemDetail(db, parseId(c.req.param('id')));
    return item ? c.json<ItemDetail>(item) : c.json({ error: 'Item nicht gefunden' }, 404);
  });

  app.put('/api/items/:id/test', async (c) => {
    const id = parseId(c.req.param('id'));
    const body: unknown = await c.req.json().catch(() => {
      throw new ValidationError('Body ist kein gültiges JSON');
    });
    if (!saveItemTest(db, id, parseItemTestUpdate(body))) return c.json({ error: 'Item nicht gefunden' }, 404);
    return c.json<ItemDetail>(getItemDetail(db, id)!);
  });

  // --- Updates -------------------------------------------------------------

  app.get('/api/updates', (c) => c.json<UpdateDetail[]>(listUpdates(db)));

  app.get('/api/updates/status', (c) => c.json<ImportStatus>(importer.getStatus()));

  app.post('/api/updates', (c) => {
    try {
      return c.json<ImportStatus>(importer.start(), 202);
    } catch (err) {
      if (err instanceof ImportAlreadyRunningError) return c.json({ error: err.message, status: importer.getStatus() }, 409);
      throw err;
    }
  });

  // -------------------------------------------------------------------------

  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: 'Interner Fehler' }, 500);
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

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Ungültige Item-ID');
  return id;
}
