<script setup lang="ts">
import { ref } from 'vue'
import { useChatStore } from '../stores/chat'

const store = useChatStore()
const userId = ref('')
const status = ref<'idle' | 'sending' | 'done' | 'error'>('idle')
const msg = ref('')

async function submit(): Promise<void> {
  const id = userId.value.trim()
  if (!id || status.value === 'sending') return
  status.value = 'sending'
  try {
    await store.session?.addFriend(id)
    msg.value = '已发送好友请求'
    status.value = 'done'
    userId.value = ''
  } catch (e) {
    msg.value = String(e instanceof Error ? e.message : e)
    status.value = 'error'
  }
}
</script>

<template>
  <div class="add">
    <input
      v-model="userId"
      class="input"
      placeholder="输入对方的用户名（如 alice）"
      @keydown.enter="submit"
    />
    <button class="btn btn-primary" :disabled="status === 'sending'" @click="submit">
      {{ status === 'sending' ? '发送中…' : '添加' }}
    </button>
    <div v-if="msg" class="msg" :class="status">{{ msg }}</div>
  </div>
</template>

<style scoped>
.add {
  padding: 10px 14px 4px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.input {
  flex: 1;
  min-width: 160px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
}
.input:focus {
  border-color: var(--accent);
}
.msg {
  width: 100%;
  font-size: 12px;
}
.msg.done {
  color: var(--ok);
}
.msg.error {
  color: var(--danger);
}
</style>
