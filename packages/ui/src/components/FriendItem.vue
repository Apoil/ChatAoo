<script setup lang="ts">
import { computed } from 'vue'
import type { Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'

const props = defineProps<{ profile: Profile | null | undefined; friendStatus: string }>()
const store = useChatStore()

const statusLabel = computed(() => {
  switch (props.friendStatus) {
    case 'outgoing':
      return '等待验证'
    case 'incoming':
      return '待处理'
    case 'friends':
      return '好友'
    default:
      return '添加好友'
  }
})

function accept(): void {
  if (props.profile) void store.session?.acceptFriend(props.profile.userId)
}

function open(): void {
  if (props.profile && props.friendStatus === 'friends') void store.openConversation(props.profile.userId)
}
</script>

<template>
  <div class="row" :class="{ clickable: friendStatus === 'friends' }" @click="open">
    <Avatar :profile="profile" :online="store.isPeerOnline(profile?.userId ?? '')" />
    <div class="meta">
      <div class="name">{{ profile?.displayName ?? '未知用户' }}</div>
      <div class="sub">
        <span v-if="store.lanPeers[profile?.userId ?? '']?.online" class="lan-pill">局域网在线</span>
        <span v-else-if="store.presence[profile?.userId ?? '']" class="online-pill">在线</span>
      </div>
    </div>
    <template v-if="friendStatus === 'incoming'">
      <button class="btn btn-primary sm" @click.stop="accept">通过</button>
    </template>
    <template v-else>
      <span class="pill">{{ statusLabel }}</span>
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius);
}
.row.clickable {
  cursor: pointer;
}
.row.clickable:hover {
  background: var(--bg-hover);
}
.meta {
  flex: 1;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.lan-pill {
  font-size: 11px;
  color: var(--accent-3);
  background: rgba(34, 211, 238, 0.12);
  padding: 1px 8px;
  border-radius: var(--radius-full);
}
.online-pill {
  font-size: 11px;
  color: var(--ok);
}
.btn.sm {
  padding: 6px 14px;
  font-size: 12px;
}
</style>
