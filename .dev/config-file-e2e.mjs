// Verify the plugin's own `config.json` path and its precedence against the row
// config. Runs against a COPY of the plugin so the installed one is untouched.
//
//   config.json  { imageUrl, overlay: 33 }
//   row config   { overlay: 25 }          -> must win for overlay
// Expected: imageUrl from the file, overlay from the row.
import { createServer } from 'node:http'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = join(here, '..')
const plugin = join(workspace, 'plugins', 'dsh-misaka-background')
const copy = join(here, 'plugin-copy')
const home = join(here, 'config-file-e2e')
const PORT = 19797
const DSH = join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDAwMDEwMDAAAAPHQED0j0mQwAAAABJRU5ErkJggg==',
  'base64'
)
const staticServer = createServer((request, response) => {
  if (request.url.startsWith('/art.png')) {
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    response.end(PNG)
    return
  }
  response.writeHead(404).end()
})
await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve))
const artUrl = `http://127.0.0.1:${staticServer.address().port}/art.png`

// A copy of the plugin, so the installed package never gains a config.json.
rmSync(copy, { recursive: true, force: true })
cpSync(plugin, copy, {
  recursive: true,
  filter: (source) => !source.includes('node_modules') && !source.includes('.dev')
})
writeFileSync(join(copy, 'config.json'), JSON.stringify({ imageUrl: artUrl, overlay: 33, artIntensity: 55 }, null, 2))

rmSync(home, { recursive: true, force: true })
mkdirSync(home, { recursive: true })
const env = { ...process.env, DSH_HOME: home }
execFileSync(`"${DSH}"`, ['plugin', '--profile', 'web', 'add', copy], { env, shell: true, stdio: 'ignore', timeout: 180000 })
const profileFile = join(home, 'profiles', 'web', 'package.json')
const profile = JSON.parse(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))', profileFile], { encoding: 'utf8' }))
profile.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-misaka-background']
writeFileSync(profileFile, JSON.stringify(profile, null, 2))
writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), [
  '- id: dsh-misaka-background',
  '  name: "dsh-misaka-background"',
  '  config:',
  '    overlay: 25',
  ''
].join('\n'))

const child = spawn(`"${DSH}"`, ['--profile', 'web', '--port', String(PORT), '--host', '127.0.0.1', '--no-open'], {
  env, shell: true, stdio: ['ignore', 'pipe', 'pipe']
})
let buffer = ''
const token = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no token in: ${buffer}`)), 120000)
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const match = buffer.match(/token=([A-Za-z0-9_-]+)/)
    if (match) { clearTimeout(timer); resolve(match[1]) }
  })
  child.stderr.on('data', (chunk) => { buffer += chunk.toString() })
  child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`dsh exited ${code}: ${buffer.slice(-300)}`)) })
})

try {
  let cookie = ''
  const response = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: 'manual' })
  cookie = (response.headers.get('set-cookie') || '').split(';')[0]
  await fetch(`http://127.0.0.1:${PORT}/`, { headers: { cookie } })
  const configResponse = await fetch(`http://127.0.0.1:${PORT}/dsh-misaka-background/config.json`, { headers: { cookie } })
  const parsed = await configResponse.json()
  console.log('served configuration:', JSON.stringify(parsed))

  const checks = [
    ['imageUrl comes from config.json', parsed.imageUrl === artUrl],
    ['row config wins over config.json for overlay', parsed.overlay === 25],
    ['config.json value survives when the row is silent', parsed.artIntensity === 55]
  ]
  console.log('\n' + '='.repeat(60))
  for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  const failed = checks.filter(([, ok]) => !ok)
  console.log(failed.length === 0 ? 'config.json PRECEDENCE: PASS' : `config.json PRECEDENCE: FAIL (${failed.length})`)
  if (failed.length > 0) process.exitCode = 1
} finally {
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 30000 })
  } catch { child.kill() }
  staticServer.close()
  rmSync(home, { recursive: true, force: true })
}
