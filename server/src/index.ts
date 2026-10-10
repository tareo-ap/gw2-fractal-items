import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/index.js';

const db = openDatabase(config.dbPath);
const app = createApp(db, config.webDist);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Server läuft auf http://localhost:${info.port} (DB: ${config.dbPath})`);
});

// Sauber beenden, damit SQLite die WAL-Datei zurückschreibt (wichtig bei "docker stop").
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
