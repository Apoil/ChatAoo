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
  type Attachment,
  type FriendStatus,
  type Identity,
  type Message,
  type Profile,
  type ServerFriend,
  type ServerMessage,
  type ServerToClient,
} from '@chataoo/shared'
import type { Bus } from './bus.js'
import type { LocalStore } from './local-store.js'
import { inferKind, parseAttachment } from './media.js'
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
  private pushing = false

  constructor(private deps: SyncDeps) {}

  /** 校验已保存的登录状态（有 token 则验证；无 token 保持待登录） */
  async ensureAccount(): Promise<void> {
    const store = this.deps.store
    const api = this.deps.api
    const token = await store.kvGet<string>('serverToken')
    if (!token) return
    try {
      const user = await api.me()
      this.deps.onToken?.(token)
      if (user.displayName && user.displayName !== this.deps.identity.displayName) {
        this.deps.identity.displayName = user.displayName
        await store.kvSet('identity', this.deps.identity)
      }
      await this.upsertProfile({
        userId: this.deps.identity.userId,
        displayName: user.displayName || this.deps.identity.displayName,
        avatarUrl: user.avatarUrl,
        avatarHash: user.avatarHash,
        updatedAt: Date.now(),
      })
    } catch {
      // 服务器不可达：保持离线模式，已保存的登录状态仍有效（LAN 可用）
    }
  }

  async start(): Promise<void> {
    await this.ensureAccount()
    await this.hydrateSelfProfile()
    await this.hydrateFriends()
    await this.repairAttachments()
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
    if (!this.online || this.stopped || this.pushing) return
    this.pushing = true
    try {
      const entries = await this.deps.store.outboxList()
      for (const entry of entries) {
        if (entry.attempt >= MAX_ATTEMPTS) {
          await this.deps.store.msgSetStatus(entry.message.id, 'failed')
          await this.deps.store.outboxRemove(entry.message.id)
          this.deps.bus.emit('message-status', { id: entry.message.id, status: 'failed' })
          continue
        }
        try {
          const payload = await this.prepareOutgoing(entry.message)
          const { seq } = await this.deps.api.sendMessage(payload)
          const m = (await this.deps.store.msgGet(entry.message.id)) ?? entry.message
          m.seq = seq
          m.status = 'sent'
          m.deliveredAt = Date.now()
          if (payload.attachment?.url && m.attachment) m.attachment.url = payload.attachment.url
          await this.deps.store.msgPut(m)
          await this.deps.store.outboxRemove(entry.message.id)
          this.deps.bus.emit('message', m)
          this.deps.bus.emit('message-status', { id: entry.message.id, status: 'sent' })
        } catch {
          await this.deps.store.outboxBump(entry.message.id)
        }
      }
    } finally {
      this.pushing = false
    }
  }

  /** 附件必须先上传拿到 URL，否则对端只有元数据、无法播放 */
  private async prepareOutgoing(msg: Message): Promise<Message> {
    const att = msg.attachment
    if (!att) return msg
    const clean: typeof att = { ...att }
    delete clean.uploadProgress
    delete clean.uploadPhase
    if (clean.thumbUrl?.startsWith('blob:')) delete clean.thumbUrl
    if (clean.url) return { ...msg, attachment: { ...clean, cached: false } }
    if (!clean.sha256) throw new Error('attachment not ready')
    const blob = await this.deps.media.read(clean.sha256)
    if (!blob) throw new Error('attachment blob missing')
    const typed =
      blob.type && blob.type !== 'application/octet-stream'
        ? blob
        : new Blob([blob], { type: clean.mimeType || 'application/octet-stream' })
    const up = await this.deps.api.uploadFile(typed, clean.name, clean.kind, (pct) => {
      this.deps.bus.emit('upload-progress', { id: msg.id, progress: pct, phase: 'uploading' })
    })
    const next = { ...clean, url: up.url, cached: true }
    const local = (await this.deps.store.msgGet(msg.id)) ?? msg
    if (local.attachment) {
      local.attachment = { ...local.attachment, url: up.url }
      delete local.attachment.uploadProgress
      delete local.attachment.uploadPhase
      await this.deps.store.msgPut(local)
      this.deps.bus.emit('message', local)
    }
    return { ...msg, attachment: { ...next, cached: false } }
  }

  private friendStatusOf(f: ServerFriend): FriendStatus | null {
    if (f.status === 'friends' || f.status === 'outgoing' || f.status === 'incoming') return f.status
    if (f.confirmed) return 'friends'
    return null
  }

  private async applyFriendEntries(friends: ServerFriend[]): Promise<void> {
    const me = this.deps.identity.userId
    for (const f of friends) {
      if (f.status === 'none') {
        await this.deps.store.purgePeer(me, f.userId)
        this.deps.bus.emit('friend', { userId: f.userId, status: 'none' })
        this.deps.bus.emit('conversations', {})
        continue
      }
      const st = this.friendStatusOf(f)
      if (!st) continue
      await this.deps.store.friendPut({ userId: f.userId, status: st, updatedAt: f.updatedAt })
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
  }

  private async hydrateSelfProfile(): Promise<void> {
    const me = this.deps.identity.userId
    try {
      const user = await this.deps.api.me()
      await this.upsertProfile({
        userId: me,
        displayName: user.displayName || this.deps.identity.displayName,
        avatarUrl: user.avatarUrl,
        avatarHash: user.avatarHash,
        updatedAt: Date.now(),
      })
    } catch {
      const local = await this.deps.store.profGet(me)
      if (local) await this.upsertProfile(local)
    }
  }

  /** 重装后本地只有服务器 JSON：把字符串附件还原成对象并补 URL / 下载 */
  private async repairAttachments(): Promise<void> {
    const store = this.deps.store
    for (const m of await store.allMessages()) {
      const parsed = parseAttachment(m.attachment)
      if (!parsed) continue
      const filled = await this.fillAttachment(parsed)
      const has = filled.sha256 ? await this.deps.media.has(filled.sha256) : false
      const nextAtt = { ...filled, cached: has }
      const prev = m.attachment
      const changed =
        typeof (m.attachment as unknown) === 'string' ||
        !prev ||
        prev.url !== nextAtt.url ||
        prev.sha256 !== nextAtt.sha256 ||
        prev.name !== nextAtt.name ||
        prev.kind !== nextAtt.kind ||
        prev.cached !== nextAtt.cached
      if (changed) {
        const next = { ...m, attachment: nextAtt }
        await store.msgPut(next)
        this.deps.bus.emit('message', next)
      }
      if (nextAtt.sha256 && nextAtt.url && !has) {
        void this.cacheAttachment(nextAtt.sha256, this.absoluteUrl(nextAtt.url))
      }
    }
  }

  private async fillAttachment(att: Attachment): Promise<Attachment> {
    let next = { ...att }
    if (!next.kind || next.kind === 'file') {
      next.kind = inferKind(next.name || '', next.mimeType || '')
    }
    if (!next.url && next.sha256) {
      try {
        const hit = await this.deps.api.lookupFile(next.sha256)
        next = {
          ...next,
          url: hit.url,
          name: next.name || hit.name,
          size: next.size || hit.size,
          mimeType: next.mimeType || hit.mime,
          kind: next.kind === 'file' ? inferKind(hit.name, hit.mime) : next.kind,
        }
      } catch {
        /* 服务器无此文件或离线 */
      }
    }
    return next
  }

  /** 全量拉好友（含待确认），避免增量同步漏掉单向请求 */
  async hydrateFriends(): Promise<void> {
    try {
      const { friends } = await this.deps.api.friends()
      const me = this.deps.identity.userId
      const keep = new Set(friends.map((f) => f.userId))
      keep.add(me)
      for (const local of await this.deps.store.friendsList()) {
        if (!keep.has(local.userId)) await this.deps.store.purgePeer(me, local.userId)
      }
      await this.applyFriendEntries(friends)
      await this.reconcileLocalPeers()
      this.deps.bus.emit('friend', { userId: me, status: 'friends' })
    } catch (e) {
      console.warn('hydrate friends failed:', e)
    }
  }

  /** 删掉不在服务器好友列表里的本地幽灵身份（换设备留下的旧 userId） */
  private async reconcileLocalPeers(): Promise<void> {
    const store = this.deps.store
    const me = this.deps.identity.userId
    const friends = (await store.friendsList()).filter((f) => f.status !== 'none')
    const keep = new Set(friends.map((f) => f.userId))
    keep.add(me)
    for (const c of await store.convs()) {
      const parts = c.id.split('__')
      if (parts.length !== 2) {
        await store.convDel(c.id)
        continue
      }
      const peer = parts[0] === me ? parts[1]! : parts[0]!
      if (!keep.has(peer)) await store.purgePeer(me, peer)
    }
    for (const p of await store.profsAll()) {
      if (!keep.has(p.userId)) await store.profDel(p.userId)
    }
    this.deps.bus.emit('conversations', {})
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
      await this.applyFriendEntries(result.friends)
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
    const me = this.deps.identity.userId
    const peer = msg.senderId === me
      ? msg.conversationId.split('__').find((p) => p && p !== me)
      : msg.senderId
    if (peer) {
      const canonical = directConversationId(me, peer)
      if (canonical !== msg.conversationId) msg = { ...msg, conversationId: canonical }
    }
    const parsed = parseAttachment(msg.attachment)
    if (msg.attachment && !parsed) {
      msg = { ...msg, attachment: undefined }
    } else if (parsed) {
      const has = parsed.sha256 ? await this.deps.media.has(parsed.sha256) : false
      msg = { ...msg, attachment: { ...parsed, cached: has } }
    }
    if (msg.revoked) {
      msg = { ...msg, revoked: true, kind: 'system', text: '消息已撤回', attachment: undefined }
    }
    const existing = await store.msgGet(msg.id)
    if (existing) {
      if (msg.revoked && !existing.revoked) {
        existing.revoked = true
        existing.kind = 'system'
        existing.text = '消息已撤回'
        existing.attachment = undefined
        if (msg.seq) existing.seq = msg.seq
        await store.msgPut(existing)
        this.deps.bus.emit('message', existing)
        this.deps.bus.emit('message-deleted', { id: existing.id, conversationId: existing.conversationId, revoked: true })
        return false
      }
      let changed = false
      if (msg.seq && !existing.seq) {
        existing.seq = msg.seq
        changed = true
      }
      const existingAtt = parseAttachment(existing.attachment)
      if (typeof (existing.attachment as unknown) === 'string' && msg.attachment) {
        existing.attachment = msg.attachment
        changed = true
      } else if (msg.attachment?.url && existingAtt && !existingAtt.url) {
        existing.attachment = { ...existingAtt, url: msg.attachment.url }
        changed = true
      }
      if (existing.status === 'pending' && msg.seq) {
        existing.status = 'sent'
        changed = true
        this.deps.bus.emit('message-status', { id: msg.id, status: 'sent' })
      }
      if (changed) {
        await store.msgPut(existing)
        this.deps.bus.emit('message', existing)
      }
      return false
    }
    const unread = opts.unread && msg.senderId !== this.deps.identity.userId
    await store.msgPut(msg)
    await store.convTouch(
      msg.conversationId,
      previewOfMessage(msg.text, msg.kind, msg.revoked),
      msg.createdAt,
      unread ? 1 : 0,
    )
    this.deps.bus.emit('message', msg)
    this.deps.bus.emit('conversations', { conversationId: msg.conversationId })
    return true
  }

  async ingestFromServer(sm: ServerMessage, unread: boolean): Promise<void> {
    await this.ingestServerMessage(sm, unread)
  }

  private async ingestServerMessage(sm: ServerMessage, unread: boolean): Promise<void> {
    let attachment = parseAttachment(sm.attachment)
    if (attachment) attachment = await this.fillAttachment(attachment)
    const msg: Message = {
      id: sm.id,
      conversationId: sm.conversationId,
      senderId: sm.senderId,
      kind: sm.kind,
      text: sm.text,
      attachment,
      createdAt: sm.createdAt,
      status: 'sent',
      seq: sm.seq,
      revoked: sm.revoked,
    }
    await this.ingestMessage(msg, { unread })
    if (attachment?.sha256 && attachment.url) {
      const has = await this.deps.media.has(attachment.sha256)
      if (!has) void this.cacheAttachment(attachment.sha256, this.absoluteUrl(attachment.url))
    }
  }

  /** 资料入库 + 头像离线缓存 */
  async upsertProfile(p: Profile): Promise<void> {
    const store = this.deps.store
    const old = await store.profGet(p.userId)
    const next: Profile = {
      userId: p.userId,
      displayName: p.displayName || old?.displayName || '',
      avatarUrl: p.avatarUrl || old?.avatarUrl,
      avatarHash: p.avatarHash || old?.avatarHash,
      statusText: p.statusText ?? old?.statusText,
      updatedAt: Math.max(old?.updatedAt ?? 0, p.updatedAt),
    }
    await store.profPut(next)
    const changed =
      !old ||
      old.avatarUrl !== next.avatarUrl ||
      old.avatarHash !== next.avatarHash ||
      old.displayName !== next.displayName ||
      old.updatedAt !== next.updatedAt
    if (changed) this.deps.bus.emit('profile', next)
    if (next.avatarHash && next.avatarUrl) {
      const media = this.deps.media
      if (!(await media.has(next.avatarHash))) {
        void media
          .cacheFromUrl(this.absoluteUrl(next.avatarUrl), next.avatarHash)
          .then((ok) => {
            if (ok) this.deps.bus.emit('media-cached', { sha256: next.avatarHash! })
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
    if (!sha256 || !url) return
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
    if (online) {
      void this.hydrateFriends()
      void this.tryPushNow()
    }
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
      case 'message-deleted': {
        const m = await this.deps.store.msgGet(msg.id)
        if (m && !m.revoked) {
          m.revoked = true
          m.kind = 'system'
          m.text = '消息已撤回'
          m.attachment = undefined
          await this.deps.store.msgPut(m)
          this.deps.bus.emit('message', m)
          this.deps.bus.emit('message-deleted', { id: m.id, conversationId: m.conversationId, revoked: true })
        }
        break
      }
      case 'profile':
        await this.upsertProfile(msg.profile)
        break
      case 'friend':
        await this.applyFriendEntries([msg.friend])
        break
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
