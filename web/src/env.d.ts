/// <reference types="vite/client" />

// Data mode, fixed at build time: "api" (default) loads from /api/*, "static" reads the JSON files
// from data/ (GitHub Pages, read-only). See npm run build:pages.
interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'api' | 'static';
  readonly VITE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
