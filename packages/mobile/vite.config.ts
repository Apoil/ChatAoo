import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    target: 'chrome100',
  },
  server: {
    port: 8100,
    strictPort: true,
  },
})
