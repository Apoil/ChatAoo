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
import { sha256OfBlob, type MediaStore } from './media.js'
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
  /** 保存/打开附件（桌面：另存为对话框；移动：系统分享） */
  saveFile?(name: string, url: string): void
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

    // 有本地身份 + 登录状态 → 直接进入（在线校验失败则自动进入离线模式）
    if (this.identity && this.token) {
      this.authed = true
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

  /** 登录（在线必需）。新设备登录同一账号自动重绑定。 */
  async login(username: string, password: string): Promise<void> {
    const res = await this.api.login({ username, password })
    let identity = this.identity
    if (!identity) identity = await generateIdentity(res.user.displayName)
    if (identity.userId !== res.user.userId) {
      // 本设备未绑定该账号 → 重绑定
      const reb = await this.api.rebind(identity, { username, password })
      await this.applyAuth(reb.token, reb.user, identity, username)
    } else {
      await this.applyAuth(res.token, res.user, identity, username)
    }
    await this.startServices()
  }

  /** 注册（在线必需）：用户名 + 密码 + 昵称，绑定本设备身份 */
  async register(username: string, password: string, displayName: string): Promise<void> {
    const identity = this.identity ?? (await generateIdentity(displayName))
    const res = await this.api.register(identity, { username, password, displayName })
    await this.applyAuth(res.token, res.user, identity, username)
    await this.startServices()
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
    this.identity = identity
    this.token = token
    this.username = username
    await this.store.kvSet('identity', identity)
    await this.store.kvSet('serverToken', token)
    await this.store.kvSet('username', username)
    await this.store.profPut({
      userId: identity.userId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarHash: user.avatarHash,
      updatedAt: Date.now(),
    })
    this.authed = true
    this.bus.emit('auth', { authed: true })
  }

  /** 修改昵称（在线；离线时仅改本地，回连后重试） */
  async updateDisplayName(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || trimmed === this.identity.displayName) return
    try {
      await this.api.updateProfile({ displayName: trimmed })
    } catch {
      /* 离线：仅本地生效 */
    }
    this.identity.displayName = trimmed
    await this.store.kvSet('identity', this.identity)
    const p = (await this.store.profGet(this.identity.userId)) ?? {
      userId: this.identity.userId,
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
    if (this.online) {
      try {
        const { messages } = await this.api.history(conversationId, Date.now(), limit)
        if (messages.length) {
          for (const sm of messages) {
            await this.sync.ingestMessage(
              {
                id: sm.id,
                conversationId: sm.conversationId,
                senderId: sm.senderId,
                kind: sm.kind,
                text: sm.text,
                attachment: sm.attachment,
                createdAt: sm.createdAt,
                status: 'sent',
                seq: sm.seq,
              },
              { unread: false },
            )
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
    const convId = directConversationId(this.identity.userId, peerId)
    const msg: Message = {
      id: randomId('m'),
      conversationId: convId,
      senderId: this.identity.userId,
      kind: 'text',
      text,
      createdAt: Date.now(),
      status: 'pending',
    }
    return this.sendMessage(peerId, msg)
  }

  async sendAttachment(
    peerId: string,
    file: { blob: Blob; name: string; kind: AttachmentKind; mimeType: string },
  ): Promise<Message> {
    const sha256 = await sha256OfBlob(file.blob)
    const media = this.platform.media
    if (!(await media.has(sha256))) {
      await media.write(sha256, file.blob)
    }
    const attachment: Attachment = {
      id: randomId('a'),
      kind: file.kind,
      name: file.name,
      mimeType: file.mimeType,
      size: file.blob.size,
      sha256,
      cached: true,
      createdAt: Date.now(),
    }
    const convId = directConversationId(this.identity.userId, peerId)
    const msg: Message = {
      id: randomId('m'),
      conversationId: convId,
      senderId: this.identity.userId,
      kind: 'attachment',
      attachment,
      createdAt: Date.now(),
      status: 'pending',
    }
    return this.sendMessage(peerId, msg, attachment)
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
      this.lan.sendMessageTo(peerId, msg)
      if (attachment) {
        const blob = await this.platform.media.read(attachment.sha256)
        if (blob) void this.lan.sendFile(peerId, attachment, blob)
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
    if (m.senderId === this.identity.userId) {
      await this.store.msgSetStatus(m.id, 'delivered')
    }
  }

  setActiveConversation(conversationId?: string): void {
    this.activeConversationId = conversationId
    if (conversationId) void this.store.convSetUnread(conversationId, 0)
  }

  /* ---------------- 好友 ---------------- */

  /** 按用户名添加好友（在线解析；离线不可添加） */
  async addFriend(username: string): Promise<void> {
    const resolved = await this.api.resolveUser(username.trim())
    if (resolved.userId === this.identity.userId) throw new Error('不能添加自己')
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
    if (!(await media.has(sha256))) await media.write(sha256, blob)
    let url: string | undefined
    try {
      const r = await this.api.uploadAvatar(blob, name)
      url = r.url
    } catch {
      // 离线：仅本地保存，回连后由 UI 提示重试
    }
    const p = (await this.store.profGet(this.identity.userId)) ?? {
      userId: this.identity.userId,
      displayName: this.identity.displayName,
      updatedAt: Date.now(),
    }
    p.avatarHash = sha256
    if (url) p.avatarUrl = url
    p.updatedAt = Date.now()
    await this.store.profPut(p)
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
    if (attachment.cached && attachment.sha256 && (await this.platform.media.has(attachment.sha256))) {
      return this.platform.media.url(attachment.sha256, attachment.mimeType)
    }
    if (attachment.url) return this.absoluteUrl(attachment.url)
    return null
  }

  /** 确保附件已缓存（在线时按需拉取） */
  async ensureAttachment(attachment: Attachment): Promise<void> {
    if (attachment.cached) return
    if (attachment.url) {
      await this.sync.cacheAttachment(attachment.sha256, this.absoluteUrl(attachment.url))
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
