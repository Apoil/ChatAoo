# ChatAoo 架构说明

## 总体设计

```
┌─────────────┐   HTTP/WS (在线)   ┌──────────────┐
│ 桌面端       │ ◄───────────────► │  同步服务器   │
│ (Electron)  │                    │  Fastify+WS  │
└──────┬──────┘                    │  node:sqlite │
       │  UDP 组播 + TCP (断网可用)  │  文件存储     │
┌──────┴──────┐                    └──────────────┘
│ 手机/平板端  │ ◄────── 局域网点对点 ──────► │ 桌面端/其他设备
│ (Capacitor) │
└─────────────┘
```

三层职责：

| 层 | 包 | 职责 |
|---|---|---|
| 协议层 | `@chataoo/shared` | 数据模型、线上/线下线协议、ED25519 身份、常量 |
| 服务器 | `@chataoo/server` | 账号注册、好友关系、消息持久化与增量同步、WebSocket 实时推送、文件/头像存储与 Range 流 |
| 客户端核心 | `@chataoo/app-core` | 离线优先存储、同步引擎、LAN 发现管理器、会话编排（与 UI 框架无关） |
| 界面层 | `@chataoo/ui` + desktop/mobile | 共享 Vue 组件与主题；两端各自装配平台桥 |

## 离线优先数据流

1. **写路径**：用户发送消息 → 立即写入本地 IndexedDB（状态 `pending`）→ 加入 outbox →
   局域网好友在线则同时 P2P 投递 → 服务器在线则推送 outbox（成功置 `sent`，消息 ID 全局唯一，服务器幂等去重）。
2. **读路径**：会话与消息永远从本地读取；首次打开会话且在线时向服务器拉取历史。
3. **同步**：服务器为每条消息分配全局单调 `seq`；客户端保存 `serverSeq` 游标，
   周期拉取 `GET /api/v1/sync?since=` 增量；WebSocket 提供实时推送与在线状态。
4. **断网回补**：离线期间产生的本地消息保留在 outbox；恢复联网后自动推送。
   局域网收到的他人消息也存入本地（其副本最终由发送方上传服务器，接收方靠 ID 去重）。
5. **媒体**：附件/头像按内容 SHA-256 缓存（桌面 `userData/media`，移动 `FilesDir/media`），
   展示时本地缓存优先 → 服务器 URL 兜底 → 后台自动下载补齐，断网后历史媒体仍可打开。

## 身份与安全

- 首次启动生成 ED25519 密钥对；`userId = "u_" + sha256(pubKey)[:20]`，私钥仅存本机。
- 服务器注册时校验 `userId` 与公钥派生一致；身份无需服务器即可生成。
- LAN 信标携带签名（`sig = sign(priv, userId|displayName|nonce|ts)`），
  接收方验签 + 时间窗 + 好友门控，防止伪造与重放。

## 局域网点对点

- **发现**：UDP 组播 `239.255.42.77:47777`（管理员组播段，路由器默认不转发，天然限定单子网）。
  Android 需 `MulticastLock`（自定义 Capacitor 插件实现）。
- **传输**：TCP `47778`，JSON 行帧（每行一条 `P2PMsg`）。
- **协议**（`shared/src/protocol.ts`）：`hello`（双向身份确认）、`message`、`ack`、
  `file-meta / file-data / file-done`（分块传输，64KB base64 块）、`typing`、`bye`。
- **门控**：信标与入站连接都校验"互为好友"，非好友直接忽略/断开。
- 桌面端在主进程用 `node:dgram` / `node:net` 实现，经 preload IPC 桥接渲染进程；
  移动端为 Kotlin 原生插件 `@chataoo/lan-socket`（DatagramSocket + ServerSocket + MulticastLock）。

## 服务器设计

- Fastify 5 + `@fastify/websocket` + `@fastify/multipart`；数据库为 Node 24 内置
  `node:sqlite`（零原生依赖；不用 WAL 以规避 Windows 跨进程读一致性问题）。
- REST：`/api/v1/auth/*`、`/friends/*`、`/messages`、`/sync`、`/files`、`/avatar`。
- 文件下载支持 HTTP Range（206），视频可拖动进度；头像 URL 不带扩展名，
  按 `userId.` 前缀扫描磁盘文件。
- WebSocket：连接后首条消息 `{type:'auth', token}` 认证；推送消息/回执/资料/好友/在线状态。
- 关键实现细节：消息 POST 幂等（同 ID 返回已有 seq）；好友关系双向行；
  `friendStatus(a,b)` 双向查询；同步仅返回涉及当前用户的消息。

## 客户端核心（app-core）

- `LocalStore`：IndexedDB（idb）封装 —— kv / 会话 / 消息 / 资料 / 好友 / outbox / 游标。
- `SyncEngine`：账号注册/登录、outbox 推送（失败重试上限）、增量拉取、WS 实时、断线重连。
- `LanManager`：信标验签 → 好友门控 → 对端表（超时淘汰）→ 自动建连 → 消息/文件收发。
- `ChatSession`：面向 UI 的门面（发消息、发附件、头像、资料、历史分页、在线状态），
  通过类型化事件总线 `Bus` 向 UI 层发布事件。

## 界面（ui 包）

- 暗色 Telegram 风格主题（CSS 变量，`theme.css`）。
- 组件：Avatar（离线缓存头像）、ConversationItem、MessageList/MessageBubble/AttachmentBubble
  （图片/视频/音频/文件）、ChatInput、AvatarCropper（cropperjs 裁剪）、FriendItem、AddFriendBox、
  SettingsPanel、MediaViewer。
- `useChatStore`（Pinia）：把 `Bus` 事件镜像为响应式状态，两端共用同一套逻辑。

## 平台桥

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| 本地数据库 | IndexedDB（渲染进程） | IndexedDB（WebView） |
| 媒体缓存 | 主进程 `userData/media` + `chataoo-media://` 协议 | Capacitor Filesystem（file:// 直读） |
| LAN 传输 | 主进程 dgram/net + IPC | 原生 Kotlin 插件（MulticastLock） |
| 保存文件 | 系统另存为对话框 | 浏览器下载 |

## 构建产物

- 桌面：`packages/desktop/release/ChatAoo-Setup-*.exe`（NSIS 安装包）
- 移动：`packages/mobile/android/app/build/outputs/apk/`（同一 APK 自适应手机/平板）
- 图标：`scripts/generate-icons.mjs` 程序化生成（零依赖 PNG/ICO/Android 自适应图标）
