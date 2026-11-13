/// <reference types="vitest" />
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/v1': 'http://127.0.0.1:4000',
      '/health': 'http://127.0.0.1:4000',
    },
  },
  build: {
    outDir: 'dist-ui',
  },
  test: {
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.browser.test.ts'],
  },
});
