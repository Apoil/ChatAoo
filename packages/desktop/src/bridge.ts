/**
 * 渲染进程桥：把 preload 暴露的 IPC 封装成 app-core 的 MediaStore / LanAdapter。
 */
import type {
  BeaconPacket,
  Identity,
  P2PMsg,
} from '@chataoo/shared'
import { buildBeacon, type LanAdapter, type LanConn, type MediaStore } from '@chataoo/app-core'

export interface ChataooBridge {
  platform: 'desktop'
  media: {
    has(sha: string): Promise<boolean>
    write(sha: string, buf: ArrayBuffer): Promise<void>
    read(sha: string): Promise<ArrayBuffer | null>
    cache(url: string, sha: string): Promise<boolean>
    url(sha: string): string
  }
  lan: {
    start(): Promise<void>
    stop(): Promise<void>
    sendBeacon(packet: unknown): Promise<void>
    connect(host: string): Promise<string | undefined>
    send(connId: string, line: string): Promise<void>
    closeConn(connId: string): Promise<void>
    onBeacon(cb: (packet: unknown, host: string) => void): () => void
    onConn(cb: (connId: string) => void): () => void
    onData(cb: (connId: string, line: string) => void): () => void
    onClosed(cb: (connId: string) => void): () => void
  }
  app: {
    openExternal(url: string): Promise<void>
    saveFile(name: string, url: string): Promise<void>
  }
}

declare global {
  interface Window {
    chataoo?: ChataooBridge
  }
}

export class DesktopMedia implements MediaStore {
  platform = 'desktop' as const

  constructor(private bridge: ChataooBridge) {}

  has(sha: string): Promise<boolean> {
    return this.bridge.media.has(sha)
  }

  url(sha: string): Promise<string> {
    return Promise.resolve(this.bridge.media.url(sha))
  }

  async write(sha: string, blob: Blob): Promise<void> {
    await this.bridge.media.write(sha, await blob.arrayBuffer())
  }

  async read(sha: string): Promise<Blob | null> {
    const buf = await this.bridge.media.read(sha)
    return buf ? new Blob([buf]) : null
  }

  async cacheFromUrl(url: string, sha: string): Promise<boolean> {
    return this.bridge.media.cache(url, sha)
  }
}

export class DesktopLan implements LanAdapter {
  kind = 'desktop' as const
  private unsubs: (() => void)[] = []
  private beaconCb: ((packet: BeaconPacket, host: string) => void) | null = null
  private connCb: ((conn: LanConn) => void) | null = null
  private started = false
  private beaconTimer: ReturnType<typeof setInterval> | null = null

  constructor(private bridge: ChataooBridge) {}

  async start(identity: Identity): Promise<void> {
    if (this.started) return
    this.started = true
    const lan = this.bridge.lan

    this.unsubs.push(
      lan.onBeacon((packet, host) => {
        this.beaconCb?.(packet as BeaconPacket, host)
      }),
      lan.onConn((connId) => {
        const conn = new DesktopConn(connId, this.bridge)
        this.connCb?.(conn)
      }),
    )
    await lan.start()

    // 周期广播带签名的信标
    const tick = async (): Promise<void> => {
      try {
        const p = await buildBeacon(identity)
        await lan.sendBeacon(p)
      } catch {
        /* ignore */
      }
    }
    void tick()
    this.beaconTimer = setInterval(() => void tick(), 4000)
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    if (this.beaconTimer) clearInterval(this.beaconTimer)
    this.beaconTimer = null
    for (const u of this.unsubs) u()
    this.unsubs = []
    await this.bridge.lan.stop()
  }

  onBeacon(cb: (packet: BeaconPacket, host: string) => void): void {
    this.beaconCb = cb
  }

  onConnection(cb: (conn: LanConn) => void): void {
    this.connCb = cb
  }

  async connect(host: string, _port: number): Promise<LanConn> {
    const connId = await this.bridge.lan.connect(host)
    if (!connId) throw new Error('connect failed')
    return new DesktopConn(connId, this.bridge)
  }
}

export class DesktopConn implements LanConn {
  id: string
  private msgCb: ((msg: P2PMsg) => void) | null = null
  private closeCb: (() => void) | null = null
  private unsubs: (() => void)[] = []

  constructor(
    id: string,
    private bridge: ChataooBridge,
  ) {
    this.id = id
    const lan = bridge.lan
    this.unsubs.push(
      lan.onData((connId, line) => {
        if (connId !== id) return
        try {
          this.msgCb?.(JSON.parse(line) as P2PMsg)
        } catch {
          /* 忽略坏帧 */
        }
      }),
      lan.onClosed((connId) => {
        if (connId !== id) return
        this.closeCb?.()
        this.dispose()
      }),
    )
  }

  send(msg: P2PMsg): void {
    void this.bridge.lan.send(this.id, JSON.stringify(msg))
  }

  close(): void {
    void this.bridge.lan.closeConn(this.id)
    this.dispose()
  }

  onMessage(cb: (msg: P2PMsg) => void): void {
    this.msgCb = cb
  }

  onClose(cb: () => void): void {
    this.closeCb = cb
  }

  private dispose(): void {
    for (const u of this.unsubs) u()
    this.unsubs = []
  }
}
