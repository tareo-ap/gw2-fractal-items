import path from 'node:path';
import { parseCheckSchedule } from './importer/checkSchedule.js';

// Alle Einstellungen kommen aus Umgebungsvariablen, mit Defaults für die lokale Entwicklung.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  // SQLite-Datei. Im Container liegt sie im Volume /data.
  dbPath: process.env.DB_PATH ?? path.resolve(import.meta.dirname, '../../data/gw2-items.db'),
  // Gebautes Frontend. Nur in Produktion gesetzt; in der Entwicklung liefert Vite das Frontend aus.
  webDist: process.env.WEB_DIST ?? null,
  gw2ApiBase: process.env.GW2_API_BASE ?? 'https://api.guildwars2.com',
  // Zeitplan der automatischen Build-Prüfung (UPDATE_CHECK=on); null = aus.
  updateCheck: parseCheckSchedule(process.env),
};

