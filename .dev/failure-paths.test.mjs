// Browser regressions for the failure paths, against a local server the harness
// controls:
//
//   /ok    a real 2x2 PNG            -> the wallpaper loads and fades in
//   /dead  a 404                     -> the preview falls back to the built-in
//                                       thumbnail instead of a broken glyph
//   /hang  accepts and never replies -> the gate must not stay closed forever
//
// `/hang` is the re-review's D3: without a watchdog the wallpaper disappears and
// only another source change brings it back.
import { createServer } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'shots')
mkdirSync(out, { recursive: true })

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
/** Must exceed the plugin's own 10s source watchdog. */
const WATCHDOG_WAIT_MS = 12500

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDAwMDEwMDAAAAPHQED0j0mQwAAAABJRU5ErkJggg==',
  'base64'
)

// The probe page is served over http from this same server: a `file://` page is
// not allowed to fetch http://localhost images in current Chromium, and the
// image URLs must be same-origin anyway to mirror the real GUI.
const probeHtml = readFileSync(join(here, 'probe.html'), 'utf8')
  .replaceAll('../lib/client.js', '/client.js')
const bundle = readFileSync(join(here, '..', 'lib', 'client.js'))

const openSockets = new Set()
const server = createServer((request, response) => {
  const path = request.url.split('?')[0]
  if (path === '/probe.html' || path === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(probeHtml)
    return
  }
  if (path === '/client.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(bundle)
    return
  }
  if (path.startsWith('/ok')) {
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    response.end(PNG)
    return
  }
  if (path.startsWith('/hang')) {
    // Accept the request and never answer it. The socket is deliberately leaked.
    openSockets.add(response.socket)
    response.socket.on('close', () => openSockets.delete(response.socket))
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const url = (path) => `http://127.0.0.1:${port}${path}`
const probeUrl = url('/probe.html')
console.log(`harness server on ${url('/')}`)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars']
})

/** Seed the section and reload, then report the layer and preview state. */
async function loadWith(page, imageUrl, waitMs) {
  await page.evaluate((value) => {
    window.localStorage.setItem('dsh-misaka-background:settings', JSON.stringify({
      enabled: true, overlay: 40, wallpaperOpacity: 100, wallpaperBlur: 0,
      glass: true, glassBlur: 18, artSeed: 7, artIntensity: 100, imageUrl: value
    }))
  }, imageUrl)
  // `load` never fires while a subresource hangs, so wait for the page itself.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 })
  await new Promise((resolve) => setTimeout(resolve, waitMs))
  return page.evaluate(() => {
    const layer = document.querySelector('.dsh-misaka-layer')
    const image = layer?.querySelector('img')
    const preview = document.querySelector('[data-dsh-misaka-row] .misaka-preview img')
    const describe = (element) => (element === null || element === undefined ? null : {
      complete: element.complete,
      natural: `${element.naturalWidth}x${element.naturalHeight}`,
      usable: element.naturalWidth > 0,
      scheme: String(element.getAttribute('src') || '').slice(0, 22)
    })
    return {
      layerReady: layer?.dataset.ready ?? null,
      layerInstant: layer?.dataset.instant ?? null,
      layerOpacity: layer ? Number(getComputedStyle(layer).opacity) : null,
      wallpaper: describe(image),
      preview: describe(preview)
    }
  })
}

const results = {}
const failures = []
const check = (label, ok, detail) => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  return ok
}

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800 })
  // The in-page fade assertion below needs motion allowed: Chromium takes
  // `prefers-reduced-motion` from the host OS, and `reduce` legitimately removes
  // the transition. Pin it so the measurement means what it says.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await page.goto(probeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 })

  // A reachable custom image behaves normally.
  results.ok = await loadWith(page, url('/ok'), 1500)
  check('/ok reveals the layer', results.ok.layerReady === 'true' && results.ok.layerOpacity > 0.9,
    JSON.stringify(results.ok))
  check('/ok swaps in the requested bitmap', results.ok.wallpaper?.usable === true)
  check('/ok leaves the transition restored', results.ok.layerInstant === null)

  // A 404: the preview must fall back to a usable thumbnail (D7).
  results.dead = await loadWith(page, url('/dead'), 1800)
  check('/dead preview falls back to a usable thumbnail', results.dead.preview?.usable === true,
    JSON.stringify(results.dead.preview))
  check('/dead still reveals the layer', results.dead.layerReady === 'true', JSON.stringify(results.dead))

  // A request that never settles must not hold the gate forever (D3).
  results.hang = await loadWith(page, url('/hang'), WATCHDOG_WAIT_MS)
  check('/hang releases the gate', results.hang.layerReady === 'true',
    `still closed after ${WATCHDOG_WAIT_MS}ms: ${JSON.stringify(results.hang)}`)
  check('/hang restores the transition', results.hang.layerInstant === null)
  check('/hang leaves the wallpaper visible', results.hang.layerOpacity > 0.9,
    `opacity ${results.hang.layerOpacity}`)

  await page.screenshot({ path: join(out, 'failure-paths.png') })

  // ---- an in-page change, not a reload -------------------------------------
  // The fade harnesses swap the wallpaper by reloading the page, which is a
  // different path from a change made inside a running page. This is the path
  // that exposed the reveal/pop defect, so it is pinned here.
  await page.evaluate(() => {
    window.localStorage.setItem('dsh-misaka-background:settings', JSON.stringify({
      enabled: true, overlay: 40, wallpaperOpacity: 100, wallpaperBlur: 0,
      glass: true, glassBlur: 18, artSeed: 7, artIntensity: 100, imageUrl: ''
    }))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 })
  await new Promise((resolve) => setTimeout(resolve, 2000))

  results.inPage = await page.evaluate(async () => {
    const layer = document.querySelector('.dsh-misaka-layer')
    const repaint = [...document.querySelectorAll('[data-dsh-misaka-row] button')]
      .find((button) => (button.textContent || '').trim() === 'Repaint')
    if (!repaint) return { error: 'no Repaint button' }
    const before = layer.querySelector('img').getAttribute('src')
    const samples = []
    const started = performance.now()
    repaint.click()
    while (performance.now() - started < 1600) {
      samples.push({
        ready: layer.dataset.ready,
        instant: layer.dataset.instant ?? null,
        opacity: Number(getComputedStyle(layer).opacity)
      })
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const opacities = samples.map((sample) => sample.opacity)
    return {
      sourceChanged: before !== layer.querySelector('img').getAttribute('src'),
      samples: samples.length,
      distinct: [...new Set(opacities.map((value) => value.toFixed(3)))].length,
      min: Math.min(...opacities),
      max: Math.max(...opacities),
      midFadeFrames: opacities.filter((value) => value > 0.02 && value < 0.98).length,
      // The reveal must never carry `transition: none`.
      revealedWhileInstant: samples.some((sample, index) =>
        sample.ready === 'true' && sample.instant === 'true'),
      finalReady: layer.dataset.ready,
      finalInstant: layer.dataset.instant ?? null
    }
  })

  check('in-page repaint swaps the source', results.inPage.sourceChanged === true, JSON.stringify(results.inPage))
  check('in-page repaint fades through intermediate opacities',
    results.inPage.distinct >= 5 && results.inPage.midFadeFrames >= 3,
    `distinct=${results.inPage.distinct} mid=${results.inPage.midFadeFrames}`)
  check('in-page repaint starts from a closed gate', results.inPage.min < 0.05, `min=${results.inPage.min}`)
  check('no reveal ever happens while data-instant is still set',
    results.inPage.revealedWhileInstant === false, JSON.stringify(results.inPage))
  check('in-page repaint leaves the transition restored', results.inPage.finalInstant === null)
} finally {
  await browser.close()
  for (const socket of openSockets) socket.destroy()
  server.close()
}

console.log(JSON.stringify(results, null, 2))
console.log('\n' + '='.repeat(60))
if (failures.length === 0) console.log('FAILURE-PATH REGRESSIONS: PASS')
else {
  console.log(`FAILURE-PATH REGRESSIONS: FAIL (${failures.length})`)
  for (const failure of failures) console.log('  - ' + failure)
  process.exitCode = 1
}
