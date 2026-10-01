// Fade determinism.
//
// The adversarial verifier demonstrated a real defect here: revealing the
// wallpaper in the same task that closed the fade gate meant the browser never
// painted `opacity: 0`, so every wallpaper CHANGE snapped instead of animating.
// This harness pins the fix.
//
// It uses probe-delayed.html, which applies the plugin 300ms after document
// start, so a document-start sampler can record the very first frame. The
// section is seeded through localStorage, which is the plugin's real
// persistence path, and the page is reloaded between cases.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'shots')
mkdirSync(out, { recursive: true })

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL_UNDER_TEST = new URL('./probe-delayed.html', import.meta.url).href
const CUSTOM = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
const BUILT_IN = ''

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--allow-file-access-from-files', '--no-sandbox', '--hide-scrollbars']
})

const page = await browser.newPage()
await page.setViewport({ width: 1000, height: 700 })

// The fade only exists when motion is allowed, and Chromium derives
// `prefers-reduced-motion` from the host OS — a machine with Windows animations
// turned off reports `reduce`, which legitimately disables the transition and
// makes every fade measurement here read a single opacity step. Both values are
// therefore emulated explicitly: `no-preference` for the fade itself, and
// `reduce` for the case below that pins the degraded behaviour.
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])

// Install the sampler before any document script runs.
await page.evaluateOnNewDocument(() => {
  window.__fade = []
  const started = performance.now()
  const tick = () => {
    const layer = document.querySelector('.dsh-misaka-layer')
    if (layer) {
      window.__fade.push({
        t: Math.round(performance.now() - started),
        ready: layer.dataset.ready,
        opacity: Number(getComputedStyle(layer).opacity)
      })
    }
    if (performance.now() - started < 2500) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

/** Seed the section, reload, and report the opacity curve. */
async function sampleLoad(imageUrl, label) {
  await page.evaluate((url) => {
    window.localStorage.setItem('dsh-misaka-background:settings', JSON.stringify({
      enabled: true, overlay: 40, wallpaperOpacity: 100, wallpaperBlur: 0,
      glass: true, glassBlur: 18, artSeed: 7, artIntensity: 100, imageUrl: url
    }))
  }, imageUrl)
  const navigation = page.reload({ waitUntil: 'load' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 }).catch(() => {})
  await navigation.catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 2000))

  const samples = await page.evaluate(() => window.__fade || [])
  const opacityOf = (sample) => sample.opacity
  const values = [...new Set(samples.map((s) => opacityOf(s).toFixed(3)))]
  const distinct = values.length
  const min = samples.length ? Math.min(...samples.map(opacityOf)) : null
  const max = samples.length ? Math.max(...samples.map(opacityOf)) : null
  return {
    label,
    samples: samples.length,
    distinct,
    min,
    max,
    first: samples.slice(0, 5),
    last: samples.slice(-2),
    src: await page.evaluate(() => String(document.querySelector('.dsh-misaka-layer img')?.getAttribute('src') || '').slice(0, 32)),
    // A real fade spends frames strictly between 0 and 1.
    framesMidFade: samples.filter((s) => s.opacity > 0.02 && s.opacity < 0.98).length
  }
}

let report
try {
  await page.goto(URL_UNDER_TEST, { waitUntil: 'load' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 })

  // First paint, then two genuine source changes.
  const firstPaint = await sampleLoad(BUILT_IN, 'first paint -> built-in artwork')
  const toCustom = await sampleLoad(CUSTOM, 'change -> custom data URL')
  const backToBuiltIn = await sampleLoad(BUILT_IN, 'change -> built-in artwork')
  await page.screenshot({ path: join(out, 'fade-after-change.png') })

  // With reduced motion the fade is deliberately removed (the blog does the
  // same), but the wallpaper must still end up visible — a transition-less
  // reveal that never reveals would be the real bug.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  const reducedMotion = await sampleLoad(BUILT_IN, 'reduced motion -> instant but visible')
  report = { firstPaint, toCustom, backToBuiltIn, reducedMotion }
} finally {
  await browser.close()
}

console.log(JSON.stringify(report, null, 2))
const cases = [report.firstPaint, report.toCustom, report.backToBuiltIn]
const failures = cases.filter((c) => !(c.distinct >= 5 && c.min < 0.05 && c.max > 0.9 && c.framesMidFade >= 3))
const reduced = report.reducedMotion
const reducedOk = reduced.max > 0.9 && reduced.distinct <= 3
console.log('\nVERDICT:', failures.length === 0
  ? 'the fade plays on the first paint AND on every source change'
  : `THE FADE DID NOT PLAY for: ${failures.map((f) => f.label).join(', ')}`)
console.log('VERDICT (reduced motion):', reducedOk
  ? 'the transition is removed and the wallpaper is still revealed'
  : `unexpected reduced-motion behaviour: distinct=${reduced.distinct} max=${reduced.max}`)
if (failures.length > 0 || !reducedOk) process.exitCode = 1
