# ChatAoo

局域网点对点 + 离线优先的多端聊天应用（类 Telegram / 微信 / QQ）。

![logo](assets/icons/icon-256.png)

## 核心特性

- **多端**：Windows 桌面端（Electron + Vue 3）、Android 手机端、Android 平板端（Capacitor + Vue 3，自适应布局）
- **局域网点对点**：UDP 组播信标自动发现同一局域网内的设备（ED25519 签名验证 + 好友白名单门控），
  **完全断网（无互联网）时互为好友的设备之间仍可互发消息与文件**
- **离线优先**：所有消息/资料/媒体默认先存本地（IndexedDB + 本地媒体缓存），断网不断档；
  离线期间产生的数据（含局域网收到的消息）恢复联网后自动同步到服务器（消息 ID 幂等去重）
- **富媒体**：图片 / 视频 / 普通文件上传与在线播放（服务器 Range 流式传输，视频可拖动进度）；
  头像上传支持**裁剪选区**（cropperjs）
- **安全身份**：每台设备生成 ED25519 密钥对，用户 ID 由公钥派生；局域网信标带签名，防伪造防重放
- **实时**：WebSocket 实时推送消息与在线状态；断线自动重连

## 仓库结构

```
packages/
├── shared/     # 协议、类型、加密身份（ED25519）、常量 —— 所有端共用
├── server/     # 同步服务器：Fastify + WebSocket + SQLite + 文件存储（Range 视频流）
├── app-core/   # 跨端业务核心：本地存储、同步引擎、LAN 发现管理器、会话编排
├── ui/         # 共享 Vue 组件与主题（消息气泡、头像裁剪、视频播放、好友/会话列表）
├── desktop/    # Windows 桌面端（Electron 主进程 + Vite/Vue 渲染进程）
└── mobile/     # Android 手机/平板端（Capacitor + 自研 UDP/TCP 原生插件）
scripts/        # 图标生成器（纯 Node 零依赖）
assets/icons/   # 生成的应用图标（PNG/ICO/Android 自适应）
```

## 快速开始

### 0. 环境要求

- Node.js ≥ 20.19（推荐 22+）
- pnpm ≥ 10
- 构建 Android APK 需要：JDK 21 + Android SDK（或 Android Studio）；
  已内置 `android/gradle-init.gradle`（阿里云 Maven 镜像，大陆网络直连
  Maven Central / dl.google.com 的 Java TLS 常被中断时自动生效），
  无需手动配置镜像。`android/gradle.properties` 中的
  `org.gradle.java.installations.paths` 为本机路径，其他机器按需修改或删除。

### 1. 安装依赖并构建

```bash
pnpm install
pnpm build          # 按拓扑顺序构建所有包
```

### 2. 启动同步服务器

```bash
pnpm dev:server     # 监听 0.0.0.0:47800，数据存 packages/server/data
```

### 3. 运行桌面端

```bash
pnpm dev:desktop    # 开发模式（Vite + Electron 热更新）
# 或构建安装包：
pnpm dist:desktop   # 产出 release/ChatAoo-Setup-0.1.0.exe
```

桌面端默认连接 `http://127.0.0.1:47800`，可在开发者工具中修改
`localStorage.chataoo:serverUrl` 指向你的服务器地址后重启。

### 4. Android 手机 / 平板

```bash
pnpm --filter @chataoo/mobile cap:sync     # 构建 Web 资源并同步到 Android 工程
pnpm --filter @chataoo/mobile cap:open     # 用 Android Studio 打开并运行/打包
# 或命令行直接构建 APK（需 JDK + Android SDK）：
pnpm android:build                          # 产出 android/app/build/outputs/apk/debug/app-debug.apk
```

> 手机与平板使用同一 APK：宽度 ≥ 720dp 自动切换为双栏布局（平板），否则单栏（手机）。

移动端默认连接 `http://192.168.1.146:47800`（局域网内服务器地址），
可在 `packages/mobile/src/main.ts` 中修改，或写入 `localStorage.chataoo:serverUrl`。

## 使用流程

1. 首次打开 → **登录/注册页**：注册（用户名 + 密码 + 昵称）或登录已有账号；
   支持修改服务器地址（桌面端在登录页，移动端同）
2. 登录成功后自动记住登录状态 —— 之后**完全断网也能直接进入**（离线模式，
   局域网点对点功能正常）；完全离线的首次使用无法登录
3. 「我的」页：点击头像 → 裁剪更换头像；可修改昵称、复制用户 ID、退出登录
4. 把**用户名**（3-20 位，比 ID 短得多）告诉朋友 → 「好友」页输入对方用户名添加 → 对方点「通过」
5. 同一局域网且互为好友的设备会自动出现在「好友」页（显示"局域网在线"），
   断网也能直接聊天、传文件
6. 服务器在线时消息实时同步；断网时本地优先，回连后自动补齐

> 账号绑定首次注册的设备身份；同账号在新设备登录会自动重绑定到新设备
> （旧设备登录状态失效，旧设备上的历史数据保留但不再关联）。

## 局域网发现协议

- 每台设备周期广播 UDP 组播信标（`239.255.42.77:47777`）：
  `{v, userId, publicKey, displayName, nonce, ts, sig}`，签名 = ED25519(私钥, userId|displayName|nonce|ts)
- 接收方：验签 → 校验 userId 与公钥派生一致 → 查本地好友表 → **只有好友**才建立 TCP 连接
- P2P 通道：TCP `47778` 端口，JSON 行协议（消息 / 确认 / 文件分块传输）
- 同一身份密钥永久有效，无需服务器即可互相验证

## 技术栈

Vue 3 · TypeScript · Vite · Pinia · Electron · Capacitor · Fastify · node:sqlite ·
IndexedDB(idb) · @noble/ed25519 · cropperjs · electron-builder

## 已知边界（后续迭代方向）

- 当前为单服务器模型，好友关系与消息经由一台同步服务器协调
- 消息暂未做端到端加密（身份签名已就绪，可平滑升级）
- 局域网视频为"先传完整文件再播放"，服务器在线时支持 Range 边下边播
- 已读回执 / 群聊 / 语音消息 / 消息搜索 尚未实现

## License

MIT © [Hina_MRZ (Apoil)](https://github.com/Apoil)

本项目为开源软件，采用 [MIT License](LICENSE)：允许自由使用、修改、分发与商用，
但**必须保留原始版权与许可声明**（注明源作者 Hina_MRZ / Apoil）。
