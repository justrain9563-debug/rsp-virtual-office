import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared') } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': api,
      '/socket.io': { target: api, ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
