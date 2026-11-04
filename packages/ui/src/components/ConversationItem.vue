<script setup lang="ts">
/**
 * 会话列表项：68px 行（手机 72px），44px 头像 + 在线点，
 * 两行信息（名称/摘要），右侧时间与未读徽标。
 * 契约不变：只接收 conversation，点击由外壳通过 @click 透传到根元素。
 */
import { computed } from 'vue'
import type { Conversation, Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'

const props = defineProps<{ conversation: Conversation }>()
const store = useChatStore()

const peerId = computed(() => store.peerOf(props.conversation.id) ?? '')
const profile = computed<Profile | undefined>(() => store.profileOf(peerId.value))
const online = computed(() => store.isPeerOnline(peerId.value))
const active = computed(() => store.activeConversationId === props.conversation.id)
const displayName = computed(() => profile.value?.displayName || peerId.value.slice(0, 10) || '未知用户')
const preview = computed(() => props.conversation.lastMessagePreview || '暂无消息')
const unread = computed(() => props.conversation.unreadCount ?? 0)
const unreadLabel = computed(() => (unread.value > 99 ? '99+' : String(unread.value)))

function timeLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
  return d.toLocaleDateString([], { year: 'numeric', month: 'numeric', day: 'numeric' })
}
</script>

<template>
  <button
    type="button"
    class="conv-item"
    :class="{ 'is-active': active }"
    :aria-current="active ? 'true' : undefined"
  >
    <Avatar :profile="profile" :size="44" :online="online" />
    <span class="conv-body">
      <span class="conv-line">
        <span class="conv-name">{{ displayName }}</span>
        <span class="conv-time">{{ timeLabel(conversation.lastMessageAt) }}</span>
      </span>
      <span class="conv-line">
        <span class="conv-preview">{{ preview }}</span>
        <span v-if="unread > 0" class="conv-badge" :aria-label="`${unread} 条未读`">{{ unreadLabel }}</span>
      </span>
    </span>
  </button>
</template>

<style scoped>
.conv-item {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  min-height: 68px;
  padding: 0 var(--s-4);
  font: inherit;
  color: var(--text);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 0;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}
.conv-item:hover {
  background: var(--bg-hover);
}
.conv-item:active,
.conv-item.is-active {
  background: var(--bg-active);
}
.conv-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
}
.conv-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  min-width: 0;
}
.conv-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-base);
  color: var(--text);
}
.conv-time {
  flex: none;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.conv-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.conv-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--s-1);
  border-radius: var(--r-full);
  background: var(--accent-solid);
  color: var(--accent-contrast);
  font-size: var(--fs-xs);
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* 手机（<720dp）：列表行 72px，触控目标 ≥ 44px */
@media (max-width: 719px) {
  .conv-item {
    min-height: 72px;
  }
}
</style>
