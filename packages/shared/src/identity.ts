/**
 * 身份与签名：ED25519（@noble/ed25519 纯 JS 实现，无原生依赖）。
 * 用户 ID 由公钥哈希派生 —— 设备无需服务器即可生成身份，
 * 局域网信标与 P2P 消息均可用私钥签名验证，防止伪造。
 */
import { etc, getPublicKeyAsync, signAsync, utils, verifyAsync } from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'
import type { Identity } from './types.js'

const ID_PREFIX = 'u_'
const ID_HASH_BYTES = 20

/** 由公钥派生用户 ID（前 20 字节 SHA-256，hex） */
export function userIdFromPublicKey(publicKeyHex: string): string {
  const digest = sha256(hexToBytes(publicKeyHex))
  return ID_PREFIX + bytesToHex(digest.slice(0, ID_HASH_BYTES))
}

/** 校验用户 ID 是否与公钥匹配 */
export function verifyUserId(userId: string, publicKeyHex: string): boolean {
  return userId === userIdFromPublicKey(publicKeyHex)
}

/** 生成新的身份 */
export async function generateIdentity(displayName: string): Promise<Identity> {
  const privateKey = utils.randomPrivateKey()
  const publicKey = await getPublicKeyAsync(privateKey)
  const pubHex = bytesToHex(publicKey)
  return {
    userId: userIdFromPublicKey(pubHex),
    publicKey: pubHex,
    privateKey: bytesToHex(privateKey),
    displayName,
    createdAt: Date.now(),
  }
}

/** 签名（hex 输出） */
export async function sign(privateKeyHex: string, message: string): Promise<string> {
  const sig = await signAsync(utf8ToBytes(message), hexToBytes(privateKeyHex))
  return bytesToHex(sig)
}

/** 验签 */
export async function verifySignature(
  publicKeyHex: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  try {
    return await verifyAsync(hexToBytes(signatureHex), utf8ToBytes(message), hexToBytes(publicKeyHex))
  } catch {
    return false
  }
}

/** 随机 ID（消息 / 附件 / 传输） */
export function randomId(prefix = 'id'): string {
  const bytes = etc.randomBytes(12)
  return `${prefix}_${bytesToHex(bytes)}`
}

/** 随机 nonce（信标防重放） */
export function randomNonce(): string {
  return bytesToHex(etc.randomBytes(8))
}

/** 内容 SHA-256（hex） */
export function hashBytes(data: Uint8Array): string {
  return bytesToHex(sha256(data))
}

export function hashHexString(hex: string): string {
  return bytesToHex(sha256(hexToBytes(hex)))
}
