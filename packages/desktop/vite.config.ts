import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    target: 'chrome120',
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
})
