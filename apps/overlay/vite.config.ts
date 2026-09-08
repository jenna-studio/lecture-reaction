import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri drives this dev server, so its port has to match tauri.conf.json's
// devUrl. `pnpm desktop` resolves a free port and passes it through
// LR_OVERLAY_PORT while overriding devUrl to match, so a port already taken by
// another project steps aside instead of failing the run.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@lr/shared` is source-only TypeScript in the workspace.
  optimizeDeps: { exclude: ['@lr/shared'] },
  server: {
    port: Number(process.env.LR_OVERLAY_PORT) || 5174,
    strictPort: true,
    host: true, // dual-stack (::), so nothing else can share the port on the other stack
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022', sourcemap: true },
  clearScreen: false,
});
