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

const peerId = computed(() => (store.activeConversationId ? store.peerOf(store.activeConversationId) : null))
const chatting = computed(() => !!store.activeConversationId && !!peerId.value)
const peerProfile = computed(() => (peerId.value ? store.profileOf(peerId.value) : undefined))
const peerOnline = computed(() => (peerId.value ? store.isPeerOnline(peerId.value) : false))
const me = computed(() => (store.session ? store.profileOf(store.session.me.userId) : undefined))
const sideTitle = computed(() => (tab.value === 'chats' ? '消息' : tab.value === 'friends' ? '好友' : '我'))

function friendStatusOf(userId: string): string {
  return store.friends.find((f) => f.userId === userId)?.status ?? 'none'
}

onMounted(async () => {
  await store.init(session)
  if (store.authed) {
    const last = store.conversations[0]
    if (last) void store.openConversation(last.id)
  }
})

watch(
  () => store.authed,
  (a) => {
    void window.chataoo?.win.resize(a ? 'chat' : 'login')
  },
)

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
  <div class="shell">
    <LoginView v-if="!store.authed" :allow-server-edit="true" @done="store.refreshConversations()" />

    <template v-else>
      <nav class="rail">
        <div class="rail-brand drag">
          <img :src="logoUrl" class="logo" alt="ChatAoo" />
        </div>
        <div class="rail-tabs no-drag">
          <button :class="{ active: tab === 'chats' }" title="消息" @click="tab = 'chats'">
            <Icon name="chat" :size="20" />
            <span>消息</span>
          </button>
          <button :class="{ active: tab === 'friends' }" title="好友" @click="tab = 'friends'">
            <Icon name="users" :size="20" />
            <span>好友</span>
          </button>
        </div>
        <div class="rail-foot no-drag">
          <span class="net" :class="{ on: store.online }" :title="store.online ? '服务器在线' : '离线（局域网）'" />
          <button class="me" :class="{ active: tab === 'profile' }" title="我" @click="tab = 'profile'">
            <Avatar :profile="me" :size="32" />
          </button>
        </div>
      </nav>

      <aside class="sidebar">
        <div class="side-head drag">
          <h1>{{ sideTitle }}</h1>
        </div>

        <div v-if="tab === 'chats'" class="list no-drag">
          <ConversationItem
            v-for="c in store.conversations"
            :key="c.id"
            :conversation="c"
            @click="store.openConversation(c.id)"
          />
          <p v-if="!store.conversations.length" class="empty-hint">还没有会话。去「好友」里挑一个人开始聊。</p>
        </div>

        <div v-else-if="tab === 'friends'" class="list no-drag">
          <AddFriendBox />
          <FriendItem
            v-for="f in store.friends"
            :key="f.userId"
            :user-id="f.userId"
            :profile="store.profileOf(f.userId)"
            :friend-status="friendStatusOf(f.userId)"
          />
          <p v-if="!store.friends.length" class="empty-hint">把你的用户名发给朋友，或在上方输入对方的用户名。</p>
        </div>

        <div v-else class="profile-wrap no-drag">
          <ProfilePage :show-back="false" />
        </div>
      </aside>

      <main class="chat">
        <header class="chat-head">
          <button v-if="chatting && peerId" class="peer no-drag" title="查看资料" @click="peerProfileId = peerId">
            <Avatar :profile="peerProfile" :online="peerOnline" :size="32" />
            <div class="peer-meta">
              <div class="peer-name">{{ peerProfile?.displayName ?? peerId.slice(0, 10) }}</div>
              <div class="peer-sub">
                <span v-if="peerOnline" class="online-txt">在线</span>
                <span v-else>离线</span>
              </div>
            </div>
          </button>
          <div class="chat-drag" />
        </header>
        <template v-if="chatting && store.activeConversationId">
          <MessageList :key="store.activeConversationId" :conversation-id="store.activeConversationId" @open="openAttachment" />
          <ChatInput @send-text="(t) => store.sendText(t)" @send-files="(f) => store.sendFiles(f)" />
        </template>
        <div v-else class="placeholder">
          <p>从左侧选一个会话</p>
        </div>
      </main>

      <div v-if="peerProfileId" class="peer-overlay">
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
  height: 100vh;
  background: var(--bg-sidebar);
}
.drag {
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}
.rail {
  width: 68px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-soft);
}
.rail-brand {
  height: var(--chrome-h);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.logo {
  width: 28px;
  height: 28px;
  border-radius: 7px;
}
.rail-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 8px 8px 0;
}
.rail-tabs button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 0 6px;
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  font-size: 10px;
}
.rail-tabs button:hover {
  background: var(--bg-hover);
  color: var(--text-dim);
}
.rail-tabs button.active {
  background: var(--bg-active);
  color: var(--accent);
}
.rail-foot {
  margin-top: auto;
  padding: 12px 0 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
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
.me {
  border-radius: 28%;
  padding: 0;
  outline: 2px solid transparent;
}
.me.active {
  outline-color: var(--accent);
}
.sidebar {
  width: 280px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-soft);
  background: var(--bg-sidebar);
}
.side-head {
  height: var(--chrome-h);
  display: flex;
  align-items: center;
  padding: 0 16px;
  flex: none;
}
.side-head h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.list {
  flex: 1;
  overflow-y: auto;
}
.profile-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-chat);
}
.chat-head {
  min-height: var(--chrome-h);
  height: var(--chrome-h);
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 8px 0 12px;
  padding-right: env(titlebar-area-width, 138px);
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border-soft);
  -webkit-app-region: drag;
  overflow: hidden;
}
.peer {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  flex: none;
  min-width: max-content;
  line-height: 1.2;
}
.peer:hover {
  background: var(--bg-hover);
}
.peer-meta {
  text-align: left;
  flex: none;
  min-width: max-content;
}
.peer-name {
  font-weight: 600;
  font-size: 14px;
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
.chat-drag {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag;
}
.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 13px;
  background: var(--bg-chat);
  -webkit-app-region: drag;
}
.peer-overlay {
  position: fixed;
  right: 12px;
  top: 52px;
  bottom: 12px;
  width: min(360px, 38vw);
  background: var(--bg-sidebar);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-float);
  z-index: 200;
  overflow: hidden;
}
</style>
