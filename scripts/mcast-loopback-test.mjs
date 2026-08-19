// 单 socket 组播自回环测试
import dgram from 'node:dgram'
const GROUP = '239.255.42.77'
const PORT = 47777
const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
let received = 0
s.on('message', (msg, rinfo) => {
  received++
  console.log(`收到来自 ${rinfo.address}: ${msg.toString().slice(0, 60)}`)
})
s.bind(PORT, () => {
  s.addMembership(GROUP)
  s.setBroadcast(true)
  s.setMulticastTTL(2)
  const payload = Buffer.from(JSON.stringify({ v: 1, test: true, ts: Date.now() }))
  for (let i = 0; i < 5; i++) {
    setTimeout(() => s.send(payload, PORT, GROUP), i * 500)
  }
  setTimeout(() => {
    console.log(`自回环收到 ${received}/5`)
    s.close()
    process.exit(0)
  }, 4000)
})
