<script setup lang="ts">
/**
 * 附件气泡（设计系统 v2 §4 AttachmentBubble）
 * - 图片：r-md、最大 320×320、hover 轻微放大
 * - 视频：VideoPlayer（封面 + 中央播放键）
 * - 文件：图标 + 名称/大小 + 下载按钮（260–320 宽）
 * - 上传进度 --accent；失败红字 + 重试
 * 契约不变：props { attachment } / emits open
 * 新增可选：failed?（父级消息 status==='failed'）；新增 emits retry
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { Attachment } from '@chataoo/shared'
import { displayAttachmentKind, parseAttachment } from '@chataoo/app-core'
import { useChatStore } from '../stores/chat'
import Icon from './Icon.vue'
import VideoPlayer from './VideoPlayer.vue'

const props = withDefaults(
  defineProps<{ attachment: Attachment; failed?: boolean; outgoing?: boolean; sticker?: boolean }>(),
  { failed: false, outgoing: false, sticker: false },
)
const emit = defineEmits<{ open: [attachment: Attachment]; retry: [] }>()
const store = useChatStore()

const att = computed<Attachment>(() => parseAttachment(props.attachment) ?? props.attachment)
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
const loadError = ref(false)
const saving = ref(false)
let resolveToken = 0

const uploading = computed(() => att.value.uploadPhase != null)
const progress = computed(() => Math.min(100, Math.max(0, att.value.uploadProgress ?? 0)))
const imageAspect = computed(() => {
  const a = att.value
  if (a.width && a.height && a.width > 0 && a.height > 0) return `${a.width} / ${a.height}`
  return undefined
})

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

async function resolve(): Promise<void> {
  const s = store.session
  if (!s) return
  const token = ++resolveToken
  loadError.value = false
  loading.value = true
  try {
    let u = await s.attachmentUrlOf(att.value)
    if (!u) {
      await s.ensureAttachment(att.value)
      u = await s.attachmentUrlOf(att.value)
    }
    if (token !== resolveToken) return
    url.value = u
    if (!u) loadError.value = true
  } catch {
    if (token === resolveToken) loadError.value = true
  } finally {
    if (token === resolveToken) loading.value = false
  }
}

onMounted(resolve)
watch(
  () => [att.value.cached, att.value.url, att.value.sha256, att.value.thumbUrl, att.value.kind, store.mediaTick],
  resolve,
)

async function saveFile(): Promise<void> {
  const s = store.session
  if (!s || saving.value) return
  saving.value = true
  try {
    let href = await s.attachmentUrlOf(att.value)
    if (!href) {
      await s.ensureAttachment(att.value)
      href = await s.attachmentUrlOf(att.value)
    }
    if (!href) return
    if (s.platform.saveFile) await Promise.resolve(s.platform.saveFile(fileName.value, href))
    else {
      const link = document.createElement('a')
      link.href = href
      link.download = fileName.value
      link.click()
    }
  } catch (e) {
    console.error('save attachment failed:', e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="attach" :class="[`kind-${kind}`, { 'is-sticker': sticker }]">
    <!-- 图片 -->
    <template v-if="kind === 'image'">
      <button
        v-if="url"
        type="button"
        class="img-btn"
        :title="`查看图片 ${fileName}`"
        @click="emit('open', att)"
      >
        <img :src="url" class="image" alt="" loading="lazy" decoding="async" />
      </button>
      <div v-else class="ph ph-image" :style="{ aspectRatio: imageAspect }">
        <template v-if="loadError">
          <Icon name="image" :size="24" />
          <span>图片加载失败</span>
          <button type="button" class="ph-retry" @click="resolve">重试</button>
        </template>
        <template v-else>
          <span v-if="loading" class="spin" aria-hidden="true" />
          <span>图片加载中…</span>
        </template>
      </div>
    </template>

    <!-- 视频 -->
    <div v-else-if="kind === 'video'" class="video-wrap">
      <VideoPlayer v-if="url" :src="url" :name="fileName" />
      <div v-else class="ph ph-video">
        <template v-if="loadError">
          <Icon name="play" :size="24" />
          <span>视频加载失败</span>
          <button type="button" class="ph-retry" @click="resolve">重试</button>
        </template>
        <template v-else>
          <span v-if="loading" class="spin" aria-hidden="true" />
          <span>视频加载中…</span>
        </template>
      </div>
    </div>

    <!-- 音频 -->
    <div v-else-if="kind === 'audio'" class="audio-wrap">
      <audio v-if="url" :key="url" :src="url" controls preload="metadata" class="audio" />
      <div v-else class="ph ph-audio">
        <Icon name="volume" :size="22" />
        <span>{{ loadError ? '音频加载失败' : '音频加载中…' }}</span>
        <button v-if="loadError" type="button" class="ph-retry" @click="resolve">重试</button>
      </div>
    </div>

    <!-- 文件 -->
    <div v-else class="file">
      <button type="button" class="file-main" :title="`查看 ${fileName}`" @click="emit('open', att)">
        <span class="file-icon"><Icon name="file" :size="20" /></span>
        <span class="file-meta">
          <span class="file-name">{{ fileName }}</span>
          <span class="file-size">{{ humanSize(att.size) }}</span>
        </span>
      </button>
      <button
        type="button"
        class="file-dl"
        :disabled="saving"
        :title="saving ? '下载中…' : '下载'"
        aria-label="下载附件"
        @click.stop="saveFile"
      >
        <span v-if="saving" class="spin spin-sm" aria-hidden="true" />
        <Icon v-else name="download" :size="16" />
      </button>
    </div>

    <!-- 上传进度 / 上传失败 -->
    <div v-if="uploading" class="progress">
      <div class="progress-head">
        <span>{{ phaseLabel(att.uploadPhase) }}</span>
        <span>{{ progress }}%</span>
      </div>
      <div
        class="progress-track"
        role="progressbar"
        :aria-valuenow="progress"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="progress-bar" :class="{ 'is-outgoing': outgoing }" :style="{ width: `${progress}%` }" />
      </div>
    </div>
    <div v-else-if="failed" class="fail" :class="{ 'is-outgoing': outgoing }">
      <Icon name="alert" :size="14" />
      <span>上传失败</span>
      <button type="button" class="fail-retry" @click="emit('retry')">重试</button>
    </div>
  </div>
</template>

<style scoped>
.attach {
  min-width: 0;
  max-width: 100%;
}

/* ---------- 图片 ---------- */
.img-btn {
  display: inline-block;
  min-width: 96px;
  min-height: 64px;
  max-width: min(320px, 56vw);
  padding: 0;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg-sunken);
  cursor: zoom-in;
  line-height: 0;
}
.image {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 320px;
  object-fit: cover;
  transition: transform var(--dur-med) var(--ease);
}
.img-btn:hover .image {
  transform: scale(1.02);
}
.img-btn:active .image {
  transform: scale(0.995);
}

/* ---------- 视频 ---------- */
.video-wrap {
  width: min(320px, 62vw);
  max-width: 100%;
}

/* ---------- 音频 ---------- */
.audio-wrap {
  width: min(280px, 58vw);
}
.audio {
  width: 100%;
  height: 36px;
  display: block;
}

/* ---------- 文件 ---------- */
.file {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  width: min(300px, 62vw);
  max-width: 100%;
  padding: var(--s-1);
  border-radius: var(--r-sm);
  background: color-mix(in srgb, currentColor 9%, transparent);
}
.file-main {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  flex: 1;
  min-width: 0;
  padding: var(--s-1) var(--s-2);
  border-radius: var(--r-xs);
  text-align: left;
  color: inherit;
}
.file-main:hover {
  background: color-mix(in srgb, currentColor 7%, transparent);
}
.file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--s-10);
  height: var(--s-10);
  flex: none;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.file-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.file-name {
  font-size: var(--fs-base);
  font-weight: 600;
  line-height: var(--lh-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-size {
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: color-mix(in srgb, currentColor 78%, transparent);
}
.file-dl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--r-xs);
  color: inherit;
}
.file-dl:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.file-dl:disabled {
  cursor: default;
}

/* ---------- 占位 / 加载 ---------- */
.ph {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  min-height: 120px;
  padding: var(--s-4);
  border-radius: var(--r-md);
  background: color-mix(in srgb, currentColor 8%, transparent);
  color: color-mix(in srgb, currentColor 82%, transparent);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  text-align: center;
}
.ph-image,
.ph-video {
  width: min(260px, 56vw);
  aspect-ratio: 4 / 3;
}
.ph-audio {
  width: min(280px, 58vw);
  min-height: 64px;
  flex-direction: row;
  justify-content: flex-start;
  text-align: left;
}
.ph-retry {
  min-height: 32px;
  padding: 0 var(--s-3);
  border-radius: var(--r-full);
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  color: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  line-height: var(--lh-base);
}
.ph-retry:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.spin {
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in srgb, currentColor 26%, transparent);
  border-top-color: currentColor;
  border-radius: var(--r-full);
  animation: attach-spin 0.8s linear infinite;
  flex: none;
}
.spin-sm {
  width: 14px;
  height: 14px;
}

/* ---------- 上传进度 / 失败 ---------- */
.progress {
  width: min(300px, 62vw);
  max-width: 100%;
  margin-top: var(--s-2);
}
.progress-head {
  display: flex;
  justify-content: space-between;
  gap: var(--s-2);
  margin-bottom: var(--s-1);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: color-mix(in srgb, currentColor 78%, transparent);
}
.progress-track {
  height: 4px;
  border-radius: var(--r-full);
  background: color-mix(in srgb, currentColor 22%, transparent);
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width var(--dur-med) var(--ease);
}
/* 自己的蓝色气泡里 --accent 对比不足，改用气泡反色 */
.progress-bar.is-outgoing {
  background: var(--bubble-out-text);
}
.fail {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  margin-top: var(--s-2);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.fail.is-outgoing {
  color: var(--bubble-out-text);
}
.fail-retry {
  min-height: 32px;
  padding: 0 var(--s-3);
  border-radius: var(--r-xs);
  color: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: var(--lh-base);
  text-decoration: underline;
}
.fail-retry:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

@keyframes attach-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 719px) {
  .img-btn {
    max-width: min(320px, 64vw);
  }
}
@media (pointer: coarse) {
  .file-dl {
    width: var(--touch);
    height: var(--touch);
  }
  .ph-retry,
  .fail-retry {
    min-height: var(--touch);
    padding: 0 var(--s-3);
  }
}

/* 自定义表情（图片/GIF 贴纸）：小尺寸、去掉附件外观 */
.attach.is-sticker .img-btn {
  min-width: 0;
  min-height: 0;
  max-width: 148px;
  background: transparent;
}
.attach.is-sticker .image {
  max-width: 148px;
  max-height: 148px;
  object-fit: contain;
}
</style>
