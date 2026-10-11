import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { Gw2Client } from './gw2/client.js';
import { BuildWatcher } from './importer/buildWatcher.js';
import { failOrphanedUpdates, Importer } from './importer/importer.js';

// Print startup parameters immediately so you can see what it was started with even after a crash.
console.log(
    `Starting server: port ${config.port}, DB ${config.dbPath}, frontend ${config.webDist ?? '(Vite dev server)'}`,
);

// Do not swallow startup errors; print them visibly and exit with an error code.
process.on('uncaughtException', (err) => {
    console.error('Server error:', err);
    process.exit(1);
});

// Startup wiring: database -> GW2 client -> importer -> optional build watcher -> HTTP app.
const db = openDatabase(config.dbPath);
// An import that was still running at the last shutdown cannot be resumed.
failOrphanedUpdates(db);

const client = new Gw2Client({ baseUrl: config.gw2ApiBase });
const importer = new Importer(db, client);
// Automatic check for new game builds, only if an interval is set.
const watcher = config.updateCheck ? new BuildWatcher(db, client, importer, config.updateCheck) : undefined;
const app = createApp(db, config.webDist, importer, watcher);

// serve() starts a Node HTTP server; app.fetch is Hono's standard request handler.
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Server running at http://localhost:${info.port} (DB: ${config.dbPath})`);
});
watcher?.start();
if (watcher) console.log(`Automatic update check active, next at ${watcher.getStatus().nextCheckAt}`);
server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${config.port} is already in use. Is the server already running in another terminal?`);
    } else {
        console.error('Server error:', err);
    }
    process.exit(1);
});

// Shut down cleanly so SQLite writes back the WAL file (important for "docker stop").
// Ctrl+C (SIGINT) and docker stop (SIGTERM).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        watcher?.stop();
        server.close();
        db.close();
        process.exit(0);
    });
}
