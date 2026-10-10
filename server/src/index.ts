import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { Gw2Client } from './gw2/client.js';
import { failOrphanedUpdates, Importer } from './importer/importer.js';

// Startparameter sofort ausgeben, damit man auch bei einem Absturz sieht, womit gestartet wurde.
console.log(`Starte Server: Port ${config.port}, DB ${config.dbPath}, Frontend ${config.webDist ?? '(Vite-Dev-Server)'}`);

// Fehler beim Start nicht verschlucken, sondern sichtbar ausgeben und mit Fehlercode beenden.
process.on('uncaughtException', (err) => {
  console.error('Server-Fehler:', err);
  process.exit(1);
});

const db = openDatabase(config.dbPath);
// Ein Import, der beim letzten Beenden noch lief, kann nicht fortgesetzt werden.
failOrphanedUpdates(db);

const importer = new Importer(db, new Gw2Client({ baseUrl: config.gw2ApiBase }));
const app = createApp(db, config.webDist, importer);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Server läuft auf http://localhost:${info.port} (DB: ${config.dbPath})`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} ist schon belegt. Läuft der Server bereits in einem anderen Terminal?`);
  } else {
    console.error('Server-Fehler:', err);
  }
  process.exit(1);
});

// Sauber beenden, damit SQLite die WAL-Datei zurückschreibt (wichtig bei "docker stop").
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
