import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ChatSession } from '@chataoo/app-core'
import '@chataoo/ui/theme.css'
import App from './App.vue'
import { CapacitorLan, CapacitorMedia } from './bridge'

async function bootstrap(): Promise<void> {
  const serverUrl = localStorage.getItem('chataoo:serverUrl') ?? 'http://192.168.1.146:47800'

  const platform = {
    platform: 'mobile' as const,
    serverUrl,
    media: new CapacitorMedia(),
    lan: new CapacitorLan(),
    openExternal: (url: string) => {
      // 移动端：用系统浏览器打开
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      a.click()
    },
    saveFile: (name: string, url: string) => {
      // 移动端：触发下载/分享（系统处理）
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
    },
  }

  const session = await ChatSession.create(platform)

  const app = createApp(App)
  app.use(createPinia())
  app.provide('session', session)
  app.mount('#app')
}

void bootstrap().catch((e) => {
  console.error('bootstrap failed:', e)
  document.body.innerHTML = `<pre style="color:#f87171;padding:40px;white-space:pre-wrap">启动失败：${String(e)}</pre>`
})
