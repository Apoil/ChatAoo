<script setup lang="ts">
/**
 * 手机/平板外壳 —— 按 docs/DESIGN-SYSTEM.md §3.2（手机 < 720dp）与 §3.3（平板 ≥ 720dp）重写。
 *
 * 结构：
 *   - 手机：56px 应用栏 → 列表（聊天/联系人/我）→ FAB（仅聊天标签）→ 62px 底部标签栏
 *     聊天页为全屏覆盖层（隐藏应用栏与标签栏），顶部 56px 返回箭头 + 对方信息。
 *   - 平板：左栏 320px（应用栏 + 三选一分段 + 列表）+ 右栏常驻会话区，无标签栏。
 *
 * 返回键：Android 物理返回在没有 @capacitor/app 的情况下走 WebView history 的默认行为
 * （goBack → popstate）。因此每次打开覆盖层都 pushState 一条记录，popstate 时按层栈关闭最上层；
 * 用户点 UI 关闭时再 history.back() 回收该记录，并用 suppressPop 避免自己触发的 popstate 被当成返回键。
 *
 * 尺寸：全部引用 theme.css 的语义 token（--appbar-h / --list-w-wide / --dock-h / --fab /
 * --touch / --s-*），安全区用 env(safe-area-inset-*)，不写死颜色与布局数值。
 */
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChatSession } from '@chataoo/app-core'
import {
  AddFriendBox,
  Avatar,
  ChatInput,
  ConversationItem,
  EmptyState,
  FriendItem,
  Icon,
  LoginView,
  MediaViewer,
  MessageList,
  ProfilePage,
  SettingsSheet,
  useChatStore,
  type IconName,
} from '@chataoo/ui'
import type { Attachment } from '@chataoo/shared'

const session = inject<ChatSession>('session')!
const store = useChatStore()

/** store.init 落定之前先不渲染外壳：否则已登录用户每次冷启动会闪一下登录页 */
const booting = ref(true)

/* ---------------- 布局断点（dp ≈ CSS px） ---------------- */

const WIDE_QUERY = '(min-width: 720px)'
const mql = window.matchMedia(WIDE_QUERY)
const wide = ref(mql.matches)

/* ---------------- 标签导航 ---------------- */

const TABS = [
  { id: 'chats', label: '聊天', icon: 'chat' },
  { id: 'friends', label: '联系人', icon: 'users' },
  { id: 'profile', label: '我', icon: 'user' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[]

type TabId = (typeof TABS)[number]['id']

const tab = ref<TabId>('chats')
const tabTitle = computed(() => TABS.find((t) => t.id === tab.value)?.label ?? 'ChatAoo')

function selectTab(next: TabId): void {
  tab.value = next
  closeSearch()
}

/* ---------------- 搜索 ---------------- */

const searching = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const searchPlaceholder = computed(() => (tab.value === 'friends' ? '搜索联系人' : '搜索会话'))

async function openSearch(): Promise<void> {
  searching.value = true
  await nextTick()
  searchInput.value?.focus()
}

function closeSearch(): void {
  searching.value = false
  query.value = ''
}

/* ---------------- 覆盖层（层栈 + 返回键） ---------------- */

const settingsOpen = ref(false)
const composeOpen = ref(false)
const peerProfileId = ref<string | null>(null)
const viewing = ref<{ attachment: Attachment; url: string | null } | null>(null)

type Layer = 'chat' | 'compose' | 'settings' | 'peer'

const layerStack: Layer[] = []
let pushedEntries = 0
let suppressPop = 0
let externalPop = false

function pushLayer(layer: Layer): void {
  layerStack.push(layer)
  try {
    history.pushState({ chataooLayer: layerStack.length }, '')
    pushedEntries++
  } catch {
    /* 少数 WebView 限制 history，退化为不处理返回键 */
  }
}

function popLayer(layer: Layer): void {
  const index = layerStack.lastIndexOf(layer)
  if (index < 0) return
  const wasTop = index === layerStack.length - 1
  layerStack.splice(index, 1)
  // 只回收我们自己压的最上层历史记录；物理返回已经消费过的条目不再 back()
  if (!wasTop || externalPop || pushedEntries <= 0) return
  pushedEntries--
  suppressPop++
  try {
    history.back()
  } catch {
    suppressPop--
  }
}

/** 关闭指定层（各层开关本身由 watch 统一记账） */
function closeLayer(layer: Layer): void {
  if (layer === 'peer') peerProfileId.value = null
  else if (layer === 'settings') settingsOpen.value = false
  else if (layer === 'compose') composeOpen.value = false
  else back()
}

/** 注册某一覆盖层开关的历史记录记账（flush:sync，返回键处理里需要同步生效） */
function trackLayer(source: () => boolean, layer: Layer): void {
  watch(
    source,
    (open) => {
      if (layer === 'chat' && wide.value) return
      if (open) pushLayer(layer)
      else popLayer(layer)
    },
    { flush: 'sync' },
  )
}

function onPopState(): void {
  if (suppressPop > 0) {
    suppressPop--
    return
  }
  const top = layerStack[layerStack.length - 1]
  if (!top) return // 没有内层可退：交给 WebView/Capacitor 默认行为（退出应用）
  layerStack.pop()
  if (pushedEntries > 0) pushedEntries--
  externalPop = true
  try {
    closeLayer(top)
  } finally {
    externalPop = false
  }
}

/* ---------------- 会话 ---------------- */

const peerId = computed(() =>
  store.activeConversationId ? store.peerOf(store.activeConversationId) : null,
)
const chatting = computed(() => !!store.activeConversationId && !!peerId.value)
const peerProfile = computed(() => (peerId.value ? store.profileOf(peerId.value) : undefined))
const peerOnline = computed(() => (peerId.value ? store.isPeerOnline(peerId.value) : false))
const peerLan = computed(() => (peerId.value ? !!store.lanPeers[peerId.value]?.online : false))
const peerName = computed(
  () => peerProfile.value?.displayName ?? peerId.value?.slice(0, 10) ?? '会话',
)
const peerStatus = computed(() => (peerLan.value ? '局域网在线' : peerOnline.value ? '在线' : '离线'))

function friendStatusOf(userId: string): string {
  return store.friends.find((f) => f.userId === userId)?.status ?? 'none'
}

function back(): void {
  store.activeConversationId = null
  session.setActiveConversation(undefined)
}

async function openChat(id: string): Promise<void> {
  tab.value = 'chats'
  closeSearch()
  await store.openConversation(id)
}

function openChatFromProfile(id: string): void {
  peerProfileId.value = null
  void openChat(id)
}

async function openAttachment(a: Attachment): Promise<void> {
  const url = await session.attachmentUrlOf(a)
  viewing.value = { attachment: a, url }
}

function onAuthed(): void {
  void store.refreshConversations()
  void store.refreshFriends()
  void store.refreshProfiles()
}

function onSendText(text: string): void {
  void store.sendText(text)
}

function onSendFiles(files: { blob: Blob; name: string }[]): void {
  void store.sendFiles(files)
}

/* ---------------- 过滤后的列表 ---------------- */

const visibleChats = computed(() => {
  const q = normalizedQuery.value
  if (!q) return store.conversations
  return store.conversations.filter((c) => {
    const peer = store.peerOf(c.id)
    const name = (peer && store.profileOf(peer)?.displayName) || peer || ''
    return name.toLowerCase().includes(q)
  })
})

const visibleFriends = computed(() => {
  const q = normalizedQuery.value
  if (!q) return store.friends
  return store.friends.filter((f) =>
    (store.profileOf(f.userId)?.displayName ?? f.userId).toLowerCase().includes(q),
  )
})

const chatsHint = computed(() =>
  normalizedQuery.value ? '换个关键词试试。' : '还没有会话。点右下角按钮加好友，就能开始聊天。',
)
const friendsHint = computed(() =>
  normalizedQuery.value ? '换个关键词试试。' : '点右上角「＋」输入对方用户名发送好友请求。',
)

/* ---------------- 键盘避让 ---------------- */

const kbInset = ref(0)
const composerPad = computed(() =>
  kbInset.value > 0 ? `calc(var(--safe-bottom) + ${kbInset.value}px)` : undefined,
)

function syncKeyboard(): void {
  const vv = window.visualViewport
  if (!vv) return
  kbInset.value = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
}

/* ---------------- 生命周期 ---------------- */

function onWideChange(): void {
  wide.value = mql.matches
  if (!wide.value) {
    // 变窄后聊天页重新变成覆盖层，补一条返回记录
    if (chatting.value && !layerStack.includes('chat')) pushLayer('chat')
    return
  }
  // 变宽后聊天区变成右栏，不再需要那条历史记录
  const index = layerStack.indexOf('chat')
  if (index < 0) return
  const wasTop = index === layerStack.length - 1
  layerStack.splice(index, 1)
  if (wasTop && pushedEntries > 0) {
    pushedEntries--
    suppressPop++
    try {
      history.back()
    } catch {
      suppressPop--
    }
  }
}

onMounted(async () => {
  mql.addEventListener('change', onWideChange)
  window.addEventListener('popstate', onPopState)
  window.visualViewport?.addEventListener('resize', syncKeyboard)
  window.visualViewport?.addEventListener('scroll', syncKeyboard)

  try {
    await store.init(session)
    // 手机上不自动跳进上次的会话：先落在列表，避免一开 App 就是聊天页
    if (store.authed && wide.value) {
      const last = store.conversations[0]
      if (last) void store.openConversation(last.id)
    }
  } finally {
    // init 失败也要解除骨架，否则停在空白页
    booting.value = false
  }
})

onUnmounted(() => {
  mql.removeEventListener('change', onWideChange)
  window.removeEventListener('popstate', onPopState)
  window.visualViewport?.removeEventListener('resize', syncKeyboard)
  window.visualViewport?.removeEventListener('scroll', syncKeyboard)
})

trackLayer(() => chatting.value, 'chat')
trackLayer(() => settingsOpen.value, 'settings')
trackLayer(() => composeOpen.value, 'compose')
trackLayer(() => peerProfileId.value !== null, 'peer')

watch(
  () => store.activeConversationId,
  (id) => {
    if (id) tab.value = 'chats'
  },
)

// 退出登录时收回所有覆盖层，并清掉会话选择
watch(
  () => store.authed,
  (authed) => {
    if (authed) return
    settingsOpen.value = false
    composeOpen.value = false
    peerProfileId.value = null
    if (store.activeConversationId) back()
  },
)
</script>

<template>
  <div class="shell" :class="{ wide }">
    <!-- init 落定前只画底色，避免已登录用户闪一下登录页/空状态 -->
    <div v-if="booting" class="boot" aria-busy="true" />

    <LoginView v-else-if="!store.authed" :allow-server-edit="true" @done="onAuthed" />

    <template v-else>
      <!-- 列表栏：手机全宽 / 平板固定 320px -->
      <div class="list-col">
        <header class="appbar">
          <template v-if="searching">
            <button class="icon-btn touch-44" aria-label="退出搜索" @click="closeSearch">
              <Icon name="back" :size="22" />
            </button>
            <input
              ref="searchInput"
              v-model="query"
              class="search-input"
              type="search"
              :placeholder="searchPlaceholder"
              aria-label="搜索"
              @keydown.esc="closeSearch"
            />
            <button class="icon-btn touch-44" aria-label="清除搜索" @click="closeSearch">
              <Icon name="close" :size="22" />
            </button>
          </template>
          <template v-else>
            <h1 class="appbar-title">{{ tabTitle }}</h1>
            <div class="appbar-actions">
              <button
                v-if="tab !== 'profile'"
                class="icon-btn touch-44"
                aria-label="搜索"
                @click="openSearch"
              >
                <Icon name="search" :size="22" />
              </button>
              <button
                v-if="tab === 'friends'"
                class="icon-btn touch-44"
                aria-label="添加好友"
                @click="composeOpen = true"
              >
                <Icon name="plus" :size="22" />
              </button>
              <button class="icon-btn touch-44" aria-label="设置" @click="settingsOpen = true">
                <Icon name="dots" :size="22" />
              </button>
            </div>
          </template>
        </header>

        <!-- 平板没有底部标签栏，用顶部分段切换 -->
        <nav v-if="wide" class="seg-tabs" aria-label="主导航">
          <button
            v-for="t in TABS"
            :key="t.id"
            :class="{ on: tab === t.id }"
            :aria-current="tab === t.id ? 'page' : undefined"
            @click="selectTab(t.id)"
          >
            {{ t.label }}
          </button>
        </nav>

        <div v-if="tab === 'chats'" class="list-body">
          <ConversationItem
            v-for="c in visibleChats"
            :key="c.id"
            :conversation="c"
            @click="openChat(c.id)"
          />
          <div v-if="!visibleChats.length" class="empty-wrap">
            <EmptyState
              icon="chat"
              :title="normalizedQuery ? '没有匹配的会话' : '还没有会话'"
              :hint="chatsHint"
            >
              <button v-if="!normalizedQuery" class="btn btn-primary btn-lg" @click="composeOpen = true">
                加好友开始聊天
              </button>
            </EmptyState>
          </div>
        </div>

        <div v-else-if="tab === 'friends'" class="list-body">
          <FriendItem
            v-for="f in visibleFriends"
            :key="f.userId"
            :user-id="f.userId"
            :profile="store.profileOf(f.userId)"
            :friend-status="friendStatusOf(f.userId)"
          />
          <div v-if="!visibleFriends.length" class="empty-wrap">
            <EmptyState
              icon="users"
              :title="normalizedQuery ? '没有匹配的联系人' : '还没有联系人'"
              :hint="friendsHint"
            >
              <button v-if="!normalizedQuery" class="btn btn-primary btn-lg" @click="composeOpen = true">
                添加好友
              </button>
            </EmptyState>
          </div>
        </div>

        <div v-else class="list-body profile-body">
          <ProfilePage :show-back="false" />
        </div>

        <button
          v-if="!wide && tab === 'chats'"
          class="fab"
          aria-label="新建会话或加好友"
          @click="composeOpen = true"
        >
          <Icon name="plus" :size="26" :stroke-width="2" />
        </button>

        <nav v-if="!wide" class="dock" aria-label="主导航">
          <button
            v-for="t in TABS"
            :key="t.id"
            :class="{ on: tab === t.id }"
            :aria-current="tab === t.id ? 'page' : undefined"
            @click="selectTab(t.id)"
          >
            <Icon :name="t.icon" :size="24" />
            <span>{{ t.label }}</span>
          </button>
        </nav>
      </div>

      <!-- 会话区：平板常驻右栏；手机为全屏覆盖层 -->
      <main v-if="wide || chatting" class="chat-col" :class="{ cover: !wide }">
        <template v-if="chatting && store.activeConversationId">
          <header class="chat-head">
            <button
              v-if="!wide"
              class="icon-btn touch-44"
              aria-label="返回会话列表"
              @click="back()"
            >
              <Icon name="back" :size="22" />
            </button>
            <button class="peer" @click="peerProfileId = peerId">
              <Avatar :profile="peerProfile" :online="peerOnline" :size="36" />
              <span class="peer-meta">
                <span class="peer-name">{{ peerName }}</span>
                <span class="peer-sub">{{ peerStatus }}</span>
              </span>
            </button>
            <button class="icon-btn touch-44" aria-label="对方资料" @click="peerProfileId = peerId">
              <Icon name="dots" :size="22" />
            </button>
          </header>

          <MessageList
            :key="store.activeConversationId"
            :conversation-id="store.activeConversationId"
            @open="openAttachment"
          />

          <div class="composer-wrap" :style="{ paddingBottom: composerPad }">
            <ChatInput @send-text="onSendText" @send-files="onSendFiles" />
          </div>
        </template>

        <div v-else class="empty-wrap">
          <EmptyState
            icon="chat"
            title="选一个会话"
            hint="从左侧列表打开一个对话，或者加个好友开始聊天。"
          />
        </div>
      </main>

      <!-- 对方资料：手机全屏 / 平板右侧面板 -->
      <div v-if="peerProfileId" class="peer-panel">
        <ProfilePage
          :peer-id="peerProfileId"
          @close="peerProfileId = null"
          @open-chat="openChatFromProfile"
        />
      </div>

      <!-- 新建会话 / 加好友：底部抽屉 -->
      <Transition name="sheet">
        <div v-if="composeOpen" class="sheet-mask" @click.self="composeOpen = false">
          <section class="sheet-card" role="dialog" aria-modal="true" aria-label="新建会话">
            <span class="grabber" aria-hidden="true" />
            <h2 class="sheet-title">新建会话</h2>
            <AddFriendBox />
            <p class="sheet-hint">输入对方用户名发送好友请求；成为好友后直接在「聊天」里选人。</p>
          </section>
        </div>
      </Transition>

      <SettingsSheet :open="settingsOpen" @close="settingsOpen = false" />

      <MediaViewer v-if="viewing" :attachment="viewing.attachment" :url="viewing.url" @close="viewing = null" />
    </template>
  </div>
</template>

<style scoped>
/* 只引用 theme.css 的语义 token：应用栏 --appbar-h、平板左栏 --list-w-wide、
   标签栏 --dock-h、FAB --fab、触控 --touch，安全区用 env()。 */
.shell {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  display: flex;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg-app);
  color: var(--text);
}

/* ---------------- 列表栏 ---------------- */

.boot {
  flex: 1;
  background: var(--bg-app);
}

.list-col {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}
.shell.wide .list-col {
  flex: none;
  width: var(--list-w-wide);
  border-right: 1px solid var(--border);
}

.appbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  height: calc(var(--appbar-h) + var(--safe-top));
  padding: var(--safe-top) var(--s-2) 0 var(--s-3);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.appbar-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: var(--lh-tight);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.appbar-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-1);
}

.search-input {
  flex: 1;
  min-width: 0;
  height: var(--touch);
  padding: 0 var(--s-3);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  outline: none;
}
.search-input::placeholder {
  color: var(--text-faint);
}
.search-input:focus {
  border-color: var(--accent);
  background: var(--bg-elev);
}

/* 平板分段切换（替代手机底部标签栏） */
.seg-tabs {
  flex: none;
  display: flex;
  gap: var(--s-1);
  padding: var(--s-2) var(--s-3);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.seg-tabs button {
  flex: 1;
  min-height: var(--touch);
  border-radius: var(--r-sm);
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.seg-tabs button.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.list-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.profile-body {
  overflow: hidden;
}
.profile-body > * {
  flex: 1;
  min-height: 0;
}

.empty-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-4);
}

/* ---------------- FAB ---------------- */

.fab {
  position: absolute;
  right: var(--s-4);
  bottom: calc(var(--dock-h) + var(--safe-bottom) + var(--s-4));
  z-index: 5;
  width: var(--fab);
  height: var(--fab);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-full);
  background: var(--accent-solid);
  color: var(--accent-contrast);
  box-shadow: var(--shadow-2);
  transition: background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.fab:active {
  background: var(--accent-active);
  transform: scale(0.96);
}

/* ---------------- 底部标签栏 ---------------- */

.dock {
  flex: none;
  display: flex;
  height: calc(var(--dock-h) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
}
.dock button {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  min-height: var(--touch);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  line-height: var(--lh-tight);
  transition: color var(--dur-fast) var(--ease);
}
.dock button.on {
  color: var(--accent);
}

/* ---------------- 会话区 ---------------- */

.chat-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-chat);
}
.chat-col.cover {
  position: fixed;
  inset: 0;
  z-index: 200;
}

.chat-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-1);
  height: calc(var(--appbar-h) + var(--safe-top));
  padding: var(--safe-top) var(--s-2) 0 var(--s-1);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.peer {
  flex: 1;
  min-width: 0;
  min-height: var(--touch);
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 0 var(--s-2);
  border-radius: var(--r-sm);
  text-align: left;
}
.peer:active {
  background: var(--bg-active);
}
.peer-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
}
.peer-name {
  color: var(--text);
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.peer-sub {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-wrap {
  flex: none;
  background: var(--bg-panel);
  padding-bottom: var(--safe-bottom);
}

/* ---------------- 对方资料 ---------------- */

.peer-panel {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}
.shell.wide .peer-panel {
  left: auto;
  width: min(var(--sheet-w), 45vw);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-pop);
}

/* ---------------- 新建会话抽屉 ---------------- */

.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: var(--bg-scrim);
}
.sheet-card {
  width: 100%;
  max-width: var(--sheet-w);
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-2) var(--s-4) calc(var(--s-4) + var(--safe-bottom));
  background: var(--bg-panel);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--shadow-pop);
}
.grabber {
  width: calc(var(--s-8) + var(--s-1));
  height: var(--s-1);
  margin: var(--s-1) auto 0;
  border-radius: var(--r-full);
  background: var(--border-strong);
}
.sheet-title {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-tight);
}
.sheet-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity var(--dur-med) var(--ease);
}
.sheet-enter-active .sheet-card,
.sheet-leave-active .sheet-card {
  transition: transform var(--dur-med) var(--ease);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-card,
.sheet-leave-to .sheet-card {
  transform: translateY(100%);
}
</style>
