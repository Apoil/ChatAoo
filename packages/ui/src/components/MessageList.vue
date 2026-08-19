<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { Message } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{ conversationId: string }>()
const emit = defineEmits<{ open: [attachment: NonNullable<Message['attachment']>] }>()
const store = useChatStore()

const scroller = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

async function scrollToBottom(smooth = false): Promise<void> {
  await nextTick()
  const el = scroller.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

async function loadOlder(): Promise<void> {
  const el = scroller.value
  if (!el) return
  const list: Message[] = store.messages[props.conversationId] ?? []
  const first = [...list].sort((a: Message, b: Message) => a.createdAt - b.createdAt)[0]
  if (!first) return
  const prevHeight = el.scrollHeight
  await store.loadHistory(first.createdAt - 1)
  await nextTick()
  el.scrollTop = el.scrollHeight - prevHeight
}

onMounted(() => scrollToBottom())
watch(
  () => store.messages[props.conversationId]?.length,
  () => {
    if (stickToBottom.value) void scrollToBottom()
  },
)
</script>

<template>
  <div class="scroller" ref="scroller" @scroll="onScroll">
    <div class="inner">
      <button v-if="(store.messages[conversationId]?.length ?? 0) > 0" class="older" @click="loadOlder">
        加载更早的消息
      </button>
      <MessageBubble
        v-for="(m, i) in store.messages[conversationId] ?? []"
        :key="m.id"
        :message="m"
        :profile="store.profileOf(m.senderId)"
        :show-avatar="!m.senderId.startsWith('c_') || (store.messages[conversationId] ?? [])[i - 1]?.senderId !== m.senderId"
        @open="(a) => emit('open', a)"
      />
      <div v-if="!(store.messages[conversationId] ?? []).length" class="hint">
        暂无消息，发送第一条消息开始聊天吧
      </div>
    </div>
  </div>
</template>

<style scoped>
.scroller {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.inner {
  display: flex;
  flex-direction: column;
  max-width: 860px;
  margin: 0 auto;
}
.older {
  align-self: center;
  margin-bottom: 10px;
  color: var(--text-dim);
  font-size: 12px;
  padding: 6px 14px;
  border-radius: var(--radius-full);
  background: var(--bg-raised);
}
.older:hover {
  background: var(--bg-hover);
}
.hint {
  text-align: center;
  color: var(--text-faint);
  margin-top: 40px;
  font-size: 13px;
}
</style>
