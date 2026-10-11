import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path of the app. "/" locally and in the Docker image, e.g. "/gw2_items/" on GitHub Pages (npm run build:pages).
// Leading and trailing slashes are normalized: "gw2_items" -> "/gw2_items/".
const trimmed = (process.env.VITE_BASE ?? '/').replace(/^\/+|\/+$/g, '');
const base = trimmed ? `/${trimmed}/` : '/';

export default defineConfig({
    base,
    plugins: [react()],
    server: {
        // In development Vite forwards API calls to the Node server.
        proxy: { '/api': 'http://localhost:3000' },
    },
});
