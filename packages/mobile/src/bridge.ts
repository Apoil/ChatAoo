/**
 * 移动端桥：Capacitor Filesystem 媒体缓存 + 原生 LAN socket 插件。
 */
import { Directory, Filesystem } from '@capacitor/filesystem'
import { LanSocket } from '@chataoo/lan-socket'
import { buildBeacon, type LanAdapter, type LanConn, type MediaStore } from '@chataoo/app-core'
import type { BeaconPacket, Identity, P2PMsg } from '@chataoo/shared'

/* ---------------- 媒体（应用私有目录，断网可见） ---------------- */

export class CapacitorMedia implements MediaStore {
  platform = 'mobile' as const

  async has(sha: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path: `media/${sha}`, directory: Directory.Data })
      return true
    } catch {
      return false
    }
  }

  async write(sha: string, blob: Blob): Promise<void> {
    await Filesystem.writeFile({
      path: `media/${sha}`,
      directory: Directory.Data,
      data: await blobToBase64(blob),
    })
  }

  async url(sha: string): Promise<string> {
    const { uri } = await Filesystem.getUri({ path: `media/${sha}`, directory: Directory.Data })
    return uri
  }

  async read(sha: string): Promise<Blob | null> {
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
