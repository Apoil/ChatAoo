<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'
import AvatarCropper from './AvatarCropper.vue'

/**
 * 个人主页：默认展示自己（可点头像换头像、改昵称、退出登录）；
 * 传入 peerId 时展示对方资料（只读）。
 */
const props = defineProps<{ peerId?: string }>()
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

/* 头像：点击即触发更换（仅自己） */
const cropping = ref(false)
const cropSrc = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarError = ref('')

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

/* 昵称编辑（仅自己） */
const editingName = ref(false)
const nameDraft = ref('')
const nameSaving = ref(false)

function startEditName(): void {
  nameDraft.value = profile.value?.displayName ?? ''
  editingName.value = true
}

async function saveName(): Promise<void> {
  const s = store.session
  if (!s) return
  nameSaving.value = true
  try {
    await s.updateDisplayName(nameDraft.value.trim())
    editingName.value = false
    await store.refreshProfiles()
  } finally {
    nameSaving.value = false
  }
}

/* 复制用户 ID */
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

/* 退出登录（仅自己） */
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
    <header class="head">
      <button class="icon-btn" @click="emit('close')">←</button>
      <span class="title">{{ isSelf ? '我的主页' : '个人主页' }}</span>
      <span class="spacer" />
    </header>

    <div class="body">
      <!-- 头像：点击更换（自己） -->
      <div class="avatar-wrap" :class="{ editable: isSelf }" @click="isSelf && avatarInput?.click()">
        <Avatar :profile="profile" :size="96" :online="isSelf ? undefined : peerOnline" />
        <span v-if="isSelf" class="edit-tip">点击更换头像</span>
        <input ref="avatarInput" type="file" accept="image/*" hidden @change="pickAvatar" />
      </div>
      <p v-if="avatarError" class="avatar-error">{{ avatarError }}</p>

      <div class="name-row">
        <template v-if="isSelf && editingName">
          <input v-model="nameDraft" class="name-input" maxlength="30" @keydown.enter="saveName" />
          <button class="btn btn-primary sm" :disabled="nameSaving" @click="saveName">保存</button>
          <button class="btn btn-ghost sm" @click="editingName = false">取消</button>
        </template>
        <template v-else>
          <h2 class="name">{{ profile?.displayName ?? '未知用户' }}</h2>
          <button v-if="isSelf" class="icon-btn" title="修改昵称" @click="startEditName">✎</button>
        </template>
      </div>

      <div class="sub">
        <span v-if="isSelf" class="pill">@{{ username }}</span>
        <span v-if="peerOnline" class="pill ok">在线</span>
      </div>

      <div class="meta">
        <div class="meta-row">
          <span class="label">用户 ID</span>
          <code>{{ isSelf ? store.session?.me.userId : peerId }}</code>
          <button class="btn btn-ghost sm" @click="copyId">{{ copied ? '已复制 ✓' : '复制' }}</button>
        </div>
        <div v-if="isSelf" class="meta-row">
          <span class="label">服务器</span>
          <span class="value">{{ store.online ? '在线' : '离线（局域网模式）' }}</span>
        </div>
      </div>

      <div v-if="!isSelf" class="actions">
        <button class="btn btn-primary" @click="emit('openChat', props.peerId!)">发消息</button>
      </div>

      <div v-if="isSelf" class="divider" />

      <div v-if="isSelf" class="logout-area">
        <template v-if="confirmingLogout">
          <p class="logout-hint">退出后需在线重新登录；本机消息会保留。</p>
          <button class="btn btn-danger" @click="logout">确认退出</button>
          <button class="btn btn-ghost" @click="confirmingLogout = false">取消</button>
        </template>
        <button v-else class="btn btn-danger" @click="confirmingLogout = true">退出登录</button>
      </div>
    </div>

    <AvatarCropper v-if="cropping" :src="cropSrc" title="调整头像位置与范围" @close="cropping = false" @cropped="onCropped" />
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-soft);
  flex: none;
}
.title {
  font-size: 15px;
  font-weight: 700;
}
.spacer {
  flex: 1;
}
.body {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  flex: 1;
}
.avatar-wrap {
  position: relative;
  cursor: default;
}
.avatar-wrap.editable {
  cursor: pointer;
}
.avatar-wrap.editable:hover::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
}
.edit-tip {
  position: absolute;
  bottom: -22px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--text-faint);
  white-space: nowrap;
}
.avatar-error {
  color: var(--danger);
  font-size: 12.5px;
  margin: 22px 0 0;
  text-align: center;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
}
.name {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}
.name-input {
  background: var(--bg-input);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 16px;
  font-weight: 700;
  outline: none;
  width: 180px;
}
.sub {
  display: flex;
  gap: 8px;
}
.pill.ok {
  background: rgba(53, 193, 142, 0.12);
  color: var(--ok);
}
.meta {
  width: 100%;
  max-width: 420px;
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.label {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 600;
  flex: none;
}
.meta-row code {
  flex: 1;
  font-size: 11.5px;
  color: var(--text-dim);
  word-break: break-all;
}
.value {
  font-size: 13px;
}
.btn.sm {
  padding: 5px 12px;
  font-size: 12px;
  flex: none;
}
.actions {
  margin-top: 18px;
}
.logout-area {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.logout-hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 12.5px;
}
</style>
