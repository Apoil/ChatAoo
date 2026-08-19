<script setup lang="ts">
import { ref } from 'vue'
import { useChatStore } from '../stores/chat'
import logoUrl from '../logo.svg'

const props = defineProps<{ allowServerEdit?: boolean }>()
const emit = defineEmits<{ done: [] }>()
const store = useChatStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const displayName = ref('')
const serverUrl = ref(store.session?.serverUrl ?? 'http://127.0.0.1:47800')
const busy = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  const s = store.session
  if (!s || busy.value) return
  const name = username.value.trim()
  if (!name || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  if (mode.value === 'register' && (!displayName.value.trim() || displayName.value.trim().length > 30)) {
    error.value = '请输入 1-30 字的昵称'
    return
  }
  if (mode.value === 'register' && password.value.length < 6) {
    error.value = '密码至少 6 位'
    return
  }
  busy.value = true
  error.value = ''
  try {
    s.setServerUrl(serverUrl.value)
    if (mode.value === 'login') {
      await s.login(name, password.value)
    } else {
      await s.register(name, password.value, displayName.value.trim())
    }
    emit('done')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="card">
      <img :src="logoUrl" class="logo" alt="ChatAoo" />
      <h1>ChatAoo</h1>
      <p class="tagline">局域网点对点 · 离线优先聊天</p>

      <div class="tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <div class="form">
        <div class="field">
          <label>用户名（好友添加用，3-20 位字母/数字/下划线）</label>
          <input v-model="username" placeholder="如 alice" autocomplete="username" @keydown.enter="submit" />
        </div>
        <div class="field">
          <label>密码</label>
          <input
            v-model="password"
            type="password"
            placeholder="至少 6 位"
            autocomplete="current-password"
            @keydown.enter="submit"
          />
        </div>
        <div v-if="mode === 'register'" class="field">
          <label>昵称（展示给好友的名字）</label>
          <input v-model="displayName" placeholder="如 爱丽丝" @keydown.enter="submit" />
        </div>
        <div v-if="allowServerEdit" class="field">
          <label>服务器地址</label>
          <input v-model="serverUrl" placeholder="http://192.168.1.10:47800" @keydown.enter="submit" />
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <button class="btn btn-primary submit" :disabled="busy" @click="submit">
          {{ busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </div>

      <p class="hint">
        登录后自动记住登录状态：之后即使完全断网，也能以已登录身份进入，
        与局域网内的好友点对点聊天。
      </p>
    </div>
  </div>
</template>

<style scoped>
.login {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1000px 500px at 50% -10%, rgba(51, 144, 236, 0.08), transparent 60%),
    var(--bg);
  padding: 24px;
}
.card {
  width: min(380px, 100%);
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 36px 32px 28px;
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
}
h1 {
  margin: 14px 0 2px;
  font-size: 22px;
  letter-spacing: 0.4px;
}
.tagline {
  margin: 0 0 22px;
  color: var(--text-dim);
  font-size: 12.5px;
}
.tabs {
  display: flex;
  gap: 6px;
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px;
  margin-bottom: 20px;
}
.tabs button {
  flex: 1;
  padding: 8px 0;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 13.5px;
  font-weight: 600;
  transition: background 0.15s, color 0.15s;
}
.tabs button.active {
  background: var(--bg-raised);
  color: var(--text);
}
.form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.error {
  color: var(--danger);
  font-size: 12.5px;
  margin: 0;
}
.submit {
  width: 100%;
  padding: 11px 0;
  font-size: 14px;
  margin-top: 4px;
}
.hint {
  margin: 18px 0 0;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}
</style>
