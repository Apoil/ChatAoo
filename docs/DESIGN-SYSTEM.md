# ChatAoo 设计系统 v2（明暗双主题）

> 本文件是 2026-11 全量 UI 重设计的唯一事实来源。所有 UI 改动先对照这里；
> 与实现冲突时以本文件为准，或提案修改本文件后再改代码。

## 1. 方向

- **目标**：一套代码同时服务 Windows 桌面端（Electron）与 Android 手机/平板（Capacitor），
  视觉统一、但布局按设备各自最优。
- **气质**：干净、克制、信息优先。深灰/浅灰分层 + 单一品牌蓝强调色；不使用渐变光效、
  不做「AI 感」超大圆角与霓虹色。
- **双主题**：`light` / `dark`，默认跟随系统，用户可手动切换并持久化。
- **动效**：只用于反馈（hover/active/展开），120–200ms，尊重 `prefers-reduced-motion`。

## 2. Token

全部定义在 [`packages/ui/src/theme.css`](../packages/ui/src/theme.css)。

**硬性规则**

1. 组件 CSS 里**禁止**写死颜色、圆角、间距数值；只能 `var(--xxx)`。
2. 需要新颜色/尺寸 → 先在 `theme.css` 添加语义 token（Lead 统一维护），再使用。
3. 文字对比度：正文 ≥ 4.5:1，次要信息 ≥ 4.5:1（用 `--text-muted`），禁用 `--text-faint` 承载关键信息。
4. 触控目标（手机）≥ 44×44px；桌面可 32–38px，但列表行整体可点。
5. 中文字段行高 ≥ 1.5（`--lh-base`），标题可用 `--lh-tight`。
6. 所有可聚焦元素提供 `:focus-visible` 环（已由全局样式兜底，自定义组件不要 `outline:none` 裸奔）。

**关键变量**

| 类别 | 变量 |
| --- | --- |
| 表面 | `--bg-app` `--bg-panel` `--bg-elev` `--bg-sunken` `--bg-input` `--bg-hover` `--bg-active` `--bg-chat` `--bg-scrim` |
| 文字 | `--text` `--text-muted` `--text-faint` `--text-inverse` |
| 强调 | `--accent`（文字/描边/高亮）`--accent-solid`（实心按钮底）`--accent-hover` `--accent-contrast` `--accent-soft` `--accent-border` |
| 气泡 | `--bubble-in-bg` `--bubble-in-text` `--bubble-out-bg` `--bubble-out-text` |
| 状态 | `--success` `--warning` `--danger` `--info` |
| 尺度 | `--s-1..--s-10`（4/8/12/16/20/24/32/40）`--r-xs/sm/md/lg/full` `--fs-xs..--fs-2xl` |
| 布局 | `--titlebar-h: 44px` `--rail-w: 68px` `--list-w: 312px` `--dock-h: 62px` `--fab: 56px` `--touch: 44px` `--chat-head-h: 62px` |
| 阴影 | `--shadow-1` `--shadow-2` `--shadow-pop` |

**主题 API**（`packages/ui/src/theme.ts`）

```ts
import { initTheme, useTheme } from '@chataoo/ui'
initTheme()                       // 应用启动时调用一次
const { mode, resolved, setMode, cycle } = useTheme()
// mode: 'system' | 'light' | 'dark'；resolved: 'light' | 'dark'
// 桌面标题栏：THEME_CHROME[resolved] -> { color, symbolColor }
```

## 3. 布局

### 3.1 桌面端（窗口 ≥ 940×600，登录窗 440×640）

```
┌─────────────────────────────── 44px 自定义标题栏（-webkit-app-region: drag）───────────────┐
│ [logo ChatAoo]                                          （右侧留给系统窗口按钮覆盖层）        │
├──────┬────────────────────────────┬────────────────────────────────────────────────────┤
│ rail │ 列表栏 312px                │ 会话区                                              │
│ 68px │ ┌ 标题 + 搜索框 + 新建 ────┐ │ ┌ 会话头 62px：头像 名称 状态 | 右侧操作 ──────────┐ │
│      │ │ 会话/好友/我 列表项      │ │ │ 消息列表（滚动）                                │ │
│      │ │ 选中态 = accent-soft     │ │ ├ 输入区：附件 / 文本框 / 发送 ──────────────────┤ │
│ ⚙    │ └──────────────────────────┘ │ └────────────────────────────────────────────────┘ │
└──────┴────────────────────────────┴────────────────────────────────────────────────────┘
```

- **标题栏**：44px，`--bg-app` 背景（与 `THEME_CHROME` 原生覆盖层颜色一致，避免右上角 138px
  系统按钮区出现色差竖条），左侧品牌（logo 20px + "ChatAoo"，600 字重，`--text-muted`）；
  中部可放当前会话名（可选）；整条是拖拽区，内部交互元素加 `no-drag`。
- **rail（68px）**：垂直图标导航——会话、联系人、我；底部：设置（齿轮）、主题切换（明/暗/系统图标）。
  选中态：`--accent-soft` 底 + `--accent` 图标，左侧 3px 指示条。
- **列表栏（312px）**：顶部 56px 放「标题 + 搜索输入 + 新建按钮」；搜索为 `--bg-input` 圆角 10px，
  带 search 图标；下方列表项 68px 高：头像 44px、名称 15px/600、摘要 13px/`--text-muted`、右侧时间/未读。
- **会话区**：头部 62px（头像 36px + 名称 + 在线/局域网状态点）；消息区 `--bg-chat`；输入区贴底 68px，
  `--bg-panel` 背景、上方 1px `--border`。
- **空状态**：居中插画位用 Icon（48px，`--text-faint`）+ 一行说明 + 可选按钮。

### 3.2 Android 手机（< 720dp）

```
┌──────────────────────────┐
│ 顶部应用栏 56px：标题 / 搜索 / 更多 │
├──────────────────────────┤
│ 列表（会话 / 联系人 / 我）        │
│                          │
│                    (＋) FAB 56px │
├──────────────────────────┤
│ 底部标签栏 62px：聊天 联系人 我   │  ← 含 env(safe-area-inset-bottom)
└──────────────────────────┘
```

- **底部标签栏**：3 个标签（聊天/联系人/我），图标 24px + 11px 文字；选中 `--accent`；高度 62px + 安全区。
- **FAB**：仅在「聊天」标签显示，`--accent-solid` 底、白图标、`--shadow-2`，右下角距 16px，
  在标签栏之上（bottom = dock + 16）。点击 → 打开添加好友/新建会话。
- **聊天页**：进入后全屏覆盖列表区（隐藏标签栏），顶部 56px 带返回箭头 + 对方头像/名称 + 更多；
  输入区贴底并避让键盘。
- 所有可点区域 ≥ 44px；列表行 72px。

### 3.3 平板 / 宽屏（≥ 720dp）

两栏：左侧列表 320px + 右侧会话区；无 rail、无底部标签栏；其余同手机。

## 4. 组件规格（逐文件）

> 通用：保留现有 `props` / `emits` / `v-model` 契约，只做视觉与结构升级；确需新增 prop 用**可选**形式。
> 所有组件 `<style scoped>`，只引用 token。

### LoginView.vue（登录/注册）
- 440×640 小窗优先：单列，最大宽 340px 居中；顶部 logo 56px + 产品名；副标题一行 `--text-muted` 13px。
- 分段控件（登录 / 注册）：`--bg-input` 底、圆角 full、内部胶囊选中项 `--bg-panel` + `--shadow-1`。
- 输入框 44px 高，label 12px/600 `--text-muted`；密码框内置右侧眼睛图标切换明文。
- 主按钮 44px 高、full 宽、`--accent-solid`。
- 「服务器地址」折叠区：文字按钮 + 展开后输入框（mono 字体、13px）；显示当前生效地址。
- 错误提示：`--danger` 12px，出现在表单下方，不跳动布局（预留 min-height）。
- 底部版本号 `--text-faint` 11px 居中。

### ProfilePage.vue（「我」页）
- 顶部：头像 88px（可点 → 裁剪），右侧昵称 20px/700 + 用户名 pill + ID（复制按钮）。
- 卡片分组（`--bg-elev` + 1px border + r-md）：账号信息、主题（明/暗/系统三选一分段）、
  服务器地址（只读 + 复制）、退出登录（danger 文字按钮，底部）。
- 手机端：整页滚动，分组卡片间距 12px。

### SettingsSheet.vue（新）
- 桌面：从右侧滑入的面板 360px；手机：底部抽屉（圆角上沿 18px，拖拽条 36×4）。
- 内容：主题模式（system/light/dark 分段）、服务器地址（可编辑 + 应用按钮）、
  关于（版本、MIT 协议、GitHub 链接按钮）、退出登录。
- Props：`open: boolean`；Emits：`close`。通过 `useChatStore()` 读取 `session`。

### EmptyState.vue（新）
- Props：`icon?: IconName`（默认 `chat`）、`title: string`、`hint?: string`；默认插槽放按钮。
- 图标 44px `--text-faint`，标题 15px/600，说明 13px `--text-muted`，整体垂直居中。

### ConversationItem.vue
- 68px 行：头像 44px（右下在线点 10px + 2px `--bg-panel` 描边）；
  名称 15px/600 与摘要 13px 两行；右侧列：时间 12px `--text-faint` + 未读数（`--accent-solid` 底、18px 高、r-full）。
- 选中：`--bg-active`；hover：`--bg-hover`；focus-visible 用全局环。

### FriendItem.vue
- 56–64px 行：头像 40px、名称 15px、副标题（用户名/局域网在线）；右侧动作按钮（添加/通过/发消息）。
- 「局域网在线」用 `--lan` 或 `--success` 圆点 + 11px 文字。

### AddFriendBox.vue
- 桌面：内联小卡片；手机：抽屉样式（由外壳决定容器）。输入 42px + 主按钮；结果提示区分
  success / danger / muted 三态。

### MessageList.vue
- 滚动容器 `--bg-chat`；消息按日期分组；分组标签居中 pill（11px、`--bg-input`、`--text-muted`）。
- 底部自动滚动；新消息淡入 120ms。

### MessageBubble.vue
- 自己：`--bubble-out-bg` + `--bubble-out-text`，圆角 16px（贴边角 4px）；
  对方：`--bubble-in-bg` + `--bubble-in-text` + 1px `--border`。
- 气泡最大宽 min(72%, 620px)；正文 14px/1.5；时间 11px（自己气泡用 80% 白、对方 `--text-faint`），
  已读/发送中用 check / check-double 16px。
- 状态：发送中（30% 透明）、失败（红色感叹 + 重发按钮）。
- 悬停（桌面）出现操作条：复制/删除/保存（浮在气泡上方，`--bg-elev` + `--shadow-2`）。

### AttachmentBubble.vue
- 图片：圆角 14px、最大 320×320、hover 轻微放大 1.02；视频封面带播放按钮（48px 圆形半透明）；
  文件：图标 + 名称/大小 + 下载按钮，宽 260–320。
- 上传进度条 `--accent`；失败红字 + 重试。

### ChatInput.vue
- 容器 68px（手机 60px），居中最大宽 980px；内部：附件按钮 40px、文本框（多行自适应 20–120px）、
  发送按钮 40px 圆形（有内容时 `--accent-solid`，空时 `--accent-soft`）。
- Enter 发送、Shift+Enter 换行；附件菜单用 Popover（`--bg-elev` + `--shadow-pop`）：图片 / 文件。
- 拖拽上传高亮：整块虚线 `--accent-border`。

### VideoPlayer.vue
- 播放器圆角 14px，黑底；控制条浮层：播放/暂停、进度（`--accent` 已播放）、时间、音量、保存。
- 触摸目标 ≥ 40px；自动隐藏控制条 3s。

### MediaViewer.vue
- 全屏 `rgba(0,0,0,.86)` 遮罩；图片 contain + 双击缩放；顶部操作条（关闭/保存/复制）；Esc 关闭。

### Avatar.vue
- 圆形，尺寸 prop；无图时用 `--accent-soft` 底 + `--accent` 首字母（中文取首字，英文取首字母大写）。
- 在线点：右下 10px + 2px 描边（`--bg-panel`）。

### AvatarCropper.vue
- 复用 `.avatar-crop-modal/.avatar-crop-card`（已在 theme.css 定义）；
  底部按钮：重置 / 取消 / 保存（主按钮）；裁剪 320×320 视窗，r-md。

## 5. 外壳要求

### 桌面 `packages/desktop/src/App.vue`
1. `initTheme()` 于 `main.ts` 启动时调用；标题栏覆盖层颜色随主题变化：
   `win.setThemeOverlay(THEME_CHROME[resolved])`（新增 IPC，见下）。
2. 登录态切换窗口尺寸保持现有行为（`win.resize('login' | 'chat')`）。
3. 顶栏 44px 可拖拽；右侧留出 138px 给系统按钮（`titleBarOverlay` 宽度）。

### 桌面主进程 `packages/desktop/electron/main.ts` + `preload.cjs`
- 新增 IPC `win:set-theme`：`win.setTitleBarOverlay({ color, symbolColor, height: 44 })` +
  `win.setBackgroundColor(color)`；preload 暴露 `win.setThemeOverlay({ color, symbolColor })`。

### 手机 `packages/mobile/src/App.vue`
1. `initTheme()`；`<meta name="theme-color">` 由 theme.ts 自动同步。
2. 底部标签栏 + FAB + 全屏聊天页；`env(safe-area-inset-bottom)` 适配。
3. 返回键（Android 物理返回）行为：聊天页 → 列表；抽屉打开 → 关闭。

## 6. 验收

- `pnpm -r typecheck` 全绿；`pnpm build` 通过。
- 桌面端启动截图正常、无白屏；手机端 APK 构建通过。
- `design_audit`（预览页）无严重对比度/触控尺寸告警；中文字段行高 ≥ 1.5。
- 明/暗两套主题都要看：登录页、会话列表、会话区、（手机）我页。
