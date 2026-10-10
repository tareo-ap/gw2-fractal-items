// Baut und zeigt die statische, schreibgeschützte Fassung für GitHub Pages (siehe README, Abschnitt "GitHub Pages").
//   node scripts/pages.mjs build     (npm run build:pages)    baut web/dist mit den Daten aus site-data/
//   node scripts/pages.mjs preview   (npm run preview:pages)  startet vite preview auf dem Ergebnis
// Plattformunabhängig (Windows, Linux), deshalb ein Node-Skript statt Umgebungsvariablen in package.json.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const siteData = path.join(root, 'site-data');
const dist = path.join(root, 'web', 'dist');

// Basis-Pfad der Seite: https://<konto>.github.io/<repo>/ → "/<repo>/". Per VITE_BASE änderbar (z. B. "/" für eine eigene Domain).
const env = { ...process.env, VITE_DATA_MODE: 'static', VITE_BASE: process.env.VITE_BASE ?? '/gw2-fractal-items/' };

function run(command) {
  // Ein einzelner Befehlsstring mit shell: npm ist unter Windows eine .cmd-Datei.
  const result = spawnSync(command, { cwd: root, env, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const mode = process.argv[2];

if (mode === 'build') {
  if (!fs.existsSync(path.join(siteData, 'meta.json'))) {
    fail('site-data/ fehlt oder ist leer. Erst "npm run export:static" ausführen und das Ergebnis committen.');
  }
  run('npm run build --workspace web');
  fs.cpSync(siteData, path.join(dist, 'data'), { recursive: true });
  // GitHub Pages liefert 404.html für unbekannte Pfade aus. Als Kopie von index.html startet die App dort
  // und liest den Pfad aus der URL: Reload und Deep-Links wie /gw2_items/items/123 funktionieren.
  fs.copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'));
  console.log(`Pages-Build fertig: ${dist} (Basis ${env.VITE_BASE}). Vorschau: npm run preview:pages`);
} else if (mode === 'preview') {
  if (!fs.existsSync(path.join(dist, 'data', 'meta.json'))) fail('Kein Pages-Build gefunden. Erst "npm run build:pages" ausführen.');
  run('npm run preview --workspace web');
} else {
  fail('Aufruf: node scripts/pages.mjs build|preview');
}
