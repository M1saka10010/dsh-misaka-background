// Regression test: a transient artwork render failure must not be memoized.
//
// Re-runs the plugin in a second page where the first canvas render throws, then
// proves a later apply recovers instead of staying stuck on the flat plate.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const BUNDLE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:19387/',
  pretendToBeVisual: true
})
const { window } = dom
const { document } = window

let renderAttempts = 0
let failNextRender = true
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  renderAttempts += 1
  if (failNextRender) {
    failNextRender = false
    return null // the shape a blocked/failed 2D context takes
  }
  const gradient = { addColorStop() {} }
  return {
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
    save() {}, restore() {}, translate() {}, rotate() {}, putImageData() {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    globalCompositeOperation: 'source-over',
    fillStyle: ''
  }
}
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,RECOVERED'

let registered = null
window.__ModuleLoader__ = { load: (entry) => { registered = entry.factory } }

const hookState = {}
const react = {
  createElement: () => ({ type: 'div', props: {}, children: [] }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useSyncExternalStore: (subscribe, read) => read()
}

new window.Function('window', 'document', 'MutationObserver', 'Image', 'requestAnimationFrame', BUNDLE)(
  window, document, window.MutationObserver, window.Image, window.requestAnimationFrame.bind(window)
)
const exported = registered((id) => {
  if (id === 'react') return react
  throw new Error('unexpected require: ' + id)
})
void hookState

const effects = []
exported.apply({
  effect: (callback) => { effects.push({ dispose: callback() }); return () => {} },
  locale: { register: () => {} },
  slots: { inject: (name, callback) => callback(), register: () => () => {} },
  get: () => undefined
})

const layer = document.querySelector('.dsh-misaka-layer')
const image = layer?.querySelector('img')
assert.ok(layer, 'layer must exist')
assert.equal(renderAttempts, 1, 'the first render must have been attempted')
assert.equal(image.getAttribute('src'), null, 'a failed render leaves no source')

// The reveal is deliberately deferred by a painted frame.
await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))))

// Second generation: the same seed must be retried, not served from a poisoned cache.
window.__ModuleLoader__ = { load: (entry) => { registered = entry.factory } }
new window.Function('window', 'document', 'MutationObserver', 'Image', 'requestAnimationFrame', BUNDLE)(
  window, document, window.MutationObserver, window.Image, window.requestAnimationFrame.bind(window)
)
const second = registered((id) => {
  if (id === 'react') return react
  throw new Error('unexpected require: ' + id)
}).apply({
  effect: (callback) => { callback(); return () => {} },
  locale: { register: () => {} },
  slots: { inject: (name, callback) => callback(), register: () => () => {} },
  get: () => undefined
})
void second

// Both generations share the module scope, so both layers coexist; the newest
// one is the one the retry must have filled.
const layers = [...document.querySelectorAll('.dsh-misaka-layer')]
assert.equal(layers.length, 2, 'both generations painted a layer')
const secondLayer = layers[layers.length - 1]
assert.equal(renderAttempts, 2, 'the render must be retried after a failure')
const recoveredSrc = secondLayer.querySelector('img')?.getAttribute('src') ?? ''
assert.notEqual(recoveredSrc, '', 'the retried render must be published')
assert.ok(recoveredSrc.startsWith('data:image/png'), `published source must be the retried artwork, got ${recoveredSrc.slice(0, 40)}`)

console.log('cache-poisoning regression: OK')
console.log(`  render attempts=${renderAttempts}, recovered src=${recoveredSrc.slice(0, 40)}...`)
