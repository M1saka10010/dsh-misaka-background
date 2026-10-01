// Why does the layer's transition compute to `none 0s` in probe-delayed.html?
import puppeteer from 'puppeteer-core'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const inspect = async (page) => page.evaluate(() => {
  const layer = document.querySelector('.dsh-misaka-layer')
  const style = document.querySelector('style[data-plugin-css="dsh-misaka-background/styles"]')
  const css = style ? style.textContent : ''
  const matching = []
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (const rule of rules) {
      const text = rule.cssText || ''
      if (rule.media && /reduced-motion/.test(rule.conditionText || '')) {
        matching.push(`MEDIA(${rule.conditionText}) matches=${window.matchMedia(rule.conditionText).matches}`)
      }
      if (text.includes('dsh-misaka-layer') && !rule.media) matching.push(text.slice(0, 200))
    }
  }
  return {
    file: location.pathname.split('/').pop(),
    reducedMotionMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    noPreferenceMatches: window.matchMedia('(prefers-reduced-motion: no-preference)').matches,
    computedTransitionProperty: layer ? getComputedStyle(layer).transitionProperty : null,
    computedTransitionDuration: layer ? getComputedStyle(layer).transitionDuration : null,
    layerAttrs: layer ? [...layer.attributes].map((a) => a.name) : null,
    cssHead: css.slice(0, 420),
    cssHasBaseTransition: css.includes('transition: opacity 480ms cubic-bezier(.22, 1, .36, 1)'),
    matchingRules: matching
  }
})

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--allow-file-access-from-files', '--no-sandbox', '--hide-scrollbars']
})
try {
  for (const file of ['probe-delayed.html', 'probe.html']) {
    const page = await browser.newPage()
    await page.goto(new URL('./' + file, import.meta.url).href, { waitUntil: 'load' })
    await page.waitForFunction('window.__probe && window.__probe.ready === true', { timeout: 20000 })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const report = await inspect(page)
    console.log('=== ' + file + ' ===')
    console.log(JSON.stringify(report, null, 1))
    await page.close()
  }
} finally {
  await browser.close()
}
void here
