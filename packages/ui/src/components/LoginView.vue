<script setup lang="ts">
import { computed, ref } from 'vue'
import { APP_VERSION_LABEL } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Icon from './Icon.vue'
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
const showPassword = ref(false)
const busy = ref(false)
const error = ref('')

const effectiveServer = computed(() => store.session?.serverUrl ?? serverUrl.value)

function switchMode(next: 'login' | 'register'): void {
  if (mode.value === next) return
  mode.value = next
  error.value = ''
}

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
    </div>

    <div class="body">
      <div class="page">
        <header class="brand">
          <img :src="logoUrl" class="logo" alt="" />
          <div class="brand-text">
            <h1>ChatAoo</h1>
            <p class="tagline">同一网络里的好友，断网也能聊</p>
          </div>
        </header>

        <div class="seg" role="group" aria-label="登录或注册">
          <button
            class="seg-btn"
            type="button"
            :class="{ on: mode === 'login' }"
            :aria-pressed="mode === 'login'"
            :disabled="busy"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            class="seg-btn"
            type="button"
            :class="{ on: mode === 'register' }"
            :aria-pressed="mode === 'register'"
            :disabled="busy"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>

        <form class="form" @submit.prevent="submit">
          <div class="field">
            <label class="field-label" for="login-username">用户名</label>
            <input
              id="login-username"
              v-model="username"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="用于登录和添加好友"
              @input="onUsernameInput"
            />
          </div>

          <div class="field">
            <label class="field-label" for="login-password">密码</label>
            <div class="pw-wrap">
              <input
                id="login-password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                :placeholder="mode === 'register' ? '至少 6 位' : '请输入密码'"
              />
              <button
                class="pw-toggle"
                type="button"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                :aria-pressed="showPassword"
                :title="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="18" />
              </button>
            </div>
          </div>

          <div v-if="mode === 'register'" class="field">
            <label class="field-label" for="login-display-name">昵称</label>
            <input
              id="login-display-name"
              v-model="displayName"
              maxlength="30"
              placeholder="好友看到的名字"
            />
          </div>

          <button class="btn btn-primary btn-lg btn-block submit" type="submit" :disabled="busy" :aria-busy="busy">
            {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号' }}
          </button>

          <div class="error-slot">
            <p v-if="error" class="error" role="alert">{{ error }}</p>
          </div>
        </form>

        <section v-if="allowServerEdit" class="server">
          <button
            class="server-toggle"
            type="button"
            :aria-expanded="showServer"
            @click="showServer = !showServer"
          >
            <Icon name="globe" :size="15" />
            <span>服务器地址</span>
            <Icon class="chev" :name="showServer ? 'chevron-down' : 'chevron-right'" :size="15" />
          </button>
          <p v-if="!showServer" class="server-current mono" :title="effectiveServer">
            {{ effectiveServer }}
          </p>
          <div v-else id="login-server-field" class="server-edit">
            <input
              v-model="serverUrl"
              class="server-input mono"
              type="text"
              inputmode="url"
              spellcheck="false"
              aria-label="服务器地址"
              placeholder="http://127.0.0.1:47800"
            />
            <p class="server-hint">当前生效：<span class="mono">{{ effectiveServer }}</span></p>
          </div>
        </section>

        <p class="ver">{{ APP_VERSION_LABEL }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  color: var(--text);
}
/* button/input 不继承 body 行高，中文文案统一按 1.5 行高 */
.login button,
.login input {
  line-height: var(--lh-base);
}
.titlebar {
  height: calc(var(--titlebar-h) + env(safe-area-inset-top, 0px));
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: env(safe-area-inset-top, 0px) var(--s-4) 0;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
}
.tb-logo {
  width: var(--s-5);
  height: var(--s-5);
  border-radius: var(--r-xs);
}
.tb-name {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-muted);
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  justify-content: center;
}
.page {
  width: 100%;
  max-width: 340px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: var(--s-6) var(--s-4) calc(var(--s-5) + env(safe-area-inset-bottom, 0px));
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  margin-bottom: var(--s-6);
}
.logo {
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: var(--r-md);
}
.brand-text {
  min-width: 0;
}
h1 {
  margin: 0;
  font-size: var(--fs-2xl);
  font-weight: 700;
  line-height: var(--lh-tight);
}
.tagline {
  margin: var(--s-1) 0 0;
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.seg {
  display: flex;
  gap: var(--s-1);
  padding: var(--s-1);
  margin-bottom: var(--s-5);
  background: var(--bg-input);
  border-radius: var(--r-full);
}
.seg-btn {
  flex: 1;
  min-height: var(--s-8);
  border-radius: var(--r-full);
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-muted);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.seg-btn.on {
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.seg-btn:hover:not(.on):not(:disabled) {
  color: var(--text);
}
.seg-btn:focus-visible {
  box-shadow: var(--focus-ring);
}
.seg-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}
.form .field input {
  min-height: var(--touch);
}
.form .field input::placeholder {
  color: var(--text-faint);
}
.pw-wrap {
  position: relative;
}
.pw-wrap input {
  padding-right: var(--touch);
}
.pw-toggle {
  position: absolute;
  top: 0;
  right: 0;
  width: var(--touch);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  border-radius: var(--r-sm);
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.pw-toggle:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.submit {
  margin-top: var(--s-1);
}
.error-slot {
  min-height: var(--s-5);
  display: flex;
  align-items: center;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.server {
  margin-top: var(--s-5);
  padding-top: var(--s-3);
  border-top: 1px solid var(--border);
}
.server-toggle {
  width: 100%;
  min-height: var(--s-8);
  display: flex;
  align-items: center;
  gap: var(--s-2);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 600;
  text-align: left;
  border-radius: var(--r-xs);
}
.server-toggle:hover {
  color: var(--text);
}
.chev {
  margin-left: auto;
}
.server-current {
  margin: var(--s-1) 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.server-edit {
  margin-top: var(--s-2);
}
.server-input {
  width: 100%;
  min-height: var(--touch);
  padding: 0 var(--s-3);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  font-size: var(--fs-base);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.server-input:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
  background: var(--bg-elev);
}
.server-hint {
  margin: var(--s-1) 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.ver {
  margin: auto 0 0;
  padding-top: var(--s-5);
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--text-faint);
}
/* 触屏设备 / 窄窗口：放大折叠按钮与分段控件的点击区域 */
@media (pointer: coarse), (max-width: 719px) {
  .seg-btn {
    min-height: var(--touch);
  }
  .server-toggle {
    min-height: var(--touch);
  }
}
</style>
