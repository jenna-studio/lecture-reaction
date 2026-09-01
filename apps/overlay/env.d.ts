/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the realtime/HTTP server. Defaults to http://localhost:8787. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
