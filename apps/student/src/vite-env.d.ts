/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin of the realtime server; dev-only escape hatch. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
