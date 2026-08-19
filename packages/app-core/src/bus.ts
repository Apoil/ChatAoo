/**
 * 极简类型化事件总线：UI 层订阅，业务层发布。
 */
import type { FriendStatus, Message, Profile } from '@chataoo/shared'

export interface LanPeerInfo {
  userId: string
  online: boolean
  host?: string
}

export interface LanFileEvent {
  transferId: string
  sha256: string
  blob: Blob
  mime: string
}

export interface BusEvents {
  /** 新消息（本地发出或收到） */
  message: Message
  /** 消息状态变化 */
  'message-status': { id: string; status: Message['status'] }
  /** 会话列表变化（新会话 / 预览 / 未读） */
  conversations: { conversationId?: string }
  /** 资料变化 */
  profile: Profile
  /** 好友变化 */
  friend: { userId: string; status: FriendStatus }
  /** 在线状态（服务器或局域网） */
  presence: { userId: string; online: boolean; source: 'server' | 'lan' }
  /** 局域网对端出现/消失 */
  'lan-peer': LanPeerInfo
  /** 局域网文件传输完成 */
  'lan-file': LanFileEvent
  /** 服务器连接状态 */
  online: boolean
  /** 登录状态变化 */
  auth: { authed: boolean }
  /** 头像等本地媒体缓存完成 */
  'media-cached': { sha256: string }
  /** 头像已更新 */
  'my-avatar': { url?: string; sha256?: string }
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

export class Bus {
  private handlers = new Map<keyof BusEvents, Set<Handler<keyof BusEvents>>>()

  on<K extends keyof BusEvents>(event: K, cb: Handler<K>): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(cb as Handler<keyof BusEvents>)
    return () => this.off(event, cb)
  }

  off<K extends keyof BusEvents>(event: K, cb: Handler<K>): void {
    this.handlers.get(event)?.delete(cb as Handler<keyof BusEvents>)
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const cb of [...set]) {
      try {
        ;(cb as Handler<K>)(payload)
      } catch (e) {
        console.error(`bus handler error (${String(event)}):`, e)
      }
    }
  }
}
