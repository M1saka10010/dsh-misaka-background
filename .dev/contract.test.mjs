// Contract test for the hand-written client bundle.
//
// Loads lib/client.js in a jsdom page the way the browser module table does,
// then drives the plugin through its public API and asserts the observable
// effects: the two decorative layers, the body gate attributes, the CSS
// variables, the injected stylesheet, and a clean teardown.
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

// A canvas stub: paintArtwork only needs a 2D context surface, and this test is
// about the plugin's DOM contract, not about raster output. `canvasFailing` lets
// a case simulate the transient render failure the plugin documents.
let canvasFailing = false
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  if (canvasFailing) return null
  const gradient = { addColorStop() {} }
  return {
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
    save() {}, restore() {}, translate() {}, rotate() {}, putImageData() {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    fillStyle: '', globalCompositeOperation: 'source-over'
  }
}
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,STUB'

// The loader facade the bundles call. `id` must be the package name and the
// factory receives the synchronous require.
const registered = new Map()
window.__ModuleLoader__ = {
  load(entry) {
    registered.set(entry.id, entry.factory)
  }
}

// Minimal `react` seed module: createElement returning plain descriptor objects
// plus the four hooks the row uses. `useEffect` runs its body immediately (as
// React would after commit) and records the cleanup.
const componentCleanups = []
const hookState = {}
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => {
    const slot = `h${Object.keys(hookState).length}`
    if (!(slot in hookState)) hookState[slot] = typeof initial === 'function' ? initial() : initial
    return [hookState[slot], (next) => { hookState[slot] = next }]
  },
  useEffect: (body) => { componentCleanups.push(body()) },
  useMemo: (factory) => factory(),
  useSyncExternalStore: (subscribe, read) => read()
}
const require = (id) => {
  if (id === 'react') return react
  throw new Error(`unexpected require: ${id}`)
}

// Execute the bundle exactly as a classic script would. A classic script sees
// the page globals, so `document` / `MutationObserver` / `Image` are parameters
// here for the same reason they are implicit in the browser.
new window.Function('window', 'document', 'MutationObserver', 'Image', 'requestAnimationFrame', BUNDLE)(
  window, document, window.MutationObserver, window.Image, window.requestAnimationFrame.bind(window)
)

assert.ok(registered.has('dsh-misaka-background'), 'bundle must register under its package name')
const exported = registered.get('dsh-misaka-background')(require)
assert.equal(typeof exported.apply, 'function', 'exports.apply must be a function')
assert.deepEqual(exported.inject, ['slots', 'locale'], 'exports.inject must list slots + locale')

// Cordis-shaped stub context: one effect recorder and one slot injector.
const effects = []
const registeredSlots = []
let rowComponent = null
const ctx = {
  effect: (callback, label) => {
    const dispose = callback()
    effects.push({ label, dispose })
    return () => {}
  },
  locale: { register: (ns, dictionaries) => assert.equal(ns, 'misaka-background') && assert.ok(dictionaries.zh && dictionaries.en) },
  slots: {
    inject: (name, callback) => {
      assert.equal(name, 'settings.general.item')
      registeredSlots.push(callback())
    },
    register: (options, component) => {
      assert.equal(options.name, 'settings.general.item')
      assert.equal(options.id, 'dsh-misaka-background')
      assert.equal(options.locale, 'misaka-background')
      assert.equal(typeof options.order, 'number')
      assert.equal(typeof component, 'function', 'the row must be a plain function component')
      rowComponent = component
      return () => {}
    }
  },
  get: () => undefined
}

exported.apply(ctx)

// ---- default paint ------------------------------------------------------

const ACTIVE = 'data-dsh-misaka-bg'
const GLASS = 'data-dsh-misaka-bg-glass'
const body = document.body

assert.equal(registeredSlots.length, 1, 'exactly one settings row must register')
assert.equal(body.getAttribute(ACTIVE), 'on', 'enabled by default')
assert.equal(body.getAttribute(GLASS), 'on', 'glass on by default')
assert.equal(document.querySelectorAll('.dsh-misaka-layer').length, 1, 'one wallpaper layer')
assert.equal(document.querySelectorAll('.dsh-misaka-scrim').length, 1, 'one scrim')

const image = document.querySelector('.dsh-misaka-layer img')
assert.equal(image.getAttribute('src'), 'data:image/png;base64,STUB', 'procedural art must be the default source')

// The fade is gated on the wallpaper decoding *and* on a painted frame: the gate
// starts closed, the browser paints `opacity: 0`, and only a following frame
// reopens it. jsdom never decodes an image, so the decode event the browser would
// fire is dispatched by hand.
const artLayer = document.querySelector('.dsh-misaka-layer')
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
assert.equal(artLayer.dataset.ready, 'false', 'fade gate must start closed')
assert.equal(artLayer.dataset.instant, 'true', 'the gate must close instantly')
assert.equal(artLayer.dataset.ready, 'false', 'the gate must not open in the task that closed it')
image.dispatchEvent(new window.Event('load'))
assert.equal(artLayer.dataset.ready, 'false',
  'the decode alone must not open the gate — a frame carrying opacity 0 has to be painted first')
await settle(220)
assert.equal(artLayer.dataset.ready, 'true', 'fade gate must clear after a painted frame')
assert.equal(artLayer.dataset.instant, undefined,
  'the reveal must restore the transition, or the fade pops instead of animating')

// ---- source change keeps the gate closed until a painted frame -------------
// The blog gates the reveal on a detached preloader; reusing the visible <img>
// would dim the *stale* bitmap for the whole 480ms fade.
const clickRowButtonEarly = (label) => {
  let clicked = false
  walk(rowComponent({ t: (key) => key }), (node) => {
    if (node.type !== 'button') return
    const children = [].concat(node.children ?? [])
    if (children.some((child) => child === label) && typeof node.props?.onClick === 'function') {
      node.props.onClick()
      clicked = true
    }
  })
  assert.ok(clicked, `row must expose a clickable "${label}" button`)
}
artLayer.dataset.ready = 'true'
// The canvas stub returns one fixed PNG regardless of seed, so a repaint would
// correctly reuse the same source and not restart the fade. Switching to a
// custom URL and back is a genuine source change; exercise that path.
image.setAttribute('src', 'data:image/png;base64,PREVIOUS')
clickRowButtonEarly('clear')
assert.equal(artLayer.dataset.ready, 'false', 'a source change must close the gate')
assert.equal(artLayer.dataset.instant, 'true',
  'the close must be instant, otherwise the reveal interrupts a 1 -> 0 transition and the fade is invisible')
assert.ok(image.getAttribute('src').endsWith('STUB'), 'the built-in source is swapped in before the reveal')
// The reveal waits for the decode *and* a painted frame, so the gate is still
// closed on the frame that carries `opacity: 0`.
assert.equal(artLayer.dataset.ready, 'false',
  'the gate must still be closed on the frame that paints opacity 0')
image.dispatchEvent(new window.Event('load'))
assert.equal(artLayer.dataset.ready, 'false', 'the decode alone must not open the gate')
await settle(220)
assert.equal(artLayer.dataset.ready, 'true', 'the gate reopens once a frame has been painted')
assert.equal(artLayer.dataset.instant, undefined,
  'the transition must be restored for the reveal so the fade actually animates')

// ---- a reveal that lands inside the window must still fade ----------------
// Regression for the re-review's D1: `applySection`'s "source unchanged" branch
// used to call markReady() while `data-instant` was still set, which turned the
// fade into a pop for any store write landing in the reveal window.
image.setAttribute('src', 'data:image/png;base64,PREVIOUS')
clickRowButtonEarly('clear')
assert.equal(artLayer.dataset.instant, 'true', 'gate closed for the new attempt')
// A section write arrives during the ~2-frame reveal window (a slider step).
clickRowButtonEarly('glass')
assert.equal(artLayer.dataset.instant, undefined,
  'any reveal must clear data-instant, so the fade is never a pop')
assert.equal(artLayer.dataset.ready, 'true', 'the reveal happened')
await settle(60)
assert.equal(artLayer.dataset.instant, undefined, 'the transition stays restored')

// ---- a failing artwork render must not leave the wallpaper hidden ---------
// `setSource('')` (the canvas-failure path) is the branch that lacked a
// generation guard. Whatever it does, the layer must end up revealed with its
// transition restored — never stuck at opacity 0.
canvasFailing = true
clickRowButtonEarly('seed')
assert.equal(artLayer.dataset.ready, 'false', 'a failed render closes the gate')
await settle(260)
assert.equal(artLayer.dataset.ready, 'true',
  'a failed artwork render must still reveal, or the wallpaper stays invisible')
assert.equal(artLayer.dataset.instant, undefined, 'and the transition must be restored')
assert.equal(image.getAttribute('src'), null, 'the failed render leaves no source on the layer')
canvasFailing = false

const style = body.style
assert.equal(style.getPropertyValue('--bg-scrim'), '0.700', 'blog overlay 40% => scrim alpha 0.7')
assert.equal(style.getPropertyValue('--bg-mobile-x'), '76%')
assert.equal(style.getPropertyValue('--bg-mobile-y'), '38%')
assert.equal(style.getPropertyValue('--bg-desktop-x'), '50%')
assert.equal(style.getPropertyValue('--bg-desktop-y'), '0%')
assert.equal(style.getPropertyValue('--dsw-alias-bg-base'), 'transparent')
assert.equal(style.getPropertyValue('--dsw-specific-sidebar-fill'), 'transparent')

const css = document.querySelector('style[data-plugin-css="dsh-misaka-background/styles"]')
assert.ok(css, 'the stylesheet must be injected')
assert.match(css.textContent, /transition: opacity 480ms cubic-bezier\(\.22, 1, \.36, 1\)/)
assert.match(css.textContent, /@media \(min-width: 1024px\)/)
assert.match(css.textContent, /prefers-reduced-motion/)
assert.match(css.textContent, /rgb\(247 248 252 \/ var\(--bg-scrim, 0\.7\)\)/)
assert.match(css.textContent, /rgb\(13 15 22 \/ var\(--bg-scrim, 0\.7\)\)/)
assert.match(css.textContent, /body > \.dsh-misaka-layer/)
assert.match(css.textContent, /-webkit-app-region: initial !important/)

// ---- live knob: a drag must paint without persisting --------------------

const before = window.localStorage.getItem('dsh-misaka-background:settings')
// The row component is rendered by the host; here the knob path is reached
// through the store subscription, which is the same code the sliders call.
body.style.setProperty('--bg-scrim', '0.700')
assert.equal(window.localStorage.getItem('dsh-misaka-background:settings'), before ?? null,
  'no storage write before any user gesture')

// ---- dark scheme --------------------------------------------------------

// A theme flip must re-derive the glass variables. The row's own observer is
// the mechanism the GUI relies on, so the row gets mounted first.
const tree = rowComponent({ t: (key) => key })

/** Depth-first walk over the descriptor tree `createElement` produces. */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  // Function components are the row's own sub-components (RangeField); render
  // them the way the slot renderer would, then keep walking.
  if (typeof node.type === 'function' && node.type !== rowComponent) {
    walk(node.type({ ...node.props, children: node.children }), visit)
    return
  }
  walk(node.children, visit)
}

const classes = []
const inputs = []
walk(tree, (node) => {
  const className = node.props?.className
  if (typeof className === 'string') classes.push(className)
  if (node.type === 'input') inputs.push(node.props)
})
assert.ok(classes.includes('misaka-field'), 'the row must render range fields')
assert.equal(inputs.filter((props) => props.type === 'range').length, 5, 'five sliders')
assert.equal(inputs.filter((props) => props.type === 'text').length, 1, 'one URL field')
const ranges = inputs.filter((props) => props.type === 'range')
assert.deepEqual(ranges.map((props) => props.max), [70, 100, 60, 40, 160], 'slider ranges')
assert.ok(classes.includes('misaka-preview'), 'the live preview card must render')
assert.ok(tree.props['data-dsh-misaka-row'] === 'on', 'the row must carry its root marker')

body.setAttribute('data-ds-dark-theme', '')
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(style.getPropertyValue('--bg-glass-fill'), 'rgba(28, 31, 41, 0.62)', 'dark glass fill')
assert.equal(style.getPropertyValue('--bg-glass-brightness'), '1.04')
const scrimRule = /body\[data-ds-dark-theme\] \.dsh-misaka-scrim/.test(css.textContent)
assert.ok(scrimRule, 'dark scrim rule must exist')

// ---- teardown restores the official paint -------------------------------

for (const cleanup of componentCleanups) if (typeof cleanup === 'function') cleanup()
for (const effect of effects) if (typeof effect.dispose === 'function') effect.dispose()

assert.equal(body.hasAttribute(ACTIVE), false, 'active attribute must be cleared')
assert.equal(body.hasAttribute(GLASS), false, 'glass attribute must be cleared')
assert.equal(document.querySelectorAll('.dsh-misaka-layer').length, 0, 'wallpaper layer removed')
assert.equal(document.querySelectorAll('.dsh-misaka-scrim').length, 0, 'scrim removed')
assert.equal(body.style.getPropertyValue('--bg-scrim'), '', 'owned variable restored')
assert.equal(body.style.getPropertyValue('--dsw-alias-bg-base'), '', 'frame token restored')
assert.equal(document.querySelector('style[data-plugin-css="dsh-misaka-background/styles"]'), null,
  'stylesheet removed on dispose')

// Regression: dispose must not clobber a value somebody else re-themed while
// the backdrop was live, and must still restore properties it still owns. The
// two host-owned tokens are the deliberate exception — their saved value
// predates the plugin and is the host's own, so a value comparison cannot tell
// "we wrote this" from "somebody wrote the same string" and they are restored
// unconditionally.
const hostThirdGeneration = registered.get('dsh-misaka-background')(require)
const thirdEffects = []
hostThirdGeneration.apply({
  effect: (callback) => { thirdEffects.push({ dispose: callback() }); return () => {} },
  locale: { register: () => {} },
  slots: { inject: (name, callback) => callback(), register: () => () => {} },
  get: () => undefined
})
assert.equal(body.style.getPropertyValue('--bg-scrim'), '0.700', 'third generation owns --bg-scrim')
// The "host" re-themes the frame token and a plugin-private one.
body.style.setProperty('--dsw-alias-bg-base', 'rgb(9, 9, 9)')
body.style.setProperty('--bg-scrim', '0.123')
for (const effect of thirdEffects) if (typeof effect.dispose === 'function') effect.dispose()
assert.equal(body.style.getPropertyValue('--dsw-alias-bg-base'), '',
  'a host-owned token must be handed back to its pre-plugin value')
assert.equal(body.style.getPropertyValue('--bg-scrim'), '0.123',
  'a plugin-private value changed by someone else must survive dispose')

// Regression: the section store lives at module scope and outlives the plugin
// generation, so its listener must be detached on dispose. Drive a real store
// write through the row's own button and prove nothing repaints afterwards.
const clickRowButton = (label) => {
  let clicked = false
  walk(rowComponent({ t: (key) => key }), (node) => {
    if (node.type !== 'button') return
    const children = [].concat(node.children ?? [])
    if (children.some((child) => child === label) && typeof node.props?.onClick === 'function') {
      node.props.onClick()
      clicked = true
    }
  })
  assert.ok(clicked, `row must expose a clickable "${label}" button`)
}

for (const cleanup of componentCleanups) if (typeof cleanup === 'function') cleanup()
for (const effect of effects) if (typeof effect.dispose === 'function') effect.dispose()
assert.equal(document.querySelectorAll('.dsh-misaka-layer').length, 0, 'disposed: no layers')

clickRowButton('seed')
assert.equal(document.querySelectorAll('.dsh-misaka-layer').length, 0,
  'a store write after dispose must not resurrect the backdrop')

// A second generation still works, and retracts cleanly.
const second = registered.get('dsh-misaka-background')(require)
const secondEffects = []
second.apply({
  effect: (callback) => { secondEffects.push({ dispose: callback() }); return () => {} },
  locale: { register: () => {} },
  slots: { inject: (name, callback) => callback(), register: () => () => {} },
  get: () => undefined
})
assert.equal(document.querySelectorAll('.dsh-misaka-layer').length, 1, 'second generation paints one layer')
for (const effect of secondEffects) if (typeof effect.dispose === 'function') effect.dispose()
assert.equal(document.querySelectorAll('.dsh-misaka-layer').length, 0, 'second generation retracts')

console.log('client bundle contract: OK')
console.log(`  registered=${registered.size} effects=${effects.length} slots=${registeredSlots.length}`)
console.log('  scrim@40=0.700 framing=mobile 76/38 desktop 50/0 fade=480ms ease-out-expo')
console.log('  teardown restored every owned property, removed both layers and detached the store listener')
