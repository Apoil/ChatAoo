/**
 * Electron 主进程：窗口、媒体缓存协议（chataoo-media://）、LAN、IPC。
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LanMain } from './lan.js'

const MEDIA_SCHEME = 'chataoo-media'
const APP_SCHEME = 'app'

// 必须在 app ready 之前注册自定义协议
//  - app://：生产模式页面加载协议（secure context，crypto.subtle / randomUUID 可用，
//    避免 file:// 非安全上下文导致头像哈希等能力失效）
//  - chataoo-media://：本地媒体缓存
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: MEDIA_SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } },
])

// 聊天类 UI 无需 GPU 合成加速；禁用可规避部分显卡驱动的渲染进程崩溃
app.disableHardwareAcceleration()

let mediaDir = ''
let lan: LanMain | null = null
let win: BrowserWindow | null = null

function ensureMediaDir(): string {
  mediaDir = join(app.getPath('userData'), 'media')
  mkdirSync(mediaDir, { recursive: true })
  return mediaDir
}

function createWindow(): void {
  // 图标：开发时在仓库根 assets/，打包后随应用分发
  const iconCandidates = [
    join(app.getAppPath(), '..', '..', 'assets', 'icons', 'icon.ico'),
    join(app.getAppPath(), 'assets', 'icons', 'icon.ico'),
  ]
  const iconPath = iconCandidates.find((p) => existsSync(p))

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    title: 'ChatAoo',
    backgroundColor: '#111417',
    icon: iconPath,
    autoHideMenuBar: true,
    // 无边框 + 系统标题栏按钮覆盖层（颜色与主题一致）
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171b20',
      symbolColor: '#9aa4b1',
      height: 44,
    },
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    // 生产模式：通过安全的 app:// 协议加载（secure context）
    void win.loadURL(`${APP_SCHEME}://bundle/index.html`)
  }

  win.on('closed', () => {
    win = null
  })

  // 崩溃/异常诊断与自动恢复
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('render-process-gone:', JSON.stringify(details))
    // 崩溃后自动重建窗口恢复
    setTimeout(() => {
      if (!win) createWindow()
    }, 800)
  })
  win.webContents.on('unresponsive', () => {
    console.error('renderer unresponsive')
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`)
  })
}

/* ---------------- 媒体缓存 ---------------- */

ipcMain.handle('media:has', (_e, sha: string) => existsSync(join(ensureMediaDir(), sha)))
ipcMain.handle('media:write', (_e, sha: string, buf: ArrayBuffer) => {
  writeFileSync(join(ensureMediaDir(), sha), Buffer.from(buf))
})
ipcMain.handle('media:read', (_e, sha: string) => {
  const p = join(ensureMediaDir(), sha)
  return existsSync(p) ? readFileSync(p).buffer : null
})
ipcMain.handle('media:cache', async (_e, url: string, sha: string) => {
  try {
    const res = await net.fetch(url)
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(join(ensureMediaDir(), sha), buf)
    return true
  } catch {
    return false
  }
})

/* ---------------- LAN ---------------- */

ipcMain.handle('lan:start', async (e) => {
  lan = new LanMain(e.sender)
  await lan.start()
})
ipcMain.handle('lan:stop', () => {
  lan?.stop()
  lan = null
})
ipcMain.handle('lan:sendBeacon', (_e, packet: unknown) => lan?.sendBeacon(packet))
ipcMain.handle('lan:connect', (_e, host: string) => lan?.connect(host))
ipcMain.handle('lan:send', (_e, connId: string, line: string) => lan?.send(connId, line))
ipcMain.handle('lan:closeConn', (_e, connId: string) => lan?.closeConn(connId))

/* ---------------- 系统能力 ---------------- */

ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url))
ipcMain.handle('app:saveFile', async (_e, name: string, url: string) => {
  const result = await dialog.showSaveDialog(win ?? undefined!, { defaultPath: name })
  if (result.canceled || !result.filePath) return
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(result.filePath, buf)
  void shell.openPath(result.filePath)
})

/* ---------------- 启动 ---------------- */

void app.whenReady().then(() => {
  // 生产模式：app://bundle/ 映射到 dist 目录
  const distDir = join(app.getAppPath(), 'dist')
  protocol.handle(APP_SCHEME, (req) => {
    const url = new URL(req.url)
    let path = url.pathname === '/' ? '/index.html' : url.pathname
    if (!path.startsWith('/')) path = '/' + path
    return net.fetch(pathToFileURL(join(distDir, path)).toString())
  })

  protocol.handle(MEDIA_SCHEME, (req) => {
    const hash = req.url.replace(`${MEDIA_SCHEME}://`, '').split('?')[0] ?? ''
    return net.fetch(pathToFileURL(join(ensureMediaDir(), hash)).toString())
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  lan?.stop()
  if (process.platform !== 'darwin') app.quit()
})
