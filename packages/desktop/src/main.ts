import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ChatSession } from '@chataoo/app-core'
import '@chataoo/ui/theme.css'
import App from './App.vue'
import { DesktopLan, DesktopMedia, type ChataooBridge } from './bridge'

async function bootstrap(): Promise<void> {
  const bridge = window.chataoo as ChataooBridge
  const serverUrl = localStorage.getItem('chataoo:serverUrl') ?? 'http://127.0.0.1:47800'

  const platform = {
    platform: 'desktop' as const,
    serverUrl,
    media: new DesktopMedia(bridge),
    lan: new DesktopLan(bridge),
    openExternal: (url: string) => void bridge.app.openExternal(url),
    saveFile: (name: string, url: string) => void bridge.app.saveFile(name, url),
  }

  const session = await ChatSession.create(platform)

  const app = createApp(App)
  app.use(createPinia())
  app.provide('session', session)
  app.mount('#app')
}

void bootstrap().catch((e) => {
  console.error('bootstrap failed:', e)
  document.body.innerHTML = `<pre style="color:#f87171;padding:40px">启动失败：${String(e)}</pre>`
})
