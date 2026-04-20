import { defineConfig } from 'vite';

const serverPort = process.env.PORT || 3457;

export default defineConfig({
  root: 'client',
  server: {
    proxy: {
      '/api': `http://localhost:${serverPort}`,
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
