/**
 * 共享 Pinia store：把 ChatSession 的业务事件镜像为响应式状态。
 * 桌面端与移动端共用。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatSession, FriendRecord } from '@chataoo/app-core'
import type { Conversation, Message, Profile } from '@chataoo/shared'
import type { LanPeerInfo } from '@chataoo/app-core'

export const useChatStore = defineStore('chat', () => {
  const session = ref<ChatSession | null>(null)
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
      }),
      s.bus.on('message', (m) => {
        const list = messages.value[m.conversationId] ?? []
        if (!list.some((x) => x.id === m.id)) {
          messages.value[m.conversationId] = [...list, m].sort((a, b) => a.createdAt - b.createdAt)
        } else {
          messages.value[m.conversationId] = list.map((x) => (x.id === m.id ? m : x))
        }
        void refreshConversations()
      }),
      s.bus.on('message-status', ({ id, status }) => {
        for (const key of Object.keys(messages.value)) {
          const list = messages.value[key] ?? []
          messages.value[key] = list.map((m) => (m.id === id ? { ...m, status } : m))
        }
      }),
      s.bus.on('conversations', () => void refreshConversations()),
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
    )

    await refreshConversations()
    await refreshFriends()
    await refreshProfiles()
    ready.value = true
  }

  async function refreshFriends(): Promise<void> {
    if (!session.value) return
    friends.value = await session.value.store.friendsList()
  }

  async function refreshConversations(): Promise<void> {
    if (!session.value) return
    conversations.value = await session.value.conversations()
  }

  async function refreshProfiles(): Promise<void> {
    if (!session.value) return
    for (const p of await session.value.profiles()) {
      profiles.value[p.userId] = p
    }
  }

  async function openConversation(peerId: string): Promise<void> {
    const s = session.value
    if (!s) return
    const convId = peerId.startsWith('c_') ? peerId : convIdOf(peerId)
    activeConversationId.value = convId
    s.setActiveConversation(convId)
    if (!messages.value[convId]) messages.value[convId] = []
    messages.value[convId] = await s.messagesIn(convId)
  }

  function convIdOf(peerId: string): string {
    const s = session.value
    return [s!.me.userId, peerId].sort().join('__')
  }

  function profileOf(userId: string): Profile | undefined {
    return profiles.value[userId]
  }

  function isPeerOnline(userId: string): boolean {
    return !!presence.value[userId] || !!lanPeers.value[userId]?.online
  }

  async function sendText(text: string): Promise<void> {
    const s = session.value
    const active = activeConversationId.value
    if (!s || !active) return
    const peer = peerOf(active)
    if (!peer) return
    const msg = await s.sendText(peer, text)
    const list = messages.value[active] ?? []
    messages.value[active] = [...list, msg]
  }

  async function sendFiles(files: { blob: Blob; name: string }[]): Promise<void> {
    const s = session.value
    const active = activeConversationId.value
    if (!s || !active) return
    const peer = peerOf(active)
    if (!peer) return
    for (const f of files) {
      const kind = (f.name.match(/\.(png|jpe?g|webp|gif|bmp)$/i) ? 'image'
        : f.name.match(/\.(mp4|webm|mov|mkv|avi)$/i) ? 'video'
        : f.name.match(/\.(mp3|wav|ogg|m4a)$/i) ? 'audio' : 'file') as 'image' | 'video' | 'audio' | 'file'
      const msg = await s.sendAttachment(peer, {
        blob: f.blob,
        name: f.name,
        kind,
        mimeType: f.blob.type || 'application/octet-stream',
      })
      const list = messages.value[active] ?? []
      messages.value[active] = [...list, msg]
    }
  }

  function peerOf(convId: string): string | null {
    const s = session.value
    if (!s) return null
    const parts = convId.split('__')
    if (parts.length !== 2) return null
    return parts[0] === s.me.userId ? parts[1]! : parts[0]!
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
    init,
    openConversation,
    refreshConversations,
    refreshFriends,
    refreshProfiles,
    profileOf,
    isPeerOnline,
    sendText,
    sendFiles,
    loadHistory,
    peerOf,
  }
})
