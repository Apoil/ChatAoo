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
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
])

// 聊天类 UI 无需 GPU 合成加速；禁用可规避部分显卡驱动的渲染进程崩溃
app.disableHardwareAcceleration()

let mediaDir = ''
let lan: LanMain | null = null
let win: BrowserWindow | null = null

/* 窗口尺寸：登录时小窗，登录后放大为聊天窗口 */
const LOGIN_W = 440
const LOGIN_H = 640
const LOGIN_MIN_W = 420
const LOGIN_MIN_H = 560
const CHAT_W = 1200
const CHAT_H = 800
const CHAT_MIN_W = 940
const CHAT_MIN_H = 600

/** 切换窗口尺寸（渲染进程在登录状态变化时调用） */
export function resizeWindow(mode: 'login' | 'chat'): void {
  if (!win) return
  const w = mode === 'login' ? LOGIN_W : CHAT_W
  const h = mode === 'login' ? LOGIN_H : CHAT_H
  win.setMinimumSize(mode === 'login' ? LOGIN_MIN_W : CHAT_MIN_W, mode === 'login' ? LOGIN_MIN_H : CHAT_MIN_H)
  win.setSize(w, h)
  win.center()
}

function ensureMediaDir(): string {
  mediaDir = join(app.getPath('userData'), 'media')
  mkdirSync(mediaDir, { recursive: true })
  return mediaDir
}

function parseMediaUrl(reqUrl: string): { hash: string; mime: string } | null {
  try {
    const u = new URL(reqUrl)
    const hash = u.hostname === 'local' ? u.pathname.replace(/^\/+|\/+$/g, '') : u.hostname
    if (!/^[a-f0-9]{64}$/i.test(hash)) return null
    return { hash, mime: u.searchParams.get('t') || 'application/octet-stream' }
  } catch {
    return null
  }
}

function sniffMime(filePath: string, fallback: string): string {
  if (fallback && fallback !== 'application/octet-stream') return fallback
  const head = Buffer.alloc(16)
  const fd = openSync(filePath, 'r')
  try {
    readSync(fd, head, 0, 16, 0)
  } finally {
    closeSync(fd)
  }
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg'
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png'
  if (head[0] === 0x47 && head[1] === 0x49) return 'image/gif'
  if (head[0] === 0x52 && head[8] === 0x57 && head[9] === 0x45) return 'image/webp'
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'video/mp4'
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf) return 'video/webm'
  return fallback
}

function serveMedia(req: Request): Response {
  const parsed = parseMediaUrl(req.url)
  if (!parsed) return new Response('bad media url', { status: 400 })
  const filePath = join(ensureMediaDir(), parsed.hash)
  if (!existsSync(filePath)) return new Response('not found', { status: 404 })
  const mime = sniffMime(filePath, parsed.mime)
  const { size } = statSync(filePath)
  let start = 0
  let end = size - 1
  let status = 200
  const range = req.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (m) {
      start = m[1] ? Number(m[1]) : 0
      end = m[2] ? Number(m[2]) : size - 1
      if (start >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
        })
      }
      status = 206
    }
  }
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  const stream = createReadStream(filePath, { start, end })
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers })
}

function createWindow(): void {
  // 图标：开发时在仓库根 assets/，打包后随应用分发
  const iconCandidates = [
    join(app.getAppPath(), '..', '..', 'assets', 'icons', 'icon.ico'),
    join(app.getAppPath(), 'assets', 'icons', 'icon.ico'),
  ]
  const iconPath = iconCandidates.find((p) => existsSync(p))

  win = new BrowserWindow({
    width: LOGIN_W,
    height: LOGIN_H,
    minWidth: LOGIN_MIN_W,
    minHeight: LOGIN_MIN_H,
    title: 'ChatAoo',
    backgroundColor: '#f3eee6',
    icon: iconPath,
    autoHideMenuBar: true,
    // 无边框 + 系统标题栏按钮覆盖层（颜色与主题一致）
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#faf7f2',
      symbolColor: '#6a645a',
      height: 44,
    },
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
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
  // 记录窗口关闭时机（区分手动关闭与异常）
  win.on('close', () => {
    console.error(`[main] window close requested at ${new Date().toISOString()}`)
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
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['log', 'info', 'warn', 'error'][level] ?? 'log'
    console.error(`[renderer:${tag}] ${message} (${sourceId ?? ''}:${line ?? ''})`)
  })
}

/* ---------------- 媒体缓存 ---------------- */

function mediaFile(sha: unknown): string | null {
  if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/i.test(sha)) return null
  return join(ensureMediaDir(), sha)
}

ipcMain.handle('media:has', (_e, sha: string) => {
  const p = mediaFile(sha)
  return !!p && existsSync(p)
})
ipcMain.handle('media:write', (_e, sha: string, buf: ArrayBuffer) => {
  const p = mediaFile(sha)
  if (!p) throw new Error('invalid media hash')
  writeFileSync(p, Buffer.from(buf))
})
ipcMain.handle('media:read', (_e, sha: string) => {
  const p = mediaFile(sha)
  if (!p || !existsSync(p)) return null
  const buf = readFileSync(p)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
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
ipcMain.handle('media:importPath', async (_e, srcPath: string) => {
  const dir = ensureMediaDir()
  const tmp = join(dir, `.in-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const hash = createHash('sha256')
  let size = 0
  await pipeline(
    createReadStream(srcPath),
    new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk)
        size += chunk.length
        cb(null, chunk)
      },
    }),
    createWriteStream(tmp),
  )
  const sha256 = hash.digest('hex')
  const dest = join(dir, sha256)
  if (existsSync(dest)) unlinkSync(tmp)
  else renameSync(tmp, dest)
  return { sha256, size }
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
  if (!win) return 'cancelled'
  const result = await dialog.showSaveDialog(win, { defaultPath: name || 'file' })
  if (result.canceled || !result.filePath) return 'cancelled'
  if (url.startsWith(`${MEDIA_SCHEME}://`)) {
    const parsed = parseMediaUrl(url)
    if (parsed) {
      const src = join(ensureMediaDir(), parsed.hash)
      if (existsSync(src)) {
        copyFileSync(src, result.filePath)
        void shell.showItemInFolder(result.filePath)
        return 'saved'
      }
    }
  }
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  writeFileSync(result.filePath, Buffer.from(await res.arrayBuffer()))
  void shell.showItemInFolder(result.filePath)
  return 'saved'
})
ipcMain.handle('win:resize', (_e, mode: 'login' | 'chat') => resizeWindow(mode))

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

  protocol.handle(MEDIA_SCHEME, (req) => serveMedia(req))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  console.error(`[main] all windows closed at ${new Date().toISOString()}`)
  lan?.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  console.error(`[main] app quitting at ${new Date().toISOString()}`)
})
