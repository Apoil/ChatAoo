<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { APP_VERSION_LABEL, type Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import { useTheme, type ThemeMode } from '../theme'
import {
  enableNotifications,
  notifyEnabled,
  notifyPermission,
  notifySupported,
  setNotificationsEnabled,
} from '../notify'
import Avatar from './Avatar.vue'
import AvatarCropper from './AvatarCropper.vue'
import Icon from './Icon.vue'

/**
 * 个人主页：默认展示自己（可点头像换头像、改昵称、切换主题、退出登录）；
 * 传入 peerId 时展示对方资料（只读）。
 */
const props = defineProps<{ peerId?: string; showBack?: boolean }>()
const emit = defineEmits<{ close: []; openChat: [peerId: string] }>()
const store = useChatStore()
const { mode, setMode } = useTheme()

/** 申请系统通知权限（必须在用户手势里调用） */
async function askNotify(): Promise<void> {
  if (!notifySupported) return
  await enableNotifications()
}

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: 'sun' | 'moon' | 'monitor' }[] = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' },
]

/** 自己的身份用「账号 ID」：多设备同账号时设备 ID 与账号 ID 不同 */
const selfId = computed(() => store.session?.accountId ?? store.session?.me.userId ?? '')
const isSelf = computed(() => !props.peerId || props.peerId === selfId.value)
const profile = computed<Profile | null>(() => {
  const s = store.session
  if (!s) return null
  if (isSelf.value) {
    return (
      store.profileOf(selfId.value) ?? {
        userId: selfId.value,
        displayName: s.me.displayName,
        updatedAt: Date.now(),
      }
    )
  }
  return store.profileOf(props.peerId!) ?? null
})

const uid = computed(() => (isSelf.value ? selfId.value : props.peerId) ?? '')
const displayName = computed(() => profile.value?.displayName ?? '未知用户')
const username = computed(() => (isSelf.value ? store.session?.username : undefined))
const serverUrl = computed(() => store.session?.serverUrl ?? '')
const connectionLabel = computed(() => (store.online ? '服务器在线' : '离线 · 局域网'))
const peerOnline = computed(() => (props.peerId ? store.isPeerOnline(props.peerId) : false))

const cropping = ref(false)
const cropSrc = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarError = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const nameError = ref('')

function pickAvatar(ev: Event): void {
  if (!isSelf.value) return
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  cropSrc.value = URL.createObjectURL(file)
  cropping.value = true
  avatarError.value = ''
}

async function onCropped(blob: Blob): Promise<void> {
  cropping.value = false
  try {
    await store.session?.setAvatar(blob)
    await store.refreshProfiles()
  } catch (e) {
    avatarError.value = `头像保存失败：${e instanceof Error ? e.message : String(e)}`
  }
}

const editingName = ref(false)
const nameDraft = ref('')
const nameSaving = ref(false)

async function startEditName(): Promise<void> {
  nameDraft.value = profile.value?.displayName ?? ''
  nameError.value = ''
  editingName.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

async function saveName(): Promise<void> {
  const s = store.session
  if (!s) return
  const next = nameDraft.value.trim()
  if (!next || next.length > 30) {
    nameError.value = '昵称需 1-30 字'
    return
  }
  nameSaving.value = true
  nameError.value = ''
  try {
    await s.updateDisplayName(next)
    editingName.value = false
    await store.refreshProfiles()
  } catch (e) {
    nameError.value = e instanceof Error ? e.message : String(e)
  } finally {
    nameSaving.value = false
  }
}

type CopyField = 'id' | 'server'
const copiedField = ref<CopyField | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyField(field: CopyField, value: string): Promise<void> {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    copiedField.value = field
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copiedField.value = null), 1500)
  } catch {
    /* ignore */
  }
}

const confirmingLogout = ref(false)
async function logout(): Promise<void> {
  await store.session?.logout()
  emit('close')
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="page">
    <header v-if="showBack !== false || !isSelf" class="head">
      <button class="icon-btn" type="button" aria-label="返回" @click="emit('close')">
        <Icon name="back" :size="20" />
      </button>
      <span class="title">{{ isSelf ? '我' : '资料' }}</span>
    </header>

    <div class="scroll">
      <div class="body">
        <section class="hero">
          <button
            v-if="isSelf"
            class="avatar-btn"
            type="button"
            title="更换头像"
            aria-label="更换头像"
            @click="avatarInput?.click()"
          >
            <Avatar :profile="profile" size="var(--avatar-lg)" />
            <span class="avatar-edit" aria-hidden="true"><Icon name="image" :size="14" /></span>
          </button>
          <Avatar v-else :profile="profile" size="var(--avatar-lg)" :online="peerOnline" />
          <input
            v-if="isSelf"
            ref="avatarInput"
            class="avatar-file"
            type="file"
            accept="image/*"
            hidden
            @change="pickAvatar"
          />

          <div class="hero-info">
            <template v-if="isSelf && editingName">
              <div class="name-edit">
                <input
                  ref="nameInput"
                  v-model="nameDraft"
                  class="name-input"
                  maxlength="30"
                  placeholder="昵称"
                  @keydown.enter="saveName"
                  @keydown.esc="editingName = false"
                />
                <button class="btn btn-primary" type="button" :disabled="nameSaving" @click="saveName">
                  {{ nameSaving ? '保存中…' : '保存' }}
                </button>
                <button class="btn btn-ghost" type="button" @click="editingName = false">取消</button>
              </div>
            </template>
            <div v-else class="name-line">
              <h2 class="name" :title="displayName">{{ displayName }}</h2>
              <button
                v-if="isSelf"
                class="icon-btn name-edit-btn"
                type="button"
                title="修改昵称"
                aria-label="修改昵称"
                @click.stop="startEditName"
              >
                <Icon name="edit" :size="16" />
              </button>
            </div>

            <div class="meta-line">
              <span v-if="username" class="pill">@{{ username }}</span>
              <span v-else-if="!isSelf" class="pill" :class="{ 'pill-success': peerOnline }">
                {{ peerOnline ? '在线' : '离线' }}
              </span>
              <span v-if="profile?.statusText" class="status-text truncate" :title="profile?.statusText">
                {{ profile?.statusText }}
              </span>
            </div>

            <button
              v-if="uid"
              class="id-chip"
              type="button"
              :title="copiedField === 'id' ? '已复制' : `复制用户 ID：${uid}`"
              @click="copyField('id', uid)"
            >
              <span class="id-label">ID</span>
              <code class="id-value mono">{{ uid }}</code>
              <Icon :name="copiedField === 'id' ? 'check' : 'copy'" :size="14" />
            </button>
          </div>
        </section>

        <p v-if="avatarError" class="error" role="alert">{{ avatarError }}</p>
        <p v-if="nameError" class="error" role="alert">{{ nameError }}</p>

        <template v-if="isSelf">
          <section class="card">
            <h3 class="card-title">账号信息</h3>
            <dl class="rows">
              <div class="row">
                <dt>用户名</dt>
                <dd>{{ username ? `@${username}` : '—' }}</dd>
              </div>
              <div class="row">
                <dt>连接状态</dt>
                <dd class="row-inline">
                  <span class="status-dot" :class="{ on: store.online }" aria-hidden="true" />
                  {{ connectionLabel }}
                </dd>
              </div>
              <div class="row">
                <dt>版本</dt>
                <dd>{{ APP_VERSION_LABEL }}</dd>
              </div>
            </dl>
          </section>

          <section class="card">
            <h3 class="card-title">主题</h3>
            <div class="seg" role="group" aria-label="主题模式">
              <button
                v-for="opt in THEME_OPTIONS"
                :key="opt.value"
                class="seg-btn"
                type="button"
                :class="{ on: mode === opt.value }"
                :aria-pressed="mode === opt.value"
                @click="setMode(opt.value)"
              >
                <Icon :name="opt.icon" :size="16" />
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </section>

          <section class="card">
            <h3 class="card-title">通知</h3>
            <template v-if="!notifySupported">
              <p class="notify-note">
                当前环境不支持系统通知（网页版在浏览器里可以开启；手机 App 的系统推送暂未接入）。
              </p>
            </template>
            <template v-else-if="notifyPermission === 'granted'">
              <div class="notify-row">
                <div class="notify-copy">
                  <span class="notify-title">桌面通知</span>
                  <span class="notify-note">
                    窗口在后台（切到别的标签/最小化）时，新消息会弹出系统通知，点击直接回到会话。
                  </span>
                </div>
                <button
                  class="switch"
                  type="button"
                  role="switch"
                  :aria-checked="notifyEnabled"
                  :class="{ on: notifyEnabled }"
                  :aria-label="notifyEnabled ? '关闭桌面通知' : '开启桌面通知'"
                  @click="setNotificationsEnabled(!notifyEnabled)"
                >
                  <span class="knob" aria-hidden="true" />
                </button>
              </div>
            </template>
            <template v-else-if="notifyPermission === 'denied'">
              <p class="notify-note">
                通知已被浏览器拒绝。点地址栏左侧的站点图标 → 把「通知」改成「允许」，再刷新页面即可。
              </p>
            </template>
            <template v-else>
              <p class="notify-note">开启后，窗口在后台时新消息会弹出系统通知。</p>
              <button class="btn btn-primary notify-ask" type="button" @click="askNotify">
                开启桌面通知
              </button>
            </template>
          </section>

          <section class="card">
            <h3 class="card-title">服务器地址</h3>
            <div class="server-row">
              <code class="server-value mono">{{ serverUrl || '—' }}</code>
              <button
                class="icon-btn"
                type="button"
                :disabled="!serverUrl"
                :title="copiedField === 'server' ? '已复制' : '复制服务器地址'"
                :aria-label="copiedField === 'server' ? '已复制' : '复制服务器地址'"
                @click="copyField('server', serverUrl)"
              >
                <Icon :name="copiedField === 'server' ? 'check' : 'copy'" :size="16" />
              </button>
            </div>
          </section>

          <section class="card danger-card">
            <template v-if="confirmingLogout">
              <p class="logout-hint">退出后需联网重新登录，本机消息会保留。</p>
              <div class="logout-actions">
                <button class="btn btn-ghost" type="button" @click="confirmingLogout = false">取消</button>
                <button class="btn btn-danger" type="button" @click="logout">确认退出</button>
              </div>
            </template>
            <button v-else class="logout-btn" type="button" @click="confirmingLogout = true">
              <Icon name="logout" :size="18" />
              <span>退出登录</span>
            </button>
          </section>
        </template>

        <template v-else>
          <section class="card">
            <h3 class="card-title">资料</h3>
            <dl class="rows">
              <div class="row">
                <dt>用户 ID</dt>
                <dd class="mono break">{{ uid }}</dd>
              </div>
              <div class="row">
                <dt>状态</dt>
                <dd>{{ peerOnline ? '在线' : '离线' }}</dd>
              </div>
              <div v-if="profile?.statusText" class="row">
                <dt>个性签名</dt>
                <dd>{{ profile?.statusText }}</dd>
              </div>
            </dl>
            <button class="btn btn-primary btn-block open-chat" type="button" @click="emit('openChat', props.peerId!)">
              发消息
            </button>
          </section>
        </template>
      </div>
    </div>

    <AvatarCropper v-if="cropping" :src="cropSrc" title="调整头像" @close="cropping = false" @cropped="onCropped" />
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-app);
  color: var(--text);
}
/* button/input 不继承 body 行高，中文文案统一按 1.5 行高 */
.page button,
.page input {
  line-height: var(--lh-base);
}
.head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: calc(var(--s-1) + env(safe-area-inset-top, 0px)) var(--s-2) var(--s-1);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.title {
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-tight);
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.body {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  padding: var(--s-5) var(--s-4) var(--s-8);
}
.hero {
  display: flex;
  align-items: center;
  gap: var(--s-4);
}
.avatar-btn {
  position: relative;
  flex: none;
  padding: 0;
  border-radius: var(--r-full);
  line-height: 0;
}
.avatar-btn:focus-visible {
  border-radius: var(--r-full);
}
.avatar-edit {
  position: absolute;
  right: 0;
  bottom: 0;
  width: var(--s-6);
  height: var(--s-6);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-full);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--accent);
  box-shadow: var(--shadow-1);
  transition: background var(--dur-fast) var(--ease);
}
.avatar-btn:hover .avatar-edit {
  background: var(--accent-soft);
}
.hero-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--s-1);
}
.name-line {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  max-width: 100%;
}
.name {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  line-height: var(--lh-tight);
  overflow-wrap: anywhere;
}
.name-edit-btn {
  flex: none;
  width: var(--s-8);
  height: var(--s-8);
}
.name-edit {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
}
.name-input {
  flex: 1 1 8em;
  min-width: 0;
  min-height: var(--touch);
  padding: 0 var(--s-3);
  background: var(--bg-input);
  border: 1px solid var(--accent);
  border-radius: var(--r-sm);
  font-size: var(--fs-xl);
  font-weight: 700;
  outline: none;
}
.name-edit .btn {
  flex: none;
}
.meta-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-2);
  max-width: 100%;
}
.meta-line .pill {
  line-height: var(--lh-base);
}
.status-text {
  max-width: 100%;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.id-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--s-1);
  max-width: 100%;
  min-height: var(--s-8);
  padding: calc(var(--s-1) / 2) var(--s-2);
  background: var(--bg-input);
  border-radius: var(--r-full);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.id-chip:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.id-label {
  flex: none;
  font-weight: 600;
}
.id-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.card {
  padding: var(--s-4);
}
.card-title {
  margin: 0 0 var(--s-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.rows {
  margin: 0;
  display: flex;
  flex-direction: column;
}
.row {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  align-items: center;
  gap: var(--s-3);
  min-height: var(--s-10);
  border-top: 1px solid var(--border);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
}
.row:first-child {
  border-top: 0;
}
.row dt {
  color: var(--text-muted);
}
.row dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.row-inline {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.status-dot {
  width: var(--s-2);
  height: var(--s-2);
  flex: none;
  border-radius: var(--r-full);
  background: var(--text-faint);
}
.status-dot.on {
  background: var(--success);
}
.break {
  word-break: break-all;
}
.seg {
  display: flex;
  gap: var(--s-1);
  padding: var(--s-1);
  background: var(--bg-input);
  border-radius: var(--r-sm);
}
.seg-btn {
  flex: 1;
  min-width: 0;
  min-height: var(--s-8);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  padding: 0 var(--s-1);
  border-radius: var(--r-xs);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.seg-btn.on {
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.seg-btn:hover:not(.on) {
  color: var(--text);
}
.seg-btn:focus-visible {
  box-shadow: var(--focus-ring);
}
.server-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.server-row .icon-btn {
  flex: none;
}
.server-value {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.danger-card {
  padding: var(--s-3);
}
.logout-btn {
  width: 100%;
  min-height: var(--touch);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-base);
  font-weight: 600;
  transition: background var(--dur-fast) var(--ease);
}
.logout-btn:hover {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.logout-hint {
  margin: 0 0 var(--s-3);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.logout-actions {
  display: flex;
  gap: var(--s-2);
}
.logout-actions .btn {
  flex: 1;
  min-height: var(--touch);
}
.open-chat {
  margin-top: var(--s-3);
  min-height: var(--touch);
}

/* ---------- 通知 ---------- */
.notify-row {
  display: flex;
  align-items: flex-start;
  gap: var(--s-3);
  justify-content: space-between;
}
.notify-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.notify-title {
  font-size: var(--fs-base);
  color: var(--text);
}
.notify-note {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.notify-ask {
  margin-top: var(--s-3);
  min-height: var(--touch);
}
.switch {
  flex: none;
  width: 48px;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--bg-hover);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}
.switch .knob {
  display: block;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--bg-panel);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 160ms ease;
}
.switch.on {
  background: var(--accent);
  border-color: var(--accent);
}
.switch.on .knob {
  transform: translateX(20px);
}
@media (pointer: coarse) {
  .switch {
    width: 52px;
    height: 32px;
  }
  .switch .knob {
    width: 26px;
    height: 26px;
  }
  .switch.on .knob {
    transform: translateX(20px);
  }
}
@media (max-width: 719.98px) {
  .body {
    gap: var(--s-3);
    padding: var(--s-4) var(--s-4) var(--s-8);
  }
  .icon-btn {
    width: var(--touch);
    height: var(--touch);
  }
  .name-edit-btn {
    width: var(--touch);
    height: var(--touch);
  }
  .seg-btn {
    min-height: var(--touch);
  }
  .id-chip {
    min-height: var(--touch);
  }
  .name-edit .btn {
    min-height: var(--touch);
  }
}
</style>
