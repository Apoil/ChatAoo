<script setup lang="ts">
/**
 * 消息气泡（设计系统 v2 §4 MessageBubble）
 * - 自己：--bubble-out-*；对方：--bubble-in-* + 1px --border
 * - 时间 11px、已读/发送中状态、失败态（感叹 + 重发）
 * - 悬停操作条（复制 / 保存 / 撤回 / 删除），触屏长按仍出菜单
 * 契约不变：props { message, profile, showAvatar? } / emits open
 * 新增可选：grouped?（同一发送者连续消息，收紧间距）
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Message, Profile } from '@chataoo/shared'
import { displayAttachmentKind } from '@chataoo/app-core'
import { useChatStore } from '../stores/chat'
import { isEmojiOnly } from '../emoji'
import AttachmentBubble from './AttachmentBubble.vue'
import Avatar from './Avatar.vue'
import Icon from './Icon.vue'

const props = defineProps<{
  message: Message
  profile: Profile | null | undefined
  showAvatar?: boolean
  grouped?: boolean
}>()

const emit = defineEmits<{ open: [attachment: NonNullable<Message['attachment']>] }>()
const store = useChatStore()

const mine = computed(() => props.message.senderId === store.session?.accountId)
const revoked = computed(() => !!props.message.revoked)
const failed = computed(() => mine.value && props.message.status === 'failed')
const canRevoke = computed(
  () => mine.value && !revoked.value && Date.now() - props.message.createdAt < 2 * 60 * 1000,
)
/** 纯表情消息放大成贴纸效果 */
const bigEmoji = computed(
  () => props.message.kind === 'text' && !!props.message.text && isEmojiOnly(props.message.text, 3),
)

const menu = ref<{ x: number; y: number } | null>(null)
const retrying = ref(false)
let pressTimer: ReturnType<typeof setTimeout> | null = null

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fullTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

const statusLabel = computed(() => {
  switch (props.message.status) {
    case 'pending':
      return '发送中'
    case 'sent':
      return '已发送'
    case 'delivered':
      return '已送达'
    default:
      return '发送失败'
  }
})

/* ---------------- 气泡菜单 ---------------- */

function openMenu(x: number, y: number): void {
  if (revoked.value) return
  const pad = 8
  const w = 156
  const h = 184
  menu.value = {
    x: Math.max(pad, Math.min(x, window.innerWidth - w - pad)),
    y: Math.max(pad, Math.min(y, window.innerHeight - h - pad)),
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
    /* 剪贴板不可用时静默 */
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

/** 失败重发：文本重发；附件从本地缓存重新读取后上传。成功后移除旧气泡。 */
async function retry(): Promise<void> {
  const s = store.session
  const peer = store.peerOf(props.message.conversationId)
  if (!s || !peer || retrying.value) return
  retrying.value = true
  try {
    const att = props.message.attachment
    if (att) {
      const blob = await s.platform.media.read(att.sha256)
      if (!blob) return
      await s.sendAttachment(peer, {
        blob,
        name: att.name || 'file',
        kind: displayAttachmentKind(att),
        mimeType: att.mimeType || blob.type || 'application/octet-stream',
      })
    } else if (props.message.text) {
      await s.sendText(peer, props.message.text)
    } else {
      return
    }
    await store.hideMessage(props.message.id)
  } catch (e) {
    console.error('retry message failed:', e)
    // 重发本身失败时，新产生的失败气泡立即清理，避免两个「发送失败」并排
    const dupes = (store.messages[props.message.conversationId] ?? []).filter(
      (m) =>
        m.id !== props.message.id &&
        m.status === 'failed' &&
        m.attachment?.sha256 === props.message.attachment?.sha256 &&
        m.createdAt >= props.message.createdAt,
    )
    for (const d of dupes) await store.hideMessage(d.id)
  } finally {
    retrying.value = false
  }
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
  <div v-if="message.kind === 'system' || revoked" class="sys-row">
    <span class="sys">{{ message.text || '消息已撤回' }}</span>
  </div>

  <div
    v-else
    class="row"
    :class="{ mine, grouped }"
    @contextmenu="onContext"
    @touchstart.passive="onTouchStart"
    @touchend="onTouchEnd"
    @touchmove="onTouchEnd"
    @touchcancel="onTouchEnd"
  >
    <Avatar v-if="!mine && showAvatar !== false" :profile="profile" :size="32" />
    <span v-else-if="!mine" class="avatar-gap" aria-hidden="true" />

    <div class="col">
      <div class="bubble-wrap">
        <div class="hover-actions" role="toolbar" aria-label="消息操作">
          <button v-if="message.text" type="button" title="复制" aria-label="复制" @click.stop="copyText">
            <Icon name="copy" :size="14" />
          </button>
          <button
            v-if="message.attachment"
            type="button"
            title="保存"
            aria-label="保存附件"
            @click.stop="saveAtt"
          >
            <Icon name="save" :size="14" />
          </button>
          <button v-if="canRevoke" type="button" title="撤回" aria-label="撤回" @click.stop="revoke">
            <Icon name="close" :size="14" />
          </button>
          <button
            type="button"
            class="danger"
            title="删除"
            aria-label="删除本地消息"
            @click.stop="delLocal"
          >
            <Icon name="trash" :size="14" />
          </button>
        </div>

        <div class="bubble" :class="{ mine, 'is-sending': message.status === 'pending' }">
          <p v-if="message.text" class="text" :class="{ 'emoji-big': bigEmoji }">{{ message.text }}</p>
          <AttachmentBubble
            v-if="message.attachment"
            :attachment="message.attachment"
            :failed="failed"
            :outgoing="mine"
            :sticker="!!message.attachment?.sticker"
            @open="(a) => emit('open', a)"
            @retry="retry"
          />
          <div class="meta">
            <time class="time" :datetime="new Date(message.createdAt).toISOString()" :title="fullTime(message.createdAt)">
              {{ timeLabel(message.createdAt) }}
            </time>
            <span v-if="mine" class="status" :class="message.status" :title="statusLabel" :aria-label="statusLabel">
              <span v-if="message.status === 'pending'" class="pending-dot" aria-hidden="true" />
              <Icon v-else-if="message.status === 'delivered'" name="check-double" :size="16" />
              <Icon v-else-if="message.status === 'sent'" name="check" :size="16" />
            </span>
          </div>
        </div>
      </div>

      <div v-if="failed && !message.attachment" class="fail-row">
        <Icon name="alert" :size="14" />
        <span>发送失败</span>
        <button type="button" class="retry" :disabled="retrying" @click.stop="retry">
          {{ retrying ? '重发中…' : '重发' }}
        </button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="menu" class="msg-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
      <button v-if="message.text" type="button" @click="copyText">
        <Icon name="copy" :size="15" /> 复制
      </button>
      <button v-if="message.attachment" type="button" @click="saveAtt">
        <Icon name="save" :size="15" /> 保存
      </button>
      <button v-if="canRevoke" type="button" @click="revoke">
        <Icon name="close" :size="15" /> 撤回
      </button>
      <button type="button" class="danger" @click="delLocal">
        <Icon name="trash" :size="15" /> 删除
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.sys-row {
  display: flex;
  justify-content: center;
  padding: var(--s-2) 0;
}
.sys {
  padding: var(--s-1) var(--s-3);
  border-radius: var(--r-full);
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  text-align: center;
  max-width: min(90%, 560px);
}

.row {
  display: flex;
  align-items: flex-end;
  gap: var(--s-2);
  margin-top: var(--s-2);
  animation: bubble-in var(--dur-fast) var(--ease);
}
.row.grouped {
  margin-top: calc(var(--s-1) / 2);
}
.row.mine {
  justify-content: flex-end;
}
.avatar-gap {
  width: var(--s-8);
  flex: none;
}

.col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: min(72%, 620px);
}
.row.mine .col {
  align-items: flex-end;
}

.bubble-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 100%;
}

.bubble {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  padding: var(--s-2) var(--s-3) var(--s-1);
  background: var(--bubble-in-bg);
  color: var(--bubble-in-text);
  border: 1px solid var(--border);
  border-radius: var(--s-1) calc(var(--r-md) + var(--s-1) / 2) calc(var(--r-md) + var(--s-1) / 2)
    calc(var(--r-md) + var(--s-1) / 2);
  min-width: 0;
  transition: opacity var(--dur-fast) var(--ease);
}
.bubble.mine {
  background: var(--bubble-out-bg);
  color: var(--bubble-out-text);
  border-color: transparent;
  border-radius: calc(var(--r-md) + var(--s-1) / 2) var(--s-1) calc(var(--r-md) + var(--s-1) / 2)
    calc(var(--r-md) + var(--s-1) / 2);
}
.bubble.is-sending {
  opacity: 0.7;
}

.text {
  margin: 0;
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  user-select: text;
}

/* 纯表情消息：放大成贴纸，气泡内留白收紧 */
.text.emoji-big {
  font-size: 44px;
  line-height: 1.15;
  padding: 2px 2px 0;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s-1);
  min-height: 16px;
  font-size: var(--fs-xs);
  line-height: var(--lh-tight);
}
.time {
  color: var(--text-muted);
}
.mine .time {
  color: var(--bubble-out-text);
}
.status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--bubble-out-text);
}
.status.failed {
  color: var(--danger);
}
.pending-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: currentColor;
  animation: pending-pulse 1s var(--ease) infinite alternate;
}

.fail-row {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  margin-top: var(--s-1);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.retry {
  min-height: 32px;
  padding: 0 var(--s-2);
  border-radius: var(--r-xs);
  color: var(--danger);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: var(--lh-base);
}
.retry:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.retry:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 悬停操作条：桌面 hover / 键盘聚焦时出现 */
.hover-actions {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--s-1));
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-2);
  opacity: 0;
  visibility: hidden;
  transform: translateY(2px);
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease),
    visibility var(--dur-fast) var(--ease);
  z-index: 3;
}
.row:not(.mine) .hover-actions {
  right: auto;
  left: 0;
}
.row:hover .hover-actions,
.bubble-wrap:focus-within .hover-actions {
  opacity: 1;
  visibility: visible;
  transform: none;
}
.hover-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--s-8);
  height: var(--s-8);
  border-radius: var(--r-xs);
  color: var(--text-muted);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.hover-actions button:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.hover-actions button.danger {
  color: var(--danger);
}

@keyframes bubble-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes pending-pulse {
  from {
    opacity: 0.35;
  }
  to {
    opacity: 1;
  }
}

/* 触屏没有 hover：隐藏悬停条，长按菜单可用 */
@media (hover: none) {
  .hover-actions {
    display: none;
  }
}

@media (pointer: coarse) {
  .retry {
    min-height: var(--touch);
    padding: 0 var(--s-3);
  }
  .msg-menu button {
    min-height: var(--touch);
  }
}

/* 长按 / 右键菜单（Teleport 到 body，scoped 样式仍生效） */
.msg-menu {
  position: fixed;
  z-index: 1200;
  min-width: 148px;
  padding: var(--s-1);
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-pop);
}
.msg-menu button {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  width: 100%;
  min-height: 34px;
  padding: 0 var(--s-3);
  border-radius: var(--r-xs);
  color: var(--text);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  text-align: left;
}
.msg-menu button:hover {
  background: var(--bg-hover);
}
.msg-menu button.danger {
  color: var(--danger);
}
</style>
