import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config (Vite = dev server + bundler). process.env.VITE_BASE is read when Vite starts, i.e. at build time.
// Base path of the app. "/" locally and in the Docker image,
// e.g. "/gw2-fractal-items/" on GitHub Pages (npm run build:pages).
// Leading and trailing slashes are normalized: "gw2-fractal-items" -> "/gw2-fractal-items/".
const trimmed = (process.env.VITE_BASE ?? '/').replace(/^\/+|\/+$/g, '');
const base = trimmed ? `/${trimmed}/` : '/';

// defineConfig only adds type hints for the config object; plugin-react enables JSX and fast refresh.
export default defineConfig({
    base,
    plugins: [react()],
    server: {
        // In development Vite forwards API calls to the Node server.
        proxy: { '/api': 'http://localhost:3000' },
    },
});
