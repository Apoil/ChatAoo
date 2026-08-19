<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Attachment } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'

const props = defineProps<{ attachment: Attachment; url: string | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useChatStore()

const imgLoaded = ref(false)

watch(
  () => props.url,
  () => (imgLoaded.value = false),
)

function save(): void {
  if (!props.url) return
  const s = store.session
  if (s?.platform.saveFile) {
    s.platform.saveFile(props.attachment.name, props.url)
  } else {
    const a = document.createElement('a')
    a.href = props.url
    a.download = props.attachment.name
    a.click()
  }
}

function humanSize(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="viewer" @click.self="emit('close')">
    <div class="card">
      <template v-if="attachment.kind === 'image' && url">
        <img v-show="imgLoaded" :src="url" class="big" alt="" @load="imgLoaded = true" />
        <div v-if="!imgLoaded" class="loading">加载中…</div>
      </template>
      <template v-else>
        <div class="file-info">
          <div class="ficon">📄</div>
          <div class="fname">{{ attachment.name }}</div>
          <div class="fsize">{{ humanSize(attachment.size) }}</div>
          <button class="btn btn-primary" @click="save">保存/打开</button>
        </div>
      </template>
      <button class="close" @click="emit('close')">✕</button>
    </div>
  </div>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  background: rgba(3, 5, 12, 0.92);
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  position: relative;
  max-width: min(92vw, 1100px);
  max-height: 92vh;
}
.big {
  max-width: 100%;
  max-height: 92vh;
  border-radius: var(--radius-sm);
  display: block;
}
.loading {
  color: var(--text-dim);
  padding: 60px;
}
.close {
  position: absolute;
  top: -14px;
  right: -14px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 14px;
}
.file-info {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 32px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 300px;
}
.ficon {
  font-size: 48px;
}
.fname {
  font-weight: 600;
  word-break: break-all;
  text-align: center;
}
.fsize {
  color: var(--text-dim);
  font-size: 13px;
  margin-bottom: 8px;
}
</style>
