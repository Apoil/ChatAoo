<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { APP_VERSION_LABEL, type Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'
import AvatarCropper from './AvatarCropper.vue'
import Icon from './Icon.vue'

/**
 * 个人主页：默认展示自己（可点头像换头像、改昵称、退出登录）；
 * 传入 peerId 时展示对方资料（只读）。
 */
const props = defineProps<{ peerId?: string; showBack?: boolean }>()
const emit = defineEmits<{ close: []; openChat: [peerId: string] }>()
const store = useChatStore()

const isSelf = computed(() => !props.peerId || props.peerId === store.session?.me.userId)
const profile = computed<Profile | null>(() => {
  const s = store.session
  if (!s) return null
  if (isSelf.value) {
    return (
      store.profileOf(s.me.userId) ?? {
        userId: s.me.userId,
        displayName: s.me.displayName,
        updatedAt: Date.now(),
      }
    )
  }
  return store.profileOf(props.peerId!) ?? null
})

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

const copied = ref(false)
async function copyId(): Promise<void> {
  const s = store.session
  const id = isSelf.value ? s?.me.userId : props.peerId
  if (!id) return
  try {
    await navigator.clipboard.writeText(id)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* ignore */
  }
}

const confirmingLogout = ref(false)
async function logout(): Promise<void> {
  await store.session?.logout()
  emit('close')
}

const peerOnline = computed(() => (props.peerId ? store.isPeerOnline(props.peerId) : false))
const username = computed(() => (isSelf.value ? store.session?.username : undefined))
</script>

<template>
  <div class="page">
    <header v-if="showBack !== false || !isSelf" class="head">
      <button class="icon-btn" @click="emit('close')">
        <Icon name="back" :size="20" />
      </button>
      <span class="title">{{ isSelf ? '我' : '资料' }}</span>
    </header>

    <div class="body">
      <div class="avatar-wrap" :class="{ editable: isSelf }" @click="isSelf && avatarInput?.click()">
        <Avatar :profile="profile" :size="88" :online="isSelf ? undefined : peerOnline" />
        <span v-if="isSelf" class="edit-tip">更换头像</span>
        <input
          v-if="isSelf"
          ref="avatarInput"
          class="avatar-file"
          type="file"
          accept="image/*"
          hidden
          @change="pickAvatar"
        />
      </div>
      <p v-if="avatarError" class="avatar-error">{{ avatarError }}</p>

      <div class="name-row">
        <template v-if="isSelf && editingName">
          <input
            ref="nameInput"
            v-model="nameDraft"
            class="name-input"
            maxlength="30"
            placeholder="昵称"
            @keydown.enter="saveName"
          />
          <button class="btn btn-primary sm" :disabled="nameSaving" @click="saveName">保存</button>
          <button class="btn btn-ghost sm" @click="editingName = false">取消</button>
        </template>
        <template v-else>
          <h2 class="name">{{ profile?.displayName ?? '未知用户' }}</h2>
          <button v-if="isSelf" class="icon-btn" title="修改昵称" @click.stop="startEditName">
            <Icon name="edit" :size="16" />
          </button>
        </template>
      </div>
      <p v-if="nameError" class="avatar-error">{{ nameError }}</p>

      <p v-if="username" class="uname">@{{ username }} · 用户名不可改</p>
      <p v-else-if="peerOnline" class="uname on">在线</p>

      <dl class="meta">
        <div class="meta-row">
          <dt>用户 ID</dt>
          <dd>
            <code>{{ isSelf ? store.session?.me.userId : peerId }}</code>
            <button class="icon-btn" :title="copied ? '已复制' : '复制'" @click="copyId">
              <Icon :name="copied ? 'check' : 'copy'" :size="15" />
            </button>
          </dd>
        </div>
        <div v-if="isSelf" class="meta-row">
          <dt>连接</dt>
          <dd>{{ store.online ? '服务器在线' : '离线 · 局域网' }}</dd>
        </div>
        <div v-if="isSelf" class="meta-row">
          <dt>版本</dt>
          <dd>{{ APP_VERSION_LABEL }}</dd>
        </div>
      </dl>

      <div v-if="!isSelf" class="actions">
        <button class="btn btn-primary" @click="emit('openChat', props.peerId!)">发消息</button>
      </div>

      <div v-if="isSelf" class="logout-area">
        <template v-if="confirmingLogout">
          <p class="logout-hint">退出后需联网重新登录，本机消息会留下。</p>
          <button class="btn btn-danger" @click="logout">确认退出</button>
          <button class="btn btn-ghost" @click="confirmingLogout = false">取消</button>
        </template>
        <button v-else class="btn btn-danger" @click="confirmingLogout = true">退出登录</button>
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
  overflow-y: auto;
  background: var(--bg-sidebar);
}
.head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  flex: none;
}
.title {
  font-size: 15px;
  font-weight: 600;
}
.body {
  padding: 20px 22px 28px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.avatar-wrap {
  position: relative;
  margin-bottom: 8px;
  width: fit-content;
}
.avatar-wrap.editable {
  cursor: pointer;
}
.edit-tip {
  display: block;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.avatar-error {
  color: var(--danger);
  font-size: 12.5px;
  margin: 8px 0 0;
}
.name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  width: 100%;
}
.name {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.name-input {
  flex: 1;
  min-width: 0;
  background: var(--bg-raised);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 16px;
  outline: none;
  user-select: text;
  -webkit-user-select: text;
  -webkit-app-region: no-drag;
}
.name-row .btn.sm {
  flex: none;
  white-space: nowrap;
}
.uname {
  margin: 4px 0 0;
  color: var(--text-dim);
  font-size: 13px;
}
.uname.on {
  color: var(--ok);
}
.meta {
  width: 100%;
  margin: 22px 0 0;
  display: flex;
  flex-direction: column;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--border-soft);
  font-size: 13px;
}
.meta-row dt {
  width: 64px;
  flex: none;
  color: var(--text-faint);
}
.meta-row dd {
  margin: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.meta-row code {
  flex: 1;
  font-size: 12px;
  color: var(--text-dim);
  word-break: break-all;
}
.btn.sm {
  padding: 5px 12px;
  font-size: 12px;
}
.actions {
  margin-top: 20px;
}
.logout-area {
  margin-top: 28px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.logout-hint {
  margin: 0;
  width: 100%;
  color: var(--text-faint);
  font-size: 12.5px;
}
</style>
