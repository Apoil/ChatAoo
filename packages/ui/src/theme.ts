/**
 * ChatAoo 主题管理：'system' | 'light' | 'dark'
 * - 解析结果写入 html[data-theme]，CSS 变量随之切换
 * - 用户选择持久化在 localStorage（chataoo:theme）
 * - 系统主题变化时自动跟随（仅 system 模式）
 * - 同步 <meta name="theme-color">（Android 状态栏 / 浏览器 UI）
 */
import { computed, ref } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'chataoo:theme'

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* SSR / 隐私模式 */
  }
  return 'system'
}

function media(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || !window.matchMedia) return undefined
  return window.matchMedia('(prefers-color-scheme: dark)')
}

const mode = ref<ThemeMode>(readMode())
const systemDark = ref<boolean>(media()?.matches ?? false)
const resolved = computed<ResolvedTheme>(() =>
  mode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : mode.value,
)

/** 当前主题解析结果对应的原生窗口颜色（桌面端标题栏覆盖层用） */
export const THEME_CHROME = {
  light: { color: '#f2f5fa', symbolColor: '#101828' },
  dark: { color: '#0c1017', symbolColor: '#e9eef8' },
} as const

function apply(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // 'system' 时移除属性，交给 CSS 的 prefers-color-scheme 分支；同时显式写上解析值，
  // 保证系统主题变化瞬间不会闪回默认色。
  root.setAttribute('data-theme', resolved.value)
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
  if (meta) meta.content = resolved.value === 'dark' ? '#0c1017' : '#f2f5fa'
}

let started = false

/** 在应用启动时调用一次。幂等。 */
export function initTheme(): void {
  if (started) return
  started = true
  apply()
  const mq = media()
  if (mq) {
    const onChange = (e: MediaQueryListEvent) => {
      systemDark.value = e.matches
      apply()
    }
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange) // 老 WebView 兼容
  }
}

export function setThemeMode(next: ThemeMode): void {
  mode.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* 忽略配额/隐私错误 */
  }
  apply()
}

/** 在 light → dark → system 间循环（用于快捷切换按钮） */
export function cycleThemeMode(): ThemeMode {
  const order: ThemeMode[] = ['light', 'dark', 'system']
  const next = order[(order.indexOf(mode.value) + 1) % order.length]!
  setThemeMode(next)
  return next
}

export function useTheme() {
  return { mode, resolved, setMode: setThemeMode, cycle: cycleThemeMode }
}
