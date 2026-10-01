// Verify the plugin's own configuration route: does a row `config:` reach the
// host half, and does the client-fetchable route serve it?
const base = process.argv[2]
const token = process.argv[3]
const route = process.argv[4] || '/dsh-misaka-background/config.json'

let cookie = ''
const get = async (path, options = {}) => {
  const response = await fetch(base + path, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
    ...options
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  return response
}

await get('/?token=' + token)
await get('/')

// Unauthenticated first: the fence must not hand configuration to a stranger.
const anonymous = await fetch(base + route)
console.log(`anonymous  ${route} -> ${anonymous.status}`)

const response = await get(route)
const body = await response.text()
console.log(`authorized ${route} -> ${response.status} ${response.headers.get('content-type')}`)
console.log(`cache-control: ${response.headers.get('cache-control')}`)
console.log(`body: ${body}`)

let parsed = null
try { parsed = JSON.parse(body) } catch { /* reported below */ }

const checks = [
  ['parsed JSON', parsed !== null],
  ['configured imageUrl served', parsed?.imageUrl === 'https://example.invalid/configured-art.png'],
  ['configured overlay served', parsed?.overlay === 25],
  ['configured wallpaperBlur served', parsed?.wallpaperBlur === 6],
  ['unmentioned keys absent', parsed !== null && !('artSeed' in parsed) && !('enabled' in parsed)],
  ['no-store', response.headers.get('cache-control') === 'no-store']
]

const post = await get(route, { method: 'POST' })
checks.push(['POST rejected', post.status === 405])

console.log('\n' + '='.repeat(58))
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
const failed = checks.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? 'CONFIG ROUTE: PASS' : `CONFIG ROUTE: FAIL (${failed.length})`)
if (failed.length > 0) process.exitCode = 1
