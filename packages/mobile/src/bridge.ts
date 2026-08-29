/**
 * 移动端桥：Capacitor Filesystem 媒体缓存 + 原生 LAN socket 插件。
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { LanSocket } from '@chataoo/lan-socket'
import { buildBeacon, type LanAdapter, type LanConn, type MediaStore } from '@chataoo/app-core'
import type { BeaconPacket, Identity, P2PMsg } from '@chataoo/shared'

/* ---------------- 媒体：IndexedDB 保底，Filesystem 可用则再写一份 ---------------- */

const memory = new Map<string, Blob>()
const objectUrls = new Map<string, string>()

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('chataoo-media', 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('blobs')) req.result.createObjectStore('blobs')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(sha: string, blob: Blob): Promise<void> {
  const db = await openMediaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('blobs', 'readwrite')
    tx.objectStore('blobs').put(blob, sha)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet(sha: string): Promise<Blob | null> {
  const db = await openMediaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readonly')
    const req = tx.objectStore('blobs').get(sha)
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

function nativeFs(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Filesystem')
}

export class CapacitorMedia implements MediaStore {
  platform = 'mobile' as const

  async has(sha: string): Promise<boolean> {
    if (memory.has(sha)) return true
    try {
      if (await idbGet(sha)) return true
    } catch {
      /* ignore */
    }
    if (!nativeFs()) return false
    try {
      await Filesystem.stat({ path: `media/${sha}`, directory: Directory.Data })
      return true
    } catch {
      return false
    }
  }

  async write(sha: string, blob: Blob): Promise<void> {
    memory.set(sha, blob)
    for (const [k, u] of [...objectUrls]) {
      if (k === sha || k.startsWith(`${sha}::`)) {
        URL.revokeObjectURL(u)
        objectUrls.delete(k)
      }
    }
    try {
      await idbPut(sha, blob)
    } catch (e) {
      console.warn('idb media write failed:', e)
    }
    // 大文件转 base64 会 OOM，视频只走 IndexedDB
    if (!nativeFs() || blob.size > 6 * 1024 * 1024) return
    try {
      await Filesystem.mkdir({ path: 'media', directory: Directory.Data, recursive: true })
    } catch {
      /* 目录已存在 */
    }
    try {
      await Filesystem.writeFile({
        path: `media/${sha}`,
        directory: Directory.Data,
        data: await blobToBase64(blob),
        recursive: true,
      })
    } catch (e) {
      console.warn('filesystem write skipped:', e)
    }
  }

  async url(sha: string, mime = 'application/octet-stream'): Promise<string> {
    const key = `${sha}::${mime}`
    const cached = objectUrls.get(key) ?? objectUrls.get(sha)
    if (cached) return cached
    let blob = memory.get(sha) ?? (await idbGet(sha).catch(() => null))
    if (blob) {
      if (mime && mime !== 'application/octet-stream' && blob.type !== mime) {
        blob = new Blob([blob], { type: mime })
      }
      const u = URL.createObjectURL(blob)
      objectUrls.set(key, u)
      return u
    }
    if (!nativeFs()) throw new Error('media not found')
    const { uri } = await Filesystem.getUri({ path: `media/${sha}`, directory: Directory.Data })
    return Capacitor.convertFileSrc(uri)
  }

  async read(sha: string): Promise<Blob | null> {
    if (memory.has(sha)) return memory.get(sha)!
    const fromIdb = await idbGet(sha).catch(() => null)
    if (fromIdb) return fromIdb
    if (!nativeFs()) return null
    try {
      const { data } = await Filesystem.readFile({ path: `media/${sha}`, directory: Directory.Data })
      return typeof data === 'string' ? base64ToBlob(data) : data
    } catch {
      return null
    }
  }

  async cacheFromUrl(url: string, sha: string): Promise<boolean> {
    try {
      const res = await fetch(url)
      if (!res.ok) return false
      await this.write(sha, await res.blob())
      return true
    } catch {
      return false
    }
  }
}

function sanitizeFilename(name: string, mime = ''): string {
  let n = (name || '').replace(/[\\/:*?"<>|]/g, '_').trim()
  if (!n || n === '-') {
    const ext =
      mime === 'image/jpeg' ? 'jpg'
      : mime === 'image/png' ? 'png'
      : mime === 'image/webp' ? 'webp'
      : mime === 'image/gif' ? 'gif'
      : mime === 'video/mp4' ? 'mp4'
      : mime === 'video/webm' ? 'webm'
      : mime.startsWith('image/') ? 'jpg'
      : mime.startsWith('video/') ? 'mp4'
      : 'bin'
    n = `${mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'file'}-${Date.now()}.${ext}`
  }
  return n
}

async function blobFromUrl(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  return res.blob()
}

/** 保存到系统：能分享则走系统分享（可存相册）；否则写入文档目录 */
export async function saveFileToDevice(name: string, url: string): Promise<'saved' | 'shared' | 'cancelled'> {
  const blob = await blobFromUrl(url)
  const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'application/octet-stream'
  const safe = sanitizeFilename(name, mime)
  const file = new File([blob], safe, { type: mime || 'application/octet-stream' })

  try {
    if (typeof navigator.share === 'function') {
      if (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: safe })
        return 'shared'
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled'
  }

  if (!nativeFs()) throw new Error('filesystem unavailable')

  try {
    await Filesystem.requestPermissions()
  } catch {
    /* 部分机型无此权限接口 */
  }

  const media = mime.startsWith('image/') || mime.startsWith('video/')
  const attempts: { directory: Directory; path: string }[] = media
    ? [
        { directory: Directory.ExternalStorage, path: `Pictures/ChatAoo/${safe}` },
        { directory: Directory.Documents, path: `ChatAoo/${safe}` },
      ]
    : [{ directory: Directory.Documents, path: `ChatAoo/${safe}` }]

  if (blob.size > 8 * 1024 * 1024) {
    throw new Error('file too large to copy; use share')
  }

  let lastErr: unknown
  for (const a of attempts) {
    try {
      const dir = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/')) : ''
      if (dir) {
        await Filesystem.mkdir({ path: dir, directory: a.directory, recursive: true }).catch(() => {})
      }
      await Filesystem.writeFile({
        path: a.path,
        data: await blobToBase64(blob),
        directory: a.directory,
        recursive: true,
      })
      return 'saved'
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('save failed')
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function base64ToBlob(b64: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes])
}

/* ---------------- LAN（原生插件） ---------------- */

export class CapacitorLan implements LanAdapter {
  kind = 'mobile' as const
  private beaconCb: ((packet: BeaconPacket, host: string) => void) | null = null
  private connCb: ((conn: LanConn) => void) | null = null
  /** 连接表：CapacitorConn 需要访问 */
  readonly conns = new Map<string, CapacitorConn>()
  private started = false
  private beaconTimer: ReturnType<typeof setInterval> | null = null

  async start(identity: Identity): Promise<void> {
    if (this.started) return
    this.started = true

    void LanSocket.addListener('beacon', (d) => {
      try {
        this.beaconCb?.(JSON.parse(d.packet) as BeaconPacket, d.host)
      } catch {
        /* ignore */
      }
    })
    void LanSocket.addListener('conn', (d) => {
      const conn = new CapacitorConn(d.connId, this)
      this.conns.set(d.connId, conn)
      this.connCb?.(conn)
    })
    void LanSocket.addListener('data', (d) => {
      this.conns.get(d.connId)?.onData(d.line)
    })
    void LanSocket.addListener('closed', (d) => {
      this.conns.get(d.connId)?.onClosed()
    })

    await LanSocket.start()

    // 首次广播 + 定期重新签名（信标带时间戳，防重放）
    const beacon = async (): Promise<void> => {
      try {
        const p = await buildBeacon(identity)
        await LanSocket.sendBeacon(JSON.stringify(p))
      } catch {
        /* ignore */
      }
    }
    void beacon()
    this.beaconTimer = setInterval(() => void beacon(), 60000)
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    if (this.beaconTimer) clearInterval(this.beaconTimer)
    this.beaconTimer = null
    await LanSocket.stop()
    this.conns.clear()
  }

  onBeacon(cb: (packet: BeaconPacket, host: string) => void): void {
    this.beaconCb = cb
  }

  onConnection(cb: (conn: LanConn) => void): void {
    this.connCb = cb
  }

  async connect(host: string, _port: number): Promise<LanConn> {
    const { connId } = await LanSocket.connect(host)
    const conn = new CapacitorConn(connId, this)
    this.conns.set(connId, conn)
    return conn
  }
}

export class CapacitorConn implements LanConn {
  id: string
  peerUserId?: string
  private msgCb: ((msg: P2PMsg) => void) | null = null
  private closeCb: (() => void) | null = null

  constructor(
    id: string,
    private lan: CapacitorLan,
  ) {
    this.id = id
  }

  send(msg: P2PMsg): void {
    void LanSocket.send(this.id, JSON.stringify(msg))
  }

  close(): void {
    void LanSocket.closeConn(this.id)
  }

  onMessage(cb: (msg: P2PMsg) => void): void {
    this.msgCb = cb
  }

  onClose(cb: () => void): void {
    this.closeCb = cb
  }

  onData(line: string): void {
    try {
      this.msgCb?.(JSON.parse(line) as P2PMsg)
    } catch {
      /* ignore */
    }
  }

  onClosed(): void {
    this.lan.conns.delete(this.id)
    this.closeCb?.()
  }
}
