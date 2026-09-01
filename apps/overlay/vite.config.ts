import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri drives this dev server; the port must stay fixed and predictable.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@lr/shared` is source-only TypeScript in the workspace.
  optimizeDeps: { exclude: ['@lr/shared'] },
  server: {
    port: 5174,
    strictPort: true,
    host: '0.0.0.0',
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022', sourcemap: true },
  clearScreen: false,
});
