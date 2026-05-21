import { defineConfig } from 'vite';

export default defineConfig({
  base: '/FakeDexTrader/',
  server: {
    port: 5173,
    open: false,
  },
});
