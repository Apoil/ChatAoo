/**
 * ChatAoo 同步服务器入口。
 *   - REST：认证 / 好友 / 消息 / 同步 / 文件（Range 视频流）
 *   - WebSocket：实时消息推送 / 在线状态
 * 用法：CHATAOO_PORT=47800 CHATAOO_DATA=./data pnpm --filter @chataoo/server start
 */
import { mkdirSync } from 'node:fs'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
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

await app.register(cors, { origin: true })
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } })
await app.register(websocket)

authHook(app, db)
registerRoutes(app, { db, hub, dataDir: DATA_DIR })

/* ---------------- WebSocket 实时通道 ---------------- */

app.get('/api/v1/ws', { websocket: true }, (socket, req) => {
  let authed = false
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
      return
    }
    if (!authed) return
    if (msg.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', t: msg.t } satisfies ServerToClient))
    }
  })

  socket.on('close', () => {
    clearTimeout(authTimer)
  })
})

app.get('/health', async () => ({ ok: true, version: APP_VERSION_LABEL, time: Date.now() }))

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
