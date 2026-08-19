/**
 * 服务器端到端冒烟测试：注册 Alice/Bob -> 加好友 -> 发消息 -> 同步 -> 头像上传 -> 文件上传 -> Range 下载
 */
const BASE = 'http://127.0.0.1:47800'
const { generateIdentity } = await import('../shared/dist/index.js')
const alice = await generateIdentity('Alice')
const bob = await generateIdentity('Bob')
// 消息 ID 加时间戳保证幂等测试可重复
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

// 1. register
const ra = await api('/api/v1/auth/register', {
  method: 'POST',
  body: { userId: alice.userId, publicKey: alice.publicKey, displayName: 'Alice' },
})
assert(ra.token && ra.user.userId === alice.userId, 'register alice')
const rb = await api('/api/v1/auth/register', {
  method: 'POST',
  body: { userId: bob.userId, publicKey: bob.publicKey, displayName: 'Bob' },
})
assert(rb.token && rb.user.userId === bob.userId, 'register bob')
console.log('  (alice=' + alice.userId.slice(0, 12) + '… bob=' + bob.userId.slice(0, 12) + '…)')

// 2. login with token
const la = await api('/api/v1/auth/login', { method: 'POST', body: { token: ra.token } })
assert(la.user.userId === alice.userId, 'login alice')

// 3. friends
const req1 = await api('/api/v1/friends/request', { method: 'POST', token: ra.token, body: { userId: bob.userId } })
assert(req1.status === 'outgoing', 'alice -> bob request')
const acc = await api('/api/v1/friends/accept', { method: 'POST', token: rb.token, body: { userId: alice.userId } })
assert(acc.status === 'friends', 'bob accepts')
const fa = await api('/api/v1/friends', { token: ra.token })
assert(fa.friends.some((f) => f.userId === bob.userId && f.confirmed), 'alice friend list')

// 4. message send (with fixed id for idempotency test)
const conv = [alice.userId, bob.userId].sort().join('__')
const msg = {
  id: MSG_ID,
  conversationId: conv,
  kind: 'text',
  text: 'hello bob from alice',
  createdAt: Date.now(),
}
const s1 = await api('/api/v1/messages', { method: 'POST', token: ra.token, body: msg })
assert(s1.seq >= 1, 'message posted')
const s2 = await api('/api/v1/messages', { method: 'POST', token: ra.token, body: msg })
assert(s2.seq === s1.seq, 'message idempotent (same seq)')

// 5. sync
const sy = await api(`/api/v1/sync?since=0&profilesSince=0`, { token: rb.token })
assert(sy.messages.length >= 1 && sy.messages.some((m) => m.id === MSG_ID), 'bob syncs message')
assert(sy.nextSeq >= s1.seq, 'nextSeq matches')

// 6. history
const hist = await api(`/api/v1/messages?conversationId=${conv}`, { token: rb.token })
assert(hist.messages.some((m) => m.id === MSG_ID), 'history has the message')

// 7. avatar upload (tiny PNG)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const fd = new FormData()
fd.append('avatar', new Blob([png], { type: 'image/png' }), 'avatar.png')
const av = await fetch(BASE + '/api/v1/avatar', {
  method: 'POST',
  headers: { Authorization: `Bearer ${ra.token}` },
  body: fd,
})
assert(av.ok, 'avatar upload status')
const avJson = await av.json()
assert(avJson.url && avJson.sha256, 'avatar returns url+sha')
const avGet = await fetch(BASE + avJson.url)
assert(avGet.ok && (await avGet.arrayBuffer()).byteLength === png.length, 'avatar downloadable')

// 8. message file upload + Range
const fd2 = new FormData()
fd2.append('file', new Blob([Buffer.from('0123456789abcdef'.repeat(64))], { type: 'video/mp4' }), 'clip.mp4')
fd2.append('kind', 'video')
const fu = await fetch(BASE + '/api/v1/files', {
  method: 'POST',
  headers: { Authorization: `Bearer ${ra.token}` },
  body: fd2,
})
assert(fu.ok, 'file upload')
const fuJson = await fu.json()
assert(fuJson.url && fuJson.sha256, 'file returns url')
const range = await fetch(BASE + fuJson.url, { headers: { Range: 'bytes=0-63' } })
assert(range.status === 206, 'range returns 206')
assert((await range.arrayBuffer()).byteLength === 64, 'range body length 64')
assert(range.headers.get('content-range')?.startsWith('bytes 0-63/'), 'content-range header')

// 9. unauthorized access denied
let denied = false
try {
  await api('/api/v1/me')
} catch (e) {
  denied = true
}
assert(denied, 'me without token is 401')

console.log('\nALL SERVER SMOKE TESTS PASSED')
process.exit(0)
