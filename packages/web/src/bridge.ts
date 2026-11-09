/**
 * Web 版桥接：
 *  - 媒体缓存用 IndexedDB（浏览器里没有 Filesystem 插件），url() 返回 objectURL
 *  - 局域网直连不可用：浏览器无法加入 UDP 组播 / 打开 TCP 监听，LanAdapter 是空实现
 *    （聊天、文件、实时同步仍然全部可用，走服务器 WebSocket / HTTP）
 */
import type { LanAdapter, LanConn, MediaStore } from '@chataoo/app-core'

const DB_NAME = 'chataoo-media-web'
const DB_VERSION = 1
const STORE = 'blobs'

const memory = new Map<string, Blob>()
const objectUrls = new Map<string, string>()

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(sha: string, blob: Blob): Promise<void> {
  const db = await openMediaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, sha)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet(sha: string): Promise<Blob | null> {
  const db = await openMediaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(sha)
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export class WebMedia implements MediaStore {
  platform = 'mobile' as const

  async has(sha: string): Promise<boolean> {
    if (memory.has(sha)) return true
    try {
      return (await idbGet(sha)) !== null
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
      console.warn('web media: IndexedDB 写入失败，仅保留内存副本', e)
    }
  }

  async url(sha: string, mime = 'application/octet-stream'): Promise<string> {
    const key = `${sha}::${mime}`
    const cached = objectUrls.get(key) ?? objectUrls.get(sha)
    if (cached) return cached
    let blob = memory.get(sha) ?? (await idbGet(sha).catch(() => null))
    if (!blob) throw new Error('media not found')
    if (mime && mime !== 'application/octet-stream' && blob.type !== mime) {
      blob = new Blob([blob], { type: mime })
    }
    const u = URL.createObjectURL(blob)
    objectUrls.set(key, u)
    return u
  }

  async read(sha: string): Promise<Blob | null> {
    return memory.get(sha) ?? (await idbGet(sha).catch(() => null))
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

/** 浏览器没有 UDP 组播 / TCP 监听能力，局域网直连降级为空实现。 */
export class WebLan implements LanAdapter {
  kind = 'mobile' as const

  async start(): Promise<void> {
    console.info('[ChatAoo web] 局域网直连在网页版不可用（浏览器限制），将只使用服务器通道')
  }
  async stop(): Promise<void> {}
  onBeacon(): void {}
  onConnection(): void {}
  async connect(): Promise<LanConn> {
    throw new Error('网页版不支持局域网直连')
  }
}

/** 浏览器保存附件：同源文件直接下载，跨域文件开新标签。 */
export function saveFileToBrowser(name: string, url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  if (new URL(url, location.href).origin !== location.origin) a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
