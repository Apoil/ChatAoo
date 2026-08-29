<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { ChatSession } from '@chataoo/app-core'
import {
  AddFriendBox,
  Avatar,
  ChatInput,
  ConversationItem,
  FriendItem,
  Icon,
  LoginView,
  logoUrl,
  MediaViewer,
  MessageList,
  ProfilePage,
  useChatStore,
} from '@chataoo/ui'
import type { Attachment } from '@chataoo/shared'

const session = inject<ChatSession>('session')!
const store = useChatStore()
const tab = ref<'chats' | 'friends' | 'profile'>('chats')
const viewing = ref<{ attachment: Attachment; url: string | null } | null>(null)
const peerProfileId = ref<string | null>(null)

const wide = ref(window.innerWidth >= 720)
window.addEventListener('resize', () => (wide.value = window.innerWidth >= 720))

const peerId = computed(() => (store.activeConversationId ? store.peerOf(store.activeConversationId) : null))
const chatting = computed(() => !!store.activeConversationId && !!peerId.value)
const peerProfile = computed(() => (peerId.value ? store.profileOf(peerId.value) : undefined))
const peerOnline = computed(() => (peerId.value ? store.isPeerOnline(peerId.value) : false))
const me = computed(() => (store.session ? store.profileOf(store.session.me.userId) : undefined))
const sideTitle = computed(() => (tab.value === 'chats' ? '消息' : tab.value === 'friends' ? '好友' : '我'))

function friendStatusOf(userId: string): string {
  return store.friends.find((f) => f.userId === userId)?.status ?? 'none'
}

function back(): void {
  store.activeConversationId = null
  session.setActiveConversation(undefined)
}

onMounted(async () => {
  await store.init(session)
  if (store.authed) {
    const last = store.conversations[0]
    if (last) void store.openConversation(last.id)
  }
})

watch(
  () => store.activeConversationId,
  (id) => {
    if (id) tab.value = 'chats'
  },
)

async function openAttachment(a: Attachment): Promise<void> {
  const url = await session.attachmentUrlOf(a)
  viewing.value = { attachment: a, url }
}
</script>

<template>
  <div class="shell" :class="{ wide }">
    <LoginView v-if="!store.authed" :allow-server-edit="true" @done="store.refreshConversations()" />

    <template v-else>
      <aside v-if="wide || !chatting" class="sidebar">
        <div class="brand">
          <img :src="logoUrl" class="logo" alt="ChatAoo" />
          <h1>{{ wide ? sideTitle : 'ChatAoo' }}</h1>
          <span class="net" :class="{ on: store.online }" />
        </div>

        <div v-if="tab === 'chats'" class="list">
          <ConversationItem
            v-for="c in store.conversations"
            :key="c.id"
            :conversation="c"
            @click="store.openConversation(c.id)"
          />
          <p v-if="!store.conversations.length" class="empty-hint">还没有会话。去「好友」里挑一个人开始聊。</p>
        </div>

        <div v-else-if="tab === 'friends'" class="list">
          <AddFriendBox />
          <FriendItem
            v-for="f in store.friends"
            :key="f.userId"
            :user-id="f.userId"
            :profile="store.profileOf(f.userId)"
            :friend-status="friendStatusOf(f.userId)"
          />
          <p v-if="!store.friends.length" class="empty-hint">在「我」里复制用户名发给朋友，或在上方输入对方用户名。</p>
        </div>

        <div v-else class="profile-wrap">
          <ProfilePage :show-back="false" />
        </div>

        <nav class="dock">
          <button :class="{ active: tab === 'chats' }" @click="tab = 'chats'">
            <Icon name="chat" :size="20" />
            消息
          </button>
          <button :class="{ active: tab === 'friends' }" @click="tab = 'friends'">
            <Icon name="users" :size="20" />
            好友
          </button>
          <button :class="{ active: tab === 'profile' }" @click="tab = 'profile'">
            <Avatar :profile="me" :size="22" />
            我
          </button>
        </nav>
      </aside>

      <main v-if="wide || chatting" class="chat">
        <template v-if="chatting && store.activeConversationId">
          <header class="chat-head">
            <button v-if="!wide" class="icon-btn back" @click="back">
              <Icon name="back" :size="20" />
            </button>
            <button v-if="peerId" class="peer" @click="peerProfileId = peerId">
              <Avatar :profile="peerProfile" :online="peerOnline" :size="32" />
              <div class="peer-meta">
                <div class="peer-name">{{ peerProfile?.displayName ?? peerId.slice(0, 10) }}</div>
                <div class="peer-sub">
                  <span v-if="peerOnline" class="online-txt">在线</span>
                  <span v-else>离线</span>
                </div>
              </div>
            </button>
          </header>
          <MessageList :key="store.activeConversationId" :conversation-id="store.activeConversationId" @open="openAttachment" />
          <ChatInput @send-text="(t) => store.sendText(t)" @send-files="(f) => store.sendFiles(f)" />
        </template>
        <div v-else class="placeholder">
          <p>从左侧选一个会话</p>
        </div>
      </main>

      <div v-if="peerProfileId" class="peer-overlay" :class="{ phone: !wide }">
        <ProfilePage
          :peer-id="peerProfileId"
          @close="peerProfileId = null"
          @open-chat="(id) => store.openConversation(id)"
        />
      </div>

      <MediaViewer v-if="viewing" :attachment="viewing.attachment" :url="viewing.url" @close="viewing = null" />
    </template>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100dvh;
  background: var(--bg-sidebar);
}
.shell.wide .sidebar {
  width: 300px;
  border-right: 1px solid var(--border-soft);
}
.shell:not(.wide) .sidebar {
  width: 100%;
}
.sidebar {
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  padding-top: calc(10px + env(safe-area-inset-top, 0px));
}
.logo {
  width: 26px;
  height: 26px;
  border-radius: 6px;
}
.brand h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  flex: 1;
}
.net {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
}
.net.on {
  background: var(--ok);
}
.list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.profile-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.dock {
  display: flex;
  border-top: 1px solid var(--border-soft);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--bg-sidebar);
  flex: none;
}
.dock button {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 0 6px;
  font-size: 10px;
  color: var(--text-faint);
}
.dock button.active {
  color: var(--accent);
}
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-chat);
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  padding-top: calc(8px + env(safe-area-inset-top, 0px));
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border-soft);
}
.back {
  flex: none;
}
.peer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  flex: none;
  min-width: max-content;
  line-height: 1.2;
}
.peer:active {
  background: var(--bg-hover);
}
.peer-meta {
  flex: none;
  min-width: max-content;
  text-align: left;
}
.peer-name {
  font-weight: 600;
  font-size: 15px;
  line-height: 1.25;
  white-space: nowrap;
}
.peer-sub {
  font-size: 11px;
  line-height: 1.25;
  color: var(--text-faint);
  white-space: nowrap;
}
.online-txt {
  color: var(--ok);
}
.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 13px;
}
.peer-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-sidebar);
  z-index: 300;
}
.peer-overlay:not(.phone) {
  right: 0;
  left: auto;
  width: min(360px, 45vw);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-float);
}
</style>
