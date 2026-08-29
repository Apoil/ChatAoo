<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Message, Profile } from '@chataoo/shared'
import { useChatStore } from '../stores/chat'
import Avatar from './Avatar.vue'
import AttachmentBubble from './AttachmentBubble.vue'
import Icon from './Icon.vue'

const props = defineProps<{
  message: Message
  profile: Profile | null | undefined
  showAvatar?: boolean
}>()

const emit = defineEmits<{ open: [attachment: NonNullable<Message['attachment']>] }>()
const store = useChatStore()

const mine = computed(() => props.message.senderId === store.session?.me.userId)
const revoked = computed(() => !!props.message.revoked)
const canRevoke = computed(() => mine.value && Date.now() - props.message.createdAt < 2 * 60 * 1000 && !revoked.value)

const menu = ref<{ x: number; y: number } | null>(null)
let pressTimer: ReturnType<typeof setTimeout> | null = null

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function openMenu(x: number, y: number): void {
  if (revoked.value) return
  const pad = 8
  const w = 148
  const h = 160
  menu.value = {
    x: Math.min(x, window.innerWidth - w - pad),
    y: Math.min(y, window.innerHeight - h - pad),
  }
}

function onContext(ev: MouseEvent): void {
  ev.preventDefault()
  openMenu(ev.clientX, ev.clientY)
}

function onTouchStart(ev: TouchEvent): void {
  const t = ev.touches[0]
  if (!t) return
  pressTimer = setTimeout(() => openMenu(t.clientX, t.clientY), 480)
}

function onTouchEnd(): void {
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = null
}

function closeMenu(): void {
  menu.value = null
}

async function copyText(): Promise<void> {
  const t = props.message.text
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
  } catch {
    /* ignore */
  }
  closeMenu()
}

async function saveAtt(): Promise<void> {
  const a = props.message.attachment
  const s = store.session
  if (!a || !s) return
  const url = await s.attachmentUrlOf(a)
  if (!url) return
  if (s.platform.saveFile) await Promise.resolve(s.platform.saveFile(a.name, url))
  else {
    const link = document.createElement('a')
    link.href = url
    link.download = a.name
    link.click()
  }
  closeMenu()
}

async function delLocal(): Promise<void> {
  await store.hideMessage(props.message.id)
  closeMenu()
}

async function revoke(): Promise<void> {
  await store.revokeMessage(props.message.id)
  closeMenu()
}

function onDoc(ev: MouseEvent | TouchEvent): void {
  if (!menu.value) return
  const t = ev.target as HTMLElement | null
  if (t?.closest('.msg-menu')) return
  closeMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onDoc)
  document.addEventListener('touchstart', onDoc, { passive: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc)
  document.removeEventListener('touchstart', onDoc)
  if (pressTimer) clearTimeout(pressTimer)
})
</script>

<template>
  <div v-if="message.kind === 'system' || revoked" class="sys">{{ message.text || '消息已撤回' }}</div>
  <div
    v-else
    class="row"
    :class="{ mine }"
    @contextmenu="onContext"
    @touchstart.passive="onTouchStart"
    @touchend="onTouchEnd"
    @touchmove="onTouchEnd"
    @touchcancel="onTouchEnd"
  >
    <Avatar v-if="!mine && showAvatar" :profile="profile" :size="32" />
    <span v-else-if="!mine" class="avatar-gap" />
    <div class="col">
      <div class="bubble" :class="{ mine }">
        <span v-if="message.text" class="text">{{ message.text }}</span>
        <AttachmentBubble
          v-if="message.attachment"
          :attachment="message.attachment"
          @open="(a) => emit('open', a)"
        />
        <div class="meta">
          <span class="time">{{ timeLabel(message.createdAt) }}</span>
          <span v-if="mine" class="status" :class="message.status">
            <Icon v-if="message.status === 'delivered'" name="check-double" :size="12" />
            <Icon v-else-if="message.status === 'sent'" name="check" :size="12" />
            <span v-else-if="message.status === 'pending'">…</span>
            <span v-else>!</span>
          </span>
        </div>
      </div>
    </div>
  </div>
  <Teleport to="body">
    <div v-if="menu" class="msg-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
      <button v-if="message.text" type="button" @click="copyText">
        <Icon name="copy" :size="14" /> 复制
      </button>
      <button v-if="message.attachment" type="button" @click="saveAtt">
        <Icon name="save" :size="14" /> 保存
      </button>
      <button v-if="canRevoke" type="button" @click="revoke">
        <Icon name="close" :size="14" /> 撤回
      </button>
      <button type="button" class="danger" @click="delLocal">
        <Icon name="trash" :size="14" /> 删除
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.sys {
  align-self: center;
  font-size: 12px;
  color: var(--text-faint);
  margin: 10px 0;
}
.row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin: 2px 0;
}
.row.mine {
  justify-content: flex-end;
}
.avatar-gap {
  width: 32px;
  flex: none;
}
.col {
  max-width: 72%;
  display: flex;
  flex-direction: column;
}
.row.mine .col {
  align-items: flex-end;
}
.bubble {
  background: var(--msg-in);
  border-radius: 4px 12px 12px 12px;
  padding: 8px 10px 6px;
  box-shadow: var(--shadow);
}
.bubble.mine {
  background: var(--msg-out);
  border-radius: 12px 4px 12px 12px;
  box-shadow: none;
}
.text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
  user-select: text;
}
.meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 2px;
}
.time {
  font-size: 10.5px;
  color: var(--text-faint);
}
.status {
  display: inline-flex;
  color: var(--text-faint);
}
.status.sent,
.status.delivered {
  color: var(--ok);
}
.status.failed {
  color: var(--danger);
}
</style>

<style>
.msg-menu {
  position: fixed;
  z-index: 1200;
  min-width: 136px;
  padding: 4px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.msg-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  border-radius: 4px;
}
.msg-menu button:hover {
  background: var(--bg-hover);
}
.msg-menu button.danger {
  color: var(--danger);
}
</style>
