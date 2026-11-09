import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ChatSession } from '@chataoo/app-core'
import { initTheme } from '@chataoo/ui'
import '@chataoo/ui/theme.css'
import App from './App.vue'
import { WebLan, WebMedia, saveFileToBrowser } from './bridge'

async function bootstrap(): Promise<void> {
  // 主题要在首帧前定好，避免深色系统先闪一下白底
  initTheme()

  // 生产环境由同步服务器托管本页面，默认就用同源地址；开发时可用 ?server= 或登录页改
  const fallback = import.meta.env.DEV ? 'http://127.0.0.1:47800' : location.origin
  const serverUrl = localStorage.getItem('chataoo:serverUrl') ?? fallback

  const platform = {
    platform: 'mobile' as const,
    serverUrl,
    media: new WebMedia(),
    lan: new WebLan(),
    openExternal: (url: string) => {
      window.open(url, '_blank', 'noopener')
    },
    saveFile: (name: string, url: string) => saveFileToBrowser(name, url),
  }

  const session = await ChatSession.create(platform)

  const app = createApp(App)
  app.use(createPinia())
  app.provide('session', session)
  app.mount('#app')
}

void bootstrap().catch((e) => {
  console.error('bootstrap failed:', e)
  document.body.innerHTML = `<pre style="color:#d0342c;padding:40px;white-space:pre-wrap">启动失败：${String(e)}</pre>`
})
