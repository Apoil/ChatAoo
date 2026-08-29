<script setup lang="ts">
import { computed } from 'vue'
import type { Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'

const props = defineProps<{
  profile: Profile | null | undefined
  friendStatus: string
  userId?: string
}>()
const store = useChatStore()

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

function accept(): void {
  if (props.profile) void store.session?.acceptFriend(props.profile.userId)
}

function open(): void {
  const id = props.profile?.userId ?? props.userId
  if (id && props.friendStatus === 'friends') void store.openConversation(id)
}
</script>

<template>
  <div class="row" :class="{ clickable: friendStatus === 'friends' }" @click="open">
    <Avatar :profile="profile" :online="store.isPeerOnline(profile?.userId ?? '')" />
    <div class="meta">
      <div class="name">{{ profile?.displayName ?? '未知用户' }}</div>
      <div class="sub">
        <span v-if="store.lanPeers[profile?.userId ?? '']?.online" class="lan">局域网</span>
        <span v-else-if="store.presence[profile?.userId ?? '']" class="on">在线</span>
        <span v-else-if="statusLabel" class="wait">{{ statusLabel }}</span>
      </div>
    </div>
    <button v-if="friendStatus === 'incoming'" class="btn btn-primary sm" @click.stop="accept">通过</button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
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
  font-size: 11.5px;
}
.lan {
  color: var(--lan);
}
.on {
  color: var(--ok);
}
.wait {
  color: var(--text-faint);
}
.btn.sm {
  padding: 5px 12px;
  font-size: 12px;
}
</style>
