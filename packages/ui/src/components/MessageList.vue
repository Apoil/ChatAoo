<script setup lang="ts">
/**
 * 消息列表（设计系统 v2 §4 MessageList）
 * - 滚动容器 --bg-chat，按日期分组，日期标签居中 pill
 * - 贴底自动滚动；新消息淡入（MessageBubble 内动画）
 * - 上滑离底时出现「回到最新」按钮；顶部可加载更早消息
 * 契约不变：props { conversationId } / emits open
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Message } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import EmptyState from './EmptyState.vue'
import Icon from './Icon.vue'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{ conversationId: string }>()
const emit = defineEmits<{ open: [attachment: NonNullable<Message['attachment']>] }>()
const store = useChatStore()

type ListItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'msg'; key: string; message: Message; showAvatar: boolean; grouped: boolean }

const scroller = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)
const atBottom = ref(true)
const loadingOlder = ref(false)
const noOlder = ref(false)

const messages = computed<Message[]>(() => store.messages[props.conversationId] ?? [])

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function dayLabel(ts: number): string {
  const today = startOfDay(Date.now())
  const day = startOfDay(ts)
  const diff = Math.round((today - day) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  const d = new Date(ts)
  if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const items = computed<ListItem[]>(() => {
  const list = messages.value
  const out: ListItem[] = []
  let lastDay = ''
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m) continue
    const key = dayKey(m.createdAt)
    if (key !== lastDay) {
      out.push({ type: 'date', key: `d-${key}`, label: dayLabel(m.createdAt) })
      lastDay = key
    }
    const prev = list[i - 1]
    const grouped =
      !!prev &&
      prev.senderId === m.senderId &&
      m.kind !== 'system' &&
      prev.kind !== 'system' &&
      dayKey(prev.createdAt) === key
    const showAvatar = !m.senderId.startsWith('c_') || !prev || prev.senderId !== m.senderId
    out.push({ type: 'msg', key: `${m.id}-${i}`, message: m, showAvatar, grouped })
  }
  return out
})

const showJump = computed(() => !atBottom.value && messages.value.length > 0)

function gapToBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  const gap = gapToBottom(el)
  stickToBottom.value = gap < 60
  atBottom.value = gap < 6
}

async function scrollToBottom(smooth = false): Promise<void> {
  await nextTick()
  const el = scroller.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  atBottom.value = true
  stickToBottom.value = true
}

async function loadOlder(): Promise<void> {
  const el = scroller.value
  if (!el || loadingOlder.value) return
  const list = messages.value
  const first = [...list].sort((a, b) => a.createdAt - b.createdAt)[0]
  if (!first) return
  loadingOlder.value = true
  // 加载更早消息时不再自动贴底，保持当前阅读位置
  stickToBottom.value = false
  const prevHeight = el.scrollHeight
  const before = list.length
  try {
    await store.loadHistory(first.createdAt - 1)
    await nextTick()
    el.scrollTop = el.scrollHeight - prevHeight
    if (messages.value.length <= before) noOlder.value = true
    onScroll()
  } finally {
    loadingOlder.value = false
  }
}

onMounted(() => {
  void scrollToBottom()
})

watch(
  () => messages.value.length,
  () => {
    const last = messages.value[messages.value.length - 1]
    const mine = !!last && !!store.session && last.senderId === (store.session.accountId ?? store.session.me.userId)
    if (stickToBottom.value || mine) void scrollToBottom(true)
  },
)
</script>

<template>
  <div ref="scroller" class="scroller" @scroll.passive="onScroll">
    <div class="inner">
      <div v-if="messages.length" class="older-wrap">
        <button v-if="!noOlder" type="button" class="older" :disabled="loadingOlder" @click="loadOlder">
          <span v-if="loadingOlder" class="spin" aria-hidden="true" />
          <Icon v-else name="arrow-up" :size="14" />
          {{ loadingOlder ? '正在加载' : '更早的消息' }}
        </button>
      </div>

      <div v-if="!messages.length" class="empty-wrap">
        <EmptyState title="还没有消息" hint="发一条消息，开始和对方聊天吧。" />
      </div>

      <template v-for="item in items" :key="item.key">
        <div v-if="item.type === 'date'" class="date-pill">
          <span>{{ item.label }}</span>
        </div>
        <MessageBubble
          v-if="item.type === 'msg'"
          :message="item.message"
          :profile="store.profileOf(item.message.senderId)"
          :show-avatar="item.showAvatar"
          :grouped="item.grouped"
          @open="(a) => emit('open', a)"
        />
      </template>
    </div>

    <div v-if="showJump" class="jump-wrap">
      <button type="button" class="jump" title="回到最新消息" @click="scrollToBottom(true)">
        <Icon name="chevron-down" :size="16" />
        <span>最新消息</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.scroller {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--bg-chat);
  padding: var(--s-3) var(--s-4) var(--s-2);
}
.inner {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 980px;
  min-height: 100%;
  margin: 0 auto;
}
.older-wrap {
  display: flex;
  justify-content: center;
  padding-bottom: var(--s-2);
}
.older {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  min-height: 32px;
  padding: 0 var(--s-3);
  border-radius: var(--r-full);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.older:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--border-strong);
}
.older:disabled {
  cursor: default;
}
.spin {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: var(--r-full);
  animation: msglist-spin 0.8s linear infinite;
}
.date-pill {
  display: flex;
  justify-content: center;
  padding: var(--s-2) 0 var(--s-3);
}
.date-pill span {
  padding: 2px var(--s-3);
  border-radius: var(--r-full);
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
}
.empty-wrap {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
}
.jump-wrap {
  position: sticky;
  bottom: var(--s-3);
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 2;
}
.jump {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--s-1);
  min-height: 32px;
  padding: 0 var(--s-3);
  border-radius: var(--r-full);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-2);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.jump:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
@keyframes msglist-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 719px) {
  .scroller {
    padding: var(--s-2) var(--s-3);
  }
}
@media (pointer: coarse) {
  .jump {
    min-height: var(--touch);
    padding: 0 var(--s-4);
  }
  .older {
    min-height: var(--touch);
  }
}
</style>
