<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'

const props = defineProps<{
  profile: Profile | null | undefined
  size?: number
  online?: boolean
}>()

const store = useChatStore()
const url = ref<string | null>(null)
const initial = ref('?')

async function resolve(): Promise<void> {
  const p = props.profile
  if (!p) {
    url.value = null
    initial.value = '?'
    return
  }
  initial.value = (p.displayName || p.userId || '?').slice(0, 1).toUpperCase()
  url.value = store.session ? await store.session.avatarUrlOf(p) : null
}

onMounted(resolve)
watch(() => [props.profile?.avatarHash, props.profile?.updatedAt], resolve)
</script>

<template>
  <div
    class="avatar"
    :style="{ width: `${size ?? 40}px`, height: `${size ?? 40}px`, fontSize: `${(size ?? 40) * 0.42}px` }"
    :class="{ online: online }"
  >
    <img v-if="url" :src="url" alt="" draggable="false" />
    <span v-else class="initial">{{ initial }}</span>
    <i v-if="online" class="dot" />
  </div>
</template>

<style scoped>
.avatar {
  position: relative;
  flex: none;
  border-radius: 50%;
  background: linear-gradient(160deg, #4b5a74, #3a465c);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: #fff;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.initial {
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
.dot {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 28%;
  height: 28%;
  border-radius: 50%;
  background: var(--ok);
  border: 2px solid var(--bg-sidebar);
}
</style>
