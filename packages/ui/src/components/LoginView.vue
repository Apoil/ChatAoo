<script setup lang="ts">
import { ref } from 'vue'
import { APP_VERSION_LABEL } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import logoUrl from '../logo.svg'

defineProps<{ allowServerEdit?: boolean }>()
const emit = defineEmits<{ done: [] }>()
const store = useChatStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const displayName = ref('')
const serverUrl = ref(store.session?.serverUrl ?? 'http://127.0.0.1:47800')
const showServer = ref(false)
const busy = ref(false)
const error = ref('')

/** 用户名统一小写（所见即所得，避免大小写歧义） */
function onUsernameInput(ev: Event): void {
  const el = ev.target as HTMLInputElement
  username.value = el.value.toLowerCase()
  el.value = username.value
}

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
    <div class="titlebar">
      <img :src="logoUrl" class="tb-logo" alt="" />
      <span class="tb-name">ChatAoo</span>
      <span class="tb-ver">{{ APP_VERSION_LABEL }}</span>
    </div>

    <div class="body">
      <header class="intro">
        <img :src="logoUrl" class="logo" alt="" />
        <h1>{{ mode === 'login' ? '登录' : '注册' }}</h1>
        <p class="tagline">同一网络里的好友，断网也能聊</p>
      </header>

      <div class="mode">
        <button type="button" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span>用户名</span>
          <input
            v-model="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            @input="onUsernameInput"
          />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" type="password" autocomplete="current-password" />
        </label>
        <label v-if="mode === 'register'" class="field">
          <span>昵称</span>
          <input v-model="displayName" maxlength="30" placeholder="好友看到的名字" />
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <button class="btn btn-primary submit" :disabled="busy" type="submit">
          {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号' }}
        </button>
      </form>

      <div v-if="allowServerEdit" class="server">
        <button type="button" class="server-toggle" @click="showServer = !showServer">
          {{ showServer ? '收起服务器地址' : '服务器地址' }}
        </button>
        <input v-if="showServer" v-model="serverUrl" class="server-input" spellcheck="false" />
      </div>

      <p class="ver">{{ APP_VERSION_LABEL }}</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.titlebar {
  height: var(--chrome-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  -webkit-app-region: drag;
  background: var(--bg-sidebar);
}
.tb-logo {
  width: 18px;
  height: 18px;
  border-radius: 5px;
}
.tb-name {
  font-size: 13px;
  color: var(--text-dim);
}
.tb-ver {
  margin-left: 4px;
  font-size: 11px;
  color: var(--text-faint);
}
.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 8px 28px 24px;
  overflow-y: auto;
  max-width: 420px;
  width: 100%;
  margin: 0 auto;
}
.intro {
  margin-bottom: 22px;
}
.logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: block;
}
h1 {
  margin: 14px 0 4px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0;
}
.tagline {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
}
.mode {
  display: flex;
  gap: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--border-soft);
}
.mode button {
  padding: 0 0 8px;
  color: var(--text-faint);
  font-size: 14px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.mode button.active {
  color: var(--text);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field span {
  font-size: 12px;
  color: var(--text-dim);
}
.field input {
  height: 40px;
  background: var(--bg-raised);
}
.error {
  color: var(--danger);
  font-size: 12.5px;
  margin: 0;
}
.submit {
  width: 100%;
  height: 40px;
  margin-top: 4px;
  font-size: 14px;
}
.server {
  margin-top: 18px;
}
.server-toggle {
  font-size: 12px;
  color: var(--text-faint);
  padding: 0;
}
.server-toggle:hover {
  color: var(--text-dim);
}
.server-input {
  display: block;
  width: 100%;
  margin-top: 8px;
  height: 36px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  font-size: 13px;
  outline: none;
}
.server-input:focus {
  border-color: var(--accent);
}
.ver {
  margin-top: auto;
  padding-top: 28px;
  font-size: 12px;
  color: var(--text-faint);
}
</style>
