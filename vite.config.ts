import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/tmp/**', '**/release-final/**', '**/.venv/**'] },
  },
  build: { outDir: 'dist' },
});
