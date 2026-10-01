// Real-browser render probe.
//
// Chrome renders probe.html (a stand-in for the DSH shell) with the plugin
// bundle loaded exactly as a classic script. Reports the computed backdrop
// state and writes screenshots for human inspection.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'shots')
mkdirSync(out, { recursive: true })

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const pageUrl = new URL('./probe.html', import.meta.url).href

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=1']
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 820 })
  // Chromium takes `prefers-reduced-motion` from the host OS; `reduce` removes
  // the transition and would make the reported transition read `none 0s`. Pin
  // the value so this report describes the default experience.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await page.goto(pageUrl, { waitUntil: 'load' })
  await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 15000 })

  // Give the wallpaper <img> data URL a beat to decode so the fade gate clears.
  await page.waitForFunction(
    () => document.querySelector('.dsh-misaka-layer')?.dataset.ready === 'true',
    { timeout: 15000 }
  )

  // The fade gate clears on the `load` event, which is the same frame the
  // 480ms transition starts on — so read the opacity only after it settles.
  await new Promise((resolve) => setTimeout(resolve, 700))

  const report = await page.evaluate(() => {
    const body = document.body
    const layer = document.querySelector('.dsh-misaka-layer')
    const image = document.querySelector('.dsh-misaka-layer img')
    const scrim = document.querySelector('.dsh-misaka-scrim')
    const composer = document.querySelector('[data-composer-card]')
    const bubble = document.querySelector('._bubble_xyz')
    const code = document.querySelector('.md-code-block')
    const read = (el, prop) => getComputedStyle(el).getPropertyValue(prop)
    return {
      attributes: {
        active: body.getAttribute('data-dsh-misaka-bg'),
        glass: body.getAttribute('data-dsh-misaka-bg-glass')
      },
      vars: {
        scrim: body.style.getPropertyValue('--bg-scrim'),
        mobile: `${body.style.getPropertyValue('--bg-mobile-x')} ${body.style.getPropertyValue('--bg-mobile-y')}`,
        desktop: `${body.style.getPropertyValue('--bg-desktop-x')} ${body.style.getPropertyValue('--bg-desktop-y')}`,
        frame: body.style.getPropertyValue('--dsw-alias-bg-base'),
        sidebar: body.style.getPropertyValue('--dsw-specific-sidebar-fill')
      },
      computed: {
        layerZ: read(layer, 'z-index'),
        layerPosition: read(layer, 'position'),
        layerTransition: read(layer, 'transition-property') + ' ' + read(layer, 'transition-duration') + ' ' + read(layer, 'transition-timing-function'),
        layerOpacity: read(layer, 'opacity'),
        imageObjectFit: read(image, 'object-fit'),
        imageObjectPosition: read(image, 'object-position'),
        imageSrcScheme: String(image.getAttribute('src')).slice(0, 22),
        imageNatural: `${image.naturalWidth}x${image.naturalHeight}`,
        scrimZ: read(scrim, 'z-index'),
        scrimBackground: read(scrim, 'background-color'),
        composerBackdrop: read(composer, 'backdrop-filter'),
        bubbleBackdrop: read(bubble, 'backdrop-filter'),
        bubbleFill: read(bubble, 'background-color'),
        codeBackdrop: read(code, 'backdrop-filter'),
        sidebarFill: read(document.querySelector('.shell-sidebar'), 'background-color'),
        appFrame: read(document.body, 'background-color')
      },
      artPixels: (() => {
        // Sample the drawn artwork so the probe can prove the canvas painted
        // more than one flat colour.
        const canvas = document.createElement('canvas')
        canvas.width = 1920
        canvas.height = 1080
        const exported = window.__probe.artSample
        return exported || null
      })(),
      row: {
        mounted: document.querySelector('[data-dsh-misaka-row]') !== null,
        sliders: document.querySelectorAll('[data-dsh-misaka-row] input[type="range"]').length,
        preview: document.querySelector('[data-dsh-misaka-row] .misaka-preview img')?.getAttribute('src')?.slice(0, 22) || null
      }
    }
  })

  // Prove the wallpaper is not a flat fill: sample distinct colours from the
  // rendered PNG through an offscreen canvas in the page.
  const artStats = await page.evaluate(async () => {
    const src = document.querySelector('.dsh-misaka-layer img').getAttribute('src')
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = src
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const buckets = new Set()
    let min = 255
    let max = 0
    let sum = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4 * 97) {
      const luma = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
      buckets.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`)
      min = Math.min(min, luma)
      max = Math.max(max, luma)
      sum += luma
      count += 1
    }
    return { width: canvas.width, height: canvas.height, distinctBuckets: buckets.size, lumaMin: min, lumaMax: max, lumaAvg: Math.round(sum / count), samples: count }
  })

  await page.screenshot({ path: join(out, 'light.png') })
  // Row screenshot: grow the viewport to the document height, then clip in
  // viewport coordinates. (`clip` and `fullPage` are mutually exclusive.)
  const rowBox = await page.evaluate(() => {
    const row = document.querySelector('[data-dsh-misaka-row]')
    if (!row) return null
    const rect = row.getBoundingClientRect()
    return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height }
  })
  if (rowBox && rowBox.height > 0) {
    await page.setViewport({
      width: 1280,
      height: Math.max(900, Math.ceil(rowBox.y + rowBox.height + 40))
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    // Re-measure after the resize: viewport-relative coordinates are what
    // puppeteer's `clip` expects.
    const clipBox = await page.evaluate(() => {
      const row = document.querySelector('[data-dsh-misaka-row]')
      const rect = row.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollY: window.scrollY, docHeight: document.documentElement.scrollHeight }
    })
    console.log('rowBox', JSON.stringify(rowBox), 'clipBox', JSON.stringify(clipBox))
    const structure = await page.evaluate(() => {
      const row = document.querySelector('[data-dsh-misaka-row]')
      const summary = []
      const walk = (el, depth) => {
        const rect = el.getBoundingClientRect()
        summary.push(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}.${el.className || '-'} ${Math.round(rect.width)}x${Math.round(rect.height)}`)
        for (const child of el.children) walk(child, depth + 1)
      }
      walk(row, 0)
      return summary.join('\n')
    })
    console.log(structure)
    await page.screenshot({
      path: join(out, 'settings-row.png'),
      clip: {
        x: Math.max(0, clipBox.x - 8),
        y: Math.max(0, clipBox.y - 8),
        width: Math.min(clipBox.width + 16, 1280),
        height: Math.min(clipBox.height + 16, 1400)
      }
    })
    await page.setViewport({ width: 1280, height: 820 })
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await new Promise((resolve) => setTimeout(resolve, 250))
  const darkScrim = await page.evaluate(() => getComputedStyle(document.querySelector('.dsh-misaka-scrim')).backgroundColor)
  await page.screenshot({ path: join(out, 'dark.png') })
  await page.evaluate(() => document.querySelector('[data-theme-toggle]').click())

  // Narrow viewport: the mobile framing must apply below 1024px.
  await page.setViewport({ width: 820, height: 900 })
  await new Promise((resolve) => setTimeout(resolve, 200))
  const narrow = await page.evaluate(() => getComputedStyle(document.querySelector('.dsh-misaka-layer img')).objectPosition)
  await page.screenshot({ path: join(out, 'narrow.png') })

  console.log(JSON.stringify({ ...report, darkScrim, narrowObjectPosition: narrow, artStats }, null, 2))
} finally {
  await browser.close()
}
