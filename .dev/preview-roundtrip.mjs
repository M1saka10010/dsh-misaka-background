// Settings-preview health across a wallpaper round-trip.
//
// The verifier reported the 200x125 preview card as a broken-image thumbnail
// after switching back from a custom URL. A browser reports a decoded failure
// as a loaded image with naturalWidth 0, so that is what gets asserted here.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'shots')
mkdirSync(out, { recursive: true })

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL_UNDER_TEST = new URL('./probe.html', import.meta.url).href
const CUSTOM = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--allow-file-access-from-files', '--no-sandbox', '--hide-scrollbars']
})

/** Read the live preview card and wallpaper state. */
const readState = async (page) => page.evaluate(async () => {
  const preview = document.querySelector('[data-dsh-misaka-row] .misaka-preview img')
  const wallpaper = document.querySelector('.dsh-misaka-layer img')
  const describe = async (img) => {
    if (!img) return null
    // Wait for the element to settle so naturalWidth is meaningful.
    if (!img.complete) await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; setTimeout(resolve, 2000) })
    return {
      scheme: String(img.getAttribute('src') || '').slice(0, 24),
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      bytes: String(img.getAttribute('src') || '').length,
      usable: img.naturalWidth > 0
    }
  }
  return { preview: await describe(preview), wallpaper: await describe(wallpaper) }
})

const seed = async (page, imageUrl) => page.evaluate((url) => {
  window.localStorage.setItem('dsh-misaka-background:settings', JSON.stringify({
    enabled: true, overlay: 40, wallpaperOpacity: 100, wallpaperBlur: 0,
    glass: true, glassBlur: 18, artSeed: 7, artIntensity: 100, imageUrl: url
  }))
}, imageUrl)

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800 })
  await page.goto(URL_UNDER_TEST, { waitUntil: 'load' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 })

  const cases = []
  // 1. Built-in artwork.
  await new Promise((resolve) => setTimeout(resolve, 500))
  cases.push({ label: 'built-in artwork', ...(await readState(page)) })

  // 2. Custom URL applied (write + reload, the plugin's real persistence path).
  await seed(page, CUSTOM)
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 })
  await new Promise((resolve) => setTimeout(resolve, 900))
  cases.push({ label: 'custom URL', ...(await readState(page)) })

  // 3. Back to the built-in artwork.
  await seed(page, '')
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 })
  await new Promise((resolve) => setTimeout(resolve, 900))
  cases.push({ label: 'back to built-in', ...(await readState(page)) })

  await page.screenshot({ path: join(out, 'preview-roundtrip.png') })

  console.log(JSON.stringify(cases, null, 2))
  const broken = cases.filter((c) => !c.wallpaper?.usable || !c.preview?.usable)
  console.log('\nVERDICT:', broken.length === 0
    ? 'the preview card and the wallpaper both decode in every state'
    : `BROKEN IMAGE in: ${broken.map((b) => b.label).join(', ')}`)
  if (broken.length > 0) process.exitCode = 1
} finally {
  await browser.close()
}
