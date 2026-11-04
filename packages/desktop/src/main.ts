import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ChatSession } from '@chataoo/app-core'
import { initTheme } from '@chataoo/ui'
import '@chataoo/ui/theme.css'
import App from './App.vue'
import { DesktopLan, DesktopMedia, type ChataooBridge } from './bridge'

async function bootstrap(): Promise<void> {
  // 主题必须在挂载前应用，避免首帧闪烁（html[data-theme] 由 theme.ts 写入）
  initTheme()

  const bridge = window.chataoo as ChataooBridge
  const serverUrl = localStorage.getItem('chataoo:serverUrl') ?? 'http://127.0.0.1:47800'

  const platform = {
    platform: 'desktop' as const,
    serverUrl,
    media: new DesktopMedia(bridge),
    lan: new DesktopLan(bridge),
    openExternal: (url: string) => void bridge.app.openExternal(url),
    saveFile: (name: string, url: string) => bridge.app.saveFile(name, url),
  }

  const session = await ChatSession.create(platform)

  // 已登录 → 直接放大到聊天窗口；未登录 → 保持登录小窗
  if (session.authed) void bridge.win.resize('chat')

  const app = createApp(App)
  app.use(createPinia())
  app.provide('session', session)
  app.mount('#app')
}

void bootstrap().catch((e) => {
  console.error('bootstrap failed:', e)
  document.body.innerHTML = `<pre style="color:var(--danger);padding:var(--s-10)">启动失败：${String(e)}</pre>`
})
