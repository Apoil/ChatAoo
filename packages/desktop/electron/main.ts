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

// 必须在 app ready 之前注册自定义协议
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } },
])

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
    void win.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
  }

  win.on('closed', () => {
    win = null
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
