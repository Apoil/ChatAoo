/**
 * 新消息提示（三端共用，Web 端为主）：
 *  - 浏览器系统通知：窗口在后台（最小化/切到别的标签）时弹通知，点击回到对应会话
 *  - 标签标题未读角标：`(3) ChatAoo`，任何端都生效
 * 需要用户手势才能申请权限，所以权限申请放在「我 → 通知」里，由按钮触发。
 */
import { ref, watch } from 'vue'
import type { Message } from '@chataoo/shared'
import type { useChatStore } from './stores/chat'

type ChatStore = ReturnType<typeof useChatStore>
type Permission = NotificationPermission | 'unsupported'

const STORAGE_KEY = 'chataoo:notify'

/** 当前环境是否支持系统通知（部分 WebView/旧浏览器没有 Notification） */
export const notifySupported = typeof Notification !== 'undefined'
/** 用户是否启用（localStorage 记忆，默认开） */
export const notifyEnabled = ref(true)
/** 当前浏览器权限 */
export const notifyPermission = ref<Permission>(
  notifySupported ? Notification.permission : 'unsupported',
)

let store: ChatStore | null = null
let attached = false
let unsubMessage: (() => void) | null = null

function loadPreference(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) === '0') notifyEnabled.value = false
  } catch {
    /* ignore */
  }
}

function preview(m: Message): string {
  if (m.revoked) return '消息已撤回'
  if (m.attachment) {
    if (m.attachment.sticker) return '[表情]'
    const k = m.attachment.kind
    return `[${k === 'image' ? '图片' : k === 'video' ? '视频' : k === 'audio' ? '音频' : '文件'}]`
  }
  const text = (m.text ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 80 ? text.slice(0, 80) + '…' : text || '新消息'
}

function senderName(m: Message): string {
  return store?.profileOf(m.senderId)?.displayName || '新消息'
}

function show(m: Message): void {
  if (!store) return
  const me = store.session?.accountId ?? store.session?.me.userId
  if (!me || m.senderId === me || m.revoked) return
  if (!notifyEnabled.value || !notifySupported || notifyPermission.value !== 'granted') return
  // 用户就在当前页面：靠会话红点和标题角标提示，不弹系统通知
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  try {
    const n = new Notification(senderName(m), {
      body: preview(m),
      tag: m.conversationId,
      renotify: true,
    } as NotificationOptions)
    n.onclick = () => {
      window.focus()
      if (store) void store.openConversation(m.conversationId)
      try {
        n.close()
      } catch {
        /* 极少数 WebView 的 Notification 没有 close */
      }
    }
  } catch {
    /* 某些 WebView 不允许直接构造 Notification */
  }
}

function updateTitle(): void {
  let unread = 0
  for (const c of store?.conversations ?? []) unread += c.unreadCount ?? 0
  document.title = unread > 0 ? `(${unread}) ChatAoo` : 'ChatAoo'
}

function subscribe(): void {
  unsubMessage?.()
  unsubMessage = store?.session?.bus.on('message', show) ?? null
}

/** 在应用启动时调用一次（传入 pinia store） */
export function useNotifications(s: ChatStore): void {
  store = s
  loadPreference()
  if (attached) return
  attached = true
  subscribe()
  watch(() => store?.session, subscribe)
  watch(
    () => (store?.conversations ?? []).map((c) => c.unreadCount ?? 0).join(','),
    updateTitle,
    { immediate: true },
  )
}

/** 申请通知权限（必须在用户点击等手势里调用） */
export async function enableNotifications(): Promise<Permission> {
  if (!notifySupported) return 'unsupported'
  try {
    const p = await Notification.requestPermission()
    notifyPermission.value = p
    if (p === 'granted') setNotificationsEnabled(true)
    return p
  } catch {
    return notifyPermission.value
  }
}

/** 开关通知（不改浏览器权限，只决定是否弹） */
export function setNotificationsEnabled(on: boolean): void {
  notifyEnabled.value = on
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}
