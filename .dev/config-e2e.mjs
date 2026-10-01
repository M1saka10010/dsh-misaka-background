// End-to-end: set the wallpaper URL in the PLUGIN and prove the GUI uses it.
//
// Boots a real dsh web instance whose plugin row carries a `config:`, serves a
// real image from a local static server, then checks in Chrome that:
//   - the configured URL is the wallpaper (not just the shipped artwork);
//   - the configured numbers reach the CSS variables;
//   - a later change in the settings row does NOT discard the configured URL
//     (the whole reason overrides are stored as a sparse patch);
//   - clearing the overrides hands control back to the configuration.
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = join(here, '..')
const plugin = join(workspace, 'plugins', 'dsh-misaka-background')
const home = join(here, 'config-e2e')
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 19796
const DSH = join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDAwMDEwMDAAAAPHQED0j0mQwAAAABJRU5ErkJggg==',
  'base64'
)

// 1. A real image the configuration can point at.
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
console.log('serving art at', artUrl)

// 2. An isolated profile whose plugin row carries the configuration.
rmSync(home, { recursive: true, force: true })
mkdirSync(home, { recursive: true })
const env = { ...process.env, DSH_HOME: home }
execFileSync(`"${DSH}"`, ['plugin', '--profile', 'web', 'add', plugin], { env, shell: true, stdio: 'ignore', timeout: 180000 })
const profileFile = join(home, 'profiles', 'web', 'package.json')
const profile = JSON.parse(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))', profileFile], { encoding: 'utf8' }))
profile.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-misaka-background']
writeFileSync(profileFile, JSON.stringify(profile, null, 2))
writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), [
  '- id: dsh-misaka-background',
  '  name: "dsh-misaka-background"',
  '  config:',
  `    imageUrl: "${artUrl}"`,
  '    overlay: 25',
  '    wallpaperBlur: 6',
  ''
].join('\n'))
console.log('row config written')

// 3. Boot the instance and read its token off stdout.
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
  child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`dsh exited ${code}: ${buffer.slice(-400)}`)) })
})
console.log('instance up on', PORT)

const checks = []
const check = (label, ok, detail) => {
  checks.push([label, ok, detail])
  return ok
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--hide-scrollbars', '--no-sandbox', '--force-device-scale-factor=1']
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 820 })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await page.goto(`http://127.0.0.1:${PORT}/?token=${token}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('.dsh-misaka-layer img') !== null, { timeout: 30000 })
  await new Promise((resolve) => setTimeout(resolve, 2500))

  /** Read what the page actually applied. */
  const read = () => page.evaluate(async () => {
    const layer = document.querySelector('.dsh-misaka-layer')
    const image = layer.querySelector('img')
    if (!image.complete) await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; setTimeout(resolve, 3000) })
    return {
      scrim: document.body.style.getPropertyValue('--bg-scrim'),
      blur: document.body.style.getPropertyValue('--bg-wallpaper-blur'),
      layerSrc: String(image.getAttribute('src') || ''),
      layerNatural: `${image.naturalWidth}x${image.naturalHeight}`,
      previewSrc: String(document.querySelector('[data-dsh-misaka-row] .misaka-preview img')?.getAttribute('src') || ''),
      stored: window.localStorage.getItem('dsh-misaka-background:settings')
    }
  })

  // --- the configuration must be what the page applied ---------------------
  // The settings row is only mounted when Settings → General is open, and the
  // preview card lives in it, so open it before reading.
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog) {
      const buttons = [...dialog.querySelectorAll('button')]
      if (buttons.length) buttons[buttons.length - 1].click()
      await sleep(700)
    }
    const clickText = (text) => {
      const hit = [...document.querySelectorAll('button, [role="button"], a, [role="tab"]')]
        .find((node) => (node.textContent || '').trim() === text)
      if (hit) { hit.click(); return true }
      return false
    }
    clickText('设置')
    await sleep(1400)
    clickText('通用')
    await sleep(1400)
  })
  const rowMounted = await page.evaluate(() => document.querySelector('[data-dsh-misaka-row]') !== null)
  check('settings row is mounted', rowMounted)

  const fromConfig = await read()
  check('configured scrim applied (overlay 25 -> 0.550)', fromConfig.scrim === '0.550', fromConfig.scrim)
  check('configured wallpaper blur applied (6px)', fromConfig.blur === '6px', fromConfig.blur)
  check('configured wallpaper URL is the layer source', fromConfig.layerSrc === artUrl, fromConfig.layerSrc)
  check('configured wallpaper actually loaded', fromConfig.layerNatural === '2x2', fromConfig.layerNatural)
  check('preview shows the configured URL', fromConfig.previewSrc === artUrl, fromConfig.previewSrc)

  // --- a user change must not discard the configured URL -------------------
  // `overlay` is overridden only; everything else must keep coming from config.
  await page.evaluate(() => {
    window.localStorage.setItem('dsh-misaka-background:settings', JSON.stringify({ v: 2, user: { overlay: 70 } }))
  })
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.dsh-misaka-layer img') !== null, { timeout: 30000 })
  await new Promise((resolve) => setTimeout(resolve, 2000))
  const withOverride = await read()
  check('override wins for the field it set (70 -> 1.000)', withOverride.scrim === '1.000', withOverride.scrim)
  check('configured URL survives an unrelated override', withOverride.layerSrc === artUrl, withOverride.layerSrc)
  check('configured blur survives an unrelated override', withOverride.blur === '6px', withOverride.blur)

  // --- clearing overrides hands control back to the configuration ----------
  await page.evaluate(() => {
    window.localStorage.setItem('dsh-misaka-background:settings', JSON.stringify({ v: 2, user: {} }))
  })
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.dsh-misaka-layer img') !== null, { timeout: 30000 })
  await new Promise((resolve) => setTimeout(resolve, 2000))
  const afterReset = await read()
  check('clearing overrides restores the configured scrim', afterReset.scrim === '0.550', afterReset.scrim)
  check('clearing overrides restores the configured URL', afterReset.layerSrc === artUrl, afterReset.layerSrc)
} finally {
  await browser.close()
  // `shell: true` means the direct child is a shell; kill the whole tree or the
  // instance keeps holding its port.
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 30000 })
  } catch (error) {
    child.kill()
  }
  staticServer.close()
}

console.log('\n' + '='.repeat(60))
for (const [label, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got: ${detail})`}`)
const failed = checks.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? 'PLUGIN CONFIGURATION: PASS' : `PLUGIN CONFIGURATION: FAIL (${failed.length})`)
if (failed.length > 0) process.exitCode = 1
