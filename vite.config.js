import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/haidou-zhanji/' : '/',
  build: {
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        duel: fileURLToPath(new URL('./duel.html', import.meta.url)),
      },
    },
  },
});
