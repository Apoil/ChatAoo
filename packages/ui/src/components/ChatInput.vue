<script setup lang="ts">
/**
 * 输入区（设计系统 v2 §4 ChatInput）
 * - 桌面 68px / 手机 60px，内容居中最大宽 980px
 * - 多行自适应 40–120px，Enter 发送、Shift+Enter 换行（兼容中文输入法）
 * - 附件 Popover：图片/视频、文件；拖拽整块虚线高亮
 * 契约不变：emits send-text / send-files
 * 新增可选：placeholder?
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import {
  EMOJI_CATEGORIES,
  EMOJI_RECENT,
  loadRecentEmoji,
  pushRecentEmoji,
} from '../emoji'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    /** 「我的表情」：图片/GIF 贴纸（url 由上层解析好） */
    stickers?: { id: string; name: string; url: string }[]
  }>(),
  { placeholder: '发送消息', stickers: () => [] },
)
const emit = defineEmits<{
  'send-text': [text: string]
  'send-files': [files: { blob: Blob; name: string }[]]
  'send-sticker': [sticker: { id: string; name: string; url: string }]
  'add-sticker': [file: File]
}>()

const MIN_H = 40
const MAX_H = 120

const text = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const area = ref<HTMLTextAreaElement | null>(null)
const wrap = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const dragging = ref(false)
let dragDepth = 0

/* ---------------- 表情包 ---------------- */
const emojiOpen = ref(false)
const emojiTab = ref<string>(EMOJI_RECENT)
const recentEmoji = ref<string[]>(loadRecentEmoji())
const stickerInput = ref<HTMLInputElement | null>(null)
const emojiTabs = computed(() => [
  { key: 'mine', name: '我的' },
  { key: EMOJI_RECENT, name: '最近' },
  ...EMOJI_CATEGORIES,
])
const currentEmojis = computed<string[]>(() => {
  if (emojiTab.value === EMOJI_RECENT) return recentEmoji.value
  return EMOJI_CATEGORIES.find((c) => c.key === emojiTab.value)?.emojis ?? []
})

/** 选择本地图片/GIF 作为自定义表情 */
function onStickerFile(ev: Event): void {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('add-sticker', file)
}

function sendSticker(sticker: { id: string; name: string; url: string }): void {
  emit('send-sticker', sticker)
  emojiOpen.value = false
}

const canSend = computed(() => text.value.trim().length > 0)

function resize(): void {
  const el = area.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_H), MAX_H)}px`
  el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden'
}

function submit(): void {
  const t = text.value.trim()
  if (!t) return
  emit('send-text', t)
  text.value = ''
  menuOpen.value = false
  void nextTick(() => {
    resize()
    area.value?.focus()
  })
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) emojiOpen.value = false
}

function toggleEmoji(): void {
  emojiOpen.value = !emojiOpen.value
  if (emojiOpen.value) {
    menuOpen.value = false
    emojiTab.value = recentEmoji.value.length ? EMOJI_RECENT : EMOJI_CATEGORIES[0]!.key
  }
}

/** 在光标处插入 emoji，保持输入框焦点与高度 */
function insertEmoji(emoji: string): void {
  const el = area.value
  const start = el?.selectionStart ?? text.value.length
  const end = el?.selectionEnd ?? text.value.length
  text.value = text.value.slice(0, start) + emoji + text.value.slice(end)
  recentEmoji.value = pushRecentEmoji(emoji)
  void nextTick(() => {
    resize()
    el?.focus()
    const pos = start + emoji.length
    el?.setSelectionRange(pos, pos)
  })
}

function pickFiles(kind: 'file' | 'image'): void {
  menuOpen.value = false
  if (kind === 'file') fileInput.value?.click()
  else imageInput.value?.click()
}

function onFiles(ev: Event): void {
  const input = ev.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  emit(
    'send-files',
    files.map((f) => ({ blob: f, name: f.name })),
  )
}

function onKeydown(ev: KeyboardEvent): void {
  // keyCode 229：部分中文/日文输入法组合态下 Enter 仍会上报，交给输入法处理
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) {
    ev.preventDefault()
    submit()
  }
}

/** 从剪贴板粘贴图片/文件（截图、复制的图片）直接作为附件发送 */
function onPaste(ev: ClipboardEvent): void {
  const items = ev.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of items) {
    if (item.kind !== 'file') continue
    const f = item.getAsFile()
    if (f && f.size > 0) files.push(f)
  }
  if (!files.length) return
  ev.preventDefault()
  emit(
    'send-files',
    files.map((f) => ({
      blob: f,
      name:
        f.name ||
        `粘贴图片-${new Date().toISOString().replace(/[:.]/g, '-')}.${f.type === 'image/png' ? 'png' : 'jpg'}`,
    })),
  )
}

function onDragEnter(ev: DragEvent): void {
  if (!ev.dataTransfer?.types.includes('Files')) return
  ev.preventDefault()
  dragDepth++
  dragging.value = true
}

function onDragOver(ev: DragEvent): void {
  if (!ev.dataTransfer?.types.includes('Files')) return
  ev.preventDefault()
  ev.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function onDragLeave(ev: DragEvent): void {
  ev.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}

function onDrop(ev: DragEvent): void {
  ev.preventDefault()
  dragDepth = 0
  dragging.value = false
  const files = [...(ev.dataTransfer?.files ?? [])].filter((f) => f.size > 0)
  if (!files.length) return
  emit(
    'send-files',
    files.map((f) => ({ blob: f, name: f.name })),
  )
  area.value?.focus()
}

function onDoc(ev: MouseEvent | TouchEvent): void {
  const target = ev.target as HTMLElement | null
  if (menuOpen.value && !target?.closest('.attach-wrap')) menuOpen.value = false
  if (emojiOpen.value && !target?.closest('.emoji-wrap')) emojiOpen.value = false
}

function onWindowKey(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return
  if (menuOpen.value || emojiOpen.value) {
    menuOpen.value = false
    emojiOpen.value = false
    area.value?.focus()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDoc)
  document.addEventListener('touchstart', onDoc, { passive: true })
  window.addEventListener('keydown', onWindowKey)
  void nextTick(resize)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc)
  document.removeEventListener('touchstart', onDoc)
  window.removeEventListener('keydown', onWindowKey)
})
</script>

<template>
  <div
    ref="wrap"
    class="composer"
    :class="{ dragging }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <input ref="fileInput" type="file" multiple hidden @change="onFiles" />
    <input
      ref="imageInput"
      type="file"
      multiple
      accept="image/*,video/*,audio/*,.mp4,.mov,.webm,.m4v,.3gp,.jpg,.jpeg,.png,.gif,.webp"
      hidden
      @change="onFiles"
    />
    <input
      ref="stickerInput"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,.gif,.png,.jpg,.jpeg,.webp"
      hidden
      @change="onStickerFile"
    />

    <div class="bar">
      <div class="emoji-wrap">
        <button
          type="button"
          class="icon-btn emoji-btn"
          :class="{ 'is-active': emojiOpen }"
          title="表情"
          aria-label="选择表情"
          aria-haspopup="dialog"
          :aria-expanded="emojiOpen"
          @click="toggleEmoji"
        >
          <Icon name="smile" :size="20" />
        </button>
        <Transition name="pop">
          <div v-if="emojiOpen" class="emoji-panel" role="dialog" aria-label="表情包">
            <div class="emoji-tabs" role="tablist" aria-label="表情分类">
              <button
                v-for="tab in emojiTabs"
                :key="tab.key"
                type="button"
                role="tab"
                class="emoji-tab"
                :class="{ on: emojiTab === tab.key }"
                :aria-selected="emojiTab === tab.key"
                @click="emojiTab = tab.key"
              >
                {{ tab.name }}
              </button>
            </div>
            <div v-if="emojiTab === 'mine'" class="sticker-grid">
              <button
                v-for="st in props.stickers"
                :key="st.id"
                type="button"
                class="sticker-cell"
                :aria-label="`发送表情 ${st.name}`"
                @click="sendSticker(st)"
              >
                <img :src="st.url" :alt="st.name" loading="lazy" />
              </button>
              <button
                type="button"
                class="sticker-cell sticker-add"
                title="上传图片/GIF 作为表情"
                aria-label="上传自定义表情"
                @click="stickerInput?.click()"
              >
                <Icon name="plus" :size="20" />
              </button>
            </div>
            <div v-else-if="currentEmojis.length" class="emoji-grid">
              <button
                v-for="e in currentEmojis"
                :key="e"
                type="button"
                class="emoji-cell"
                :aria-label="`插入表情 ${e}`"
                @click="insertEmoji(e)"
              >
                {{ e }}
              </button>
            </div>
            <p v-else class="emoji-empty">还没有用过的表情</p>
          </div>
        </Transition>
      </div>

      <div class="attach-wrap">
        <button
          type="button"
          class="icon-btn attach-btn"
          :class="{ 'is-active': menuOpen }"
          title="添加附件"
          aria-label="添加附件"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          @click="toggleMenu"
        >
          <Icon name="paperclip" :size="20" />
        </button>
        <Transition name="pop">
          <div v-if="menuOpen" class="popover" role="menu" aria-label="选择附件类型">
            <button type="button" role="menuitem" @click="pickFiles('image')">
              <span class="popover-icon"><Icon name="image" :size="18" /></span>
              <span class="popover-text">
                <span class="popover-title">图片 / 视频</span>
                <span class="popover-hint">从本地选择</span>
              </span>
            </button>
            <button type="button" role="menuitem" @click="pickFiles('file')">
              <span class="popover-icon"><Icon name="file" :size="18" /></span>
              <span class="popover-text">
                <span class="popover-title">文件</span>
                <span class="popover-hint">任意格式</span>
              </span>
            </button>
          </div>
        </Transition>
      </div>

      <textarea
        ref="area"
        v-model="text"
        class="input"
        rows="1"
        :placeholder="props.placeholder"
        enterkeyhint="send"
        @input="resize"
        @keydown="onKeydown"
        @paste="onPaste"
      />

      <button
        type="button"
        class="send"
        :class="{ filled: canSend }"
        :disabled="!canSend"
        title="发送（Enter）"
        aria-label="发送"
        @click="submit"
      >
        <Icon name="send" :size="18" />
      </button>
    </div>

    <div v-if="dragging" class="drag-overlay" aria-hidden="true">
      <span class="drag-tip">松开以发送文件</span>
    </div>
  </div>
</template>

<style scoped>
.composer {
  position: relative;
  flex: none;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
}
.bar {
  display: flex;
  align-items: flex-end;
  gap: var(--s-2);
  width: 100%;
  max-width: 980px;
  min-height: 68px;
  margin: 0 auto;
  padding: var(--s-3) var(--s-4);
}

/* ---------- 附件按钮 + Popover ---------- */
.attach-wrap {
  position: relative;
  flex: none;
}
.attach-btn {
  width: var(--s-10);
  height: var(--s-10);
  border-radius: var(--r-sm);
}
.popover {
  position: absolute;
  left: 0;
  bottom: calc(100% + var(--s-2));
  z-index: 30;
  width: 208px;
  padding: var(--s-1);
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  transform-origin: bottom left;
}
.popover button {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  min-height: 44px;
  padding: var(--s-1) var(--s-2);
  border-radius: var(--r-sm);
  text-align: left;
  color: var(--text);
  transition: background var(--dur-fast) var(--ease);
}
.popover button:hover,
.popover button:focus-visible {
  background: var(--bg-hover);
}
.popover-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--accent-soft);
  color: var(--accent);
}
.popover-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.popover-title {
  font-size: var(--fs-base);
  font-weight: 600;
  line-height: var(--lh-base);
}
.popover-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.pop-enter-active,
.pop-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}

/* ---------- 文本域 ---------- */
.input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 40px;
  max-height: 120px;
  padding: var(--s-2) var(--s-3);
  border: 1px solid transparent;
  border-radius: var(--r-lg);
  background: var(--bg-input);
  color: var(--text);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  resize: none;
  outline: none;
  overflow-y: hidden;
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.input::placeholder {
  color: var(--text-faint);
}
.input:focus {
  border-color: var(--accent-border);
  background: var(--bg-elev);
  box-shadow: var(--focus-ring);
}

/* ---------- 发送 ---------- */
.send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--s-10);
  height: var(--s-10);
  flex: none;
  border-radius: var(--r-full);
  background: var(--accent-soft);
  color: var(--accent);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}
.send.filled {
  background: var(--accent-solid);
  color: var(--accent-contrast);
}
.send.filled:hover {
  background: var(--accent-hover);
}
.send.filled:active {
  background: var(--accent-active);
  transform: translateY(0.5px);
}
.send:disabled {
  cursor: default;
}

/* ---------- 拖拽高亮 ---------- */
.drag-overlay {
  position: absolute;
  inset: var(--s-1);
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--accent-border);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  pointer-events: none;
}
.drag-tip {
  padding: var(--s-2) var(--s-4);
  border-radius: var(--r-full);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-2);
  color: var(--accent);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: var(--lh-base);
}

/* ---------- 表情包 ---------- */
.emoji-wrap {
  position: relative;
  flex: none;
}
.emoji-btn.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}
.emoji-panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + var(--s-2));
  z-index: 30;
  width: min(360px, calc(100vw - 32px));
  max-height: 300px;
  display: flex;
  flex-direction: column;
  padding: var(--s-2);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}
.emoji-tabs {
  display: flex;
  gap: var(--s-1);
  padding: 0 var(--s-1) var(--s-2);
  overflow-x: auto;
  flex: none;
}
.emoji-tab {
  flex: none;
  height: 30px;
  padding: 0 var(--s-2);
  border: 0;
  border-radius: var(--r-full);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.emoji-tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.emoji-tab.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: var(--s-1);
  overflow-y: auto;
  padding: 0 var(--s-1) var(--s-1);
}
.emoji-cell {
  width: 100%;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.emoji-cell:hover {
  background: var(--bg-hover);
}
.emoji-cell:active {
  transform: scale(0.92);
}
.emoji-empty {
  margin: var(--s-2);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  text-align: center;
}

/* ---------- 自定义表情（图片/GIF 贴纸） ---------- */
.sticker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: var(--s-1);
  overflow-y: auto;
  padding: var(--s-1);
}
.sticker-cell {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-1);
  border: 1px solid transparent;
  border-radius: var(--r-md);
  background: var(--bg-hover);
  cursor: pointer;
  overflow: hidden;
}
.sticker-cell:hover {
  border-color: var(--accent);
}
.sticker-cell img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--r-sm);
}
.sticker-add {
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--text-muted);
}
.sticker-add:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* ---------- 手机 ---------- */
/* 底部安全区由外壳（mobile App 的 composer-wrap）负责，组件内不再叠加，避免双重留白 */
@media (max-width: 719px), (pointer: coarse) {
  .bar {
    min-height: 60px;
    gap: var(--s-1);
    padding: var(--s-2) var(--s-3);
  }
  .attach-btn,
  .send {
    width: var(--touch);
    height: var(--touch);
  }
  .input {
    min-height: var(--touch);
    padding: var(--s-2) var(--s-3);
  }
}
</style>
