/**
 * LAN 端到端验证：监听应用信标 → 主动 TCP 连接 → 发送伪造 hello →
 * 预期被好友门控拒绝（连接被关闭）。
 * 用法：node scripts/lan-e2e.mjs
 */
import dgram from 'node:dgram'
import net from 'node:net'

const GROUP = '239.255.42.77'
const UDP_PORT = 47777
const TCP_PORT = 47778

// 等待应用的信标
const beacon = await new Promise((resolve, reject) => {
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  const timer = setTimeout(() => {
    s.close()
    reject(new Error('8 秒内未收到信标（应用未运行？）'))
  }, 8000)
  s.on('message', (msg, rinfo) => {
    try {
      const p = JSON.parse(msg.toString())
      if (p.v && p.userId) {
        clearTimeout(timer)
        s.close()
        resolve({ packet: p, host: rinfo.address })
      }
    } catch {}
  })
  s.bind(UDP_PORT, () => {
    s.addMembership(GROUP)
    s.setBroadcast(true)
  })
})

console.log(`信标来自: ${beacon.packet.displayName} (${beacon.packet.userId.slice(0, 14)}…)`)

// 伪造身份（非好友）
const fake = {
  type: 'hello',
  userId: 'u_FAKE00000000000000000000000000000000',
  displayName: '入侵者',
}

const conn = net.connect(TCP_PORT, '127.0.0.1')
let closed = false
let gotData = false

conn.on('connect', () => {
  console.log('TCP 已连接，发送伪造 hello…')
  conn.write(JSON.stringify(fake) + '\n')
})

conn.on('data', (d) => {
  gotData = true
  console.log('收到数据:', d.toString().trim().slice(0, 80))
})

conn.on('close', () => {
  closed = true
  console.log('连接被对端关闭')
})

setTimeout(() => {
  if (closed) {
    console.log('✅ 好友门控生效：非好友连接被拒绝')
    process.exit(0)
  } else {
    console.log(gotData ? '⚠️ 对端返回了数据（需人工检查）' : '❌ 连接未被关闭（门控可能失效）')
    process.exit(1)
  }
}, 5000)
