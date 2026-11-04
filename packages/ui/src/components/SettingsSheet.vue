<script setup lang="ts">
/**
 * 设置面板：桌面从右侧滑入 360px，手机为底部抽屉（圆角上沿 + 拖拽条）。
 * 内容：主题模式 / 服务器地址（可编辑 + 应用）/ 关于（版本、MIT、GitHub）/ 退出登录。
 * 契约不变：props `open`，emits `close`；外壳只负责开关。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { APP_VERSION_LABEL } from '@chataoo/shared'
import { useTheme, type ThemeMode } from '../theme'
import { useChatStore } from '../stores/chat'
import Icon, { type IconName } from './Icon.vue'

const GITHUB_URL = 'https://github.com/Apoil/ChatAoo'
const version = APP_VERSION_LABEL

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useChatStore()
const { mode, setMode } = useTheme()

const themeOptions: { value: ThemeMode; label: string; icon: IconName }[] = [
  { value: 'system', label: '跟随系统', icon: 'monitor' },
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
]

type FeedbackTone = 'is-success' | 'is-danger' | 'is-muted'
interface Feedback {
  tone: FeedbackTone
  text: string
}

const closeBtn = ref<HTMLButtonElement | null>(null)
const serverDraft = ref('')
const serverFeedback = ref<Feedback | null>(null)
const confirmingLogout = ref(false)
const loggingOut = ref(false)
const logoutError = ref('')

const currentServer = computed(() => store.session?.serverUrl ?? '')
const serverDirty = computed(() => !!store.session && normalizeUrl(serverDraft.value) !== currentServer.value)

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function reset(): void {
  serverDraft.value = currentServer.value
  serverFeedback.value = null
  confirmingLogout.value = false
  loggingOut.value = false
  logoutError.value = ''
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    reset()
    await nextTick()
    closeBtn.value?.focus()
  },
  { immediate: true },
)

function onKeydown(ev: KeyboardEvent): void {
  if (!props.open) return
  if (ev.key === 'Escape') {
    ev.preventDefault()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function applyServer(): void {
  const s = store.session
  if (!s) return
  const url = normalizeUrl(serverDraft.value)
  if (!url) {
    serverFeedback.value = { tone: 'is-danger', text: '请输入服务器地址' }
    return
  }
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {
    parsed = null
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    serverFeedback.value = { tone: 'is-danger', text: '地址格式不正确，需以 http:// 或 https:// 开头' }
    return
  }
  if (url === s.serverUrl) {
    serverFeedback.value = { tone: 'is-muted', text: '地址未变化' }
    return
  }
  const wasAuthed = store.authed
  // setServerUrl 会在已登录时自动登出（旧 token 对新服务器无效）
  s.setServerUrl(url)
  serverDraft.value = s.serverUrl
  serverFeedback.value = { tone: 'is-success', text: wasAuthed ? '已保存，请重新登录' : '已保存' }
  if (wasAuthed) emit('close')
}

function openGithub(): void {
  const s = store.session
  if (s) s.platform.openExternal(GITHUB_URL)
  else window.open(GITHUB_URL, '_blank', 'noopener,noreferrer')
}

async function doLogout(): Promise<void> {
  if (loggingOut.value) return
  loggingOut.value = true
  logoutError.value = ''
  try {
    await store.session?.logout()
    emit('close')
  } catch (e) {
    logoutError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet-fade">
      <div v-if="open" class="settings-mask" @click.self="emit('close')">
        <aside
          class="settings-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          tabindex="-1"
        >
          <div class="sheet-handle" aria-hidden="true" />

          <header class="sheet-head">
            <!-- 关闭按钮放左侧：桌面 Electron 的标题栏按钮覆盖层占据右上角 138×44px -->
            <button
              ref="closeBtn"
              class="icon-btn close-btn"
              type="button"
              aria-label="关闭设置"
              @click="emit('close')"
            >
              <Icon name="close" :size="18" />
            </button>
            <h2 id="settings-title" class="sheet-title">设置</h2>
          </header>

          <div class="sheet-body">
            <section class="block">
              <h3 id="settings-theme-label" class="block-label">主题</h3>
              <div class="seg" role="group" aria-labelledby="settings-theme-label">
                <button
                  v-for="opt in themeOptions"
                  :key="opt.value"
                  class="seg-item"
                  type="button"
                  :class="{ 'is-on': mode === opt.value }"
                  :aria-pressed="mode === opt.value"
                  @click="setMode(opt.value)"
                >
                  <Icon :name="opt.icon" :size="16" />
                  <span>{{ opt.label }}</span>
                </button>
              </div>
            </section>

            <section class="block">
              <label class="block-label" for="settings-server">服务器地址</label>
              <div class="server-row">
                <input
                  id="settings-server"
                  v-model="serverDraft"
                  class="server-input mono"
                  type="url"
                  inputmode="url"
                  autocomplete="url"
                  spellcheck="false"
                  placeholder="http://127.0.0.1:47800"
                  @keydown.enter.prevent="applyServer"
                />
                <button
                  class="btn btn-primary apply-btn"
                  type="button"
                  :disabled="!serverDirty"
                  @click="applyServer"
                >
                  应用
                </button>
              </div>
              <p class="server-hint">
                当前生效：<code class="mono">{{ currentServer || '未设置' }}</code>
              </p>
              <p v-if="serverFeedback" class="feedback" :class="serverFeedback.tone" role="status">
                {{ serverFeedback.text }}
              </p>
              <p v-else class="feedback is-muted">修改服务器地址后需要重新登录。</p>
            </section>

            <section class="block">
              <h3 class="block-label">关于</h3>
              <div class="about-card">
                <div class="about-head">
                  <div>
                    <p class="about-name">ChatAoo</p>
                    <p class="about-sub">版本 {{ version }} · MIT 协议</p>
                  </div>
                  <Icon name="info" :size="20" class="about-icon" />
                </div>
                <button class="btn btn-ghost btn-block github-btn" type="button" @click="openGithub">
                  <Icon name="globe" :size="16" />
                  <span>GitHub 仓库</span>
                  <Icon name="chevron-right" :size="16" class="github-chevron" />
                </button>
              </div>
            </section>

            <section class="block logout-block">
              <div class="sheet-divider" aria-hidden="true" />
              <template v-if="confirmingLogout">
                <p class="logout-hint">退出后需联网重新登录，本机聊天记录会保留。</p>
                <div class="logout-actions">
                  <button
                    class="btn btn-danger logout-btn"
                    type="button"
                    :disabled="loggingOut"
                    @click="doLogout"
                  >
                    {{ loggingOut ? '退出中…' : '确认退出' }}
                  </button>
                  <button class="btn btn-ghost logout-btn" type="button" @click="confirmingLogout = false">
                    取消
                  </button>
                </div>
              </template>
              <button
                v-else
                class="btn btn-danger btn-block logout-btn"
                type="button"
                @click="confirmingLogout = true"
              >
                <Icon name="logout" :size="16" />
                <span>退出登录</span>
              </button>
              <p v-if="logoutError" class="feedback is-danger" role="alert">{{ logoutError }}</p>
            </section>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ---------- 外壳 ---------- */
.settings-mask {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  justify-content: flex-end;
  background: var(--bg-scrim);
}
.settings-sheet {
  display: flex;
  flex-direction: column;
  width: var(--sheet-w);
  max-width: 100vw;
  height: 100%;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-pop);
  outline: none;
}
.sheet-handle {
  display: none;
}

/* ---------- 头部 ---------- */
.sheet-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  height: var(--chat-head-h);
  padding: 0 var(--s-4) 0 var(--s-3);
  border-bottom: 1px solid var(--border);
}
.sheet-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--text);
}
.close-btn {
  width: 38px;
  height: 38px;
}

/* ---------- 内容 ---------- */
.sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--s-4);
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}
.block {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}
.block-label {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: var(--lh-base);
  color: var(--text-muted);
}

/* 分段控件 */
.seg {
  display: flex;
  gap: var(--s-1);
  padding: var(--s-1);
  background: var(--bg-input);
  border-radius: var(--r-sm);
}
.seg-item {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  min-height: 36px;
  padding: 0 var(--s-2);
  border-radius: var(--r-xs);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: var(--lh-base);
  color: var(--text-muted);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.seg-item.is-on {
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: var(--shadow-1);
}

/* 服务器地址 */
.server-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.server-input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 var(--s-3);
  font-size: 13px;
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
.server-input::placeholder {
  color: var(--text-faint);
}
.server-input:focus {
  border-color: var(--accent);
  background: var(--bg-elev);
  box-shadow: var(--focus-ring);
}
.apply-btn {
  flex: none;
  height: 42px;
  min-height: 42px;
  padding: 0 var(--s-4);
  font-size: var(--fs-base);
}
.server-hint {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--text-faint);
  word-break: break-all;
}
.server-hint code {
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.feedback {
  margin: 0;
  min-height: 18px;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.feedback.is-success {
  color: var(--success);
}
.feedback.is-danger {
  color: var(--danger);
}
.feedback.is-muted {
  color: var(--text-muted);
}

/* 关于 */
.about-card {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-4);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.about-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}
.about-name {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 700;
  line-height: var(--lh-base);
  color: var(--text);
}
.about-sub {
  margin: var(--s-1) 0 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.about-icon {
  color: var(--text-faint);
}
.github-btn {
  justify-content: flex-start;
}
.github-chevron {
  margin-left: auto;
  color: var(--text-faint);
}

/* 退出登录 */
.sheet-divider {
  height: 1px;
  background: var(--border);
}
.logout-hint {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.logout-actions {
  display: flex;
  gap: var(--s-2);
}
.logout-actions .logout-btn {
  flex: 1;
}
.logout-btn {
  min-height: 42px;
}

/* ---------- 动效 ---------- */
.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity var(--dur-med) var(--ease);
}
.sheet-fade-enter-active .settings-sheet,
.sheet-fade-leave-active .settings-sheet {
  transition: transform var(--dur-med) var(--ease);
}
.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
}
.sheet-fade-enter-from .settings-sheet,
.sheet-fade-leave-to .settings-sheet {
  transform: translateX(100%);
}

/* ---------- 手机（<720dp）：底部抽屉 ---------- */
@media (max-width: 719px) {
  .settings-mask {
    align-items: flex-end;
  }
  .settings-sheet {
    width: 100%;
    height: auto;
    max-height: 88vh;
    border-left: 0;
    border-top: 1px solid var(--border);
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .sheet-handle {
    display: block;
    flex: none;
    width: 36px;
    height: 4px;
    margin: var(--s-2) auto 0;
    border-radius: var(--r-full);
    background: var(--border-strong);
  }
  .sheet-head {
    padding: 0 var(--s-4) 0 var(--s-2);
  }
  .close-btn {
    width: var(--touch);
    height: var(--touch);
  }
  .seg-item {
    min-height: var(--touch);
  }
  .server-input,
  .apply-btn,
  .logout-btn {
    height: var(--touch);
    min-height: var(--touch);
  }
  .sheet-fade-enter-from .settings-sheet,
  .sheet-fade-leave-to .settings-sheet {
    transform: translateY(100%);
  }
}
</style>
