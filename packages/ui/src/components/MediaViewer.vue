<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Attachment } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Icon from './Icon.vue'

const props = defineProps<{ attachment: Attachment; url: string | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useChatStore()

const imgLoaded = ref(false)
const resolved = ref<string | null>(props.url)
const saving = ref(false)
const hint = ref('')

watch(
  () => props.url,
  (u) => {
    resolved.value = u
    imgLoaded.value = false
  },
)

watch(
  () => props.attachment,
  async () => {
    if (resolved.value || !store.session) return
    await store.session.ensureAttachment(props.attachment)
    resolved.value = await store.session.attachmentUrlOf(props.attachment)
  },
  { immediate: true },
)

async function save(): Promise<void> {
  const s = store.session
  let href = resolved.value
  if (!href && s) {
    await s.ensureAttachment(props.attachment)
    href = await s.attachmentUrlOf(props.attachment)
    resolved.value = href
  }
  if (!href || saving.value) {
    hint.value = href ? '' : '文件还没加载完'
    return
  }
  saving.value = true
  hint.value = ''
  try {
    if (s?.platform.saveFile) {
      const r = await Promise.resolve(s.platform.saveFile(props.attachment.name || 'file', href))
      if (r === 'cancelled') return
      hint.value = r === 'shared' ? '请选择保存到相册或文件' : '已保存'
    } else {
      const a = document.createElement('a')
      a.href = href
      a.download = props.attachment.name || 'file'
      a.click()
      hint.value = '已开始下载'
    }
  } catch (e) {
    console.error('save file failed:', e)
    hint.value = '保存失败'
  } finally {
    saving.value = false
  }
}

function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="viewer" @click.self="emit('close')">
    <button type="button" class="close" title="关闭" @click.stop="emit('close')">
      <Icon name="close" :size="16" />
    </button>
    <div class="card" @click.stop>
      <template v-if="attachment.kind === 'image' && resolved">
        <img v-show="imgLoaded" :src="resolved" class="big" alt="" @load="imgLoaded = true" />
        <div v-if="!imgLoaded" class="loading">加载中…</div>
      </template>
      <template v-else-if="(attachment.kind === 'video' || attachment.kind === 'audio') && resolved">
        <video
          v-if="attachment.kind === 'video'"
          :src="resolved"
          class="big-video"
          controls
          playsinline
          autoplay
        />
        <audio v-else :src="resolved" controls />
      </template>
      <template v-else>
        <div class="file-info">
          <Icon name="file" :size="36" />
          <div class="fname">{{ attachment.name || '文件' }}</div>
          <div class="fsize">{{ humanSize(attachment.size) }}</div>
        </div>
      </template>
    </div>
    <div class="bar">
      <p v-if="hint" class="hint">{{ hint }}</p>
      <button type="button" class="save" :disabled="saving || !resolved" @click.stop="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  background: rgba(28, 25, 21, 0.72);
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(env(titlebar-area-height, 0px) + env(safe-area-inset-top, 0px) + 52px)
    20px
    calc(env(safe-area-inset-bottom, 0px) + 72px);
}
.card {
  position: relative;
  max-width: min(92vw, 1100px);
  max-height: 100%;
}
.big {
  max-width: 100%;
  max-height: min(80vh, 100%);
  border-radius: 4px;
  display: block;
}
.big-video {
  max-width: min(92vw, 1100px);
  max-height: 70vh;
  border-radius: 4px;
  background: #1c1915;
}
.loading {
  color: #faf7f2;
  padding: 60px;
}
.close {
  position: absolute;
  top: calc(env(titlebar-area-height, 0px) + env(safe-area-inset-top, 0px) + 10px);
  left: 16px;
  z-index: 2;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  border: 1px solid var(--border);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.save {
  pointer-events: auto;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 8px 22px;
  font-size: 14px;
}
.save:disabled {
  opacity: 0.5;
}
.hint {
  margin: 0;
  color: #faf7f2;
  font-size: 13px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
}
.file-info {
  background: var(--bg-sidebar);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 280px;
  color: var(--text-dim);
}
.fname {
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
  text-align: center;
}
.fsize {
  font-size: 13px;
  margin-bottom: 6px;
}
</style>
