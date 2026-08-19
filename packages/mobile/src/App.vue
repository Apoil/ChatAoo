<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { ChatSession } from '@chataoo/app-core'
import {
  AddFriendBox,
  Avatar,
  ChatInput,
  ConversationItem,
  FriendItem,
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

// 自适应：≥720px 视为平板（双栏），否则手机（单栏）
const wide = ref(window.innerWidth >= 720)
window.addEventListener('resize', () => (wide.value = window.innerWidth >= 720))

const activeConv = computed(() => store.conversations.find((c) => c.id === store.activeConversationId))
const peerId = computed(() => (store.activeConversationId ? store.peerOf(store.activeConversationId) : null))
const peerProfile = computed(() => (peerId.value ? store.profileOf(peerId.value) : undefined))
const peerOnline = computed(() => (peerId.value ? store.isPeerOnline(peerId.value) : false))

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

async function openAttachment(a: Attachment): Promise<void> {
  const url = await session.attachmentUrlOf(a)
  viewing.value = { attachment: a, url }
}
</script>

<template>
  <div class="shell" :class="{ wide }">
    <!-- 登录门控 -->
    <LoginView v-if="!store.authed" :allow-server-edit="true" @done="store.refreshConversations()" />

    <template v-else>
      <!-- 侧栏（手机：独立页；平板：常驻） -->
      <aside v-if="wide || !activeConv" class="sidebar" :class="{ phone: !wide }">
        <div class="brand">
          <img :src="logoUrl" class="logo" alt="ChatAoo" />
          <span class="brand-name">ChatAoo</span>
          <span class="dot-ind" :class="{ on: store.online }" />
        </div>
        <div class="tabs">
          <button :class="{ active: tab === 'chats' }" @click="tab = 'chats'">会话</button>
          <button :class="{ active: tab === 'friends' }" @click="tab = 'friends'">好友</button>
          <button :class="{ active: tab === 'profile' }" @click="tab = 'profile'">我的</button>
        </div>

        <template v-if="tab === 'chats'">
          <div class="list">
            <ConversationItem
              v-for="c in store.conversations"
              :key="c.id"
              :conversation="c"
              @click="store.openConversation(c.id)"
            />
            <div v-if="!store.conversations.length" class="empty">从「好友」页选择好友开始聊天</div>
          </div>
        </template>

        <template v-else-if="tab === 'friends'">
          <AddFriendBox />
          <div class="list">
            <FriendItem
              v-for="f in store.friends"
              :key="f.userId"
              :profile="store.profileOf(f.userId)"
              :friend-status="friendStatusOf(f.userId)"
            />
            <div v-if="!store.friends.length" class="empty">
              在「我的」页查看你的用户名发给朋友，或在上方输入对方的用户名添加
            </div>
          </div>
        </template>

        <div v-else class="profile-wrap">
          <ProfilePage @close="tab = 'chats'" />
        </div>
      </aside>

      <!-- 聊天区 -->
      <main v-if="wide || activeConv" class="chat" :class="{ phone: !wide }">
        <template v-if="activeConv && peerId">
          <header class="chat-head">
            <button v-if="!wide" class="icon-btn back" @click="back">←</button>
            <button class="peer" @click="peerProfileId = peerId">
              <Avatar :profile="peerProfile" :online="peerOnline" :size="34" />
              <div class="peer-meta">
                <div class="peer-name">{{ peerProfile?.displayName ?? peerId.slice(0, 10) }}</div>
                <div class="peer-sub">
                  <span v-if="peerOnline" class="online-txt">在线</span>
                  <span v-else class="offline-txt">离线</span>
                </div>
              </div>
            </button>
          </header>
          <MessageList :conversation-id="activeConv.id" @open="openAttachment" />
          <ChatInput @send-text="(t) => store.sendText(t)" @send-files="(f) => store.sendFiles(f)" />
        </template>
        <div v-else class="placeholder">
          <img :src="logoUrl" class="ph-logo" alt="" />
          <p>选择会话开始聊天</p>
        </div>
      </main>

      <!-- 对方主页（手机全屏 / 平板侧栏） -->
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
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
}
.logo {
  width: 30px;
  height: 30px;
  border-radius: 8px;
}
.brand-name {
  font-size: 17px;
  font-weight: 800;
}
.dot-ind {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--danger);
  margin-left: auto;
}
.dot-ind.on {
  background: var(--ok);
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 12px 8px;
}
.tabs button {
  flex: 1;
  padding: 8px 0;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
}
.tabs button.active {
  background: var(--bg-active);
  color: var(--text);
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 12px;
}
.empty {
  color: var(--text-faint);
  font-size: 13px;
  text-align: center;
  padding: 30px 16px;
  line-height: 1.6;
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
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
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
  border-radius: var(--radius);
}
.peer:active {
  background: var(--bg-hover);
}
.peer-meta {
  min-width: 0;
  text-align: left;
}
.peer-name {
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.peer-sub {
  font-size: 11.5px;
}
.online-txt {
  color: var(--ok);
}
.offline-txt {
  color: var(--text-faint);
}
.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  gap: 8px;
}
.ph-logo {
  width: 96px;
  height: 96px;
  border-radius: 24px;
  opacity: 0.9;
  margin-bottom: 10px;
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
  width: min(380px, 45vw);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-float);
}
</style>
