import { randomBytes } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

export function bearerToken(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization
  if (!h) return undefined
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m?.[1]
}
