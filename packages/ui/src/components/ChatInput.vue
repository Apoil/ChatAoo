<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ 'send-text': [text: string]; 'send-files': [files: { blob: Blob; name: string }[]] }>()

const text = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)

function submit(): void {
  const t = text.value.trim()
  if (!t) return
  emit('send-text', t)
  text.value = ''
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
    <input ref="imageInput" type="file" multiple accept="image/*,video/*,audio/*" hidden @change="onFiles" />
    <div class="tools">
      <button class="icon-btn" title="发送文件" @click="pickFiles('file')">📎</button>
      <button class="icon-btn" title="发送图片/视频" @click="pickFiles('image')">🖼️</button>
    </div>
    <textarea
      v-model="text"
      class="input"
      rows="1"
      placeholder="输入消息，Enter 发送，Shift+Enter 换行"
      @keydown="onKeydown"
    />
    <button class="btn btn-primary send" :disabled="!text.trim()" @click="submit">发送</button>
  </div>
</template>

<style scoped>
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-soft);
  background: var(--bg);
}
.tools {
  display: flex;
  gap: 2px;
}
.input {
  flex: 1;
  resize: none;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.4;
  max-height: 140px;
  outline: none;
  transition: border-color 0.15s;
}
.input:focus {
  border-color: var(--accent);
}
.send {
  flex: none;
  padding: 10px 18px;
}
</style>
