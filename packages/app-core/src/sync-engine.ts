/**
 * 同步引擎 —— 离线优先：
 *  - 所有数据先写本地（IndexedDB），断网完全可用；
 *  - 在线时把 outbox 中的本地消息推送到服务器（幂等，消息 ID 全局唯一）；
 *  - 周期性拉取增量（since 游标），WebSocket 实时推送；
 *  - 头像等媒体按内容哈希本地缓存，断网仍可见。
 */
import {
  directConversationId,
  previewOfMessage,
  type Identity,
  type Message,
  type Profile,
  type ServerMessage,
  type ServerToClient,
} from '@chataoo/shared'
import type { Bus } from './bus.js'
import type { LocalStore } from './local-store.js'
import type { MediaStore } from './media.js'
import type { ServerApi } from './server-api.js'

const PUSH_INTERVAL_MS = 8000
const PULL_INTERVAL_MS = 30000
const MAX_ATTEMPTS = 6

export interface SyncDeps {
  api: ServerApi
  store: LocalStore
  media: MediaStore
  identity: Identity
  bus: Bus
  serverUrl: string
  /** 当前活跃会话（未读计数跳过它） */
  activeConversation: () => string | undefined
  onToken?(token: string): void
}

export class SyncEngine {
  online = false
  private closeWs: (() => void) | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(private deps: SyncDeps) {}

  /** 注册/登录，建立账号与 token */
  async ensureAccount(): Promise<void> {
    const store = this.deps.store
    const api = this.deps.api
    let token = await store.kvGet<string>('serverToken')
    if (token) {
      try {
        await api.login(token)
        return
      } catch {
        token = undefined
      }
    }
    const res = await api.register(this.deps.identity, this.deps.identity.displayName)
    await store.kvSet('serverToken', res.token)
    this.deps.onToken?.(res.token)
  }

  async start(): Promise<void> {
    await this.ensureAccount()
    await this.pull()
    this.connectWs()
    this.timers.push(setInterval(() => void this.pushLoop(), PUSH_INTERVAL_MS))
    this.timers.push(setInterval(() => void this.pull(), PULL_INTERVAL_MS))
    this.timers.push(setInterval(() => void this.pushLoop(), 2000))
  }

  stop(): void {
    this.stopped = true
    this.closeWs?.()
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer)
    this.wsRetryTimer = null
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  /* ---------------- 上行 ---------------- */

  /** 立即尝试推送本地待同步消息 */
  async tryPushNow(): Promise<void> {
    if (!this.online) return
    await this.pushLoop()
  }

  private async pushLoop(): Promise<void> {
    if (!this.online || this.stopped) return
    const entries = await this.deps.store.outboxList()
    for (const entry of entries) {
      if (entry.attempt >= MAX_ATTEMPTS) {
        await this.deps.store.msgSetStatus(entry.message.id, 'failed')
        await this.deps.store.outboxRemove(entry.message.id)
        this.deps.bus.emit('message-status', { id: entry.message.id, status: 'failed' })
        continue
      }
      try {
        const { seq } = await this.deps.api.sendMessage(entry.message)
        const m = (await this.deps.store.msgGet(entry.message.id)) ?? entry.message
        m.seq = seq
        m.status = 'sent'
        m.deliveredAt = Date.now()
        await this.deps.store.msgPut(m)
        await this.deps.store.outboxRemove(entry.message.id)
        this.deps.bus.emit('message-status', { id: entry.message.id, status: 'sent' })
      } catch {
        await this.deps.store.outboxBump(entry.message.id)
      }
    }
  }

  /* ---------------- 下行 ---------------- */

  async pull(): Promise<void> {
    if (!this.online || this.stopped) return
    const store = this.deps.store
    try {
      const since = await store.cursorGet('serverSeq')
      const profilesSince = await store.cursorGet('profilesSince')
      const result = await this.deps.api.sync(since, profilesSince)
      for (const sm of result.messages) {
        await this.ingestServerMessage(sm, false)
      }
      for (const p of result.profiles) {
        await this.upsertProfile(p)
      }
      for (const f of result.friends) {
        const st = f.confirmed ? 'friends' : 'none'
        await store.friendPut({ userId: f.userId, status: st, updatedAt: f.updatedAt })
        this.deps.bus.emit('friend', { userId: f.userId, status: st })
        await this.upsertProfile({
          userId: f.userId,
          displayName: f.displayName,
          avatarUrl: f.avatarUrl,
          avatarHash: f.avatarHash,
          statusText: f.statusText,
          updatedAt: f.updatedAt,
        })
      }
      await store.cursorSet('serverSeq', result.nextSeq)
      await store.cursorSet('profilesSince', result.serverTime)
      this.deps.bus.emit('conversations', {})
    } catch (e) {
      console.warn('sync pull failed:', e)
    }
  }

  /** 收到（服务器或局域网）消息：去重入库 + 更新会话 + 通知 UI */
  async ingestMessage(msg: Message, opts: { unread: boolean; viaLan?: boolean }): Promise<boolean> {
    const store = this.deps.store
    const existing = await store.msgGet(msg.id)
    if (existing) {
      // 幂等更新：补充 seq / 状态
      if (msg.seq && !existing.seq) {
        existing.seq = msg.seq
        await store.msgPut(existing)
      }
      if (existing.status === 'pending' && msg.seq) {
        await store.msgSetStatus(msg.id, 'sent')
        this.deps.bus.emit('message-status', { id: msg.id, status: 'sent' })
      }
      return false
    }
    const unread = opts.unread && msg.senderId !== this.deps.identity.userId
    await store.msgPut(msg)
    await store.convTouch(
      msg.conversationId,
      previewOfMessage(msg.text, msg.kind),
      msg.createdAt,
      unread ? 1 : 0,
    )
    this.deps.bus.emit('message', msg)
    this.deps.bus.emit('conversations', { conversationId: msg.conversationId })
    return true
  }

  private async ingestServerMessage(sm: ServerMessage, unread: boolean): Promise<void> {
    const msg: Message = {
      id: sm.id,
      conversationId: sm.conversationId,
      senderId: sm.senderId,
      kind: sm.kind,
      text: sm.text,
      attachment: sm.attachment,
      createdAt: sm.createdAt,
      status: 'sent',
      seq: sm.seq,
    }
    const isNew = await this.ingestMessage(msg, { unread })
    if (isNew && sm.attachment && !sm.attachment.cached) {
      void this.cacheAttachment(sm.attachment.sha256, this.absoluteUrl(sm.attachment.url ?? ''))
    }
  }

  /** 资料入库 + 头像离线缓存 */
  async upsertProfile(p: Profile): Promise<void> {
    const store = this.deps.store
    const old = await store.profGet(p.userId)
    await store.profPut(p)
    if (!old || old.updatedAt < p.updatedAt) {
      this.deps.bus.emit('profile', p)
    }
    if (p.avatarHash && p.avatarUrl) {
      const media = this.deps.media
      if (!(await media.has(p.avatarHash))) {
        void media
          .cacheFromUrl(this.absoluteUrl(p.avatarUrl), p.avatarHash)
          .then((ok) => {
            if (ok) this.deps.bus.emit('media-cached', { sha256: p.avatarHash! })
          })
          .catch(() => {})
      }
    }
  }

  private absoluteUrl(relative: string): string {
    return relative.startsWith('http') ? relative : this.deps.serverUrl + relative
  }

  /** 附件后台缓存（服务器 URL -> 本地媒体库） */
  async cacheAttachment(sha256: string, url: string): Promise<void> {
    try {
      const media = this.deps.media
      if (await media.has(sha256)) return
      const ok = await media.cacheFromUrl(url, sha256)
      if (ok) {
        this.deps.bus.emit('media-cached', { sha256 })
        for (const m of await this.deps.store.messagesByAttachmentSha(sha256)) {
          if (m.attachment && !m.attachment.cached) {
            m.attachment.cached = true
            await this.deps.store.msgPut(m)
          }
        }
        this.deps.bus.emit('conversations', {})
      }
    } catch {
      /* 离线时静默 */
    }
  }

  /* ---------------- WebSocket ---------------- */

  private connectWs(): void {
    if (this.stopped) return
    this.closeWs?.()
    this.closeWs = this.deps.api.connectWs({
      onOpen: () => {
        this.setOnline(true)
        void this.pull()
      },
      onClose: () => {
        this.setOnline(false)
        // 断线重连（离线时静默重试）
        if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer)
        this.wsRetryTimer = setTimeout(() => {
          this.wsRetryTimer = null
          this.connectWs()
        }, 10000)
      },
      onMessage: (msg) => void this.handleServerMessage(msg),
    })
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return
    this.online = online
    this.deps.bus.emit('online', online)
    if (online) void this.tryPushNow()
  }

  private async handleServerMessage(msg: ServerToClient): Promise<void> {
    switch (msg.type) {
      case 'hello':
        await this.deps.store.cursorSet('serverSeq', Math.max(await this.deps.store.cursorGet('serverSeq'), msg.serverSeq))
        break
      case 'message-acked': {
        const m = await this.deps.store.msgGet(msg.id)
        if (m) {
          m.seq = msg.seq
          m.status = 'sent'
          m.deliveredAt = Date.now()
          await this.deps.store.msgPut(m)
          await this.deps.store.outboxRemove(msg.id)
          this.deps.bus.emit('message-status', { id: msg.id, status: 'sent' })
        }
        break
      }
      case 'message':
        await this.ingestServerMessage(msg.message, true)
        break
      case 'profile':
        await this.upsertProfile(msg.profile)
        break
      case 'friend': {
        const st = msg.friend.confirmed ? 'friends' : 'incoming'
        await this.deps.store.friendPut({
          userId: msg.friend.userId,
          status: st,
          updatedAt: msg.friend.updatedAt,
        })
        this.deps.bus.emit('friend', { userId: msg.friend.userId, status: st })
        await this.upsertProfile({
          userId: msg.friend.userId,
          displayName: msg.friend.displayName,
          avatarUrl: msg.friend.avatarUrl,
          avatarHash: msg.friend.avatarHash,
          statusText: msg.friend.statusText,
          updatedAt: msg.friend.updatedAt,
        })
        break
      }
      case 'presence':
        this.deps.bus.emit('presence', { userId: msg.userId, online: msg.online, source: 'server' })
        break
      case 'sync':
        for (const sm of msg.result.messages) await this.ingestServerMessage(sm, true)
        for (const p of msg.result.profiles) await this.upsertProfile(p)
        await this.deps.store.cursorSet('serverSeq', msg.result.nextSeq)
        break
      default:
        break
    }
  }
}
