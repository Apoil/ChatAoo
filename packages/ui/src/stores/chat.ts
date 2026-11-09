/**
 * 共享 Pinia store：把 ChatSession 的业务事件镜像为响应式状态。
 * 桌面端与移动端共用。
 *
 * 注意：session 必须用 shallowRef —— 若用 ref 深响应式包装，组件通过
 * `store.session.login()` 等方法调用时 `this` 会绑定到 Proxy 包装的实例，
 * 导致 `this.identity` 等属性变成不可克隆的 Proxy 对象，写入 IndexedDB
 * 时抛 "could not be cloned"。
 */
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { inferKind, inferMime, type ChatSession, type FriendRecord } from '@chataoo/app-core'
import type { Conversation, Message, Profile } from '@chataoo/shared'
import type { LanPeerInfo } from '@chataoo/app-core'

export const useChatStore = defineStore('chat', () => {
  const session = shallowRef<ChatSession | null>(null)
  const ready = ref(false)
  const authed = ref(false)
  const online = ref(false)
  const conversations = ref<Conversation[]>([])
  const messages = ref<Record<string, Message[]>>({})
  const profiles = ref<Record<string, Profile>>({})
  const friends = ref<FriendRecord[]>([])
  const presence = ref<Record<string, boolean>>({})
  const lanPeers = ref<Record<string, LanPeerInfo>>({})
  const activeConversationId = ref<string | null>(null)
  const mediaTick = ref(0)

  let unsubs: (() => void)[] = []

  async function init(s: ChatSession): Promise<void> {
    session.value = s
    ready.value = false
    authed.value = s.authed
    for (const u of unsubs) u()
    unsubs = []

    unsubs.push(
      s.bus.on('auth', ({ authed: a }) => {
        authed.value = a
        if (a) void refreshProfiles()
      }),
      s.bus.on('message', (m) => {
        upsertLocalMessage(m)
        void refreshConversations()
      }),
      s.bus.on('message-status', ({ id, status }) => {
        for (const key of Object.keys(messages.value)) {
          const list = messages.value[key] ?? []
          messages.value[key] = list.map((m) => (m.id === id ? { ...m, status } : m))
        }
      }),
      s.bus.on('conversations', () => {
      // 拉取到新会话时好友列表可能也是新的（多设备/另一台设备加的好友）：先刷新好友再过滤会话
      void refreshFriends().then(() => refreshConversations())
    }),
      s.bus.on('profile', (p) => {
        profiles.value[p.userId] = p
      }),
      s.bus.on('friend', () => {
        void refreshFriends()
        void refreshConversations()
        void refreshProfiles()
      }),
      s.bus.on('presence', ({ userId, online: o }) => {
        presence.value[userId] = o
      }),
      s.bus.on('lan-peer', (info) => {
        if (info.online) lanPeers.value[info.userId] = info
        else delete lanPeers.value[info.userId]
      }),
      s.bus.on('online', (o) => (online.value = o)),
      s.bus.on('media-cached', ({ sha256 }) => markAttachmentCached(sha256)),
      s.bus.on('lan-file', ({ sha256 }) => markAttachmentCached(sha256)),
      s.bus.on('message-deleted', ({ id, conversationId, revoked }) => {
        if (revoked) return
        const list = messages.value[conversationId]
        if (list) messages.value[conversationId] = list.filter((m) => m.id !== id)
        void refreshConversations()
      }),
    )

    await refreshFriends()
    await refreshProfiles()
    await refreshConversations()
    ready.value = true
  }

  async function refreshFriends(): Promise<void> {
    if (!session.value) return
    friends.value = (await session.value.store.friendsList()).filter((f) => f.status !== 'none')
  }

  async function refreshConversations(): Promise<void> {
    if (!session.value) return
    const all = await session.value.conversations()
    conversations.value = all.filter((c) => {
      const peer = peerOf(c.id)
      return !!peer && friends.value.some((f) => f.userId === peer)
    })
  }

  async function refreshProfiles(): Promise<void> {
    if (!session.value?.authed || !session.value.identity) return
    const me = session.value.accountId ?? session.value.me.userId
    const self = await session.value.store.profGet(me)
    if (self) profiles.value[me] = self
    for (const p of await session.value.profiles()) {
      profiles.value[p.userId] = p
    }
  }

  async function openConversation(idOrPeer: string): Promise<void> {
    const s = session.value
    if (!s) return
    let peer = idOrPeer.includes('__') ? peerOf(idOrPeer) : idOrPeer
    if (!peer) return
    if (!friends.value.some((f) => f.userId === peer)) {
      const ghostName = profileOf(peer)?.displayName
      const hit = friends.value.find((f) => profileOf(f.userId)?.displayName === ghostName)
      if (hit) peer = hit.userId
    }
    const convId = await s.ensureDirectConversation(peer)
    activeConversationId.value = convId
    s.setActiveConversation(convId)
    await refreshConversations()
    messages.value[convId] = await s.messagesIn(convId)
  }

  function convIdOf(peerId: string): string {
    const s = session.value
    return [s!.accountId ?? s!.me.userId, peerId].sort().join('__')
  }

  function profileOf(userId: string): Profile | undefined {
    return profiles.value[userId]
  }

  function isPeerOnline(userId: string): boolean {
    return !!presence.value[userId] || !!lanPeers.value[userId]?.online
  }

  function upsertLocalMessage(msg: Message): void {
    const list = messages.value[msg.conversationId] ?? []
    if (list.some((x) => x.id === msg.id)) {
      messages.value[msg.conversationId] = list.map((x) => (x.id === msg.id ? msg : x))
    } else {
      messages.value[msg.conversationId] = [...list, msg].sort((a, b) => a.createdAt - b.createdAt)
    }
  }

  async function sendText(text: string): Promise<void> {
    const s = session.value
    const active = activeConversationId.value
    if (!s || !active) return
    const peer = peerOf(active)
    if (!peer) return
    upsertLocalMessage(await s.sendText(peer, text))
  }

  function markAttachmentCached(sha256: string): void {
    mediaTick.value++
    for (const key of Object.keys(messages.value)) {
      const list = messages.value[key] ?? []
      if (!list.some((m) => m.attachment?.sha256 === sha256)) continue
      messages.value[key] = list.map((m) =>
        m.attachment?.sha256 === sha256
          ? { ...m, attachment: { ...m.attachment, cached: true } }
          : m,
      )
    }
  }

  async function sendFiles(files: { blob: Blob; name: string }[]): Promise<void> {
    const s = session.value
    const active = activeConversationId.value
    if (!s || !active) return
    const peer = peerOf(active)
    if (!peer) return
    for (const f of files) {
      const mime = inferMime(f.name, f.blob.type)
      const kind = inferKind(f.name, mime)
      const path = f.blob instanceof File ? s.platform.media.pathOfFile?.(f.blob) : undefined
      try {
        const msg = await s.sendAttachment(peer, {
          blob: f.blob,
          name: f.name || (kind === 'video' ? 'video.mp4' : kind === 'image' ? 'image.jpg' : 'file'),
          kind,
          mimeType: mime,
          path,
        })
        upsertLocalMessage(msg)
      } catch (e) {
        console.error('send file failed:', e)
      }
    }
  }

  function peerOf(convId: string): string | null {
    const s = session.value
    if (!s) return null
    const parts = convId.split('__')
    if (parts.length !== 2) return null
    const me = s.accountId ?? s.me.userId
    return parts[0] === me ? parts[1]! : parts[0]!
  }

  async function hideMessage(id: string): Promise<void> {
    await session.value?.hideMessage(id)
  }

  async function revokeMessage(id: string): Promise<void> {
    await session.value?.revokeMessage(id)
  }

  async function loadHistory(before: number): Promise<void> {
    const s = session.value
    const active = activeConversationId.value
    if (!s || !active) return
    const older = await s.messagesIn(active, before)
    messages.value[active] = [...older, ...(messages.value[active] ?? [])]
  }

  return {
    session,
    ready,
    authed,
    online,
    conversations,
    messages,
    profiles,
    friends,
    presence,
    lanPeers,
    activeConversationId,
    mediaTick,
    init,
    openConversation,
    refreshConversations,
    refreshFriends,
    refreshProfiles,
    profileOf,
    isPeerOnline,
    sendText,
    sendFiles,
    hideMessage,
    revokeMessage,
    loadHistory,
    peerOf,
  }
})
