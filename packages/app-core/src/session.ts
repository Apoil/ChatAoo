/**
 * ChatSession：应用级编排 —— 账号鉴权（用户名+密码）、身份、本地存储、
 * 同步引擎、LAN 发现、消息收发、附件与头像、资料解析。UI 层只与它交互。
 *
 * 登录模型：
 *  - 在线模式用「用户名 + 密码」登录/注册；账号绑定本设备 ED25519 身份；
 *  - 登录成功后持久化 token + 身份 + 用户名 —— 之后完全断网也能以已登录
 *    状态进入（离线模式，LAN 可用）；完全离线的首次使用无法登录。
 *  - 同一账号在新设备登录时自动把账号重绑定到新设备（旧设备数据保留但不
 *    再关联，详见 docs）。
 */
import {
  directConversationId,
  generateIdentity,
  randomId,
  type Attachment,
  type AttachmentKind,
  type Conversation,
  type Identity,
  type Message,
  type Profile,
  type ServerUser,
} from '@chataoo/shared'
import { Bus } from './bus.js'
import { LocalStore } from './local-store.js'
import { parseAttachment, sha256OfBlob, typedBlob, type MediaStore } from './media.js'
import { ServerApi } from './server-api.js'
import { SyncEngine } from './sync-engine.js'
import { LanManager } from './lan/manager.js'
import type { LanAdapter } from './lan/types.js'

export interface ChatPlatform {
  platform: 'desktop' | 'mobile'
  serverUrl: string
  lan: LanAdapter
  media: MediaStore
  /** 用系统方式打开外部链接/文件 */
  openExternal(url: string): void
  /** 保存附件。返回 saved/shared/cancelled，便于界面提示 */
  saveFile?(name: string, url: string): void | Promise<void | 'saved' | 'shared' | 'cancelled'>
}

export class ChatSession {
  readonly bus = new Bus()
  readonly platform: ChatPlatform
  store!: LocalStore
  identity!: Identity
  api!: ServerApi
  sync!: SyncEngine
  lan!: LanManager
  /** 是否已登录（有本机身份 + 登录状态） */
  authed = false
  /** 服务器地址（登录页可修改；修改后需重新登录） */
  serverUrl: string
  username?: string
  online = false
  /** 最近一次登录态失效原因（登录页提示用；重新登录后清空） */
  lastAuthError?: string
  activeConversationId?: string
  presence = new Map<string, boolean>()

  private token?: string
  private servicesStarted = false

  private constructor(platform: ChatPlatform) {
    this.platform = platform
    this.serverUrl = platform.serverUrl
  }

  static async create(platform: ChatPlatform): Promise<ChatSession> {
    const s = new ChatSession(platform)
    await s.init()
    return s
  }

  private async init(): Promise<void> {
    this.store = await LocalStore.open()
    this.identity = (await this.store.kvGet<Identity>('identity'))!
    this.token = await this.store.kvGet<string>('serverToken')
    this.username = await this.store.kvGet<string>('username')
    this.rebuildApi()

    this.bus.on('online', (v) => (this.online = v))
    this.bus.on('presence', ({ userId, online }) => this.presence.set(userId, online))
    // 401：token 失效（过期 / 账号被换绑）→ 回到登录页，而不是假装离线
    this.bus.on('auth-expired', ({ reason }) => void this.handleAuthExpired(reason))

    // 有本地身份 + 登录状态 → 直接进入（在线校验失败则自动进入离线模式）
    if (this.identity && this.token) {
      this.authed = true
      await this.migrateLegacyConversations().catch((e) => console.warn('conversation migration failed:', e))
      await this.startServices().catch((e) => console.warn('services start failed:', e))
    }
  }

  private rebuildApi(): void {
    this.api = new ServerApi(this.serverUrl, () => this.token)
  }

  /** 设置服务器地址（登录页使用；修改后需要重新登录） */
  setServerUrl(url: string): void {
    const u = url.trim().replace(/\/+$/, '')
    if (!u || u === this.serverUrl) return
    this.serverUrl = u
    try {
      localStorage.setItem('chataoo:serverUrl', u)
    } catch {
      /* ignore */
    }
    this.rebuildApi()
    if (this.authed) {
      // 切换服务器后原登录状态失效
      void this.logout()
    }
  }

  /** 启动同步 + LAN（登录成功后调用） */
  private async startServices(): Promise<void> {
    if (this.servicesStarted) return
    this.servicesStarted = true
    const identity = this.identity!

    this.sync = new SyncEngine({
      api: this.api,
      store: this.store,
      media: this.platform.media,
      identity,
      bus: this.bus,
      serverUrl: this.serverUrl,
      activeConversation: () => this.activeConversationId,
      onToken: (t) => (this.token = t),
    })

    this.lan = new LanManager({
      adapter: this.platform.lan,
      store: this.store,
      media: this.platform.media,
      identity,
      bus: this.bus,
      activeConversation: () => this.activeConversationId,
      onPeerMessage: (m) => this.onPeerMessage(m),
    })

    await this.sync.start()
    void this.lan.start().catch((e) => console.warn('lan start failed:', e))
  }

  /* ---------------- 账号 ---------------- */

  get me(): Identity {
    return this.identity!
  }

  /**
   * 迁移历史会话：旧版本的账号 ID 会随「换设备登录」变化，导致同一好友出现多条会话。
   * 登录后把旧账号 ID 的会话并入当前账号 ID 的规范会话，并修正消息 senderId。
   */
  private async migrateLegacyConversations(): Promise<void> {
    const accountId = this.accountId
    const friendIds = new Set(
      (await this.store.friendsList()).filter((f) => f.status === 'friends').map((f) => f.userId),
    )
    if (!friendIds.size) return
    for (const conv of await this.store.convs()) {
      const parts = conv.id.split('__')
      if (parts.length !== 2 || parts.includes(accountId)) continue
      // 只迁移「知道对方是谁」的会话：两段里恰好一段是当前好友
      const known = parts.filter((p) => p && friendIds.has(p))
      if (known.length !== 1) continue
      const peer = known[0]!
      const oldMe = parts[0] === peer ? parts[1] : parts[0]
      if (!oldMe || oldMe === peer) continue
      const target = directConversationId(accountId, peer)
      const msgs = await this.store.msgsIn(conv.id, Number.MAX_SAFE_INTEGER, 2000)
      for (const m of msgs) {
        const senderId = m.senderId === oldMe ? accountId : m.senderId
        if (m.conversationId === target && senderId === m.senderId) continue
        await this.store.msgPut({ ...m, conversationId: target, senderId })
      }
      await this.store.convDel(conv.id)
      const targetConv = await this.store.convEnsure(target, peer)
      const latest = (await this.store.msgsIn(target, Number.MAX_SAFE_INTEGER, 1))[0]
      if (latest) {
        targetConv.lastMessageAt = latest.createdAt
        targetConv.lastMessagePreview = conversationPreview(latest)
        targetConv.updatedAt = latest.createdAt
        targetConv.unreadCount = Math.max(targetConv.unreadCount, conv.unreadCount)
        await this.store.convPut(targetConv)
      }
      this.bus.emit('conversations', { conversationId: target })
    }
  }

  /** 数据身份：多设备同账号时消息/好友/会话都用「账号 ID」，局域网信标用设备 ID */
  get accountId(): string {
    return this.identity!.accountUserId ?? this.identity!.userId
  }

  /** 登录（在线必需）。同一账号可在多台设备同时在线：服务器把本设备登记为账号的设备之一。 */
  async login(username: string, password: string): Promise<void> {
    let identity = this.identity
    if (!identity) identity = await generateIdentity(username)
    const res = await this.api.login(identity, { username, password })
    identity.accountUserId = res.user.userId
    await this.applyAuth(res.token, res.user, identity, username)
    await this.startServices()
  }

  /** 注册（在线必需）：用户名 + 密码 + 昵称；首个设备即账号身份 */
  async register(username: string, password: string, displayName: string): Promise<void> {
    const identity = this.identity ?? (await generateIdentity(displayName))
    const res = await this.api.register(identity, { username, password, displayName })
    identity.accountUserId = res.user.userId
    identity.displayName = res.user.displayName
    await this.applyAuth(res.token, res.user, identity, username)
    await this.startServices()
  }

  /** 登录态失效（401）：记录原因并退出到登录页 */
  private async handleAuthExpired(reason?: string): Promise<void> {
    this.lastAuthError = reason ?? '登录已过期，请重新登录'
    await this.logout()
  }

  /** 退出登录：清除登录状态（本机身份保留），下次需在线登录 */
  async logout(): Promise<void> {
    this.authed = false
    this.token = undefined
    this.username = undefined
    await this.store.kvDel('serverToken')
    await this.store.kvDel('username')
    if (this.sync) this.sync.stop()
    if (this.lan) await this.lan.stop()
    this.servicesStarted = false
    this.bus.emit('auth', { authed: false })
  }

  private async applyAuth(token: string, user: ServerUser, identity: Identity, username: string): Promise<void> {
    identity.displayName = user.displayName
    this.lastAuthError = undefined
    this.identity = identity
    this.token = token
    this.username = username
    await this.store.kvSet('identity', identity)
    await this.store.kvSet('serverToken', token)
    await this.store.kvSet('username', username)
    const selfId = identity.accountUserId ?? identity.userId
    await this.store.profPut({
      userId: selfId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarHash: user.avatarHash,
      updatedAt: Date.now(),
    })
    this.bus.emit('profile', {
      userId: selfId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarHash: user.avatarHash,
      updatedAt: Date.now(),
    })
    this.authed = true
    this.bus.emit('auth', { authed: true })
    await this.migrateLegacyConversations().catch((e) => console.warn('conversation migration failed:', e))
  }

  /** 修改昵称（在线写服务器；离线仅改本地，回连后随资料同步） */
  async updateDisplayName(name: string): Promise<void> {
    if (!this.identity) throw new Error('未登录')
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 30) throw new Error('昵称需 1-30 字')
    if (trimmed === this.identity.displayName) return
    try {
      await this.api.updateProfile({ displayName: trimmed })
    } catch (e) {
      if (this.isOnline) throw e
    }
    this.identity.displayName = trimmed
    await this.store.kvSet('identity', this.identity)
    const p = (await this.store.profGet(this.accountId)) ?? {
      userId: this.accountId,
      displayName: trimmed,
      updatedAt: Date.now(),
    }
    p.displayName = trimmed
    p.updatedAt = Date.now()
    await this.store.profPut(p)
    this.bus.emit('profile', p)
  }

  /* ---------------- 基础查询 ---------------- */

  async conversations(): Promise<Conversation[]> {
    return this.store.convs()
  }

  async messagesIn(conversationId: string, before?: number, limit = 50): Promise<Message[]> {
    const local = await this.store.msgsIn(conversationId, before, limit)
    if (before || local.length >= limit) return local
    // 首次打开会话：在线时再向服务器拉取更早历史
    if (this.isOnline) {
      try {
        const { messages } = await this.api.history(conversationId, Number.MAX_SAFE_INTEGER, limit)
        if (messages.length) {
          for (const sm of messages) {
            await this.sync.ingestFromServer(sm, false)
          }
          return this.store.msgsIn(conversationId, before, limit)
        }
      } catch {
        /* offline */
      }
    }
    return local
  }

  async profile(userId: string): Promise<Profile | undefined> {
    return this.store.profGet(userId)
  }

  async profiles(): Promise<Profile[]> {
    const friends = await this.store.friendsList()
    const out: Profile[] = []
    for (const f of friends) {
      const p = await this.store.profGet(f.userId)
      if (p) out.push(p)
    }
    return out
  }

  /* ---------------- 发送 ---------------- */

  async sendText(peerId: string, text: string): Promise<Message> {
    const convId = directConversationId(this.accountId, peerId)
    const msg: Message = {
      id: randomId('m'),
      conversationId: convId,
      senderId: this.accountId,
      kind: 'text',
      text,
      createdAt: Date.now(),
      status: 'pending',
    }
    return this.sendMessage(peerId, msg)
  }

  async sendAttachment(
    peerId: string,
    file: { blob: Blob; name: string; kind: AttachmentKind; mimeType: string; path?: string },
    opts?: { sticker?: boolean },
  ): Promise<Message> {
    const media = this.platform.media
    const blob = typedBlob(file.blob, file.mimeType)
    const convId = directConversationId(this.accountId, peerId)
    const now = Date.now()
    const attachment: Attachment = {
      id: randomId('a'),
      kind: file.kind,
      name: file.name,
      mimeType: file.mimeType,
      size: Number.isFinite(blob.size) ? blob.size : 0,
      sha256: '',
      cached: true,
      createdAt: now,
      uploadProgress: 0,
      uploadPhase: 'preparing',
      thumbUrl: URL.createObjectURL(blob),
      ...(opts?.sticker ? { sticker: true } : {}),
    }
    const msg: Message = {
      id: randomId('m'),
      conversationId: convId,
      senderId: this.accountId,
      kind: 'attachment',
      attachment,
      createdAt: now,
      status: 'pending',
    }
    await this.store.msgPut(msg)
    await this.store.convTouch(convId, opts?.sticker ? '[表情]' : `[${file.kind === 'file' ? '文件' : file.kind === 'image' ? '图片' : file.kind === 'audio' ? '音频' : '视频'}]`, now)
    this.bus.emit('message', msg)
    this.bus.emit('conversations', { conversationId: convId })

    const patchAtt = async (partial: Partial<Attachment>, status?: Message['status']): Promise<Message> => {
      const cur = (await this.store.msgGet(msg.id)) ?? msg
      if (cur.attachment) {
        cur.attachment = { ...cur.attachment, ...partial }
        if (partial.uploadProgress === undefined) delete cur.attachment.uploadProgress
        if (partial.uploadPhase === undefined) delete cur.attachment.uploadPhase
      }
      if (status) cur.status = status
      await this.store.msgPut(cur)
      this.bus.emit('message', cur)
      this.bus.emit('upload-progress', {
        id: cur.id,
        progress: cur.attachment?.uploadProgress ?? 100,
        phase: cur.attachment?.uploadPhase,
      })
      return cur
    }

    try {
      let sha256: string
      let size = attachment.size
      if (file.path && media.importPath) {
        const imported = await media.importPath(file.path)
        sha256 = imported.sha256
        size = imported.size
      } else {
        sha256 = await sha256OfBlob(blob)
        if (!(await media.has(sha256))) await media.write(sha256, blob)
      }
      let cur = await patchAtt({ sha256, size, uploadProgress: 8, uploadPhase: 'uploading' })

      if (this.sync?.online) {
        const local = (await media.read(sha256)) ?? blob
        const typed =
          local.type && local.type !== 'application/octet-stream'
            ? local
            : new Blob([local], { type: file.mimeType })
        const up = await this.api.uploadFile(typed, file.name, file.kind, (pct) => {
          void patchAtt({ uploadProgress: 8 + Math.round(pct * 0.9), uploadPhase: 'uploading' })
        })
        cur = await patchAtt({ url: up.url, uploadProgress: 98, uploadPhase: 'sending' })
      }

      cur = await patchAtt({ sha256, cached: true })
      if (cur.attachment) {
        delete cur.attachment.uploadProgress
        delete cur.attachment.uploadPhase
        await this.store.msgPut(cur)
        this.bus.emit('message', cur)
      }
      return this.sendMessage(peerId, cur, cur.attachment)
    } catch (e) {
      await patchAtt({}, 'failed')
      throw e
    }
  }

  async hideMessage(id: string): Promise<void> {
    const m = await this.store.msgGet(id)
    if (!m) return
    m.hiddenForMe = true
    await this.store.msgPut(m)
    this.bus.emit('message-deleted', { id, conversationId: m.conversationId })
  }

  async revokeMessage(id: string): Promise<void> {
    const m = await this.store.msgGet(id)
    if (!m || m.senderId !== this.accountId) return
    await this.applyRevoke(m)
    const peer = m.conversationId.split('__').find((p) => p && p !== this.accountId)
    if (peer && this.lan?.isOnline(peer)) this.lan.sendDelete(peer, id)
    if (this.sync?.online) {
      try {
        await this.api.deleteMessage(id)
      } catch {
        /* 离线撤回已落本地，回连后对端可能仍看到，下次同步再对齐 */
      }
    }
  }

  async applyRevoke(m: Message): Promise<void> {
    m.revoked = true
    m.kind = 'system'
    m.text = '消息已撤回'
    m.attachment = undefined
    await this.store.msgPut(m)
    await this.store.outboxRemove(m.id).catch(() => {})
    this.bus.emit('message', m)
    this.bus.emit('message-deleted', { id: m.id, conversationId: m.conversationId, revoked: true })
    this.bus.emit('conversations', { conversationId: m.conversationId })
  }

  private async sendMessage(peerId: string, msg: Message, attachment?: Attachment): Promise<Message> {
    await this.store.msgPut(msg)
    await this.store.convTouch(
      msg.conversationId,
      msg.text ?? (attachment ? `[${attachment.kind === 'file' ? '文件' : attachment.kind === 'image' ? '图片' : '视频'}]` : '[消息]'),
      msg.createdAt,
    )
    await this.store.outboxAdd(msg)
    this.bus.emit('message', msg)
    this.bus.emit('conversations', { conversationId: msg.conversationId })

    // 局域网好友在线 -> 立即 P2P 投递
    if (this.lan && this.lan.isOnline(peerId)) {
      const wireAtt = attachment ? stripClientAttachment(attachment) : undefined
      this.lan.sendMessageTo(peerId, wireAtt ? { ...msg, attachment: wireAtt } : msg)
      if (wireAtt?.sha256) {
        const blob = await this.platform.media.read(wireAtt.sha256)
        if (blob) void this.lan.sendFile(peerId, wireAtt, blob)
      }
    }
    // 服务器在线 -> 推送（离线时留在 outbox 等待回连）
    if (this.sync) void this.sync.tryPushNow()
    return msg
  }

  /* ---------------- 接收与状态 ---------------- */

  private async onPeerMessage(m: Message): Promise<void> {
    await this.sync.ingestMessage(m, { unread: true, viaLan: true })
    // 离线局域网收到的消息：标记待同步（服务器去重，由发送方最终上传）
    if (m.senderId === this.accountId) {
      await this.store.msgSetStatus(m.id, 'delivered')
    }
  }

  setActiveConversation(conversationId?: string): void {
    this.activeConversationId = conversationId
    if (conversationId) void this.store.convSetUnread(conversationId, 0)
  }

  /** 点开好友时保证本地已有会话行，否则聊天区找不到会话 */
  async ensureDirectConversation(peerId: string): Promise<string> {
    const convId = directConversationId(this.accountId, peerId)
    await this.store.convEnsure(convId, peerId)
    this.bus.emit('conversations', { conversationId: convId })
    return convId
  }

  /* ---------------- 好友 ---------------- */

  /** 按用户名添加好友（在线解析；离线不可添加） */
  async addFriend(username: string): Promise<void> {
    const resolved = await this.api.resolveUser(username.trim())
    if (resolved.userId === this.accountId) throw new Error('不能添加自己')
    await this.api.requestFriend(resolved.userId)
    await this.store.profPut({
      userId: resolved.userId,
      displayName: resolved.displayName,
      avatarUrl: resolved.avatarUrl,
      avatarHash: resolved.avatarHash,
      statusText: resolved.statusText,
      updatedAt: Date.now(),
    })
    this.bus.emit('profile', {
      userId: resolved.userId,
      displayName: resolved.displayName,
      avatarUrl: resolved.avatarUrl,
      avatarHash: resolved.avatarHash,
      statusText: resolved.statusText,
      updatedAt: Date.now(),
    })
    const st = await this.api.friends()
    const f = st.friends.find((x) => x.userId === resolved.userId)
    if (f?.confirmed) {
      await this.store.friendPut({ userId: resolved.userId, status: 'friends', updatedAt: Date.now() })
      this.bus.emit('friend', { userId: resolved.userId, status: 'friends' })
    } else {
      await this.store.friendPut({ userId: resolved.userId, status: 'outgoing', updatedAt: Date.now() })
      this.bus.emit('friend', { userId: resolved.userId, status: 'outgoing' })
    }
  }

  async acceptFriend(userId: string): Promise<void> {
    await this.api.acceptFriend(userId)
    await this.store.friendPut({ userId, status: 'friends', updatedAt: Date.now() })
    this.bus.emit('friend', { userId, status: 'friends' })
  }

  /* ---------------- 头像与资料 ---------------- */

  /** 上传裁剪后的头像：本地缓存 + 服务器（在线时） */
  async setAvatar(blob: Blob, name = 'avatar.png'): Promise<void> {
    const sha256 = await sha256OfBlob(blob)
    const media = this.platform.media
    try {
      if (!(await media.has(sha256))) await media.write(sha256, blob)
    } catch (e) {
      console.warn('avatar local cache failed:', e)
    }
    let url: string | undefined
    try {
      const r = await this.api.uploadAvatar(blob, name)
      url = r.url
    } catch (e) {
      if (!(await media.has(sha256).catch(() => false))) throw e
    }
    const p = (await this.store.profGet(this.accountId)) ?? {
      userId: this.accountId,
      displayName: this.identity.displayName,
      updatedAt: Date.now(),
    }
    p.avatarHash = sha256
    if (url) p.avatarUrl = url
    p.updatedAt = Date.now()
    await this.store.profPut(p)
    // 同步到 UI store（自己的资料也要进 profiles，头像/昵称才能即时刷新）
    this.bus.emit('profile', { ...p })
    this.bus.emit('my-avatar', { url, sha256 })
  }

  /** 头像展示 URL：本地缓存优先（离线可用），否则服务器 URL */
  async avatarUrlOf(profile: Profile | undefined): Promise<string | null> {
    if (!profile) return null
    if (profile.avatarHash && (await this.platform.media.has(profile.avatarHash))) {
      return this.platform.media.url(profile.avatarHash, 'image/jpeg')
    }
    if (profile.avatarUrl) return this.absoluteUrl(profile.avatarUrl)
    return null
  }

  /** 附件展示 URL：本地缓存优先，其次服务器 */
  async attachmentUrlOf(attachment: Attachment): Promise<string | null> {
    const att = parseAttachment(attachment) ?? attachment
    if (att.sha256 && (await this.platform.media.has(att.sha256))) {
      return this.platform.media.url(att.sha256, att.mimeType)
    }
    if (att.url) return this.absoluteUrl(att.url)
    if (att.thumbUrl) return att.thumbUrl
    return null
  }

  /** 确保附件已缓存（在线时按需拉取） */
  async ensureAttachment(attachment: Attachment): Promise<void> {
    const att = parseAttachment(attachment) ?? attachment
    if (att.sha256 && (await this.platform.media.has(att.sha256))) return
    let url = att.url
    if (!url && att.sha256) {
      try {
        url = (await this.api.lookupFile(att.sha256)).url
      } catch {
        /* 离线或服务器没有这份文件 */
      }
    }
    if (url && att.sha256 && this.sync) {
      await this.sync.cacheAttachment(att.sha256, this.absoluteUrl(url))
    }
  }

  absoluteUrl(relative: string): string {
    return relative.startsWith('http') ? relative : this.serverUrl + relative
  }

  /** 服务器在线状态 */
  get isOnline(): boolean {
    return this.sync?.online ?? false
  }
}

function stripClientAttachment(att: Attachment): Attachment {
  const next = { ...att }
  delete next.uploadProgress
  delete next.uploadPhase
  if (next.thumbUrl?.startsWith('blob:')) delete next.thumbUrl
  return next
}

/** 会话列表预览文案 */
function conversationPreview(m: Message): string {
  if (m.revoked) return '消息已撤回'
  if (m.attachment) {
    if (m.attachment.sticker) return '[表情]'
    const k = m.attachment.kind
    return `[${k === 'image' ? '图片' : k === 'video' ? '视频' : k === 'audio' ? '音频' : '文件'}]`
  }
  return (m.text ?? '').slice(0, 60)
}
