/**
 * 媒体缓存抽象：附件/头像按内容 SHA-256 缓存，断网后依然可看。
 * 桌面端：Electron 主进程写 userData/media，经自定义协议 chataoo-media:// 提供；
 * 移动端：Capacitor Filesystem 写应用私有目录，file:// 直读。
 */
import type { Attachment, AttachmentKind } from '@chataoo/shared'

export interface MediaStore {
  platform: 'desktop' | 'mobile'
  has(sha256: string): Promise<boolean>
  /** 返回可直接用于 <img>/<video> 的 URL */
  url(sha256: string, mime: string): Promise<string>
  write(sha256: string, blob: Blob): Promise<void>
  read(sha256: string): Promise<Blob | null>
  /** 从服务器 URL 下载并缓存（断网时可回退本地副本） */
  cacheFromUrl(url: string, sha256: string): Promise<boolean>
  /** Electron：从本地路径流式导入，避免大视频进渲染进程内存 */
  importPath?(filePath: string): Promise<{ sha256: string; size: number }>
  pathOfFile?(file: File): string | undefined
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m4v: 'video/mp4',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
}

export function inferMime(name: string, blobType?: string): string {
  const t = blobType?.trim()
  if (t && t !== 'application/octet-stream') return t
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

/** 同步接口可能把 attachment 列（JSON 文本）原样下发，这里解成对象 */
export function parseAttachment(raw: unknown): Attachment | undefined {
  if (!raw) return undefined
  let v: unknown = raw
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try {
      v = JSON.parse(v)
    } catch {
      return undefined
    }
  }
  if (!v || typeof v !== 'object') return undefined
  const a = v as Partial<Attachment>
  if (!a.sha256 && !a.url && !a.name && !a.kind) return undefined
  return a as Attachment
}

export function displayAttachmentKind(att: Attachment): AttachmentKind {
  if (att.kind === 'image' || att.kind === 'video' || att.kind === 'audio') return att.kind
  return inferKind(att.name || '', att.mimeType || '')
}

export function inferKind(name: string, mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (/^(png|jpe?g|webp|gif|bmp|heic|heif)$/.test(ext)) return 'image'
  if (/^(mp4|webm|mov|mkv|avi|m4v|3gp)$/.test(ext)) return 'video'
  if (/^(mp3|wav|ogg|m4a|aac)$/.test(ext)) return 'audio'
  return 'file'
}

export function typedBlob(blob: Blob, mime: string): Blob {
  if (!mime || mime === 'application/octet-stream' || blob.type === mime) return blob
  return new Blob([blob], { type: mime })
}

/** Blob -> SHA-256 */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 通用下载辅助（两端共用） */
export async function downloadBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  return res.blob()
}
