<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

const TONES = ['#8f5b3d', '#5f6b4e', '#6a4e5c', '#4e5d6b', '#7a5e38', '#3f5c56']

const tone = computed(() => {
  const key = props.profile?.displayName || props.profile?.userId || '?'
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i) * (i + 1)) % 997
  return TONES[h % TONES.length]
})

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
watch(() => [props.profile?.avatarHash, props.profile?.avatarUrl, props.profile?.updatedAt, store.mediaTick], resolve)

function onImgError(): void {
  url.value = null
}
</script>

<template>
  <div
    class="avatar"
    :style="{
      width: `${size ?? 40}px`,
      height: `${size ?? 40}px`,
      fontSize: `${(size ?? 40) * 0.4}px`,
      background: url ? undefined : tone,
    }"
    :class="{ online: online }"
  >
    <img v-if="url" :src="url" alt="" draggable="false" @error="onImgError" />
    <span v-else class="initial">{{ initial }}</span>
    <i v-if="online" class="dot" />
  </div>
</template>

<style scoped>
.avatar {
  position: relative;
  flex: none;
  border-radius: 28%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: #fffaf6;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.initial {
  font-weight: 600;
}
.dot {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 26%;
  height: 26%;
  border-radius: 50%;
  background: var(--ok);
  border: 2px solid var(--bg-sidebar);
  box-sizing: border-box;
}
</style>
