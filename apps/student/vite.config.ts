import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER_ORIGIN = 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Phones on the lecture-hall LAN need to reach the dev server directly.
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/ws': { target: SERVER_ORIGIN, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
