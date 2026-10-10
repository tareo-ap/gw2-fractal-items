import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Basis-Pfad der App. Lokal und im Docker-Image "/", auf GitHub Pages z. B. "/gw2_items/" (npm run build:pages).
// Führende und abschließende Schrägstriche werden normalisiert: "gw2_items" → "/gw2_items/".
const trimmed = (process.env.VITE_BASE ?? '/').replace(/^\/+|\/+$/g, '');
const base = trimmed ? `/${trimmed}/` : '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    // In der Entwicklung leitet Vite API-Aufrufe an den Node-Server weiter.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
