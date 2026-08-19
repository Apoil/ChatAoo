<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Attachment } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'

const props = defineProps<{ attachment: Attachment }>()
const emit = defineEmits<{ open: [attachment: Attachment] }>()
const store = useChatStore()

const url = ref<string | null>(null)
const loading = ref(false)

async function resolve(): Promise<void> {
  const s = store.session
  if (!s) return
  url.value = await s.attachmentUrlOf(props.attachment)
  // 在线时按需缓存，保证可离线回看
  if (!props.attachment.cached) {
    loading.value = true
    await s.ensureAttachment(props.attachment)
    url.value = await s.attachmentUrlOf(props.attachment)
    loading.value = false
  }
}

onMounted(resolve)
watch(() => props.attachment.cached, resolve)

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>

<template>
  <div class="attach">
    <!-- 图片 -->
    <img
      v-if="attachment.kind === 'image' && url"
      :src="url"
      class="image"
      alt=""
      loading="lazy"
      @click="emit('open', attachment)"
    />
    <!-- 视频：在线（Range 流）或本地缓存均可直接播放 -->
    <div v-else-if="attachment.kind === 'video'" class="video-wrap">
      <video v-if="url" :src="url" controls preload="metadata" class="video" />
      <div v-else class="pending">视频加载中…</div>
    </div>
    <!-- 音频 -->
    <div v-else-if="attachment.kind === 'audio'" class="audio-wrap">
      <audio v-if="url" :src="url" controls preload="metadata" />
      <div v-else class="pending">音频加载中…</div>
    </div>
    <!-- 普通文件 -->
    <div v-else class="file" @click="emit('open', attachment)">
      <div class="file-icon">📄</div>
      <div class="file-meta">
        <div class="file-name">{{ attachment.name }}</div>
        <div class="file-size">{{ humanSize(attachment.size) }}</div>
      </div>
      <span v-if="loading" class="spin" />
    </div>
  </div>
</template>

<style scoped>
.attach {
  min-width: 0;
}
.image {
  max-width: min(320px, 55vw);
  max-height: 340px;
  border-radius: var(--radius-sm);
  display: block;
  cursor: zoom-in;
  object-fit: cover;
}
.video-wrap {
  width: min(360px, 60vw);
}
.video {
  width: 100%;
  max-height: 300px;
  border-radius: var(--radius-sm);
  background: #000;
}
.audio-wrap {
  width: min(280px, 55vw);
}
.pending {
  color: var(--text-dim);
  padding: 12px 4px;
  font-size: 13px;
}
.file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-sm);
  cursor: pointer;
  max-width: 280px;
}
.file:hover {
  background: rgba(255, 255, 255, 0.1);
}
.file-icon {
  font-size: 26px;
}
.file-meta {
  min-width: 0;
  flex: 1;
}
.file-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-size {
  font-size: 11.5px;
  color: var(--text-dim);
}
.spin {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: rot 0.8s linear infinite;
  flex: none;
}
@keyframes rot {
  to {
    transform: rotate(360deg);
  }
}
</style>
