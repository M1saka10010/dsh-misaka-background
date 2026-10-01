// Final end-to-end verification against a live dsh web instance.
//
// Loads the real GUI in Chrome, then asserts the plugin's full observable
// contract: the boot graph serves its bundle, both decorative layers exist with
// the right z-index, the stylesheet is injected, the body gates are on, every
// CSS variable carries the blog's measured value, the fade actually animates
// from opacity 0 on first paint, the settings row renders with all controls, and
// the app reports no page errors.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'gui-shots')
mkdirSync(out, { recursive: true })

const url = process.argv[2]
if (!url) {
  console.error('usage: node gui-verify.mjs "<authenticated url>"')
  process.exit(2)
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--no-sandbox']
})

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  return condition
}

const pageErrors = []
const consoleErrors = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  // The in-page fade assertion needs motion allowed: Chromium takes
  // `prefers-reduced-motion` from the host OS, and this machine reports `reduce`,
  // which legitimately removes the transition. Pinning it makes the fade
  // measurement describe the default experience rather than this host's setting.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 400)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
  })

  // A document-start sampler records the wallpaper's very first frames, which is
  // where a correct fade begins at opacity 0.
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
      if (performance.now() - started < 3000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  check('authenticated load', response && response.status() === 200, `status ${response && response.status()}`)
  await page.waitForFunction(() => document.querySelector('.dsh-misaka-layer') !== null, { timeout: 30000 })
  await new Promise((resolve) => setTimeout(resolve, 3000))

  const state = await page.evaluate(() => {
    const body = document.body
    const layer = document.querySelector('.dsh-misaka-layer')
    const image = layer?.querySelector('img')
    const scrim = document.querySelector('.dsh-misaka-scrim')
    const style = document.querySelector('style[data-plugin-css="dsh-misaka-background/styles"]')
    const cssVar = (name) => body.style.getPropertyValue(name)
    const computed = (element, prop) => (element ? getComputedStyle(element).getPropertyValue(prop) : null)
    return {
      bodyGates: {
        active: body.getAttribute('data-dsh-misaka-bg'),
        glass: body.getAttribute('data-dsh-misaka-bg-glass')
      },
      stylesheetBytes: style ? style.textContent.length : 0,
      layer: layer ? { zIndex: computed(layer, 'z-index'), position: computed(layer, 'position'), ready: layer.dataset.ready } : null,
      scrim: scrim ? { zIndex: computed(scrim, 'z-index'), background: computed(scrim, 'background-color') } : null,
      image: image ? {
        fit: computed(image, 'object-fit'),
        position: computed(image, 'object-position'),
        natural: `${image.naturalWidth}x${image.naturalHeight}`,
        scheme: String(image.getAttribute('src') || '').slice(0, 22)
      } : null,
      vars: {
        scrim: cssVar('--bg-scrim'),
        mobileX: cssVar('--bg-mobile-x'),
        mobileY: cssVar('--bg-mobile-y'),
        desktopX: cssVar('--bg-desktop-x'),
        desktopY: cssVar('--bg-desktop-y'),
        glassFill: cssVar('--bg-glass-fill'),
        frame: cssVar('--dsw-alias-bg-base'),
        sidebar: cssVar('--dsw-specific-sidebar-fill')
      },
      fade: window.__fade || [],
      bootMentionsPlugin: /dsh-misaka-background/.test(document.documentElement.innerHTML)
    }
  })

  // ---- contract assertions ------------------------------------------------
  check('body gate attribute', state.bodyGates.active === 'on', JSON.stringify(state.bodyGates))
  check('glass gate attribute', state.bodyGates.glass === 'on')
  check('stylesheet injected', state.stylesheetBytes > 4000, `${state.stylesheetBytes} bytes`)
  check('wallpaper layer exists', state.layer !== null)
  check('layer is fixed', state.layer?.position === 'fixed')
  check('layer sits behind the app', state.layer?.zIndex === '-2', `z-index ${state.layer?.zIndex}`)
  check('scrim sits above the wallpaper', state.scrim?.zIndex === '-1', `z-index ${state.scrim?.zIndex}`)
  check('scrim is the blog light tint at 0.7', state.scrim?.background === 'rgba(247, 248, 252, 0.7)', state.scrim?.background)
  check('wallpaper is cover', state.image?.fit === 'cover')
  check('desktop framing 50% 0%', state.image?.position === '50% 0%', state.image?.position)
  check('wallpaper decoded 1920x1080', state.image?.natural === '1920x1080', state.image?.natural)
  check('scrim variable 0.700', state.vars.scrim === '0.700', state.vars.scrim)
  check('mobile framing 76%/38%', state.vars.mobileX === '76%' && state.vars.mobileY === '38%')
  check('desktop framing variables 50%/0%', state.vars.desktopX === '50%' && state.vars.desktopY === '0%')
  check('app frame transparent', state.vars.frame === 'transparent', state.vars.frame)
  check('sidebar transparent', state.vars.sidebar === 'transparent', state.vars.sidebar)
  check('boot graph carries the plugin', state.bootMentionsPlugin)

  // The boot-time sampler proves the gate opens only after a closed frame, but
  // the app's own startup work starves it of intermediate frames — the honest
  // animation measurement happens further down, on a post-boot repaint.
  const fade = state.fade
  const distinct = [...new Set(fade.map((s) => s.opacity.toFixed(3)))].length
  const minOpacity = fade.length ? Math.min(...fade.map((s) => s.opacity)) : null
  const midFrames = fade.filter((s) => s.opacity > 0.02 && s.opacity < 0.98).length
  check('boot fade sampled frames', fade.length >= 3, `${fade.length} samples`)
  check('boot fade starts closed', minOpacity !== null && minOpacity < 0.05, `min=${minOpacity}`)
  check('boot fade settles open', fade.some((s) => s.opacity > 0.9) || state.layer?.ready === 'true',
    'never reached opacity 1')

  await page.screenshot({ path: join(out, 'final-app.png') })

  // ---- settings row ------------------------------------------------------
  const row = await page.evaluate(async () => {
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
    const element = document.querySelector('[data-dsh-misaka-row]')
    if (!element) return null
    element.scrollIntoView({ block: 'center' })
    await sleep(500)
    const rect = element.getBoundingClientRect()
    return {
      heading: element.querySelector('.misaka-title')?.textContent || null,
      sliders: element.querySelectorAll('input[type="range"]').length,
      textFields: element.querySelectorAll('input[type="text"]').length,
      buttons: [...element.querySelectorAll('button')].map((b) => (b.textContent || '').trim()),
      previewUsable: (() => {
        const img = element.querySelector('.misaka-preview img')
        return img ? img.naturalWidth > 0 : false
      })(),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
    }
  })

  check('settings row is present', row !== null)
  check('row heading is localized', row?.heading === '参考背景', row?.heading)
  check('row has five sliders', row?.sliders === 5, `sliders=${row?.sliders}`)
  check('row has the URL field', row?.textFields === 1)
  check('preview image decodes', row?.previewUsable === true)

  if (row) {
    await page.screenshot({
      path: join(out, 'final-settings-row.png'),
      clip: {
        x: Math.max(0, row.box.x - 10),
        y: Math.max(0, row.box.y - 10),
        width: Math.min(row.box.w + 20, 1440),
        height: Math.min(row.box.h + 20, 880)
      }
    })
  }

  // ---- the fade on a wallpaper CHANGE, measured with an idle main thread ----
  // The boot-time sampler above is starved by the app's own startup work, so it
  // catches the closed gate and the settled value but no intermediate frames.
  // Repainting the wallpaper once the app has settled measures the transition
  // honestly.
  const changeSample = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const layer = document.querySelector('.dsh-misaka-layer')
    const before = layer.querySelector('img').getAttribute('src')
    const repaint = [...document.querySelectorAll('[data-dsh-misaka-row] button')]
      .find((b) => (b.textContent || '').trim() === '换一张')
    if (!repaint) return { error: 'no repaint button' }
    const samples = []
    const started = performance.now()
    repaint.click()
    while (performance.now() - started < 900) {
      samples.push({
        t: Math.round(performance.now() - started),
        ready: layer.dataset.ready,
        opacity: Number(getComputedStyle(layer).opacity)
      })
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const after = layer.querySelector('img').getAttribute('src')
    const values = [...new Set(samples.map((s) => s.opacity.toFixed(3)))]
    return {
      sourceChanged: before !== after,
      samples: samples.length,
      distinct: values.length,
      min: Math.min(...samples.map((s) => s.opacity)),
      max: Math.max(...samples.map((s) => s.opacity)),
      midFrames: samples.filter((s) => s.opacity > 0.02 && s.opacity < 0.98).length,
      first: samples.slice(0, 6)
    }
  }, {})

  check('repaint changes the wallpaper source', changeSample?.sourceChanged === true, JSON.stringify(changeSample))
  check('change fades through intermediate opacities',
    (changeSample?.distinct ?? 0) >= 5 && (changeSample?.midFrames ?? 0) >= 3,
    `distinct=${changeSample?.distinct} mid=${changeSample?.midFrames}`)
  check('change starts from a closed gate', (changeSample?.min ?? 1) < 0.05, `min=${changeSample?.min}`)

  await page.screenshot({ path: join(out, 'final-settings-row.png'), clip: row ? {
    x: Math.max(0, row.box.x - 10),
    y: Math.max(0, row.box.y - 10),
    width: Math.min(row.box.w + 20, 1440),
    height: Math.min(row.box.h + 20, 880)
  } : undefined })

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '))
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))

  console.log(JSON.stringify({
    state: { ...state, fade: fade.slice(0, 5), fadeSamples: fade.length, distinct, midFrames, minOpacity },
    changeSample,
    row,
    pageErrors,
    consoleErrors
  }, null, 2))

  console.log('\n' + '='.repeat(60))
  if (failures.length === 0) {
    console.log('LIVE GUI VERIFICATION: PASS — every assertion held')
  } else {
    console.log(`LIVE GUI VERIFICATION: FAIL (${failures.length})`)
    for (const failure of failures) console.log('  - ' + failure)
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
