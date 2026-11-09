/**
 * 表情包数据与工具函数（三端共用）。
 * 不依赖图片资源：使用 unicode emoji，离线可用、无需上传服务器。
 */

export interface EmojiCategory {
  key: string
  name: string
  emojis: string[]
}

/** 「最近使用」tab 的 key */
export const EMOJI_RECENT = 'recent'
/** localStorage 键 */
export const EMOJI_RECENT_KEY = 'chataoo:emoji-recent'
/** 最近使用最多保留多少个 */
export const EMOJI_RECENT_MAX = 24

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    key: 'common',
    name: '常用',
    emojis: [
      '😀', '😄', '😁', '😆', '😊', '🙂', '😉', '😍', '🥰', '😘',
      '😜', '🤪', '🤔', '🤨', '😐', '😴', '😮', '😢', '😭', '😡',
      '🥺', '😅', '🤣', '😇', '👍', '🙏', '🎉', '❤️',
    ],
  },
  {
    key: 'mood',
    name: '心情',
    emojis: [
      '😃', '😆', '😅', '😂', '🙃', '😊', '😇', '🥰', '😘', '😗',
      '😋', '😛', '😝', '🤗', '🤭', '🤫', '🤐', '🤨', '😐', '😑',
      '😶', '😏', '😒', '🙄', '😬', '😯', '😲', '😳', '🥺', '😦',
      '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😞', '😔', '😕',
    ],
  },
  {
    key: 'gesture',
    name: '手势',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '👐',
      '🤲', '🤝', '🙏', '💪', '👋', '🤙', '👈', '👉', '👆', '👇',
      '☝️', '✋', '🤚', '🖐️', '🖖', '🫶',
    ],
  },
  {
    key: 'object',
    name: '物件',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕',
      '💞', '💓', '💗', '💖', '✨', '⭐', '🌟', '💫', '🔥', '💧',
      '🎉', '🎊', '🎁', '🎂', '☕', '🍺', '🍎', '🍉', '🌹', '🌸',
      '🌻', '🌈', '☀️', '🌙', '☁️', '⚡',
    ],
  },
]

/** 读取最近使用的 emoji（容忍 localStorage 不可用/数据损坏） */
export function loadRecentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(EMOJI_RECENT_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.filter((x): x is string => typeof x === 'string').slice(0, EMOJI_RECENT_MAX)
  } catch {
    return []
  }
}

/** 记录一次使用，返回更新后的列表（最新在前、去重、限量） */
export function pushRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...loadRecentEmoji().filter((x) => x !== emoji)].slice(0, EMOJI_RECENT_MAX)
  try {
    localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式/配额不足时忽略 */
  }
  return next
}

const EMOJI_CHAR = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/u

/**
 * 判断一条文本是否"只是 emoji"（≤ maxCount 个），用于气泡里放大成贴纸效果。
 * 用 grapheme 切分，避免把 ❤️ / 👍🏻 / 👨‍👩‍👧 这类组合拆坏。
 */
export function isEmojiOnly(text: string, maxCount = 3): boolean {
  const t = text.trim()
  if (!t) return false
  let units: string[]
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    units = [...seg.segment(t)].map((s) => s.segment)
  } catch {
    units = [...t]
  }
  if (units.length === 0 || units.length > maxCount) return false
  return units.every((u) => EMOJI_CHAR.test(u))
}
