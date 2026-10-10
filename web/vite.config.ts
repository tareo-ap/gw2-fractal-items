import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In der Entwicklung leitet Vite API-Aufrufe an den Node-Server weiter.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
