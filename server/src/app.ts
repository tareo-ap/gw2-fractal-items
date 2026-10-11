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
    toJson,
    exportFilename,
    ValidationError,
} from './routes/items.js';
import {
    compareUpdates,
    deleteUpdate,
    getUpdate,
    getUpdateChanges,
    listUpdates,
    parseUpdateChangesQuery,
    toUpdateSummary,
    type UpdateRow,
} from './routes/updates.js';

// Builds the Hono app (Hono = small web framework; routes are registered with app.get/put/post/delete).
// Kept separate from index.ts so it can be tested without a running server.
// Every handler receives `c`, Hono's Context: it gives access to the request (c.req) and builds
// the response (c.json, c.body, c.text, c.html). Thrown errors end up in app.onError below.
export function createApp(db: DatabaseSync, webDist: string | null, importer: Importer, watcher?: BuildWatcher): Hono {
    const app = new Hono();

    app.get('/api/health', (c) => c.json<HealthResponse>({ status: 'ok', version: '0.1.0' }));

    // Dashboard numbers. db.prepare(sql) compiles a statement; .get() returns the first row (or undefined),
    // .all() returns all rows, .run() executes without returning rows.
    app.get('/api/stats', (c) => {
        // Runs a "SELECT COUNT(*) AS n" query and returns the number.
        const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
        const lastDoneUpdate = db
            .prepare(`SELECT * FROM updates WHERE status = 'done' ORDER BY id DESC LIMIT 1`)
            .get() as UpdateRow | undefined;

        return c.json<StatsResponse>({
            items: count('SELECT COUNT(*) AS n FROM items WHERE removed = 0'),
            candidates: {
                gizmo: count(
                    `SELECT COUNT(*) AS n FROM items WHERE removed = 0 AND is_candidate = 1 AND type = 'Gizmo'`,
                ),
                consumable: count(
                    `SELECT COUNT(*) AS n FROM items WHERE removed = 0 AND is_candidate = 1 AND type = 'Consumable'`,
                ),
                tonic: count(
                    `SELECT COUNT(*) AS n FROM items i WHERE i.removed = 0 AND i.is_candidate = 1 AND ${TONIC_SQL}`,
                ),
            },
            germanTexts: count(`SELECT COUNT(*) AS n FROM item_texts WHERE lang = 'de'`),
            lastUpdate: lastDoneUpdate ? toUpdateSummary(lastDoneUpdate) : null,
            autoCheck: watcher?.getStatus() ?? null,
        });
    });

    // --- Items ---------------------------------------------------------------

    app.get('/api/items', (c) => c.json<ItemListResponse>(listItems(db, parseItemListQuery(c.req.query()))));

    // Must come before /api/items/:id. Exports all filter matches, page/pageSize are ignored.
    app.get('/api/items/export', (c) => {
        const params = c.req.query();
        // `as const` makes the array a tuple of literal types, so `format` is typed 'csv' | 'json'.
        const format = oneOf('format', params.format, ['csv', 'json'] as const);
        if (!format) throw new ValidationError('format must be one of: csv, json');
        const query = parseItemListQuery(params);
        const rows = exportItems(db, query);
        const filename = exportFilename(query.view, format);
        // Makes the browser download the response as a file instead of displaying it.
        const headers = { 'Content-Disposition': `attachment; filename="${filename}"` };
        if (format === 'json') return c.body(toJson(rows), 200, { ...headers, 'Content-Type': 'application/json' });
        return c.body(toCsv(rows), 200, { ...headers, 'Content-Type': 'text/csv; charset=utf-8' });
    });

    app.get('/api/items/:id', (c) => {
        const item = getItemDetail(db, parseId(c.req.param('id')), parseLang(c.req.query('lang')));
        return item ? c.json<ItemDetail>(item) : c.json({ error: 'Item not found' }, 404);
    });

    // Saves the manual test result (status/note) of an item and returns the updated item.
    app.put('/api/items/:id/test', async (c) => {
        const id = parseId(c.req.param('id'));
        const lang = parseLang(c.req.query('lang'));
        // `unknown` forces us to validate the body in parseItemTestUpdate before using it.
        const body: unknown = await c.req.json().catch(() => {
            throw new ValidationError('Body is not valid JSON');
        });
        if (!saveItemTest(db, id, parseItemTestUpdate(body))) return c.json({ error: 'Item not found' }, 404);
        // `!` = non-null assertion: the item exists, saveItemTest just updated it.
        return c.json<ItemDetail>(getItemDetail(db, id, lang)!);
    });

    // --- Updates -------------------------------------------------------------

    app.get('/api/updates', (c) => c.json<UpdateDetail[]>(listUpdates(db)));

    app.get('/api/updates/status', (c) => c.json<ImportStatus>(importer.getStatus()));

    // State after update A versus state after update B (A < B, both completed).
    app.get('/api/updates/compare', (c) => {
        const from = parseId(c.req.query('from') ?? '', 'Update (from)');
        const to = parseId(c.req.query('to') ?? '', 'Update (to)');
        if (from >= to) throw new ValidationError('from must be less than to');
        const query = parseUpdateChangesQuery(c.req.query());
        const fromUpdate = getUpdate(db, from);
        const toUpdate = getUpdate(db, to);
        if (!fromUpdate || !toUpdate) return c.json({ error: 'Update not found' }, 404);
        if (fromUpdate.status !== 'done' || toUpdate.status !== 'done')
            throw new ValidationError('Both updates must be completed');
        return c.json<UpdateCompareResponse>(compareUpdates(db, fromUpdate, toUpdate, query));
    });

    app.get('/api/updates/:id/changes', (c) => {
        const id = parseId(c.req.param('id'), 'Update');
        const query = parseUpdateChangesQuery(c.req.query());
        const update = getUpdate(db, id);
        return update
            ? c.json<UpdateChangesResponse>(getUpdateChanges(db, update, query))
            : c.json({ error: 'Update not found' }, 404);
    });

    // Starts an import in the background (202 Accepted). Only one import may run at a time.
    app.post('/api/updates', (c) => {
        try {
            return c.json<ImportStatus>(importer.start(), 202);
        } catch (err) {
            if (err instanceof ImportAlreadyRunningError)
                return c.json({ error: err.message, status: importer.getStatus() }, 409);
            throw err;
        }
    });

    // Deletes a state (only failed or empty ones, see deleteUpdate). Running imports write to their row: 409.
    app.delete('/api/updates/:id', (c) => {
        const result = deleteUpdate(db, parseId(c.req.param('id'), 'Update'));
        return result.ok ? c.body(null, 204) : c.json({ error: result.error }, result.status);
    });

    // --- Export --------------------------------------------------------------

    // Consistent copy of the database as a download. VACUUM INTO also works during an import.
    app.get('/api/export', (c) => {
        const tmpFile = path.join(os.tmpdir(), `gw2-items-export-${crypto.randomUUID()}.db`);
        try {
            // VACUUM INTO takes no parameters; double single quotes in the path.
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

    // Central error handling: validation errors become 400, everything else a generic 500.
    app.onError((err, c) => {
        if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
        console.error(err);
        return c.json({ error: 'Internal error' }, 500);
    });

    app.notFound((c) =>
        c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404),
    );

    // In production the server also serves the built frontend.
    // Unknown paths get index.html so client-side routing works.
    if (webDist) {
        const indexHtml = fs.readFileSync(`${webDist}/index.html`, 'utf8');
        app.use('/*', serveStatic({ root: webDist }));
        app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
    }

    return app;
}

// Parses a path/query value into a positive integer ID; throws ValidationError (-> HTTP 400) otherwise.
function parseId(value: string, what = 'Item'): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) throw new ValidationError(`Invalid ${what} ID`);
    return id;
}
