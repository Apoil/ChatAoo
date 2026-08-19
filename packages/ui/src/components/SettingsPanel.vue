<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'
import AvatarCropper from './AvatarCropper.vue'

const emit = defineEmits<{ close: [] }>()
const store = useChatStore()

const cropping = ref(false)
const cropSrc = ref('')
const copied = ref(false)

const me = computed(() => store.session?.me)
const myProfile = computed(() => (me.value ? store.profileOf(me.value.userId) : undefined))

function pickAvatar(ev: Event): void {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  cropSrc.value = URL.createObjectURL(file)
  cropping.value = true
}

async function onCropped(blob: Blob): Promise<void> {
  cropping.value = false
  await store.session?.setAvatar(blob)
  await store.refreshProfiles()
}

async function copyId(): Promise<void> {
  if (!me.value) return
  try {
    await navigator.clipboard.writeText(me.value.userId)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="panel">
    <div class="head">
      <h3>设置</h3>
      <button class="icon-btn" @click="emit('close')">✕</button>
    </div>

    <div class="section">
      <div class="me">
        <Avatar :profile="myProfile" :size="72" />
        <div class="me-meta">
          <div class="name">{{ myProfile?.displayName ?? me?.displayName }}</div>
          <div class="sub">
            <span v-if="store.online" class="pill ok">服务器在线</span>
            <span v-else class="pill">离线模式（局域网可用）</span>
          </div>
        </div>
        <label class="btn btn-primary change">
          更换头像
          <input type="file" accept="image/*" hidden @change="pickAvatar" />
        </label>
      </div>
      <div class="field id-field">
        <label>我的用户 ID（好友添加用）</label>
        <div class="id-row">
          <code>{{ me?.userId }}</code>
          <button class="btn btn-ghost sm" @click="copyId">{{ copied ? '已复制 ✓' : '复制' }}</button>
        </div>
      </div>
    </div>

    <div class="divider" />

    <div class="section tips">
      <h4>局域网模式</h4>
      <p>
        在同一局域网且互为好友的设备会自动发现（UDP 组播，无需互联网）。断网时聊天数据先保存在本地，
        恢复联网后自动同步到服务器。
      </p>
    </div>

    <AvatarCropper v-if="cropping" :src="cropSrc" title="调整头像位置与范围" @close="cropping = false" @cropped="onCropped" />
  </div>
</template>

<style scoped>
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}
h3 {
  margin: 0;
  font-size: 16px;
}
.section {
  padding: 16px;
}
.me {
  display: flex;
  align-items: center;
  gap: 14px;
}
.me-meta {
  flex: 1;
  min-width: 0;
}
.name {
  font-size: 17px;
  font-weight: 700;
}
.sub {
  margin-top: 4px;
}
.pill.ok {
  background: rgba(52, 211, 153, 0.14);
  color: var(--ok);
}
.change {
  flex: none;
}
.id-field {
  margin-top: 16px;
}
.id-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.id-row code {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-dim);
  word-break: break-all;
}
.btn.sm {
  padding: 6px 12px;
  font-size: 12px;
  flex: none;
}
.tips h4 {
  margin: 0 0 8px;
  color: var(--text);
}
.tips p {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.6;
  font-size: 13px;
}
</style>
