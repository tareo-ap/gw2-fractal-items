import path from 'node:path';
import { parseCheckSchedule } from './importer/checkSchedule.js';

// All settings come from environment variables, with defaults for local development.
// Read once at startup; imported by index.ts.
export const config = {
    port: Number(process.env.PORT ?? 3000),
    // SQLite file. In the container it lives in the /data volume.
    dbPath: process.env.DB_PATH ?? path.resolve(import.meta.dirname, '../../data/gw2-items.db'),
    // Built frontend. Only set in production; in development Vite serves the frontend.
    webDist: process.env.WEB_DIST ?? null,
    gw2ApiBase: process.env.GW2_API_BASE ?? 'https://api.guildwars2.com',
    // Schedule of the automatic build check (UPDATE_CHECK=on); null = off.
    updateCheck: parseCheckSchedule(process.env),
};
