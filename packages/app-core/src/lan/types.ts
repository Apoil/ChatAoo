/**
 * 局域网传输抽象：
 *  - 桌面端：Electron 主进程用 node:dgram / node:net，经 preload IPC 桥接；
 *  - 移动端：Capacitor 原生插件（Kotlin DatagramSocket / ServerSocket）。
 * 协议：UDP 组播信标发现；TCP JSON 行（每行一条 P2PMsg）。
 */
import type { BeaconPacket, Identity, P2PMsg } from '@chataoo/shared'

export interface LanConn {
  id: string
  /** hello 交换后可知对端 userId */
  peerUserId?: string
  send(msg: P2PMsg): void
  close(): void
  onMessage(cb: (msg: P2PMsg) => void): void
  onClose(cb: () => void): void
}

export interface LanAdapter {
  kind: 'desktop' | 'mobile'
  /** 启动：加入组播、开始周期广播信标（携带身份）、监听 TCP */
  start(identity: Identity): Promise<void>
  stop(): Promise<void>
  /** 收到对端信标 */
  onBeacon(cb: (packet: BeaconPacket, host: string) => void): void
  /** 收到入站连接（已被对端连接） */
  onConnection(cb: (conn: LanConn) => void): void
  /** 主动连接对端 */
  connect(host: string, port: number): Promise<LanConn>
}

export interface P2PFileState {
  transferId: string
  sha256: string
  size: number
  name: string
  mime: string
  chunks: Blob[]
  received: number
}
