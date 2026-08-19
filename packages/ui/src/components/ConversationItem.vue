<script setup lang="ts">
import type { Conversation, Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'

const props = defineProps<{ conversation: Conversation }>()
const store = useChatStore()

const profile = (): Profile | undefined => store.profileOf(store.peerOf(props.conversation.id) ?? '')

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
  <div class="item" :class="{ active: store.activeConversationId === conversation.id }">
    <Avatar :profile="profile()" :online="store.isPeerOnline(store.peerOf(conversation.id) ?? '')" />
    <div class="body">
      <div class="row">
        <span class="name">{{ profile()?.displayName ?? store.peerOf(conversation.id)?.slice(0, 10) }}</span>
        <span class="time">{{ timeLabel(conversation.lastMessageAt) }}</span>
      </div>
      <div class="row">
        <span class="preview">{{ conversation.lastMessagePreview ?? '暂无消息' }}</span>
        <span v-if="conversation.unreadCount > 0" class="badge">{{ conversation.unreadCount }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  border-radius: var(--radius);
  transition: background 0.12s;
}
.item:hover {
  background: var(--bg-hover);
}
.item.active {
  background: var(--bg-active);
}
.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.name {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.time {
  font-size: 11px;
  color: var(--text-faint);
  flex: none;
}
.preview {
  font-size: 12.5px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  flex: none;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
