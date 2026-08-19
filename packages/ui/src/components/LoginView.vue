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
    <!-- 顶部标题栏：与系统窗口控件同行，可拖拽窗口 -->
    <div class="titlebar">
      <img :src="logoUrl" class="tb-logo" alt="" />
      <span class="tb-name">ChatAoo</span>
    </div>

    <div class="body">
      <div class="hero">
        <img :src="logoUrl" class="logo" alt="ChatAoo" />
        <h1>{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h1>
        <p class="tagline">局域网点对点 · 离线优先聊天</p>
      </div>

      <div class="panel">
        <div class="tabs">
          <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
          <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
        </div>

        <div class="form">
          <div class="field">
            <input
              v-model="username"
              placeholder="用户名"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              @input="onUsernameInput"
              @keydown.enter="submit"
            />
            <span class="field-hint">3-20 位字母 / 数字 / 下划线，自动小写</span>
          </div>
          <div class="field">
            <input
              v-model="password"
              type="password"
              placeholder="密码"
              autocomplete="current-password"
              @keydown.enter="submit"
            />
            <span v-if="mode === 'register'" class="field-hint">至少 6 位</span>
          </div>
          <div v-if="mode === 'register'" class="field">
            <input
              v-model="displayName"
              placeholder="昵称（展示给好友）"
              maxlength="30"
              @keydown.enter="submit"
            />
          </div>
          <div v-if="allowServerEdit" class="field">
            <input v-model="serverUrl" placeholder="服务器地址" spellcheck="false" @keydown.enter="submit" />
          </div>

          <p v-if="error" class="error">{{ error }}</p>

          <button class="btn-primary" :disabled="busy" @click="submit">
            {{ busy ? '处理中…' : mode === 'login' ? '登 录' : '注册并登录' }}
          </button>
        </div>
      </div>

      <p class="hint">
        登录后自动记住登录状态：之后即使完全断网，也能以已登录身份进入，与局域网内的好友点对点聊天。
      </p>
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
/* 标题栏：44px，与系统窗口按钮同行；品牌融入，可拖拽 */
.titlebar {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  -webkit-app-region: drag;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg);
}
.tb-logo {
  width: 20px;
  height: 20px;
  border-radius: 5px;
}
.tb-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.3px;
}
.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 24px 16px;
  overflow-y: auto;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 8px 0 16px;
}
.logo {
  width: 52px;
  height: 52px;
  border-radius: 14px;
}
h1 {
  margin: 12px 0 2px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.tagline {
  margin: 0;
  color: var(--text-faint);
  font-size: 12px;
}
/* 面板：与窗口同宽，紧凑对话框式 */
.panel {
  width: 100%;
  max-width: 392px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
}
.tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
  margin-bottom: 14px;
}
.tabs button {
  flex: 1;
  padding: 7px 0;
  border-radius: 8px;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  transition: background 0.15s, color 0.15s;
}
.tabs button.active {
  background: var(--bg-active);
  color: var(--text);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field input {
  width: 100%;
  height: 42px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
.field input:focus {
  border-color: var(--accent);
}
.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-faint);
  padding-left: 2px;
}
.error {
  color: var(--danger);
  font-size: 12.5px;
  margin: 0;
}
.btn-primary {
  width: 100%;
  height: 42px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
  transition: background 0.15s, opacity 0.15s;
}
.btn-primary:hover {
  background: #2f82d8;
}
.btn-primary:disabled {
  opacity: 0.5;
}
.hint {
  margin: 14px 0 0;
  max-width: 392px;
  color: var(--text-faint);
  font-size: 11.5px;
  line-height: 1.6;
  text-align: center;
}
</style>
