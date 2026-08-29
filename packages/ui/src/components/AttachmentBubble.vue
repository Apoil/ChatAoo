<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Attachment } from '@chataoo/shared'
import { displayAttachmentKind, parseAttachment } from '@chataoo/app-core'
import { useChatStore } from '../stores/chat'
import Icon from './Icon.vue'
import VideoPlayer from './VideoPlayer.vue'

const props = defineProps<{ attachment: Attachment }>()
const emit = defineEmits<{ open: [attachment: Attachment] }>()
const store = useChatStore()

const att = computed(() => parseAttachment(props.attachment) ?? props.attachment)
const kind = computed(() => displayAttachmentKind(att.value))
const fileName = computed(() => {
  const a = att.value
  if (a.name && a.name !== '-') return a.name
  if (kind.value === 'image') return '图片'
  if (kind.value === 'video') return '视频'
  if (kind.value === 'audio') return '音频'
  return '文件'
})

const url = ref<string | null>(null)
const loading = ref(false)
const playError = ref(false)

async function resolve(): Promise<void> {
  const s = store.session
  const a = att.value
  if (!s || !a) return
  playError.value = false
  url.value = await s.attachmentUrlOf(a)
  if (a.sha256 && a.cached && !a.uploadPhase && url.value) return
  if (url.value) return
  loading.value = true
  void s.ensureAttachment(a).then(async () => {
    url.value = await s.attachmentUrlOf(a)
    loading.value = false
  })
}

onMounted(resolve)
watch(() => [att.value.cached, att.value.url, att.value.sha256, att.value.thumbUrl, att.value.kind, store.mediaTick], resolve)

function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function phaseLabel(phase?: string): string {
  if (phase === 'preparing') return '正在读取…'
  if (phase === 'uploading') return '正在上传…'
  if (phase === 'sending') return '即将发送…'
  return '处理中…'
}
</script>

<template>
  <div class="attach">
    <img
      v-if="kind === 'image' && url"
      :src="url"
      class="image"
      alt=""
      loading="lazy"
      @click="emit('open', att)"
    />
    <div v-else-if="kind === 'image'" class="pending">图片加载中…</div>
    <div v-else-if="kind === 'video'" class="video-wrap">
      <VideoPlayer v-if="url && !playError" :src="url" />
      <div v-else-if="playError" class="pending fail" @click="emit('open', att)">
        无法播放，点击保存后用播放器打开
      </div>
      <div v-else class="pending">视频加载中…</div>
    </div>
    <div v-else-if="kind === 'audio'" class="audio-wrap">
      <audio v-if="url" :key="url" :src="url" controls preload="auto" />
      <div v-else class="pending">音频加载中…</div>
    </div>
    <div v-else class="file" @click="emit('open', att)">
      <div class="file-icon"><Icon name="file" :size="22" /></div>
      <div class="file-meta">
        <div class="file-name">{{ fileName }}</div>
        <div class="file-size">{{ humanSize(att.size) }}</div>
      </div>
      <span v-if="loading" class="spin" />
    </div>
    <div v-if="att.uploadPhase != null" class="progress">
      <div class="progress-label">
        {{ phaseLabel(att.uploadPhase) }}
        <span v-if="att.uploadProgress != null">{{ att.uploadProgress }}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-bar" :style="{ width: `${att.uploadProgress ?? 8}%` }" />
      </div>
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
  border-radius: 6px;
  display: block;
  cursor: zoom-in;
  object-fit: cover;
}
.video-wrap {
  width: min(360px, 60vw);
}
.audio-wrap {
  width: min(280px, 55vw);
}
.pending {
  color: var(--text-dim);
  padding: 12px 4px;
  font-size: 13px;
}
.pending.fail {
  cursor: pointer;
  color: var(--accent);
}
.file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--bg-input);
  border-radius: var(--radius-sm);
  cursor: pointer;
  max-width: 280px;
}
.file:hover {
  background: var(--bg-hover);
}
.file-icon {
  color: var(--accent);
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
.progress {
  margin-top: 6px;
  max-width: 280px;
}
.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.progress-track {
  height: 4px;
  border-radius: 99px;
  background: var(--border);
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
</style>
