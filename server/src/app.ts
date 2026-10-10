import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type {
  HealthResponse,
  ImportStatus,
  ItemDetail,
  ItemListResponse,
  StatsResponse,
  UpdateChangesResponse,
  UpdateCompareResponse,
  UpdateDetail,
} from '../../shared/types.js';
import type { BuildWatcher } from './importer/buildWatcher.js';
import { ImportAlreadyRunningError, type Importer } from './importer/importer.js';
import {
  exportItems,
  getItemDetail,
  TONIC_SQL,
  listItems,
  oneOf,
  parseItemListQuery,
  parseLang,
  parseItemTestUpdate,
  saveItemTest,
  toCsv,
  ValidationError,
} from './routes/items.js';
import { compareUpdates, deleteUpdate, getUpdate, getUpdateChanges, listUpdates, parseUpdateChangesQuery, toUpdateSummary, type UpdateRow } from './routes/updates.js';

// Baut die Hono-App. Getrennt von index.ts, damit sie sich ohne laufenden Server testen lässt.
export function createApp(db: DatabaseSync, webDist: string | null, importer: Importer, watcher?: BuildWatcher): Hono {
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
        tonic: count(`SELECT COUNT(*) AS n FROM items i WHERE i.removed = 0 AND i.is_candidate = 1 AND ${TONIC_SQL}`),
      },
      germanTexts: count(`SELECT COUNT(*) AS n FROM item_texts WHERE lang = 'de'`),
      lastUpdate: last ? toUpdateSummary(last) : null,
      autoCheck: watcher?.getStatus() ?? null,
    });
  });

  // --- Items ---------------------------------------------------------------

  app.get('/api/items', (c) => c.json<ItemListResponse>(listItems(db, parseItemListQuery(c.req.query()))));

  // Muss vor /api/items/:id stehen. Exportiert alle Treffer der Filter, page/pageSize werden ignoriert.
  app.get('/api/items/export', (c) => {
    const params = c.req.query();
    const format = oneOf('format', params.format, ['csv', 'json'] as const);
    if (!format) throw new ValidationError('format muss einer dieser Werte sein: csv, json');
    const query = parseItemListQuery(params);
    const rows = exportItems(db, query);
    const filename = `gw2-items-${query.view}-${new Date().toISOString().slice(0, 10)}.${format}`;
    const headers = { 'Content-Disposition': `attachment; filename="${filename}"` };
    if (format === 'json') return c.body(JSON.stringify(rows, null, 2), 200, { ...headers, 'Content-Type': 'application/json' });
    return c.body(toCsv(rows), 200, { ...headers, 'Content-Type': 'text/csv; charset=utf-8' });
  });

  app.get('/api/items/:id', (c) => {
    const item = getItemDetail(db, parseId(c.req.param('id')), parseLang(c.req.query('lang')));
    return item ? c.json<ItemDetail>(item) : c.json({ error: 'Item nicht gefunden' }, 404);
  });

  app.put('/api/items/:id/test', async (c) => {
    const id = parseId(c.req.param('id'));
    const lang = parseLang(c.req.query('lang'));
    const body: unknown = await c.req.json().catch(() => {
      throw new ValidationError('Body ist kein gültiges JSON');
    });
    if (!saveItemTest(db, id, parseItemTestUpdate(body))) return c.json({ error: 'Item nicht gefunden' }, 404);
    return c.json<ItemDetail>(getItemDetail(db, id, lang)!);
  });

  // --- Updates -------------------------------------------------------------

  app.get('/api/updates', (c) => c.json<UpdateDetail[]>(listUpdates(db)));

  app.get('/api/updates/status', (c) => c.json<ImportStatus>(importer.getStatus()));

  // Stand nach Update A gegen Stand nach Update B (A < B, beide abgeschlossen).
  app.get('/api/updates/compare', (c) => {
    const from = parseId(c.req.query('from') ?? '', 'Update (from)');
    const to = parseId(c.req.query('to') ?? '', 'Update (to)');
    if (from >= to) throw new ValidationError('from muss kleiner als to sein');
    const query = parseUpdateChangesQuery(c.req.query());
    const fromUpdate = getUpdate(db, from);
    const toUpdate = getUpdate(db, to);
    if (!fromUpdate || !toUpdate) return c.json({ error: 'Update nicht gefunden' }, 404);
    if (fromUpdate.status !== 'done' || toUpdate.status !== 'done') throw new ValidationError('Beide Updates müssen abgeschlossen sein');
    return c.json<UpdateCompareResponse>(compareUpdates(db, fromUpdate, toUpdate, query));
  });

  app.get('/api/updates/:id/changes', (c) => {
    const id = parseId(c.req.param('id'), 'Update');
    const query = parseUpdateChangesQuery(c.req.query());
    const update = getUpdate(db, id);
    return update ? c.json<UpdateChangesResponse>(getUpdateChanges(db, update, query)) : c.json({ error: 'Update nicht gefunden' }, 404);
  });

  app.post('/api/updates', (c) => {
    try {
      return c.json<ImportStatus>(importer.start(), 202);
    } catch (err) {
      if (err instanceof ImportAlreadyRunningError) return c.json({ error: err.message, status: importer.getStatus() }, 409);
      throw err;
    }
  });

  // Löscht einen Stand (nur fehlgeschlagene oder leere, siehe deleteUpdate). Laufende Imports schreiben in ihre Zeile: 409.
  app.delete('/api/updates/:id', (c) => {
    const result = deleteUpdate(db, parseId(c.req.param('id'), 'Update'));
    return result.ok ? c.body(null, 204) : c.json({ error: result.error }, result.status);
  });

  // --- Export --------------------------------------------------------------

  // Konsistente Kopie der Datenbank als Download. VACUUM INTO funktioniert auch während eines Imports.
  app.get('/api/export', (c) => {
    const tmpFile = path.join(os.tmpdir(), `gw2-items-export-${crypto.randomUUID()}.db`);
    try {
      // VACUUM INTO nimmt keine Parameter; einfache Anführungszeichen im Pfad verdoppeln.
      db.exec(`VACUUM INTO '${tmpFile.replace(/'/g, "''")}'`);
      const data = fs.readFileSync(tmpFile);
      return c.body(data, 200, {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="gw2-items-${new Date().toISOString().slice(0, 10)}.db"`,
        'Content-Length': String(data.length),
      });
    } finally {
      fs.rmSync(tmpFile, { force: true });
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

function parseId(value: string, what = 'Item'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new ValidationError(`Ungültige ${what}-ID`);
  return id;
}
