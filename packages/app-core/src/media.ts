/**
 * 媒体缓存抽象：附件/头像按内容 SHA-256 缓存，断网后依然可看。
 * 桌面端：Electron 主进程写 userData/media，经自定义协议 chataoo-media:// 提供；
 * 移动端：Capacitor Filesystem 写应用私有目录，file:// 直读。
 */
export interface MediaStore {
  platform: 'desktop' | 'mobile'
  has(sha256: string): Promise<boolean>
  /** 返回可直接用于 <img>/<video> 的 URL */
  url(sha256: string, mime: string): Promise<string>
  write(sha256: string, blob: Blob): Promise<void>
  read(sha256: string): Promise<Blob | null>
  /** 从服务器 URL 下载并缓存（断网时可回退本地副本） */
  cacheFromUrl(url: string, sha256: string): Promise<boolean>
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
