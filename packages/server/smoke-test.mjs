/**
 * 服务器端到端冒烟测试：注册/登录/重绑定/用户名解析/好友/消息/同步/头像/文件/Range
 */
const BASE = process.env.CHATAOO_TEST_BASE ?? 'http://127.0.0.1:47800'
const { generateIdentity } = await import('../shared/dist/index.js')
const alice = await generateIdentity('Alice')
const bob = await generateIdentity('Bob')
const USER_A = `alice_${Date.now() % 100000}`
const USER_B = `bob_${Date.now() % 100000}`
const MSG_ID = `m_test_${Date.now()}`

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : undefined
}

function assert(cond, name) {
  if (!cond) throw new Error(`ASSERT FAILED: ${name}`)
  console.log(`  ok: ${name}`)
}

// 1. 注册（用户名+密码）
const ra = await api('/api/v1/auth/register', {
  method: 'POST',
  body: { userId: alice.userId, publicKey: alice.publicKey, username: USER_A, password: 'pass123', displayName: 'Alice' },
})
assert(ra.token && ra.user.userId === alice.userId && ra.user.username === USER_A, 'register alice (username+password)')
const rb = await api('/api/v1/auth/register', {
  method: 'POST',
  body: { userId: bob.userId, publicKey: bob.publicKey, username: USER_B, password: 'pass123', displayName: 'Bob' },
})
assert(rb.token && rb.user.userId === bob.userId, 'register bob')

// 2. 登录（用户名+密码）
const la = await api('/api/v1/auth/login', { method: 'POST', body: { username: USER_A, password: 'pass123' } })
assert(la.token && la.user.userId === alice.userId, 'login alice')

// 3. 错误密码
let badLogin = false
try {
  await api('/api/v1/auth/login', { method: 'POST', body: { username: USER_A, password: 'wrong' } })
} catch {
  badLogin = true
}
assert(badLogin, 'wrong password rejected')

// 4. 重绑定：新设备登录同一账号（旧设备 token 应立即失效）
const newDevice = await generateIdentity('Alice2')
const reb = await api('/api/v1/auth/rebind', {
  method: 'POST',
  body: { username: USER_A, password: 'pass123', userId: newDevice.userId, publicKey: newDevice.publicKey },
})
assert(reb.token && reb.user.userId === newDevice.userId, 'rebind account to new device')
// 旧 token 失效
let oldTokenDead = false
try {
  await api('/api/v1/me', { token: ra.token })
} catch {
  oldTokenDead = true
}
assert(oldTokenDead, 'old device token invalidated after rebind')
// 此后 alice 的身份 = 新设备
const aliceActive = { userId: newDevice.userId, token: reb.token }

// 5. 用户名解析
const resolved = await api(`/api/v1/users/resolve?username=${USER_B}`, { token: aliceActive.token })
assert(resolved.userId === bob.userId && resolved.displayName === 'Bob', 'resolve username')

// 6. 修改昵称
const nameRes = await api('/api/v1/profile', {
  method: 'PATCH',
  token: aliceActive.token,
  body: { displayName: '爱丽丝' },
})
assert(nameRes.displayName === '爱丽丝', 'update displayName')

// 7. 好友（alice = 新设备身份）
const req1 = await api('/api/v1/friends/request', { method: 'POST', token: aliceActive.token, body: { userId: bob.userId } })
assert(req1.status === 'outgoing', 'alice -> bob request')
const acc = await api('/api/v1/friends/accept', { method: 'POST', token: rb.token, body: { userId: aliceActive.userId } })
assert(acc.status === 'friends', 'bob accepts')

// 8. 消息发送 + 幂等
const conv = [aliceActive.userId, bob.userId].sort().join('__')
const msg = { id: MSG_ID, conversationId: conv, kind: 'text', text: 'hello bob', createdAt: Date.now() }
const s1 = await api('/api/v1/messages', { method: 'POST', token: aliceActive.token, body: msg })
assert(s1.seq >= 1, 'message posted')
const s2 = await api('/api/v1/messages', { method: 'POST', token: aliceActive.token, body: msg })
assert(s2.seq === s1.seq, 'message idempotent')

// 9. 同步
const sy = await api(`/api/v1/sync?since=0&profilesSince=0`, { token: rb.token })
assert(sy.messages.some((m) => m.id === MSG_ID), 'bob syncs message')
assert(sy.profiles.some((p) => p.displayName === '爱丽丝'), 'bob syncs renamed profile')

// 10. 头像上传 + 下载
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const fd = new FormData()
fd.append('avatar', new Blob([png], { type: 'image/png' }), 'avatar.png')
const av = await fetch(BASE + '/api/v1/avatar', { method: 'POST', headers: { Authorization: `Bearer ${aliceActive.token}` }, body: fd })
assert(av.ok, 'avatar upload status')
const avJson = await av.json()
assert(avJson.url && avJson.sha256, 'avatar returns url+sha')
const avGet = await fetch(BASE + avJson.url)
assert(avGet.ok && (await avGet.arrayBuffer()).byteLength === png.length, 'avatar downloadable')

// 11. 文件上传 + Range
const fd2 = new FormData()
fd2.append('file', new Blob([Buffer.from('0123456789abcdef'.repeat(64))], { type: 'video/mp4' }), 'clip.mp4')
fd2.append('kind', 'video')
const fu = await fetch(BASE + '/api/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${aliceActive.token}` }, body: fd2 })
assert(fu.ok, 'file upload')
const fuJson = await fu.json()
const range = await fetch(BASE + fuJson.url, { headers: { Range: 'bytes=0-63' } })
assert(range.status === 206, 'range returns 206')
assert((await range.arrayBuffer()).byteLength === 64, 'range body length 64')

// 12. 未授权拒绝
let denied = false
try {
  await api('/api/v1/me')
} catch {
  denied = true
}
assert(denied, 'me without token is 401')

console.log('\nALL SERVER SMOKE TESTS PASSED')
process.exit(0)
