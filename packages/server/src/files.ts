/**
 * 文件存储：上传（流式 + 增量 SHA-256）、下载（支持 HTTP Range，视频可拖动进度）。
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  createWriteStream,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { once } from 'node:events'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db, FileRow } from './db.js'

export interface SavedFile {
  id: string
  name: string
  mime: string
  size: number
  sha256: string
  relPath: string
}

/** 保存 multipart 上传文件，返回元数据 */
export async function saveUpload(
  req: FastifyRequest,
  filesDir: string,
  fileId: string,
): Promise<SavedFile> {
  const data = await req.file()
  if (!data) throw new Error('no file part')
  const dest = join(filesDir, fileId)
  const hash = createHash('sha256')
  let size = 0
  const out = createWriteStream(dest)
  data.file.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    size += chunk.length
  })
  out.on('error', () => out.destroy())
  data.file.pipe(out)
  await once(out, 'finish')
  return {
    id: fileId,
    name: data.filename ?? fileId,
    mime: sniffMime(dest, data.mimetype ?? 'application/octet-stream'),
    size,
    sha256: hash.digest('hex'),
    relPath: fileId,
  }
}

/** 注册 Range 下载路由 */
export function registerFileRoutes(
  app: FastifyInstance,
  opts: { db: Db; messageDir: string; avatarDir: string },
): void {
  const { db, messageDir, avatarDir } = opts

  app.get<{ Params: { id: string } }>('/files/m/:id', async (req, reply) => {
    const file = db.fileById(req.params.id)
    if (!file) return reply.code(404).send({ error: 'not found' })
    return streamFile(reply, messageDir, file)
  })

  app.get<{ Params: { userId: string } }>('/files/a/:userId', async (req, reply) => {
    const user = db.getUser(req.params.userId)
    if (!user) return reply.code(404).send({ error: 'no avatar' })
    // 磁盘文件带扩展名（u_xxx.png），URL 不带 —— 按前缀扫描实际文件
    // 重装后 users.avatarUrl 可能为空，但文件还在，照样提供
    let name: string | undefined
    for (const f of readdirSync(avatarDir)) {
      if (f.startsWith(`${req.params.userId}.`)) {
        name = f
        break
      }
    }
    if (!name) return reply.code(404).send({ error: 'no avatar' })
    const path = join(avatarDir, name)
    const file: FileRow = {
      id: name,
      ownerId: user.userId,
      sha256: user.avatarHash ?? '',
      kind: 'avatar',
      name,
      mime: mimeFromName(name),
      size: statSync(path).size,
      path,
      createdAt: user.updatedAt,
    }
    reply.header('Cache-Control', 'public, max-age=3600')
    return streamFile(reply, avatarDir, file)
  })

  /**
   * 注意：必须 `return reply.send(stream)` —— 异步 handler 若不返回 reply，
   * Fastify 会在流开始流动前结束响应生命周期（表现为 Content-Length 被改为 0）。
   */
  async function streamFile(reply: FastifyReply, dir: string, file: FileRow) {
    try {
      const stat = statSync(file.path)
      const range = reply.request.headers.range
      reply.header('Content-Type', sniffMime(file.path, file.mime))
      reply.header('Accept-Ranges', 'bytes')
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (m) {
          const start = m[1] ? Number(m[1]) : 0
          const end = m[2] ? Number(m[2]) : stat.size - 1
          if (start <= end && start < stat.size) {
            return reply
              .code(206)
              .headers({
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Content-Length': end - start + 1,
              })
              .send(createReadStream(file.path, { start, end }))
          }
          reply.code(416).header('Content-Range', `bytes */${stat.size}`).send()
          return
        }
      }
      reply.header('Content-Length', stat.size)
      return reply.send(createReadStream(file.path))
    } catch {
      reply.code(404).send({ error: 'missing file on disk' })
    }
  }
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    '3gp': 'video/3gpp',
    mp3: 'audio/mpeg',
    pdf: 'application/pdf',
    zip: 'application/zip',
  }
  return (ext && map[ext]) || 'application/octet-stream'
}

function sniffMime(filePath: string, fallback: string): string {
  if (fallback && fallback !== 'application/octet-stream') return fallback
  const head = Buffer.alloc(16)
  const fd = openSync(filePath, 'r')
  try {
    readSync(fd, head, 0, 16, 0)
  } finally {
    closeSync(fd)
  }
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg'
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png'
  if (head[0] === 0x47 && head[1] === 0x49) return 'image/gif'
  if (head[0] === 0x52 && head[8] === 0x57 && head[9] === 0x45) return 'image/webp'
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'video/mp4'
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf) return 'video/webm'
  return fallback
}
