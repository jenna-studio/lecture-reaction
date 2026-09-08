import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER_ORIGIN = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Phones on the lecture-hall LAN need to reach the dev server directly.
    host: true,
    // Nothing points at this port by hard-coded URL, so if another project
    // already owns 5173 vite may simply take the next one.
    port: Number(process.env.LR_STUDENT_PORT) || 5173,
    strictPort: false,
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/ws': { target: SERVER_ORIGIN, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
