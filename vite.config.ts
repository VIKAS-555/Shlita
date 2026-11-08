/// <reference types="vitest" />
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3000,
    host: true,
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
  },
});
