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

const activeConv = computed(() => store.conversations.find((c) => c.id === store.activeConversationId))
const peerId = computed(() => (store.activeConversationId ? store.peerOf(store.activeConversationId) : null))
const peerProfile = computed(() => (peerId.value ? store.profileOf(peerId.value) : undefined))
const peerOnline = computed(() => (peerId.value ? store.isPeerOnline(peerId.value) : false))

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

async function openAttachment(a: Attachment): Promise<void> {
  const url = await session.attachmentUrlOf(a)
  viewing.value = { attachment: a, url }
}
</script>

<template>
  <div class="shell">
    <!-- 登录门控 -->
    <LoginView v-if="!store.authed" :allow-server-edit="true" @done="store.refreshConversations()" />

    <template v-else>
      <!-- 侧栏（顶部为窗口拖拽区） -->
      <aside class="sidebar">
        <div class="titlebar">
          <div class="brand drag">
            <img :src="logoUrl" class="logo" alt="ChatAoo" />
            <span class="brand-name">ChatAoo</span>
            <span class="dot-ind" :class="{ on: store.online }" :title="store.online ? '服务器在线' : '离线（局域网模式）'" />
          </div>
        </div>
        <div class="tabs no-drag">
          <button :class="{ active: tab === 'chats' }" @click="tab = 'chats'">会话</button>
          <button :class="{ active: tab === 'friends' }" @click="tab = 'friends'">好友</button>
          <button :class="{ active: tab === 'profile' }" @click="tab = 'profile'">我的</button>
        </div>

        <div v-if="tab === 'chats'" class="list no-drag">
          <ConversationItem
            v-for="c in store.conversations"
            :key="c.id"
            :conversation="c"
            @click="store.openConversation(c.id)"
          />
          <div v-if="!store.conversations.length" class="empty">从「好友」页选择好友开始聊天</div>
        </div>

        <div v-else-if="tab === 'friends'" class="list no-drag">
          <AddFriendBox />
          <FriendItem
            v-for="f in store.friends"
            :key="f.userId"
            :profile="store.profileOf(f.userId)"
            :friend-status="friendStatusOf(f.userId)"
          />
          <div v-if="!store.friends.length" class="empty">
            还没有好友。把用户名告诉朋友，或在上方输入对方的用户名添加。
          </div>
        </div>

        <div v-else class="profile-wrap no-drag">
          <ProfilePage @close="tab = 'chats'" />
        </div>
      </aside>

      <!-- 聊天区 -->
      <main class="chat">
        <template v-if="activeConv && peerId">
          <header class="chat-head">
            <button class="peer" title="查看资料" @click="peerProfileId = peerId">
              <Avatar :profile="peerProfile" :online="peerOnline" :size="36" />
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
          <p>选择会话开始聊天，或添加局域网好友</p>
          <p class="ph-sub">离线时，局域网内互为好友的设备可点对点通信</p>
        </div>
      </main>

      <!-- 对方主页 -->
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
}
.drag {
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}
.sidebar {
  width: 300px;
  flex: none;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
}
/* 标题栏（44px，与系统窗口控件对齐） */
.titlebar {
  height: 44px;
  display: flex;
  align-items: center;
  flex: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  width: 100%;
  height: 100%;
}
.logo {
  width: 26px;
  height: 26px;
  border-radius: 7px;
}
.brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.3px;
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
  padding: 7px 0;
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
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg);
}
.peer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  margin: -4px -8px;
  border-radius: var(--radius);
}
.peer:hover {
  background: var(--bg-hover);
}
.peer-meta {
  text-align: left;
}
.peer-name {
  font-weight: 700;
  font-size: 15px;
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
.ph-sub {
  color: var(--text-faint);
  font-size: 12.5px;
}
.peer-overlay {
  position: fixed;
  right: 16px;
  top: 52px;
  bottom: 16px;
  width: min(380px, 40vw);
  background: var(--bg-sidebar);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
  z-index: 200;
  overflow: hidden;
}
</style>
