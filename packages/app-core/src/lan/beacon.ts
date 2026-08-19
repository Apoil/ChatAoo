/**
 * UDP 组播信标：构造与验签。
 * 验证通过 => 对端身份可信（ED25519），即使无服务器也可互相识别。
 */
import {
  LAN_BEACON_INTERVAL_MS,
  PROTOCOL_VERSION,
  sign,
  userIdFromPublicKey,
  verifySignature,
  type BeaconPacket,
  type Identity,
} from '@chataoo/shared'

export function beaconPayload(p: Pick<BeaconPacket, 'userId' | 'displayName' | 'nonce' | 'ts'>): string {
  return `${p.userId}|${p.displayName}|${p.nonce}|${p.ts}`
}

export async function buildBeacon(identity: Identity): Promise<BeaconPacket> {
  const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  const ts = Date.now()
  const payload: Omit<BeaconPacket, 'sig'> = {
    v: PROTOCOL_VERSION as 1,
    userId: identity.userId,
    publicKey: identity.publicKey,
    displayName: identity.displayName,
    nonce,
    ts,
  }
  const sig = await sign(identity.privateKey, beaconPayload(payload))
  return { ...payload, sig }
}

/** 校验信标：版本 / 新鲜度 / userId 与公钥匹配 / 签名 */
export async function verifyBeacon(p: BeaconPacket): Promise<boolean> {
  if (p.v !== PROTOCOL_VERSION) return false
  if (Date.now() - p.ts > 120_000 || p.ts - Date.now() > 60_000) return false
  if (!p.publicKey || userIdFromPublicKey(p.publicKey) !== p.userId) return false
  return verifySignature(p.publicKey, beaconPayload(p), p.sig)
}

export const BEACON_INTERVAL_MS = LAN_BEACON_INTERVAL_MS
