<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'

const props = defineProps<{
  profile: Profile | null | undefined
  /** 数字按 px；也接受 CSS 长度（如 var(--avatar-lg)） */
  size?: number | string
  online?: boolean
}>()

const store = useChatStore()
const url = ref<string | null>(null)

/** 无图占位：中文取首字，英文取首字母大写。 */
const initial = computed(() => {
  const name = (props.profile?.displayName || props.profile?.userId || '?').trim()
  return (Array.from(name)[0] ?? '?').toUpperCase()
})

const sizeValue = computed(() => {
  const size = props.size
  if (size === undefined) return 'var(--avatar-sm)'
  return typeof size === 'number' ? `${size}px` : size
})

async function resolve(): Promise<void> {
  const p = props.profile
  if (!p) {
    url.value = null
    return
  }
  url.value = store.session ? await store.session.avatarUrlOf(p) : null
}

onMounted(resolve)
watch(
  () => [props.profile?.avatarHash, props.profile?.avatarUrl, props.profile?.updatedAt, store.mediaTick],
  resolve,
)

function onImgError(): void {
  url.value = null
}
</script>

<template>
  <div
    class="avatar"
    :class="{ online }"
    :style="{ '--avatar-size': sizeValue }"
  >
    <img v-if="url" :src="url" alt="" draggable="false" @error="onImgError" />
    <span v-else class="initial">{{ initial }}</span>
    <i v-if="online" class="dot" aria-hidden="true" />
  </div>
</template>

<style scoped>
.avatar {
  position: relative;
  flex: none;
  width: var(--avatar-size);
  height: var(--avatar-size);
  font-size: calc(var(--avatar-size) * 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-full);
  background: var(--accent-soft);
  color: var(--accent);
  user-select: none;
}
.avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: inherit;
}
.initial {
  font-weight: 600;
  line-height: 1;
}
/* 在线点：10px + 2px --bg-panel 描边（设计系统 §4 Avatar） */
.dot {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 10px;
  height: 10px;
  border-radius: var(--r-full);
  background: var(--success);
  border: 2px solid var(--bg-panel);
  box-sizing: border-box;
  pointer-events: none;
}
</style>
