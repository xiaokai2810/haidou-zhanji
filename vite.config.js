import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/haidou-zhanji/' : '/',
  build: {
    rollupOptions: {
      input: {
        squad: fileURLToPath(new URL('./squad.html', import.meta.url)),
        classic: fileURLToPath(new URL('./classic.html', import.meta.url)),
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        duel: fileURLToPath(new URL('./duel.html', import.meta.url)),
      },
    },
  },
});
