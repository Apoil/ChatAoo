/**
 * LAN 信标验证：加入组播组监听桌面端广播，验签并打印。
 * 用法：node scripts/beacon-probe.mjs [秒数]
 */
import dgram from 'node:dgram'
import { userIdFromPublicKey, verifySignature } from '../packages/shared/dist/index.js'

async function verifyBeacon(p) {
  if (Date.now() - p.ts > 120000) return false
  if (userIdFromPublicKey(p.publicKey) !== p.userId) return false
  return verifySignature(p.publicKey, `${p.userId}|${p.displayName}|${p.nonce}|${p.ts}`, p.sig)
}

const seconds = Number(process.argv[2] ?? 8)
const GROUP = '239.255.42.77'
const PORT = 47777

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
socket.bind(PORT, () => {
  socket.addMembership(GROUP)
  socket.setBroadcast(true)
  console.log(`监听组播 ${GROUP}:${PORT}，持续 ${seconds} 秒…`)
})

const seen = new Map()
socket.on('message', async (msg, rinfo) => {
  try {
    const packet = JSON.parse(msg.toString())
    if (!packet.v || !packet.userId) return
    const valid = await verifyBeacon(packet)
    const key = packet.userId
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    console.log(
      `[${new Date().toLocaleTimeString()}] ${packet.displayName} (${packet.userId.slice(0, 14)}…) ` +
        `来自 ${rinfo.address} 签名:${valid ? '✅有效' : '❌无效'} 第${count}次`,
    )
  } catch {
    /* 非本协议报文 */
  }
})

setTimeout(() => {
  console.log(`--- 共发现 ${seen.size} 个设备 ---`)
  socket.close()
  process.exit(0)
}, seconds * 1000)
