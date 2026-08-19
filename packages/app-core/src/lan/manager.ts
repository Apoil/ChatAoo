/**
 * 局域网发现管理器：
 *  - 校验信标（签名+好友白名单门控）：只有互为好友的设备才建立 P2P 连接；
 *  - 维护在线对端表（信标超时淘汰）；
 *  - 消息直接投递；文件分块传输（JSON 行 base64 块）；
 *  - 断网时局域网内聊天照常，回服务器后再同步。
 */
import {
  LAN_TCP_PORT,
  P2P_CHUNK_SIZE,
  type Attachment,
  type BeaconPacket,
  type Identity,
  type Message,
} from '@chataoo/shared'
import type { Bus } from '../bus.js'
import type { LocalStore } from '../local-store.js'
import type { MediaStore } from '../media.js'
import type { LanAdapter, LanConn, P2PFileState } from './types.js'
import { verifyBeacon } from './beacon.js'
import type { P2PClientMsg, P2PMsg, P2PServerMsg } from '@chataoo/shared'

interface PeerState {
  userId: string
  displayName: string
  host: string
  lastSeen: number
  conn: LanConn | undefined
}

export interface LanManagerDeps {
  adapter: LanAdapter
  store: LocalStore
  media: MediaStore
  identity: Identity
  bus: Bus
  /** 收到对端消息（已通过好友门控与身份校验） */
  onPeerMessage(msg: Message, viaLan: boolean): Promise<void>
  /** 会话未读数是否跳过（活跃会话） */
  activeConversation(): string | undefined
}

export class LanManager {
  private peers = new Map<string, PeerState>()
  private files = new Map<string, P2PFileState>()
  private beaconTimer: ReturnType<typeof setInterval> | null = null
  private expireTimer: ReturnType<typeof setInterval> | null = null
  private started = false

  constructor(private deps: LanManagerDeps) {}

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const { adapter, bus } = this.deps

    adapter.onBeacon((packet, host) => void this.handleBeacon(packet, host))
    adapter.onConnection((conn) => this.wire(conn))

    // 由 adapter 负责：加入组播组、周期性广播带签名的信标、监听 TCP
    await adapter.start(this.deps.identity)

    // 对端超时淘汰
    this.expireTimer = setInterval(() => this.expirePeers(), 5000)
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    if (this.beaconTimer) clearInterval(this.beaconTimer)
    if (this.expireTimer) clearInterval(this.expireTimer)
    this.beaconTimer = null
    this.expireTimer = null
    for (const p of this.peers.values()) p.conn?.close()
    this.peers.clear()
    await this.deps.adapter.stop()
  }

  /** 对端是否通过局域网在线 */
  isOnline(userId: string): boolean {
    const p = this.peers.get(userId)
    return !!p && Date.now() - p.lastSeen < 20_000 && !!p.conn
  }

  /** 通过局域网发送消息（仅好友），返回是否已投递 */
  sendMessageTo(peerId: string, msg: Message): boolean {
    const p = this.peers.get(peerId)
    if (!p?.conn) return false
    p.conn.send({ type: 'message', message: msg } satisfies P2PClientMsg)
    return true
  }

  /** 通过局域网分块发送附件（发送方），返回是否已开始 */
  async sendFile(peerId: string, attachment: Attachment, blob: Blob): Promise<boolean> {
    const p = this.peers.get(peerId)
    if (!p?.conn) return false
    const conn = p.conn
    const buf = new Uint8Array(await blob.arrayBuffer())
    conn.send({ type: 'file-meta', transferId: attachment.id, attachment } satisfies P2PClientMsg)
    const chunkCount = Math.ceil(buf.length / P2P_CHUNK_SIZE)
    for (let i = 0; i < chunkCount; i++) {
      const chunk = buf.slice(i * P2P_CHUNK_SIZE, (i + 1) * P2P_CHUNK_SIZE)
      conn.send({
        type: 'file-data',
        transferId: attachment.id,
        offset: i * P2P_CHUNK_SIZE,
        data: btoa(String.fromCharCode(...chunk)),
      } satisfies P2PClientMsg)
      // 让出事件循环，避免大文件阻塞 UI
      if (i % 16 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    conn.send({ type: 'file-done', transferId: attachment.id, sha256: attachment.sha256 } satisfies P2PClientMsg)
    return true
  }

  /* ---------------- 信标处理 ---------------- */

  private async handleBeacon(packet: BeaconPacket, host: string): Promise<void> {
    const ok = await verifyBeacon(packet)
    if (!ok) return
    // 好友白名单门控：仅好友设备可被发现/连接
    const friend = await this.deps.store.friendGet(packet.userId)
    if (!friend || friend.status !== 'friends') return

    const now = Date.now()
    let peer = this.peers.get(packet.userId)
    if (!peer) {
      peer = { userId: packet.userId, displayName: packet.displayName, host, lastSeen: now, conn: undefined }
      this.peers.set(packet.userId, peer)
      this.deps.bus.emit('lan-peer', { userId: packet.userId, online: true, host })
    } else {
      peer.lastSeen = now
      peer.host = host
      if (!peer.conn) this.deps.bus.emit('lan-peer', { userId: packet.userId, online: true, host })
    }
    // 好友在线但未连接 -> 主动建立 P2P
    if (!peer.conn) {
      void this.connectTo(peer)
    }
  }

  private expirePeers(): void {
    const now = Date.now()
    for (const [userId, p] of this.peers) {
      if (now - p.lastSeen > 20_000) {
        if (p.conn) {
          p.conn.close()
          p.conn = undefined
        }
        this.peers.delete(userId)
        this.deps.bus.emit('lan-peer', { userId, online: false })
      }
    }
  }

  private async connectTo(peer: PeerState): Promise<void> {
    try {
      const conn = await this.deps.adapter.connect(peer.host, LAN_TCP_PORT)
      this.wire(conn)
      peer.conn = conn
    } catch {
      /* 对端端口未开等情况，下个信标周期重试 */
    }
  }

  /* ---------------- 连接处理 ---------------- */

  private wire(conn: LanConn): void {
    conn.onMessage((msg) => void this.handleP2PMsg(conn, msg))
    conn.onClose(() => {
      for (const p of this.peers.values()) {
        if (p.conn === conn) {
          p.conn = undefined
          this.deps.bus.emit('lan-peer', { userId: p.userId, online: false })
        }
      }
    })
    // 主动方发送 hello；被动方收到 hello 后回 welcome
    if (!conn.peerUserId) {
      conn.send({
        type: 'hello',
        userId: this.deps.identity.userId,
        displayName: this.deps.identity.displayName,
      } satisfies P2PClientMsg)
    }
  }

  private async handleP2PMsg(conn: LanConn, raw: P2PMsg): Promise<void> {
    const msg = raw as P2PClientMsg | P2PServerMsg
    switch (msg.type) {
      case 'hello': {
        conn.peerUserId = msg.userId
        // 反向 hello：双向确认（协议对称，双方互发 hello）
        if (conn.peerUserId !== this.deps.identity.userId) {
          conn.send({
            type: 'hello',
            userId: this.deps.identity.userId,
            displayName: this.deps.identity.displayName,
          } satisfies P2PClientMsg)
        }
        const friend = await this.deps.store.friendGet(msg.userId)
        if (!friend || friend.status !== 'friends') {
          conn.close() // 非好友连接直接断开
          return
        }
        // 更新本地对端表
        const p = this.peers.get(msg.userId)
        if (p) p.conn = conn
        else this.peers.set(msg.userId, { userId: msg.userId, displayName: msg.displayName, host: '', lastSeen: Date.now(), conn })
        this.deps.bus.emit('lan-peer', { userId: msg.userId, online: true })
        break
      }
      case 'message': {
        const friend = await this.deps.store.friendGet(msg.message.senderId)
        if (!friend || friend.status !== 'friends') return
        // 局域网送达即视为 delivered
        const m: Message = { ...msg.message, status: 'delivered' }
        await this.deps.onPeerMessage(m, true)
        conn.send({ type: 'ack', messageId: msg.message.id, ok: true } satisfies P2PServerMsg)
        break
      }
      case 'ack':
        if (msg.ok) {
          this.deps.bus.emit('message-status', { id: msg.messageId, status: 'delivered' })
        }
        break
      case 'file-meta': {
        this.files.set(msg.transferId, {
          transferId: msg.transferId,
          sha256: msg.attachment.sha256,
          size: msg.attachment.size,
          name: msg.attachment.name,
          mime: msg.attachment.mimeType,
          chunks: [],
          received: 0,
        })
        break
      }
      case 'file-data': {
        const f = this.files.get(msg.transferId)
        if (!f) return
        const bin = atob(msg.data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        f.chunks.push(new Blob([bytes]))
        f.received += bytes.length
        break
      }
      case 'file-done': {
        const f = this.files.get(msg.transferId)
        if (!f) return
        this.files.delete(msg.transferId)
        if (f.received !== f.size) {
          conn.send({ type: 'file-cancel', transferId: msg.transferId, reason: 'size mismatch' } satisfies P2PServerMsg)
          return
        }
        const blob = new Blob(f.chunks, { type: f.mime })
        await this.deps.media.write(f.sha256, blob)
        // 更新消息附件为已缓存
        for (const m of await this.deps.store.messagesByAttachmentSha(f.sha256)) {
          if (m.attachment && !m.attachment.cached) {
            m.attachment.cached = true
            await this.deps.store.msgPut(m)
          }
        }
        this.deps.bus.emit('lan-file', { transferId: msg.transferId, sha256: f.sha256, blob, mime: f.mime })
        this.deps.bus.emit('conversations', {})
        break
      }
      case 'typing':
        break
      case 'bye':
        conn.close()
        break
      default:
        break
    }
  }
}
