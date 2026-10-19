import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome120',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
