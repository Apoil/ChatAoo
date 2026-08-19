<script setup lang="ts">
import { computed } from 'vue'
import type { Message, Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'
import AttachmentBubble from './AttachmentBubble.vue'

const props = defineProps<{
  message: Message
  profile: Profile | null | undefined
  showAvatar?: boolean
}>()

const emit = defineEmits<{ open: [attachment: NonNullable<Message['attachment']>] }>()
const store = useChatStore()

const mine = computed(() => props.message.senderId === store.session?.me.userId)

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="row" :class="{ mine }">
    <Avatar v-if="!mine && showAvatar" :profile="profile" :size="32" />
    <div class="col">
      <div v-if="!mine && showAvatar" class="name">{{ profile?.displayName ?? '未知' }}</div>
      <div class="bubble" :class="{ mine }">
        <template v-if="message.kind === 'system'">
          <span class="system">{{ message.text }}</span>
        </template>
        <template v-else>
          <span v-if="message.text" class="text">{{ message.text }}</span>
          <AttachmentBubble
            v-if="message.attachment"
            :attachment="message.attachment"
            @open="(a) => emit('open', a)"
          />
          <div class="meta">
            <span class="time">{{ timeLabel(message.createdAt) }}</span>
            <span v-if="mine" class="status" :class="message.status">
              {{ message.status === 'sent' ? '✓' : message.status === 'delivered' ? '✓✓' : message.status === 'pending' ? '…' : '!' }}
            </span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin: 4px 0;
}
.row.mine {
  justify-content: flex-end;
}
.col {
  max-width: 76%;
  display: flex;
  flex-direction: column;
}
.row.mine .col {
  align-items: flex-end;
}
.name {
  font-size: 11.5px;
  color: var(--text-faint);
  margin: 0 2px 2px;
  font-weight: 600;
}
.bubble {
  background: var(--msg-in);
  border-radius: var(--radius-lg);
  border-top-left-radius: 4px;
  padding: 8px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.bubble.mine {
  background: var(--msg-out);
  border-radius: var(--radius-lg);
  border-top-right-radius: 4px;
}
.text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
}
.system {
  color: var(--text-dim);
  font-size: 12.5px;
}
.meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  margin-top: 3px;
}
.time {
  font-size: 10.5px;
  opacity: 0.65;
}
.status {
  font-size: 11px;
}
.status.sent,
.status.delivered {
  color: var(--ok);
}
.status.failed {
  color: var(--danger);
}
</style>
