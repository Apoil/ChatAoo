<script setup lang="ts">
/**
 * 好友/联系人列表项：56–64px 行（手机 72px），40px 头像，
 * 副标题展示局域网在线 / 在线 / 等待验证，
 * 右侧动作按钮：通过 / 发消息 / 添加。
 * 契约不变：profile + friendStatus + 可选 userId，无 emits。
 */
import { computed, ref } from 'vue'
import type { Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'

const props = defineProps<{
  profile: Profile | null | undefined
  friendStatus: string
  userId?: string
}>()
const store = useChatStore()

const busy = ref(false)
const added = ref(false)

const userId = computed(() => props.profile?.userId ?? props.userId ?? '')
const displayName = computed(() => props.profile?.displayName ?? '未知用户')
const isFriend = computed(() => props.friendStatus === 'friends')
const canAccept = computed(() => props.friendStatus === 'incoming')
const canAdd = computed(() => props.friendStatus === 'none' || props.friendStatus === '')
const lanOnline = computed(() => !!store.lanPeers[userId.value]?.online)
const online = computed(() => store.isPeerOnline(userId.value))

const statusLabel = computed(() => {
  switch (props.friendStatus) {
    case 'outgoing':
      return '等待验证'
    case 'incoming':
      return '待处理'
    default:
      return ''
  }
})

const subtitle = computed<{ text: string; tone: 'lan' | 'online' | 'wait' | 'muted' }>(() => {
  if (lanOnline.value) return { text: '局域网在线', tone: 'lan' }
  if (online.value) return { text: '在线', tone: 'online' }
  if (statusLabel.value) return { text: statusLabel.value, tone: 'wait' }
  if (props.profile?.statusText) return { text: props.profile.statusText, tone: 'muted' }
  return { text: '离线', tone: 'muted' }
})

async function accept(): Promise<void> {
  if (busy.value || !userId.value) return
  busy.value = true
  try {
    await store.session?.acceptFriend(userId.value)
  } finally {
    busy.value = false
  }
}

async function add(): Promise<void> {
  if (busy.value || added.value || !userId.value) return
  busy.value = true
  try {
    await store.session?.addFriend(userId.value)
    added.value = true
  } catch {
    /* 添加失败保留按钮，允许重试 */
  } finally {
    busy.value = false
  }
}

function open(): void {
  if (!isFriend.value) return
  if (userId.value) void store.openConversation(userId.value)
}

function onRowKeydown(ev: KeyboardEvent): void {
  if (ev.target !== ev.currentTarget) return
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault()
    open()
  }
}
</script>

<template>
  <div
    class="friend-item"
    :class="{ 'is-clickable': isFriend }"
    :role="isFriend ? 'button' : undefined"
    :tabindex="isFriend ? 0 : undefined"
    @click="open"
    @keydown="onRowKeydown"
  >
    <Avatar :profile="profile" :size="40" :online="online" />
    <div class="friend-meta">
      <div class="friend-name">{{ displayName }}</div>
      <div class="friend-sub" :class="`is-${subtitle.tone}`">
        <span v-if="subtitle.tone === 'lan' || subtitle.tone === 'online'" class="friend-dot" aria-hidden="true" />
        <span class="friend-sub-text">{{ subtitle.text }}</span>
      </div>
    </div>

    <button
      v-if="canAccept"
      class="btn btn-primary friend-action"
      type="button"
      :disabled="busy"
      @click.stop="accept"
    >
      {{ busy ? '处理中' : '通过' }}
    </button>
    <button v-else-if="isFriend" class="btn btn-ghost friend-action" type="button" @click.stop="open">
      发消息
    </button>
    <button
      v-else-if="canAdd"
      class="btn btn-primary friend-action"
      type="button"
      :disabled="busy || added"
      @click.stop="add"
    >
      {{ added ? '已发送' : '添加' }}
    </button>
    <span v-else-if="statusLabel" class="friend-wait">{{ statusLabel }}</span>
  </div>
</template>

<style scoped>
.friend-item {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-height: 64px;
  padding: var(--s-2) var(--s-4);
}
.friend-item.is-clickable {
  cursor: pointer;
}
.friend-item.is-clickable:hover {
  background: var(--bg-hover);
}
.friend-meta {
  flex: 1;
  min-width: 0;
}
.friend-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-base);
  color: var(--text);
}
.friend-sub {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  margin-top: var(--s-1);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--text-faint);
}
.friend-sub.is-lan,
.friend-sub.is-online {
  color: var(--success);
}
.friend-sub.is-wait {
  color: var(--warning);
}
.friend-sub.is-muted {
  color: var(--text-muted);
}
.friend-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: currentColor;
}
.friend-sub-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.friend-action {
  flex: none;
  min-height: 32px;
  padding: 0 var(--s-3);
  font-size: var(--fs-sm);
}
.friend-wait {
  flex: none;
  font-size: var(--fs-sm);
  color: var(--text-faint);
}

/* 手机（<720dp）：行 72px；动作按钮触控目标 ≥ 44px */
@media (max-width: 719px) {
  .friend-item {
    min-height: 72px;
  }
  .friend-action {
    min-height: var(--touch);
    padding: 0 var(--s-4);
    font-size: var(--fs-base);
  }
}
</style>
