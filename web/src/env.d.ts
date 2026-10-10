/// <reference types="vite/client" />

// Datenmodus, beim Build festgelegt: "api" (Standard) lädt von /api/*, "static" liest die JSON-Dateien
// aus data/ (GitHub Pages, schreibgeschützt). Siehe npm run build:pages.
interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'api' | 'static';
  readonly VITE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
