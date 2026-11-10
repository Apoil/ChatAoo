<script setup lang="ts">
/**
 * 桌面外壳（docs/DESIGN-SYSTEM.md §3.1 / §5）
 * 结构：44px 标题栏（拖拽）→ [68px rail | 312px 列表栏 | 会话区]
 * 颜色/尺度只使用 @chataoo/ui 的 theme.css 语义 token。
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import { ChatSession } from '@chataoo/app-core'
import type { Attachment } from '@chataoo/shared'
import {
  AddFriendBox,
  Avatar,
  ChatInput,
  ConversationItem,
  EmptyState,
  FriendItem,
  Icon,
  LoginView,
  logoUrl,
  MediaViewer,
  MessageList,
  ProfilePage,
  SettingsSheet,
  THEME_CHROME,
  useChatStore,
  useTheme,
} from '@chataoo/ui'
import type { IconName, ThemeMode } from '@chataoo/ui'

type Tab = 'chats' | 'friends' | 'profile'

const session = inject<ChatSession>('session')!
const store = useChatStore()
const { mode, resolved, cycle } = useTheme()

const tab = ref<Tab>('chats')
const query = ref('')
const showAddFriend = ref(false)
const settingsOpen = ref(false)
const viewing = ref<{ attachment: Attachment; url: string | null } | null>(null)
const peerProfileId = ref<string | null>(null)

const peerId = computed(() => (store.activeConversationId ? store.peerOf(store.activeConversationId) : null))
const chatting = computed(() => !!store.activeConversationId && !!peerId.value)
const peerProfile = computed(() => (peerId.value ? store.profileOf(peerId.value) : undefined))
const peerOnline = computed(() => (peerId.value ? store.isPeerOnline(peerId.value) : false))
const peerName = computed(() => {
  const id = peerId.value
  if (!id) return ''
  return store.profileOf(id)?.displayName ?? id.slice(0, 10)
})
const sideTitle = computed(() => (tab.value === 'chats' ? '消息' : tab.value === 'friends' ? '联系人' : '我'))
const searchPlaceholder = computed(() => (tab.value === 'friends' ? '搜索联系人' : '搜索会话'))
const newTitle = computed(() => {
  if (tab.value === 'friends') return showAddFriend.value ? '收起添加好友' : '添加好友'
  return '新建会话'
})

/** 在线 / 局域网 / 离线（会话头状态点） */
const peerStatus = computed<{ label: string; tone: 'on' | 'lan' | 'off' } | null>(() => {
  const id = peerId.value
  if (!id) return null
  if (store.presence[id]) return { label: '在线', tone: 'on' }
  if (store.lanPeers[id]?.online) return { label: '局域网在线', tone: 'lan' }
  return { label: '离线', tone: 'off' }
})

const MODE_LABEL: Record<ThemeMode, string> = { system: '跟随系统', light: '浅色', dark: '深色' }
const themeIcon = computed<IconName>(() =>
  mode.value === 'light' ? 'sun' : mode.value === 'dark' ? 'moon' : 'monitor',
)
const themeTitle = computed(() => `主题：${MODE_LABEL[mode.value]}（点击切换）`)

const conversationList = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.conversations
  return store.conversations.filter((c) => {
    const peer = store.peerOf(c.id)
    const name = peer ? (store.profileOf(peer)?.displayName ?? peer) : ''
    return name.toLowerCase().includes(q) || (c.lastMessagePreview ?? '').toLowerCase().includes(q)
  })
})

const friendList = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.friends
  return store.friends.filter((f) => {
    const name = store.profileOf(f.userId)?.displayName ?? f.userId
    return name.toLowerCase().includes(q) || f.userId.toLowerCase().includes(q)
  })
})

function switchTab(next: Tab): void {
  tab.value = next
  query.value = ''
  if (next !== 'friends') showAddFriend.value = false
}

/** 列表栏右上「新建」：会话 → 去联系人；联系人 → 展开/收起加好友 */
function onNew(): void {
  if (tab.value === 'friends') {
    showAddFriend.value = !showAddFriend.value
    return
  }
  switchTab('friends')
  showAddFriend.value = true
}

function onCycleTheme(): void {
  cycle()
}

function openPeer(): void {
  if (peerId.value) peerProfileId.value = peerId.value
}

function friendStatusOf(userId: string): string {
  return store.friends.find((f) => f.userId === userId)?.status ?? 'none'
}

async function openAttachment(a: Attachment): Promise<void> {
  const url = await session.attachmentUrlOf(a)
  viewing.value = { attachment: a, url }
}

onMounted(async () => {
  await store.init(session)
  if (store.authed) {
    const last = store.conversations[0]
    if (last) void store.openConversation(last.id)
  }
})

// 标题栏覆盖层 + 窗口底色跟随主题（THEME_CHROME 由 @chataoo/ui 导出）
watch(
  resolved,
  (r) => {
    // 旧版 preload（未重新构建）可能没有该方法，可选调用避免外壳崩溃
    void window.chataoo?.win.setThemeOverlay?.(THEME_CHROME[r])
  },
  { immediate: true },
)

// 登录态切换窗口尺寸：登录小窗 440×640 ↔ 聊天窗口 1200×800
watch(
  () => store.authed,
  (a) => {
    void window.chataoo?.win.resize(a ? 'chat' : 'login')
  },
)

watch(
  () => store.activeConversationId,
  (id) => {
    if (id) switchTab('chats')
  },
)
</script>

<template>
  <div class="shell">
    <LoginView v-if="!store.authed" :allow-server-edit="true" @done="store.refreshConversations()" />

    <template v-else>
      <!-- 44px 自定义标题栏：整条可拖拽，右侧 138px 留给系统窗口按钮覆盖层 -->
      <header class="titlebar">
        <div class="brand">
          <img :src="logoUrl" class="brand-logo" alt="" />
          <span class="brand-name">ChatAoo</span>
        </div>
      </header>

      <div class="body">
        <!-- 68px rail：会话 / 联系人 / 我 + 底部设置与主题切换 -->
        <nav class="rail" aria-label="主导航">
          <div class="rail-tabs">
            <button
              class="rail-tab"
              :class="{ active: tab === 'chats' }"
              :aria-current="tab === 'chats' ? 'page' : undefined"
              title="消息"
              @click="switchTab('chats')"
            >
              <Icon name="chat" :size="20" />
              <span>消息</span>
            </button>
            <button
              class="rail-tab"
              :class="{ active: tab === 'friends' }"
              :aria-current="tab === 'friends' ? 'page' : undefined"
              title="联系人"
              @click="switchTab('friends')"
            >
              <Icon name="users" :size="20" />
              <span>联系人</span>
            </button>
            <button
              class="rail-tab"
              :class="{ active: tab === 'profile' }"
              :aria-current="tab === 'profile' ? 'page' : undefined"
              title="我"
              @click="switchTab('profile')"
            >
              <Icon name="user" :size="20" />
              <span>我</span>
            </button>
          </div>

          <div class="rail-foot">
            <span
              class="net"
              :class="{ on: store.online }"
              role="img"
              :title="store.online ? '服务器在线' : '离线：使用局域网直连'"
              :aria-label="store.online ? '服务器在线' : '离线，使用局域网直连'"
            />
            <button class="icon-btn" title="设置" aria-label="设置" @click="settingsOpen = true">
              <Icon name="settings" :size="20" />
            </button>
            <button
              class="icon-btn"
              :title="themeTitle"
              :aria-label="themeTitle"
              @click="onCycleTheme"
            >
              <Icon :name="themeIcon" :size="20" />
            </button>
          </div>
        </nav>

        <!-- 312px 列表栏：56px 头部（标题 + 搜索 + 新建）+ 列表 -->
        <aside class="listbar">
          <div class="list-head">
            <h1 class="list-title">{{ sideTitle }}</h1>
            <div v-if="tab !== 'profile'" class="search">
              <Icon name="search" :size="15" />
              <input
                v-model="query"
                class="search-input"
                type="text"
                :placeholder="searchPlaceholder"
                :aria-label="searchPlaceholder"
                spellcheck="false"
              />
            </div>
            <button
              v-if="tab !== 'profile'"
              class="icon-btn new-btn"
              :title="newTitle"
              :aria-label="newTitle"
              @click="onNew"
            >
              <Icon name="plus" :size="20" />
            </button>
          </div>

          <div v-if="tab === 'chats'" class="list">
            <ConversationItem
              v-for="c in conversationList"
              :key="c.id"
              :conversation="c"
              @click="store.openConversation(c.id)"
            />

            <div v-if="!conversationList.length" class="list-empty">
              <EmptyState
                v-if="query"
                icon="search"
                title="没有匹配的会话"
                hint="换个关键词试试。"
              />
              <EmptyState
                v-else
                icon="chat"
                title="还没有会话"
                hint="从「联系人」里选一位好友，开始第一段对话。"
              >
                <button class="btn btn-primary" @click="switchTab('friends')">去联系人</button>
              </EmptyState>
            </div>
          </div>

          <div v-else-if="tab === 'friends'" class="list">
            <AddFriendBox v-if="showAddFriend" />
            <FriendItem
              v-for="f in friendList"
              :key="f.userId"
              :user-id="f.userId"
              :profile="store.profileOf(f.userId)"
              :friend-status="friendStatusOf(f.userId)"
            />

            <div v-if="!friendList.length" class="list-empty">
              <EmptyState
                v-if="query"
                icon="search"
                title="没有匹配的联系人"
                hint="可以按昵称或用户名搜索。"
              />
              <EmptyState
                v-else
                icon="users"
                title="还没有联系人"
                hint="把用户名发给朋友，或输入对方的用户名发送好友请求。"
              >
                <button class="btn btn-primary" @click="showAddFriend = true">添加好友</button>
              </EmptyState>
            </div>
          </div>

          <div v-else class="profile-wrap">
            <ProfilePage :show-back="false" />
          </div>
        </aside>

        <!-- 会话区：62px 会话头 + 消息列表 + 输入区 -->
        <main class="chat">
          <header v-if="chatting" class="chat-head">
            <button class="peer" title="查看资料" @click="openPeer">
              <Avatar :profile="peerProfile" :online="peerOnline" :size="36" />
              <span class="peer-meta">
                <span class="peer-name">{{ peerName }}</span>
                <span class="peer-status" :class="peerStatus?.tone">
                  <i class="status-dot" />
                  {{ peerStatus?.label }}
                </span>
              </span>
            </button>
            <span class="head-spacer" />
            <button class="icon-btn" title="会话信息" aria-label="会话信息" @click="openPeer">
              <Icon name="dots" :size="20" />
            </button>
          </header>

          <template v-if="chatting && store.activeConversationId">
            <MessageList
              :key="store.activeConversationId"
              :conversation-id="store.activeConversationId"
              @open="openAttachment"
            />
            <ChatInput
              :stickers="store.stickers"
              @send-text="(t) => store.sendText(t)"
              @send-files="(f) => store.sendFiles(f)"
              @send-sticker="(s) => store.sendSticker(s)"
              @add-sticker="(f) => store.addSticker(f)"
              @remove-sticker="(s) => store.removeSticker(s)"
            />
          </template>
          <div v-else class="chat-empty">
            <EmptyState
              icon="chat"
              title="选择一个会话开始聊天"
              hint="消息保存在本机；同一局域网内断网也能收发。"
            />
          </div>
        </main>
      </div>

      <SettingsSheet :open="settingsOpen" @close="settingsOpen = false" />

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
/* ---------------------------------------------------------------------------
   设计系统未提供 token 的布局常量（docs/DESIGN-SYSTEM.md §3.1 / §5.3 指定值）。
   仅作用于外壳；颜色、间距、圆角一律使用 theme.css 的语义变量。
   --------------------------------------------------------------------------- */
.shell {
  --wco-w: 138px; /* §5.3 右侧系统按钮覆盖层宽度 */
  --ctl-h: 34px; /* §2.4 桌面控件高度 32–38px */
  --tab-indicator-w: 3px; /* §3.1 rail 选中指示条 */

  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-app);
  color: var(--text);
}

/* ---------------- 标题栏 ----------------
   颜色与 THEME_CHROME（--bg-app）一致，保证与右侧原生按钮覆盖层无缝衔接。 */
.titlebar {
  height: var(--titlebar-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 0 var(--wco-w) 0 var(--s-4);
  background: var(--bg-app);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  overflow: hidden;
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex: none;
}
.brand-logo {
  width: var(--s-5);
  height: var(--s-5);
  border-radius: var(--r-xs);
}
.brand-name {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-muted);
}

/* ---------------- 主体三栏 ---------------- */
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* ---------------- rail 68px ---------------- */
.rail {
  width: var(--rail-w);
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--s-2) 0 var(--s-3);
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
}
.rail-tabs {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  width: 100%;
  padding: 0 var(--s-2);
}
.rail-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-1);
  width: 100%;
  padding: var(--s-2) 0 var(--s-1);
  border-radius: var(--r-sm);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  font-weight: 500;
  line-height: var(--lh-tight);
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.rail-tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.rail-tab.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.rail-tab.active::before {
  content: '';
  position: absolute;
  left: calc(-1 * var(--s-2));
  top: 50%;
  width: var(--tab-indicator-w);
  height: var(--s-5);
  border-radius: var(--r-full);
  background: var(--accent);
  transform: translateY(-50%);
}
.rail-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
  padding-top: var(--s-3);
}
.net {
  width: var(--s-2);
  height: var(--s-2);
  border-radius: var(--r-full);
  background: var(--danger);
}
.net.on {
  background: var(--success);
}

/* ---------------- 列表栏 312px ---------------- */
.listbar {
  width: var(--list-w);
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
}
.list-head {
  height: var(--appbar-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: 0 var(--s-3);
  border-bottom: 1px solid var(--border);
}
.list-title {
  margin: 0;
  flex: none;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-tight);
  color: var(--text);
  white-space: nowrap;
}
.search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  height: var(--ctl-h);
  padding: 0 var(--s-2) 0 var(--s-3);
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  color: var(--text-faint);
  transition:
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.search:focus-within {
  border-color: var(--accent-border);
  background: var(--bg-elev);
}
.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  user-select: text;
}
.search-input::placeholder {
  color: var(--text-faint);
}
.new-btn {
  flex: none;
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--s-1) 0;
}
.list-empty {
  padding: var(--s-4) var(--s-2);
}
.profile-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* ---------------- 会话区 ---------------- */
.chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-chat);
}
.chat-head {
  height: var(--chat-head-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: 0 var(--s-3);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.peer {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-width: 0;
  padding: var(--s-1) var(--s-2);
  border-radius: var(--r-sm);
  text-align: left;
}
.peer:hover {
  background: var(--bg-hover);
}
.peer-meta {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  min-width: 0;
}
.peer-name {
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-tight);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.peer-status {
  display: inline-flex;
  align-items: center;
  gap: var(--s-1);
  font-size: var(--fs-sm);
  line-height: var(--lh-tight);
  color: var(--text-muted);
  white-space: nowrap;
}
.status-dot {
  width: var(--s-2);
  height: var(--s-2);
  flex: none;
  border-radius: var(--r-full);
  background: var(--text-faint);
}
.peer-status.on .status-dot,
.peer-status.lan .status-dot {
  background: var(--success);
}
.head-spacer {
  flex: 1;
}
.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---------------- 资料浮层 ---------------- */
.peer-overlay {
  position: fixed;
  top: calc(var(--titlebar-h) + var(--s-2));
  right: var(--s-3);
  bottom: var(--s-3);
  width: min(var(--list-w), 38vw);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  z-index: 200;
}
</style>
