<script setup lang="ts">
import { nextTick, ref } from 'vue'
import Icon from './Icon.vue'

const emit = defineEmits<{ 'send-text': [text: string]; 'send-files': [files: { blob: Blob; name: string }[]] }>()

const text = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const area = ref<HTMLTextAreaElement | null>(null)

function resize(): void {
  const el = area.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`
}

function submit(): void {
  const t = text.value.trim()
  if (!t) return
  emit('send-text', t)
  text.value = ''
  void nextTick(resize)
}

function pickFiles(kind: 'file' | 'image'): void {
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
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="composer">
    <input ref="fileInput" type="file" multiple hidden @change="onFiles" />
    <input
      ref="imageInput"
      type="file"
      multiple
      accept="image/*,video/*,audio/*,.mp4,.mov,.webm,.m4v,.3gp,.jpg,.jpeg,.png,.gif,.webp"
      hidden
      @change="onFiles"
    />
    <div class="tools">
      <button class="icon-btn" title="发送文件" @click="pickFiles('file')">
        <Icon name="paperclip" :size="18" />
      </button>
      <button class="icon-btn" title="发送图片/视频" @click="pickFiles('image')">
        <Icon name="image" :size="18" />
      </button>
    </div>
    <textarea
      ref="area"
      v-model="text"
      class="input"
      rows="1"
      placeholder="发送消息"
      @input="resize"
      @keydown="onKeydown"
    />
    <button class="btn btn-primary send" :disabled="!text.trim()" @click="submit">发送</button>
  </div>
</template>

<style scoped>
.composer {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 10px 12px 12px;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border-soft);
}
.tools {
  display: flex;
  gap: 1px;
  padding-bottom: 2px;
}
.input {
  flex: 1;
  resize: none;
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.5;
  max-height: 140px;
  min-height: 36px;
  outline: none;
}
.input:focus {
  border-color: var(--border);
  background: var(--bg-raised);
}
.send {
  flex: none;
  height: 36px;
  padding: 0 14px;
}
</style>
