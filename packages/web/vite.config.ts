import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Web 版：由同步服务器（Fastify）托管 dist，因此使用绝对根路径。
export default defineConfig({
  base: '/',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    target: 'chrome100',
  },
  server: {
    port: 8101,
    strictPort: true,
  },
})
