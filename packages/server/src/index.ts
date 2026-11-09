/**
 * ChatAoo 同步服务器入口。
 *   - REST：认证 / 好友 / 消息 / 同步 / 文件（Range 视频流）
 *   - WebSocket：实时消息推送 / 在线状态
 * 用法：CHATAOO_PORT=47800 CHATAOO_DATA=./data pnpm --filter @chataoo/server start
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import { APP_VERSION_LABEL, type ClientToServer, type ServerToClient } from '@chataoo/shared'
import { openDb } from './db.js'
import { Hub } from './hub.js'
import { authHook, registerRoutes } from './routes.js'

const PORT = Number(process.env.CHATAOO_PORT ?? 47800)
const HOST = process.env.CHATAOO_HOST ?? '0.0.0.0'
// 数据目录默认固定在包目录下（不依赖 cwd，避免 tsx/pnpm 的 cwd 差异导致开错库）
const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.CHATAOO_DATA
  ? (isAbsolute(process.env.CHATAOO_DATA) ? process.env.CHATAOO_DATA : resolve(process.cwd(), process.env.CHATAOO_DATA))
  : join(PKG_DIR, '..', 'data')

const app = Fastify({ logger: true, bodyLimit: 4 * 1024 * 1024 })
app.log.info({ dataDir: DATA_DIR }, 'initializing')
const db = openDb(DATA_DIR)
const hub = new Hub()

// 网页版静态资源（packages/web/dist）。未构建时只提供 API，不报错。
const WEB_DIR = process.env.CHATAOO_WEB_DIR
  ? (isAbsolute(process.env.CHATAOO_WEB_DIR) ? process.env.CHATAOO_WEB_DIR : resolve(process.cwd(), process.env.CHATAOO_WEB_DIR))
  : join(PKG_DIR, '..', '..', 'web', 'dist')
const HAS_WEB = existsSync(join(WEB_DIR, 'index.html'))

await app.register(cors, { origin: true })
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } })
await app.register(websocket)
if (HAS_WEB) {
  await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/', index: ['index.html'] })
  app.log.info({ webDir: WEB_DIR }, 'serving web client')
} else {
  app.log.warn({ webDir: WEB_DIR }, 'web client not built; API only')
}

authHook(app, db)
registerRoutes(app, { db, hub, dataDir: DATA_DIR })

/* ---------------- WebSocket 实时通道 ---------------- */

app.get('/api/v1/ws', { websocket: true }, (socket, req) => {
  let authed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const authTimer = setTimeout(() => {
    if (!authed) {
      socket.send(JSON.stringify({ type: 'auth-fail', reason: 'timeout' } satisfies ServerToClient))
      socket.close()
    }
  }, 10000)

  socket.on('message', (raw) => {
    let msg: ClientToServer
    try {
      msg = JSON.parse(String(raw)) as ClientToServer
    } catch {
      return
    }
    if (msg.type === 'auth') {
      const userId = db.userForToken(msg.token)
      if (!userId) {
        socket.send(JSON.stringify({ type: 'auth-fail', reason: 'invalid token' } satisfies ServerToClient))
        socket.close()
        return
      }
      authed = true
      clearTimeout(authTimer)
      socket.send(
        JSON.stringify({
          type: 'hello',
          serverTime: Date.now(),
          serverSeq: db.maxSeq(),
        } satisfies ServerToClient),
      )
      socket.send(JSON.stringify({ type: 'auth-ok' } satisfies ServerToClient))
      hub.add(userId, socket)
      hub.sendPresenceSnapshot(userId)
      hub.broadcastPresence(userId)
      // 反向代理（Cloudflare Tunnel / Nginx）对空闲 WebSocket 有 ~100s 超时，
      // 定期发 ping 控制帧保活；浏览器会自动回 pong，无需客户端改动
      heartbeat = setInterval(() => {
        try {
          socket.ping()
        } catch {
          /* socket 已关闭，close 事件会清理 */
        }
      }, 25000)
      return
    }
    if (!authed) return
    if (msg.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', t: msg.t } satisfies ServerToClient))
    }
  })

  socket.on('close', () => {
    clearTimeout(authTimer)
    if (heartbeat) clearInterval(heartbeat)
  })
})

app.get('/health', async () => ({ ok: true, version: APP_VERSION_LABEL, time: Date.now() }))

/* ---------------- 网页版：SPA 回退 ---------------- */

if (HAS_WEB) {
  app.get('/', (_req, reply) => reply.sendFile('index.html'))
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0] ?? '/'
    if (req.method === 'GET' && !url.startsWith('/api/') && !url.startsWith('/files/')) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.code(404).send({ error: 'not found' })
  })
}

try {
  mkdirSync(join(DATA_DIR, 'files', 'm'), { recursive: true })
  mkdirSync(join(DATA_DIR, 'files', 'a'), { recursive: true })
  await app.listen({ port: PORT, host: HOST })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

const shutdown = async () => {
  app.log.info('shutting down')
  await app.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
