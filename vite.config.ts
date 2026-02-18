import { defineConfig } from 'vite';
import path from 'path';

/**
 * Vite configuration for the Tactical Commander game client.
 * Sets up path aliases so we can import shared code between client and server.
 */
export default defineConfig({
  /* The client source lives in client/ */
  root: 'client',

  resolve: {
    alias: {
      /* Allow importing shared types/constants with @shared/ prefix */
      '@shared': path.resolve(__dirname, 'shared'),
      /* Allow importing client modules with @client/ prefix */
      '@client': path.resolve(__dirname, 'client/src'),
    },
  },

  server: {
    /* Dev server port - open http://localhost:3000 to play */
    port: 3000,
    open: true,
  },

  build: {
    /* Build output goes to dist/ at project root */
    outDir: '../dist',
    emptyOutDir: true,
  },
});
