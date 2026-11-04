<script setup lang="ts">
/**
 * 媒体查看器（设计系统 v2 §4 MediaViewer）
 * - 全屏 --overlay-strong 遮罩；图片 contain + 双击缩放（可拖拽平移）
 * - 顶部操作条：关闭 / 复制 / 保存；Esc 关闭；点击遮罩关闭
 * 契约不变：props { attachment, url } / emits close
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Attachment } from '@chataoo/shared'
import { displayAttachmentKind } from '@chataoo/app-core'
import { useChatStore } from '../stores/chat'
import Icon from './Icon.vue'

const props = defineProps<{ attachment: Attachment; url: string | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useChatStore()

const resolved = ref<string | null>(props.url)
const loadError = ref(false)
const saving = ref(false)
const imgLoaded = ref(false)
const imgError = ref(false)
const hint = ref('')

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const panning = ref(false)

const closeBtn = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
let hintTimer: ReturnType<typeof setTimeout> | null = null
let resolveToken = 0

const kind = computed(() => displayAttachmentKind(props.attachment))
const fileName = computed(() => {
  const a = props.attachment
  if (a.name && a.name !== '-') return a.name
  if (kind.value === 'image') return '图片'
  if (kind.value === 'video') return '视频'
  if (kind.value === 'audio') return '音频'
  return '文件'
})

const imgStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
}))

function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function flash(text: string): void {
  hint.value = text
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => (hint.value = ''), 2200)
}

function resetZoom(): void {
  scale.value = 1
  tx.value = 0
  ty.value = 0
  panning.value = false
}

async function resolveAttachment(): Promise<void> {
  const s = store.session
  const token = ++resolveToken
  loadError.value = false
  imgError.value = false
  imgLoaded.value = false
  resolved.value = props.url
  if (resolved.value) return
  if (!s) {
    loadError.value = true
    return
  }
  try {
    await s.ensureAttachment(props.attachment)
    if (token !== resolveToken) return
    resolved.value = await s.attachmentUrlOf(props.attachment)
    if (!resolved.value) loadError.value = true
  } catch {
    if (token === resolveToken) loadError.value = true
  }
}

async function retryLoad(): Promise<void> {
  resolved.value = null
  await resolveAttachment()
}

watch(
  () => props.url,
  (u) => {
    if (!u) return
    resolved.value = u
    imgLoaded.value = false
    imgError.value = false
  },
)

watch(
  () => props.attachment.id,
  () => {
    resetZoom()
    void resolveAttachment()
  },
  { immediate: true },
)

/* ---------------- 缩放 / 拖拽 ---------------- */

function toggleZoom(): void {
  if (scale.value > 1) resetZoom()
  else {
    scale.value = 2.5
    tx.value = 0
    ty.value = 0
  }
}

interface DragState {
  pointerId: number
  x: number
  y: number
  tx: number
  ty: number
}
let drag: DragState | null = null

function onImgDown(ev: PointerEvent): void {
  if (scale.value <= 1) return
  ev.preventDefault()
  panning.value = true
  drag = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, tx: tx.value, ty: ty.value }
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
}

function onImgMove(ev: PointerEvent): void {
  if (!drag || drag.pointerId !== ev.pointerId) return
  tx.value = drag.tx + ev.clientX - drag.x
  ty.value = drag.ty + ev.clientY - drag.y
}

function onImgUp(ev: PointerEvent): void {
  if (!drag || drag.pointerId !== ev.pointerId) return
  drag = null
  panning.value = false
}

/* ---------------- 保存 / 复制 ---------------- */

async function save(): Promise<void> {
  const s = store.session
  if (saving.value) return
  saving.value = true
  try {
    let href = resolved.value
    if (!href && s) {
      await s.ensureAttachment(props.attachment)
      href = await s.attachmentUrlOf(props.attachment)
      resolved.value = href
    }
    if (!href) {
      flash('文件还没加载完')
      return
    }
    if (s?.platform.saveFile) {
      const r = await Promise.resolve(s.platform.saveFile(fileName.value, href))
      if (r === 'cancelled') return
      flash(r === 'shared' ? '请选择保存位置' : '已保存')
    } else {
      const a = document.createElement('a')
      a.href = href
      a.download = fileName.value
      a.click()
      flash('已开始下载')
    }
  } catch (e) {
    console.error('save file failed:', e)
    flash('保存失败')
  } finally {
    saving.value = false
  }
}

async function copy(): Promise<void> {
  const href = resolved.value
  if (kind.value === 'image' && href) {
    try {
      const res = await fetch(href)
      const blob = await res.blob()
      const type = blob.type || props.attachment.mimeType || 'image/png'
      if (typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ [type]: blob })])
        flash('图片已复制')
        return
      }
    } catch {
      /* 回退为复制文件名 */
    }
  }
  try {
    await navigator.clipboard.writeText(href || fileName.value)
    flash('已复制')
  } catch {
    flash('复制失败')
  }
}

/* ---------------- 生命周期 ---------------- */

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    emit('close')
  }
}

onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  window.addEventListener('keydown', onKey)
  void nextTick(() => closeBtn.value?.focus())
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (hintTimer) clearTimeout(hintTimer)
  previousFocus?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <div class="viewer" role="dialog" aria-modal="true" :aria-label="`查看 ${fileName}`" @click.self="emit('close')">
      <header class="topbar">
        <button ref="closeBtn" type="button" class="tb" title="关闭（Esc）" aria-label="关闭" @click="emit('close')">
          <Icon name="close" :size="20" />
        </button>
        <div class="title">
          <span class="tname">{{ fileName }}</span>
          <span class="tsize">{{ humanSize(attachment.size) }}</span>
        </div>
        <button type="button" class="tb" title="复制" aria-label="复制" @click="copy">
          <Icon name="copy" :size="18" />
        </button>
        <button
          type="button"
          class="tb"
          title="保存"
          aria-label="保存"
          :disabled="saving"
          @click="save"
        >
          <Icon name="save" :size="18" />
        </button>
      </header>

      <div class="stage" @click.self="emit('close')">
        <template v-if="kind === 'image'">
          <div v-if="!resolved && !loadError" class="loading"><span class="spin" aria-hidden="true" /><span>加载中…</span></div>
          <div v-else-if="loadError" class="error-card">
            <Icon name="alert" :size="22" />
            <span>图片加载失败</span>
            <button type="button" class="card-btn" @click="retryLoad">重试</button>
          </div>
          <img
            v-if="resolved && !loadError"
            v-show="imgLoaded && !imgError"
            :src="resolved"
            class="photo"
            :class="{ zoomed: scale > 1, panning }"
            :style="imgStyle"
            alt=""
            draggable="false"
            @load="imgLoaded = true"
            @error="imgError = true"
            @dblclick="toggleZoom"
            @pointerdown="onImgDown"
            @pointermove="onImgMove"
            @pointerup="onImgUp"
            @pointercancel="onImgUp"
          />
          <div v-if="resolved && !imgLoaded && !imgError && !loadError" class="loading">
            <span class="spin" aria-hidden="true" /><span>加载中…</span>
          </div>
          <div v-if="imgError" class="error-card">
            <Icon name="alert" :size="22" />
            <span>图片加载失败</span>
            <button type="button" class="card-btn" @click="retryLoad">重试</button>
          </div>
        </template>

        <template v-else-if="kind === 'video'">
          <video v-if="resolved" :src="resolved" class="media-video" controls playsinline autoplay />
          <div v-else-if="loadError" class="error-card">
            <Icon name="alert" :size="22" />
            <span>视频加载失败</span>
            <button type="button" class="card-btn" @click="retryLoad">重试</button>
          </div>
          <div v-else class="loading"><span class="spin" aria-hidden="true" /><span>加载中…</span></div>
        </template>

        <template v-else-if="kind === 'audio'">
          <div class="file-card">
            <span class="file-icon"><Icon name="volume" :size="28" /></span>
            <span class="fname">{{ fileName }}</span>
            <span class="fsize">{{ humanSize(attachment.size) }}</span>
            <audio v-if="resolved" :src="resolved" class="media-audio" controls autoplay />
            <div v-else-if="loadError" class="card-row">
              <span>音频加载失败</span>
              <button type="button" class="card-btn" @click="retryLoad">重试</button>
            </div>
            <div v-else class="card-row"><span class="spin" aria-hidden="true" /><span>加载中…</span></div>
          </div>
        </template>

        <div v-else class="file-card">
          <span class="file-icon"><Icon name="file" :size="28" /></span>
          <span class="fname">{{ fileName }}</span>
          <span class="fsize">{{ humanSize(attachment.size) }}</span>
        </div>
      </div>

      <div class="hint" role="status" aria-live="polite">
        <span v-if="hint">{{ hint }}</span>
        <template v-else-if="kind === 'image'">
          <span>{{ scale > 1 ? '双击复位 · Esc 关闭' : '双击缩放 · Esc 关闭' }}</span>
          <button v-if="scale > 1" type="button" class="hint-btn" @click="resetZoom">复位</button>
        </template>
        <span v-else>Esc 关闭</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  background: var(--overlay-strong);
  color: var(--media-fg);
  animation: viewer-in var(--dur-med) var(--ease);
}

/* ---------- 顶部操作条 ---------- */
.topbar {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + var(--s-2));
  left: var(--s-3);
  right: var(--s-3);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: var(--s-1);
  border-radius: var(--r-full);
  background: var(--media-control-bg);
  border: 1px solid color-mix(in srgb, var(--media-fg) 12%, transparent);
  backdrop-filter: blur(10px);
}
.tb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--s-10);
  height: var(--s-10);
  flex: none;
  border-radius: var(--r-full);
  color: var(--media-fg);
  transition: background var(--dur-fast) var(--ease), opacity var(--dur-fast) var(--ease);
}
.tb:hover:not(:disabled) {
  background: color-mix(in srgb, var(--media-fg) 14%, transparent);
}
.tb:disabled {
  opacity: 0.4;
  cursor: default;
}
.title {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  padding: 0 var(--s-2);
  text-align: left;
}
.tname {
  font-size: var(--fs-base);
  font-weight: 600;
  line-height: var(--lh-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tsize {
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--media-fg-muted);
}

/* ---------- 舞台 ---------- */
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: calc(var(--s-10) + var(--s-4) + env(safe-area-inset-top, 0px)) var(--s-4)
    calc(var(--s-10) + var(--s-4) + env(safe-area-inset-bottom, 0px));
}
.photo {
  max-width: 100%;
  max-height: 100%;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  cursor: zoom-in;
  transform-origin: center center;
  transition: transform var(--dur-med) var(--ease);
  will-change: transform;
}
.photo.zoomed {
  cursor: grab;
}
.photo.panning {
  cursor: grabbing;
  transition: none;
}
.media-video {
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--r-md);
  background: var(--media-bg);
}
.media-audio {
  width: min(100%, 380px);
  margin-top: var(--s-2);
}

.loading {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  color: var(--media-fg-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.spin {
  width: 18px;
  height: 18px;
  border: 2px solid var(--media-track);
  border-top-color: var(--media-fg);
  border-radius: var(--r-full);
  animation: viewer-spin 0.8s linear infinite;
}

/* ---------- 文件 / 错误卡片 ---------- */
.file-card,
.error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
  max-width: min(92vw, 420px);
  padding: var(--s-6);
  border-radius: var(--r-lg);
  background: var(--media-control-bg);
  border: 1px solid color-mix(in srgb, var(--media-fg) 12%, transparent);
  backdrop-filter: blur(10px);
  text-align: center;
}
.error-card {
  color: var(--media-fg-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--s-10) + var(--s-3));
  height: calc(var(--s-10) + var(--s-3));
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--media-fg) 12%, transparent);
  color: var(--media-fg);
}
.fname {
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-base);
  color: var(--media-fg);
  overflow-wrap: anywhere;
}
.fsize {
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--media-fg-muted);
}
.card-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  color: var(--media-fg-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.card-btn,
.hint-btn {
  min-height: 32px;
  padding: 0 var(--s-4);
  border-radius: var(--r-full);
  border: 1px solid var(--media-track);
  color: var(--media-fg);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  white-space: nowrap;
}
.card-btn:hover,
.hint-btn:hover {
  background: color-mix(in srgb, var(--media-fg) 14%, transparent);
}

/* ---------- 底部提示 ---------- */
.hint {
  position: absolute;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + var(--s-5));
  transform: translateX(-50%);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  max-width: calc(100vw - var(--s-8));
  padding: var(--s-1) var(--s-4);
  border-radius: var(--r-full);
  background: var(--media-control-bg);
  border: 1px solid color-mix(in srgb, var(--media-fg) 12%, transparent);
  backdrop-filter: blur(8px);
  color: var(--media-fg);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  white-space: nowrap;
}

@keyframes viewer-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes viewer-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 719px) {
  .tb {
    width: var(--touch);
    height: var(--touch);
  }
  .topbar {
    top: calc(env(safe-area-inset-top, 0px) + var(--s-1));
    left: var(--s-2);
    right: var(--s-2);
  }
  .stage {
    padding: calc(var(--touch) + var(--s-5) + env(safe-area-inset-top, 0px)) var(--s-2)
      calc(var(--touch) + var(--s-4) + env(safe-area-inset-bottom, 0px));
  }
  .card-btn,
  .hint-btn {
    min-height: var(--touch);
  }
}
</style>
