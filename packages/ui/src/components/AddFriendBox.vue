<script setup lang="ts">
/**
 * 加好友：42px 输入 + 主按钮（手机 44px），结果区区分 success / danger / muted 三态。
 * 桌面为内联小卡片、手机为抽屉内容，容器由外壳决定；契约不变（无 props/emits）。
 */
import { computed, ref } from 'vue'
import { useChatStore } from '../stores/chat'
import Icon from './Icon.vue'

const store = useChatStore()
const userId = ref('')
const status = ref<'idle' | 'sending' | 'done' | 'error'>('idle')
const msg = ref('')

const canSubmit = computed(() => !!userId.value.trim() && status.value !== 'sending')

const resultTone = computed(() => {
  if (status.value === 'done') return 'is-success'
  if (status.value === 'error') return 'is-danger'
  return 'is-muted'
})

const resultText = computed(() => {
  if (status.value === 'sending') return '正在发送好友请求…'
  if (msg.value) return msg.value
  return '对方需已注册 ChatAoo'
})

/** 用户重新输入时清掉上一次的结果提示（程序清空输入不触发 input，不会误清成功提示）。 */
function onInput(): void {
  if (status.value === 'done' || status.value === 'error') {
    status.value = 'idle'
    msg.value = ''
  }
}

async function submit(): Promise<void> {
  const id = userId.value.trim()
  if (!id || status.value === 'sending') return
  status.value = 'sending'
  msg.value = ''
  try {
    await store.session?.addFriend(id)
    msg.value = '已发送好友请求'
    status.value = 'done'
    userId.value = ''
  } catch (e) {
    msg.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
  }
}
</script>

<template>
  <form class="add-friend" novalidate @submit.prevent="submit">
    <div class="add-row">
      <input
        v-model="userId"
        class="add-input"
        type="text"
        name="username"
        placeholder="对方用户名，例如 alice"
        aria-label="对方用户名"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :disabled="status === 'sending'"
        @input="onInput"
      />
      <button class="btn btn-primary add-submit" type="submit" :disabled="!canSubmit">
        <Icon :name="status === 'sending' ? 'send' : 'plus'" :size="16" />
        <span>{{ status === 'sending' ? '发送中' : '添加' }}</span>
      </button>
    </div>
    <p class="add-result" :class="resultTone" role="status">{{ resultText }}</p>
  </form>
</template>

<style scoped>
.add-friend {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-3) var(--s-4) var(--s-2);
}
.add-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.add-input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 var(--s-3);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  color: var(--text);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  outline: none;
  user-select: text;
  -webkit-user-select: text;
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.add-input::placeholder {
  color: var(--text-faint);
}
.add-input:focus {
  border-color: var(--accent);
  background: var(--bg-elev);
  box-shadow: var(--focus-ring);
}
.add-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.add-submit {
  flex: none;
  height: 42px;
  min-height: 42px;
  padding: 0 var(--s-4);
  font-size: var(--fs-base);
}
.add-result {
  margin: 0;
  min-height: 18px;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--text-faint);
}
.add-result.is-success {
  color: var(--success);
}
.add-result.is-danger {
  color: var(--danger);
}
.add-result.is-muted {
  color: var(--text-faint);
}

/* 手机（<720dp）：输入与按钮触控目标 ≥ 44px */
@media (max-width: 719px) {
  .add-input,
  .add-submit {
    height: var(--touch);
    min-height: var(--touch);
  }
}
</style>
