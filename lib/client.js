/**
 * dsh-misaka-background — client half.
 *
 * Recreates the backdrop treatment of https://blog.misaka.ren inside the
 * DeepSeek Harness web GUI:
 *
 *   1. a fixed wallpaper layer behind the whole app frame — `cover`, no-repeat,
 *      `inset: 0`, mobile framing `76% 38%`, desktop framing `50% 0%` from the
 *      blog's `64rem` (1024px) breakpoint, and a 480ms
 *      `cubic-bezier(.22, 1, .36, 1)` opacity fade gated on the art decoding;
 *   2. a theme-aware readability scrim above it — `rgb(13 15 22 / 0.7)` in the
 *      dark scheme, `rgb(247 248 252 / 0.7)` in the light one, i.e. the blog's
 *      `0.3 + backgroundOverlay` with `backgroundOverlay: 40`;
 *   3. frosted-glass fills for the surfaces that float over the art (composer
 *      card, message bubbles, code surfaces); dialogs, settings, menus,
 *      tooltips and toasts keep the official opaque paint.
 *
 * The wallpaper is drawn procedurally on a canvas from the blog’s accent
 * palette, so no binary asset ships and the default look needs no network.
 * A pasted image URL replaces it at runtime.
 *
 * Format note: this is a hand-written client module bundle. The browser-side
 * module table consumes one `window.__ModuleLoader__.load({ id, factory })`
 * call whose factory returns the plugin exports; `id` must equal the package
 * name. No import/export statements are permitted in this file, and only the
 * shell seed modules may be required — `react` is one of them.
 */
window.__ModuleLoader__.load({
	id: 'dsh-misaka-background',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		var react = require('react')

		//#region constants

		/** Style-element dedup key. */
		const CSS_TAG = 'dsh-misaka-background/styles'
		/** Body attribute set while a wallpaper is painted. */
		const ACTIVE_ATTR = 'data-dsh-misaka-bg'
		/** Body attribute set while the frosted-glass fills are on. */
		const GLASS_ATTR = 'data-dsh-misaka-bg-glass'
		/** Root marker on the settings row (styling hook + test anchor). */
		const ROW_ATTR = 'data-dsh-misaka-row'
		/** localStorage key holding the persisted user overrides. */
		const STORAGE_KEY = 'dsh-misaka-background:settings'
		/**
		* Storage record version. Records written before this format held a whole
		* section; every field in one of those was a user choice, so they are read
		* as overrides.
		*/
		const STORAGE_VERSION = 2
		/** Locale namespace this plugin owns. */
		const NS = 'misaka-background'
		/**
		* Where the host half publishes the plugin's configuration. Kept as a
		* literal in both halves: they are separate bundles and cannot import from
		* each other.
		*/
		const CONFIG_ROUTE = '/dsh-misaka-background/config.json'
		/** How long to wait for that route before keeping the shipped defaults. */
		const CONFIG_TIMEOUT_MS = 1500

		/** Palette lifted from the blog: plates, scrim tints and accent hues. */
		const PALETTE = {
			lightPlate: '#f7f8fc',
			darkPlate: '#0d0f16',
			lightScrim: '247 248 252',
			darkScrim: '13 15 22',
			accent: '80, 65, 219',
			deep: '43, 32, 128',
			violet: '154, 139, 255',
			mint: '87, 217, 203'
		}

		/** Blog mobile framing (`--mobile-background-x/y`), below 1024px. */
		const MOBILE_FRAMING = { x: 76, y: 38 }
		/** Blog desktop framing (`--background-x/y`), at or above 1024px. */
		const DESKTOP_FRAMING = { x: 50, y: 0 }

		/** Shipped defaults: the blog's overlay 40% => scrim alpha 0.7. */
		const DEFAULTS = {
			enabled: true,
			overlay: 40,
			wallpaperOpacity: 100,
			wallpaperBlur: 0,
			glass: true,
			glassBlur: 18,
			artSeed: 7,
			artIntensity: 100,
			imageUrl: ''
		}

		/** Every knob the settings row can write, and the only keys configuration may set. */
		const SECTION_KEYS = Object.keys(DEFAULTS)

		/**
		* The section used before anything is configured or overridden. Kept as a
		* frozen snapshot so the painter always has a complete section to read.
		*/
		const DEFAULT_SECTION = { ...DEFAULTS }

		//#endregion

		//#region pure helpers

		/** Clamp a number into a range, falling back when it is not finite. */
		function clampNumber(value, min, max, fallback) {
			const n = typeof value === 'number' ? value : Number(value)
			if (!Number.isFinite(n)) return fallback
			return Math.max(min, Math.min(max, n))
		}

		/**
		* The blog scrim formula, `0.3 + overlay/100`, clamped to the blog's
		* reachable range (the 0.3 floor can never be undercut).
		* @param overlay - the blog's `backgroundOverlay` percentage, 0..70.
		* @returns the alpha applied to the scrim layer.
		*/
		function scrimAlpha(overlay) {
			const value = 0.3 + clampNumber(overlay, 0, 70, DEFAULTS.overlay) / 100
			return Math.max(0.3, Math.min(1, value))
		}

		/** Glass blur saturation boost, capped where a hot saturate would clip. */
		function glassSaturate(blur) {
			if (blur <= 0) return 1
			return Math.round(Math.min(1.6, 1.1 + blur * 0.02) * 1000) / 1000
		}

		/** Translucent glass fill for one scheme. */
		function glassFill(dark) {
			return dark ? 'rgba(28, 31, 41, 0.62)' : 'rgba(255, 255, 255, 0.72)'
		}

		/** @returns whether the shell currently paints the dark scheme. */
		function isDark() {
			return document.body.hasAttribute('data-ds-dark-theme')
		}

		/** Inline stroke icon, so the row needs no icon dependency. */
		function icon(paths) {
			return react.createElement(
				'svg',
				{
					width: 15,
					height: 15,
					viewBox: '0 0 24 24',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.75,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true'
				},
				paths.map((d, index) => react.createElement('path', { key: index, d }))
			)
		}

		//#endregion

		//#region section state

		/** Coerce arbitrary parsed data into a complete, in-range section. */
		function normalizeSection(raw) {
			const input = raw && typeof raw === 'object' ? raw : {}
			const section = {}
			section.enabled = input.enabled !== false
			section.overlay = clampNumber(input.overlay, 0, 70, DEFAULTS.overlay)
			section.wallpaperOpacity = clampNumber(input.wallpaperOpacity, 0, 100, DEFAULTS.wallpaperOpacity)
			section.wallpaperBlur = clampNumber(input.wallpaperBlur, 0, 60, DEFAULTS.wallpaperBlur)
			section.glass = input.glass !== false
			section.glassBlur = clampNumber(input.glassBlur, 0, 40, DEFAULTS.glassBlur)
			section.artSeed = clampNumber(input.artSeed, 1, 99, DEFAULTS.artSeed)
			section.artIntensity = clampNumber(input.artIntensity, 0, 160, DEFAULTS.artIntensity)
			section.imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : ''
			return section
		}

		/**
		* Read the persisted USER OVERRIDES, tolerating absent or corrupt storage.
		*
		* Only the keys the user actually touched are stored, so a value the plugin
		* is *configured* with (row config or `config.json`) still applies to every
		* field the user never changed. Records written before this format stored a
		* whole section, and every field in one of those was a user choice, so they
		* are read as overrides too.
		*/
		function readPersisted() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY)
				if (raw === null) return {}
				const parsed = JSON.parse(raw)
				if (parsed === null || typeof parsed !== 'object') return {}
				if (parsed.v === STORAGE_VERSION && parsed.user !== null && typeof parsed.user === 'object') {
					return parsed.user
				}
				return parsed
			} catch (error) {
				return {}
			}
		}

		/** Persist the user overrides, tolerating storage that refuses writes. */
		function persist(overrides) {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, user: overrides }))
			} catch (error) {
				/* Private mode or quota: the effect still lives for this session. */
			}
		}

		/**
		* The module-level section store. Deliberately not a cordis store seat:
		* the plugin owns exactly one section, both the painter and the settings
		* row read it, and a plain snapshot store keeps the row a pure function of
		* the state without an extra service dependency.
		*
		* Three layers compose into the effective section, later ones winning:
		* `DEFAULTS` < the plugin's own configuration (fetched from the host half) <
		* the user's overrides from the settings row. Keeping the last layer as a
		* sparse patch is what stops a user dragging one slider from silently
		* discarding the configured wallpaper URL.
		*/
		const configState = { current: {} }
		const overridesState = { current: readPersisted() }
		const sectionState = { current: DEFAULT_SECTION }
		const sectionListeners = new Set()

		/** Recompute the effective section from the three layers. */
		function recomputeSection() {
			sectionState.current = normalizeSection({ ...DEFAULTS, ...configState.current, ...overridesState.current })
			return sectionState.current
		}

		// Start from the persisted overrides rather than the bare defaults, so the
		// very first paint already reflects them.
		recomputeSection()

		/** @returns the current effective section (stable identity until a write). */
		function readSection() {
			return sectionState.current
		}

		/** @param listener - notified after each write. @returns the detach. */
		function subscribeSection(listener) {
			sectionListeners.add(listener)
			return () => sectionListeners.delete(listener)
		}

		/** Notify every subscriber. */
		function notifySection() {
			for (const listener of [...sectionListeners]) listener()
		}

		/**
		* Record a user change: merge it into the override layer, persist that layer,
		* recompute the effective section and notify subscribers.
		* @param patch - partial section.
		* @returns the next effective section.
		*/
		function writeSection(patch) {
			overridesState.current = { ...overridesState.current, ...patch }
			persist(overridesState.current)
			// Recompute before notifying: subscribers read `readSection()`, so
			// notifying first would repaint from the previous values.
			recomputeSection()
			notifySection()
			return sectionState.current
		}

		/**
		* Discard every user override, so the plugin's configured values (or the
		* shipped defaults when it has none) take effect again.
		* @returns the next effective section.
		*/
		function resetSection() {
			overridesState.current = {}
			persist(overridesState.current)
			recomputeSection()
			notifySection()
			return sectionState.current
		}

		/**
		* Adopt the configuration published by the host half and repaint if it
		* changed anything.
		*
		* The route is same-origin and read once at startup: the configuration is
		* resolved host-side when the row loads, so it cannot change without the app
		* restarting — which reloads this page anyway. A missing route (no webserver,
		* an older host half, an offline fetch) simply leaves the shipped defaults
		* in place.
		*
		* @returns a promise settling once the attempt is over.
		*/
		async function loadConfig() {
			let timer = null
			try {
				const controller = typeof AbortController === 'function' ? new AbortController() : null
				if (controller !== null) {
					timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS)
				}
				const response = await fetch(CONFIG_ROUTE, {
					credentials: 'same-origin',
					headers: { accept: 'application/json' },
					signal: controller === null ? undefined : controller.signal
				})
				if (!response.ok) return
				const raw = await response.json()
				if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return
				// Keep only recognized keys, so a typo in the configuration cannot
				// inject a field the painter would then read.
				const clean = {}
				for (const key of SECTION_KEYS) {
					if (raw[key] !== undefined) clean[key] = raw[key]
				}
				configState.current = clean
				recomputeSection()
				notifySection()
			} catch (error) {
				/* Aborted, unreachable or malformed: the previous layers stand. */
			} finally {
				if (timer !== null) clearTimeout(timer)
			}
		}

		//#endregion

		//#region procedural artwork

		/** Deterministic PRNG (mulberry32): one seed always paints one image. */
		function createRandom(seed) {
			let state = (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0
			return () => {
				state = (state + 0x6d2b79f5) >>> 0
				let t = state
				t = Math.imul(t ^ (t >>> 15), t | 1)
				t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296
			}
		}

		/**
		* Draw one soft elliptical wash of colour. Positions and radii are
		* fractions of the canvas, so the composition is resolution independent.
		*/
		function wash(ctx, width, height, x, y, radius, color, alpha) {
			const cx = x * width
			const cy = y * height
			const r = radius * Math.max(width, height)
			if (alpha <= 0 || r <= 0) return
			const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
			gradient.addColorStop(0, `rgba(${color}, ${alpha})`)
			gradient.addColorStop(0.55, `rgba(${color}, ${alpha * 0.45})`)
			gradient.addColorStop(1, `rgba(${color}, 0)`)
			ctx.fillStyle = gradient
			ctx.beginPath()
			ctx.arc(cx, cy, r, 0, Math.PI * 2)
			ctx.fill()
		}

		/**
		* Paint the default abstract wallpaper.
		*
		* Composition: a near-white plate, five off-centre washes in the blog's
		* accent palette weighted toward the upper half (the desktop framing shows
		* the top of the image), a diagonal light band, a fine grain pass that
		* stops the washes from banding on a large display, and a vignette so the
		* centred UI stays the brightest area.
		*
		* @param canvas - any canvas whose 2D context is available.
		* @param seed - integer seed; the same seed redraws the same image.
		* @param intensity - 0..160 percentage scaling every wash alpha.
		* @returns the canvas.
		*/
		function paintArtwork(canvas, seed, intensity) {
			const width = canvas.width
			const height = canvas.height
			const ctx = canvas.getContext('2d')
			const random = createRandom(seed)
			const gain = Math.max(0, intensity) / 100

			ctx.setTransform(1, 0, 0, 1, 0, 0)
			ctx.globalCompositeOperation = 'source-over'
			ctx.clearRect(0, 0, width, height)
			ctx.fillStyle = PALETTE.lightPlate
			ctx.fillRect(0, 0, width, height)

			wash(ctx, width, height, 0.42, 0.3, 1.15, PALETTE.violet, 0.44 * gain)
			wash(ctx, width, height, 0.72, 0.62, 0.95, PALETTE.accent, 0.36 * gain)
			wash(ctx, width, height, 0.86, 0.16, 0.52, PALETTE.mint, 0.34 * gain)
			wash(ctx, width, height, 0.16, 0.12, 0.6, PALETTE.violet, 0.32 * gain)
			wash(ctx, width, height, 0.3, 0.95, 0.8, PALETTE.deep, 0.2 * gain)

			ctx.save()
			ctx.translate(width * 0.5, height * 0.22)
			ctx.rotate(-0.36)
			const band = ctx.createLinearGradient(0, -height * 0.5, 0, height * 0.5)
			band.addColorStop(0, 'rgba(255, 255, 255, 0)')
			band.addColorStop(0.5, `rgba(255, 255, 255, ${0.3 * gain})`)
			band.addColorStop(1, 'rgba(255, 255, 255, 0)')
			ctx.fillStyle = band
			ctx.fillRect(0, -height * 0.5, width * 1.4, height)
			ctx.restore()

			const grain = ctx.getImageData(0, 0, width, height)
			const bytes = grain.data
			for (let i = 0; i < bytes.length; i += 4) {
				const noise = (random() - 0.5) * 13
				bytes[i] = Math.max(0, Math.min(255, bytes[i] + noise))
				bytes[i + 1] = Math.max(0, Math.min(255, bytes[i + 1] + noise))
				bytes[i + 2] = Math.max(0, Math.min(255, bytes[i + 2] + noise))
			}
			ctx.putImageData(grain, 0, 0)

			const vignette = ctx.createRadialGradient(
				width * 0.5, height * 0.45, Math.min(width, height) * 0.25,
				width * 0.5, height * 0.45, Math.max(width, height) * 0.78
			)
			vignette.addColorStop(0, 'rgba(255, 255, 255, 0)')
			vignette.addColorStop(1, 'rgba(23, 25, 35, 0.16)')
			ctx.fillStyle = vignette
			ctx.fillRect(0, 0, width, height)

			return canvas
		}

		/** Cached procedural data URL, keyed by the inputs that produced it. */
		const artCache = { key: '', url: '' }

		/**
		* Render the procedural artwork to a PNG data URL, memoized per
		* `seed|intensity`. 1920x1080 matches the reference art's resolution.
		*
		* A failure is deliberately NOT memoized: canvas allocation can fail
		* transiently, and caching that would leave the plugin permanently stuck
		* on the flat plate until the seed changed.
		*
		* @param seed - artwork seed.
		* @param intensity - wash intensity percentage.
		* @returns a `data:image/png;base64,...` URL, or '' when the render failed.
		*/
		function artworkDataUrl(seed, intensity) {
			const key = `${seed}|${intensity}`
			if (artCache.key === key && artCache.url !== '') return artCache.url
			try {
				const canvas = document.createElement('canvas')
				canvas.width = 1920
				canvas.height = 1080
				paintArtwork(canvas, seed, intensity)
				const url = canvas.toDataURL('image/png')
				if (url !== '') {
					artCache.key = key
					artCache.url = url
				}
				return url
			} catch (error) {
				return ''
			}
		}

		//#endregion

		//#region backdrop stylesheet

		/**
		* The injected stylesheet. Every rule is gated on the two body attributes,
		* so disabling the wallpaper (or disposing the plugin) returns the GUI to
		* its exact official paint without residue.
		*/
		const CSS = `
/* ---- wallpaper + scrim ------------------------------------------------- */
.dsh-misaka-layer {
  position: fixed;
  inset: 0;
  z-index: -2;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transition: opacity 480ms cubic-bezier(.22, 1, .36, 1);
}
.dsh-misaka-layer[data-ready='true'] { opacity: var(--bg-wallpaper-opacity, 1); }
/* Closing the gate must be instant. The reveal is a transition from the closed
   state, so if the close also animated, the interruption two frames later would
   leave the opacity barely moved off 1 and the fade would be invisible. The
   blog behaves the same way: its gate has no transition, only the reveal does. */
.dsh-misaka-layer[data-instant='true'] { transition: none; }
.dsh-misaka-layer .dsh-misaka-image {
  width: 100%;
  height: 100%;
  display: block;
  border: 0;
  object-fit: cover;
  object-position: var(--bg-mobile-x, 76%) var(--bg-mobile-y, 38%);
  filter: blur(var(--bg-wallpaper-blur, 0px));
  transform: scale(var(--bg-wallpaper-scale, 1));
  transform-origin: center;
}
@media (min-width: 1024px) {
  .dsh-misaka-layer .dsh-misaka-image {
    object-position: var(--bg-desktop-x, 50%) var(--bg-desktop-y, 0%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-misaka-layer { transition: none; }
}

/* The page plate under the art: the theme sets it, exactly like the blog's
   --color-page. The scrim is tinted against it when the art is absent. */
body[${ACTIVE_ATTR}] { background-color: var(--bg-plate, ${PALETTE.lightPlate}); }
body[data-ds-dark-theme][${ACTIVE_ATTR}] { background-color: var(--bg-plate-dark, ${PALETTE.darkPlate}); }

.dsh-misaka-scrim {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: rgb(${PALETTE.lightScrim} / var(--bg-scrim, 0.7));
}
body[data-ds-dark-theme] .dsh-misaka-scrim {
  background: rgb(${PALETTE.darkScrim} / var(--bg-scrim, 0.7));
}

/* The shell marks body boxes it does not own as no-drag, which would make
   these two decorative layers swallow the desktop window drag surface and
   double-click maximize. Chromium only accepts 'initial' here (it reads back as
   'none' and leaves the composition), and the shell rule carries #root's
   specificity, so !important is required to win it. */
body > .dsh-misaka-layer,
body > .dsh-misaka-scrim {
  -webkit-app-region: initial !important;
}

/* ---- app frame + sidebar go transparent so all columns share one art --- */
body[${ACTIVE_ATTR}] {
  --dsw-alias-bg-base: transparent;
  --dsw-specific-sidebar-fill: transparent;
}

/* ---- frosted-glass fills: whitelisted surfaces only --------------------
   Only surfaces that float as cards over the art are glassed. Dialogs, the
   settings UI, menus, tooltips, toasts, hover fills and accents keep the
   official opaque paint: they are reading surfaces.
   The bubble suffix is shared with Tooltip.module.css, so it is excluded by
   role here AND kept in its own declaration block: if a future UI ever collides
   with the guard, only the bubbles lose the glass instead of the whole list. */
body[${GLASS_ATTR}] [data-composer-card],
body[${GLASS_ATTR}] .md-code-block,
body[${GLASS_ATTR}] [class*='_ioCard'],
body[${GLASS_ATTR}] [class*='_instructionsCard'] {
  background-color: var(--bg-glass-fill, rgba(255, 255, 255, 0.72));
  background-image: linear-gradient(
    180deg,
    rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)),
    rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%,
    rgba(255, 255, 255, 0.01)
  );
  -webkit-backdrop-filter: blur(var(--bg-glass-blur, 18px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1));
  backdrop-filter: blur(var(--bg-glass-blur, 18px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.10),
    0 12px 40px rgba(0, 0, 0, 0.12);
}
body[${GLASS_ATTR}] [class*='_bubble']:not([role='tooltip']) {
  background-color: var(--bg-glass-fill, rgba(255, 255, 255, 0.72));
  background-image: linear-gradient(
    180deg,
    rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)),
    rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%,
    rgba(255, 255, 255, 0.01)
  );
  -webkit-backdrop-filter: blur(var(--bg-glass-blur, 18px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1));
  backdrop-filter: blur(var(--bg-glass-blur, 18px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.10),
    0 12px 40px rgba(0, 0, 0, 0.12);
}
/* The composer hosts its picker menu as an absolutely positioned child. A
   backdrop-filter on the card itself would make the card a Backdrop Root, and
   the menu would then sample the card's own paint only — so the card keeps the
   fill and the filter rides a pseudo-element that is not the menu's ancestor. */
body[${GLASS_ATTR}] [data-composer-card] {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
body[${GLASS_ATTR}] [data-composer-card]::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  -webkit-backdrop-filter: blur(var(--bg-glass-blur, 18px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1));
  backdrop-filter: blur(var(--bg-glass-blur, 18px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1));
}

/* ---- settings row chrome (official --dsw-alias-* tokens) --------------- */
[${ROW_ATTR}] {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
  font-size: 14px;
  color: var(--dsw-alias-label-primary, #0f1115);
}
[${ROW_ATTR}] .misaka-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
[${ROW_ATTR}] .misaka-title { font-weight: 600; line-height: 1.4; }
[${ROW_ATTR}] .misaka-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
[${ROW_ATTR}] .misaka-switch {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg, transparent);
  color: inherit;
  cursor: pointer;
  font: inherit;
}
[${ROW_ATTR}] .misaka-switch .misaka-knob {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--dsw-alias-label-tertiary, #81858c);
  transition: background 160ms ease;
}
[${ROW_ATTR}] .misaka-switch[data-on='true'] .misaka-knob {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
}
[${ROW_ATTR}] .misaka-body { display: flex; gap: 16px; align-items: flex-start; }
[${ROW_ATTR}] .misaka-preview {
  position: relative;
  width: 200px;
  min-width: 200px;
  aspect-ratio: 16 / 10;
  flex: none;
  overflow: hidden;
  border-radius: 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  background: ${PALETTE.lightPlate};
}
[${ROW_ATTR}] .misaka-preview img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: 50% 0%;
}
[${ROW_ATTR}] .misaka-preview::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(${PALETTE.lightScrim} / var(--preview-scrim, 0.7));
}
[${ROW_ATTR}][data-dark='true'] .misaka-preview::after {
  background: rgb(${PALETTE.darkScrim} / var(--preview-scrim, 0.7));
}
[${ROW_ATTR}] .misaka-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-width: 260px;
}
[${ROW_ATTR}] .misaka-field {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) 56px;
  align-items: center;
  gap: 10px;
  min-height: 28px;
}
[${ROW_ATTR}] .misaka-field > span:first-child {
  font-size: 12px;
  line-height: 1.3;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
[${ROW_ATTR}] .misaka-field input[type='range'] {
  width: 100%;
  min-width: 0;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary, #4d6bfe);
}
[${ROW_ATTR}] .misaka-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--dsw-alias-label-secondary, #61666b);
}
[${ROW_ATTR}] .misaka-sources { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; }
[${ROW_ATTR}] .misaka-url {
  display: flex;
  flex: 1 1 340px;
  min-width: 240px;
  gap: 8px;
}
[${ROW_ATTR}] .misaka-url input[type='text'] {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg, transparent);
  color: inherit;
  font: inherit;
}
[${ROW_ATTR}] .misaka-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg, transparent);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
[${ROW_ATTR}] .misaka-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
[${ROW_ATTR}] .misaka-btn:disabled,
[${ROW_ATTR}] .misaka-switch:disabled { opacity: 0.5; cursor: default; }
[${ROW_ATTR}] .misaka-note {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
`

		/** Inject the stylesheet once; a second call is a no-op. */
		function injectCss() {
			if (document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`)) return
			const tag = document.createElement('style')
			tag.dataset.plugin = 'dsh-misaka-background'
			tag.dataset.pluginCss = CSS_TAG
			tag.textContent = CSS
			document.head.appendChild(tag)
		}

		//#endregion

		//#region painter

		/**
		* The properties this plugin writes inline on `document.body`, with the
		* value each held before the first write. Only owned properties are
		* recorded and only recorded ones are restored, so the painter can never
		* clobber a token another plugin owns.
		*/
		const OWNED_VARS = [
			'--bg-mobile-x',
			'--bg-mobile-y',
			'--bg-desktop-x',
			'--bg-desktop-y',
			'--bg-wallpaper-opacity',
			'--bg-wallpaper-blur',
			'--bg-wallpaper-scale',
			'--bg-scrim',
			'--bg-plate',
			'--bg-plate-dark',
			'--bg-glass-fill',
			'--bg-glass-blur',
			'--bg-glass-saturate',
			'--bg-glass-brightness',
			'--bg-glass-sheen',
			'--bg-glass-sheen-mid',
			'--dsw-alias-bg-base',
			'--dsw-specific-sidebar-fill'
		]

		/**
		* Saved inline values, keyed by property: the value that predates this
		* plugin plus the value this plugin last wrote. Tracking both is what lets
		* the teardown hand a property back only if it still holds what we put
		* there — if something else (the host, another plugin) re-themed it while
		* the wallpaper was live, that newer value survives disposal instead of
		* being clobbered with our stale snapshot.
		*/
		const savedVars = new Map()
		/**
		* Properties the HOST also owns, where a value comparison cannot tell "we
		* wrote this" from "somebody else wrote the same string". Their saved value
		* predates the plugin and is the host's own, so they are restored
		* unconditionally; only the plugin-private `--bg-*` names use the
		* comparison.
		*/
		const SHARED_HOST_VARS = ['--dsw-alias-bg-base', '--dsw-specific-sidebar-fill']
		/** Wallpaper layer element, created lazily. */
		let layer = null
		/** `<img>` inside the layer. */
		let layerImage = null
		/** Scrim element, created lazily. */
		let scrim = null
		/** Detached preloader for the wallpaper currently being fetched. */
		let preload = null
		/** Generation counter that invalidates in-flight preloads. */
		let preloadGeneration = 0
		/** Watchdog that bounds how long one source attempt may hold the gate. */
		let watchdog = null
		/** The visible element's active decode listener, if any. */
		let decodeListener = null
		/** Whether the layers are currently attached. */
		let active = false

		/**
		* How long the gate may stay closed for one source before the previous
		* artwork is revealed again. A server that accepts the socket and never
		* answers would otherwise leave the wallpaper hidden forever.
		*/
		const SOURCE_TIMEOUT_MS = 10000

		/** Remember one property's pre-existing inline value (once). */
		function remember(prop) {
			if (!savedVars.has(prop)) {
				savedVars.set(prop, { original: document.body.style.getPropertyValue(prop), written: '' })
			}
			return savedVars.get(prop)
		}

		/** Write one owned property, remembering its original value first. */
		function setVar(prop, value) {
			const record = remember(prop)
			record.written = value
			document.body.style.setProperty(prop, value)
		}

		/**
		* Restore the properties this plugin still owns. A property whose current
		* value no longer matches what we wrote was changed by someone else while
		* the backdrop was live, so it is left alone — except for the two tokens the
		* host also owns, which are always handed back to their pre-plugin value.
		*/
		function restoreVars() {
			for (const [prop, record] of savedVars) {
				const current = document.body.style.getPropertyValue(prop)
				const shared = SHARED_HOST_VARS.includes(prop)
				if (shared || current === record.written) {
					if (record.original === '') document.body.style.removeProperty(prop)
					else document.body.style.setProperty(prop, record.original)
				}
			}
			savedVars.clear()
		}

		/**
		* Clear the fade gate and hand the transition back.
		*
		* Clearing `data-instant` here rather than at each call site is what keeps
		* the fade honest: every path that reveals goes through this function, and a
		* reveal that left `transition: none` in force would pop instead of fade —
		* which is exactly what a section write landing inside the reveal window
		* used to do.
		*/
		function markReady() {
			if (!layer) return
			delete layer.dataset.instant
			layer.dataset.ready = 'true'
		}

		/**
		* Run `callback` after the gate has been painted closed.
		*
		* A CSS transition needs the browser to have painted the element's `opacity:
		* 0` state first; flipping the gate to `true` in the same task — or in the
		* same rendering update — leaves nothing to transition from and the
		* wallpaper snaps. The reveal is therefore held back by one full frame.
		*
		* Chromium and Gecko only invoke rAF callbacks during the rendering update,
		* so waiting for the *second* frame callback guarantees that a composition
		* containing the closed gate happened in between. That costs one frame
		* (~16ms), which is invisible inside a 480ms fade and buys determinism
		* across engines.
		*
		* When this is called from a document-start script the first probe already
		* lands in the current rendering update; when it is called from async work
		* (a preload promise, say) the first probe *is* the next frame. Both are
		* correct, and the timeout is only the resting guard for a document that
		* never renders at all.
		*
		* @param callback - runs after a painted frame; called immediately if no
		*   frame callback ever arrives.
		*/
		function afterPaintedFrame(callback) {
			let settled = false
			let guard = null
			const frames = []

			const run = () => {
				if (settled) return
				settled = true
				if (guard !== null) clearTimeout(guard)
				callback()
			}

			const probe = () => {
				if (settled) return
				frames.push(performance.now())
				if (frames.length >= 2) run()
				else requestAnimationFrame(probe)
			}

			guard = setTimeout(() => {
				if (frames.length === 0) run()
			}, 150)
			requestAnimationFrame(probe)
		}

		/** Detach the visible element's decode listener, if one is attached. */
		function detachDecodeListener() {
			if (layerImage === null || decodeListener === null) return
			layerImage.removeEventListener('load', decodeListener)
			layerImage.removeEventListener('error', decodeListener)
			decodeListener = null
		}

		/**
		* Reveal the wallpaper once its bitmap has settled (decoded, or reported as
		* undecodable) *and* the closed gate has been painted.
		*
		* The decode wait is what makes the reveal safe when the visible element's
		* own fetch is slow: the gate stays closed until the pixels exist, and a
		* broken image still resolves so the wallpaper never stays invisible.
		*
		* @param generation - the source attempt this reveal belongs to.
		*/
		function revealWhenSettled(generation) {
			const reveal = () => {
				if (generation !== preloadGeneration || layer === null) return
				afterPaintedFrame(() => {
					if (generation !== preloadGeneration || layer === null) return
					markReady()
				})
			}
			detachDecodeListener()
			// A completed element already knows its fate, including the failure of
			// a source that never resolved.
			if (layerImage.complete) {
				reveal()
				return
			}
			decodeListener = () => {
				detachDecodeListener()
				reveal()
			}
			layerImage.addEventListener('load', decodeListener)
			layerImage.addEventListener('error', decodeListener)
		}

		/** Invalidate any in-flight source attempt and its watchdog. */
		function cancelPreload() {
			preloadGeneration += 1
			if (preload) {
				preload.onload = null
				preload.onerror = null
				preload = null
			}
			if (watchdog !== null) {
				clearTimeout(watchdog)
				watchdog = null
			}
			detachDecodeListener()
		}

		/**
		* Point the wallpaper at `source`, revealing it only once it has decoded
		* *and* the browser has painted the closed gate.
		*
		* The blog gates the fade on a *detached* `new Image()` preloader, and the
		* reason matters here too: reusing the visible `<img>` and setting a new
		* `src` keeps the previous bitmap on screen until the new one arrives, so
		* the 480ms fade would dim the stale frame. Instead the gate closes, the
		* new source decodes off-DOM, and only then is it swapped in and revealed.
		*/
		function setSource(source) {
			if (!layer || !layerImage) return
			cancelPreload()
			const generation = preloadGeneration
			// Instant close, so the reveal animates from a real opacity of 0 rather
			// than from wherever a 2-frame interruption left it.
			layer.dataset.instant = 'true'
			layer.dataset.ready = 'false'

			if (source === '') {
				layerImage.removeAttribute('src')
				revealWhenSettled(generation)
				return
			}

			/**
			* Swap the decoded bitmap into the visible element, then wait for its
			* decode and the painted closed frame before revealing.
			*/
			const commit = () => {
				if (generation !== preloadGeneration || !layer || !layerImage) return
				preload = null
				if (watchdog !== null) {
					clearTimeout(watchdog)
					watchdog = null
				}
				layerImage.setAttribute('src', source)
				revealWhenSettled(generation)
			}

			// A data URL is already in memory, so only its decode and the painted
			// frame are left to wait for.
			if (source.startsWith('data:')) {
				commit()
				return
			}

			const probe = new Image()
			preload = probe
			probe.onload = commit
			probe.onerror = commit
			probe.src = source

			// A remote request that never settles must not hold the gate forever:
			// give up on it and show the artwork that is already on screen.
			watchdog = setTimeout(() => {
				watchdog = null
				if (generation !== preloadGeneration || !layer || !layerImage) return
				preload = null
				markReady()
			}, SOURCE_TIMEOUT_MS)
		}

		/** Remove both decorative layers from the body. */
		function removeLayers() {
			cancelPreload()
			if (layer) layer.remove()
			if (scrim) scrim.remove()
			layer = null
			layerImage = null
			scrim = null
		}

		/** Write the scheme-dependent glass variables. */
		function writeSchemeVars() {
			const dark = isDark()
			setVar('--bg-glass-fill', glassFill(dark))
			setVar('--bg-glass-brightness', dark ? '1.04' : '0.98')
			setVar('--bg-glass-sheen', dark ? '0.16' : '0.07')
			setVar('--bg-glass-sheen-mid', dark ? '0.05' : '0.02')
		}

		/**
		* Update one knob without touching the DOM. Slider drags take this path;
		* the persisted write happens once, on release.
		* @param key - section key.
		* @param value - the new value in its canonical unit.
		*/
		function setKnob(key, value) {
			if (!active) return
			switch (key) {
				case 'overlay':
					setVar('--bg-scrim', scrimAlpha(value).toFixed(3))
					break
				case 'wallpaperOpacity':
					setVar('--bg-wallpaper-opacity', String(value / 100))
					break
				case 'wallpaperBlur':
					setVar('--bg-wallpaper-blur', `${value}px`)
					setVar('--bg-wallpaper-scale', (1 + value * 0.006).toFixed(4))
					break
				case 'glassBlur':
					setVar('--bg-glass-blur', `${value}px`)
					setVar('--bg-glass-saturate', String(glassSaturate(value)))
					break
				default:
					break
			}
		}

		/**
		* Apply one section: create/tune the two layers, publish every CSS
		* variable, and flip the body attributes that gate the stylesheet.
		* @param section - a normalized section.
		*/
		function applySection(section) {
			injectCss()

			if (!section.enabled) {
				removeLayers()
				restoreVars()
				document.body.removeAttribute(ACTIVE_ATTR)
				document.body.removeAttribute(GLASS_ATTR)
				active = false
				return
			}

			const source = section.imageUrl !== ''
				? section.imageUrl
				: artworkDataUrl(section.artSeed, section.artIntensity)

			setVar('--bg-mobile-x', `${MOBILE_FRAMING.x}%`)
			setVar('--bg-mobile-y', `${MOBILE_FRAMING.y}%`)
			setVar('--bg-desktop-x', `${DESKTOP_FRAMING.x}%`)
			setVar('--bg-desktop-y', `${DESKTOP_FRAMING.y}%`)
			setVar('--bg-wallpaper-opacity', String(section.wallpaperOpacity / 100))
			setVar('--bg-wallpaper-blur', `${section.wallpaperBlur}px`)
			setVar('--bg-wallpaper-scale', (1 + section.wallpaperBlur * 0.006).toFixed(4))
			setVar('--bg-scrim', scrimAlpha(section.overlay).toFixed(3))
			setVar('--bg-plate', PALETTE.lightPlate)
			setVar('--bg-plate-dark', PALETTE.darkPlate)
			setVar('--bg-glass-blur', `${section.glassBlur}px`)
			setVar('--bg-glass-saturate', String(glassSaturate(section.glassBlur)))
			writeSchemeVars()

			// The app frame and the sidebar column go transparent so every column
			// shares one wallpaper + scrim backdrop rather than stacking its own
			// opaque fill on top of the art.
			setVar('--dsw-alias-bg-base', 'transparent')
			setVar('--dsw-specific-sidebar-fill', 'transparent')

			if (!layer) {
				layer = document.createElement('div')
				layer.className = 'dsh-misaka-layer'
				layer.dataset.ready = 'false'
				layerImage = document.createElement('img')
				layerImage.className = 'dsh-misaka-image'
				layerImage.alt = ''
				layerImage.decoding = 'async'
				layerImage.referrerPolicy = 'no-referrer'
				layer.appendChild(layerImage)
				document.body.appendChild(layer)
			}
			if (!scrim) {
				scrim = document.createElement('div')
				scrim.className = 'dsh-misaka-scrim'
				document.body.appendChild(scrim)
			}

			document.body.setAttribute(ACTIVE_ATTR, 'on')
			if (section.glass) document.body.setAttribute(GLASS_ATTR, 'on')
			else document.body.removeAttribute(GLASS_ATTR)
			active = true

			// Only touch the image when the visible source actually differs: a
			// slider gesture must not restart the preload and re-run the fade.
			if (layerImage.getAttribute('src') !== source) setSource(source)
			else markReady()
		}

		//#endregion

		//#region settings row

		const zh = {
			title: '参考背景',
			description: '参考 blog.misaka.ren：固定壁纸、主题自适应纱帘、480ms 淡入与毛玻璃面板。',
			enable: '开启',
			disable: '关闭',
			overlay: '纱帘',
			wallpaperOpacity: '壁纸浓度',
			wallpaperBlur: '壁纸模糊',
			glassBlurLabel: '毛玻璃模糊',
			intensity: '画面强度',
			seed: '换一张',
			seedNeedsBuiltIn: '使用自定义图片时不可换图，先「恢复内置」',
			glass: '毛玻璃',
			on: '开',
			off: '关',
			imageLabel: '图片地址',
			imagePlaceholder: '粘贴图片链接后回车',
			apply: '应用',
			clear: '恢复内置',
			reset: '全部重置',
			note: '内置壁纸由插件在本地绘制，不依赖网络；自定义图片加载失败时预览会退回内置图。'
		}

		const en = {
			title: 'Reference background',
			description: 'The blog.misaka.ren treatment: fixed wallpaper, theme-aware scrim, 480ms fade-in and frosted-glass panels.',
			enable: 'On',
			disable: 'Off',
			overlay: 'Scrim',
			wallpaperOpacity: 'Wallpaper',
			wallpaperBlur: 'Wallpaper blur',
			glassBlurLabel: 'Glass blur',
			intensity: 'Art intensity',
			seed: 'Repaint',
			seedNeedsBuiltIn: 'Repaint only affects the built-in artwork — choose "Use built-in" first',
			glass: 'Frosted',
			on: 'On',
			off: 'Off',
			imageLabel: 'Image URL',
			imagePlaceholder: 'Paste an image link, press Enter',
			apply: 'Apply',
			clear: 'Use built-in',
			reset: 'Reset all',
			note: 'The built-in wallpaper is drawn locally; no network access is needed. A custom image that fails to load falls back to the built-in thumbnail in this preview.',
		}

		/**
		* One labelled range control. `onInput` paints live; `onChange` fires on
		* release, which is when the value is persisted — one storage write per
		* gesture instead of one per pixel of travel.
		*/
		function RangeField(props) {
			return react.createElement(
				'label',
				{ className: 'misaka-field' },
				react.createElement('span', null, props.label),
				react.createElement('input', {
					type: 'range',
					min: props.min,
					max: props.max,
					step: props.step,
					value: props.value,
					disabled: props.disabled,
					'aria-label': props.label,
					onInput: (event) => props.onInput(Number(event.target.value)),
					onChange: (event) => props.onCommit(Number(event.target.value))
				}),
				react.createElement('span', { className: 'misaka-value' }, props.display)
			)
		}

		/**
		* The General-settings row: a live preview card plus every effect control.
		*/
		function BackgroundRow(props) {
			const section = react.useSyncExternalStore(subscribeSection, readSection, readSection)
			const [dark, setDark] = react.useState(isDark)
			const [urlDraft, setUrlDraft] = react.useState(section.imageUrl)
			/** Set when the custom URL's thumbnail cannot be decoded. */
			const [previewBroken, setPreviewBroken] = react.useState(false)

			react.useEffect(() => {
				const observer = new MutationObserver(() => setDark(isDark()))
				observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
				return () => observer.disconnect()
			}, [])

			react.useEffect(() => {
				setUrlDraft(section.imageUrl)
				setPreviewBroken(false)
			}, [section.imageUrl])

			// A URL that cannot be decoded falls back to the built-in artwork's
			// thumbnail rather than leaving a broken-image glyph in the row. The
			// stored URL is untouched, so the field still shows what was typed.
			const previewUrl = react.useMemo(() => {
				const builtIn = artworkDataUrl(section.artSeed, section.artIntensity)
				if (section.imageUrl === '' || previewBroken) return builtIn
				return section.imageUrl
			}, [section.imageUrl, section.artSeed, section.artIntensity, previewBroken])

			const disabled = !section.enabled
			// Repaint only affects the procedural artwork, so it is inert while a
			// custom image is in use — same as the intensity slider.
			const repaintDisabled = disabled || section.imageUrl !== ''
			const t = props.t
			const write = writeSection

			return react.createElement(
				'div',
				{ [ROW_ATTR]: 'on', 'data-dark': dark ? 'true' : 'false' },
				react.createElement(
					'div',
					{ className: 'misaka-head' },
					react.createElement(
						'div',
						null,
						react.createElement('div', { className: 'misaka-title' }, t('title')),
						react.createElement('div', { className: 'misaka-desc' }, t('description'))
					),
					react.createElement(
						'button',
						{
							type: 'button',
							className: 'misaka-switch',
							'data-on': section.enabled ? 'true' : 'false',
							'aria-pressed': section.enabled,
							'aria-label': section.enabled ? t('disable') : t('enable'),
							onClick: () => write({ enabled: !section.enabled })
						},
						react.createElement('span', { className: 'misaka-knob' }),
						react.createElement('span', null, section.enabled ? t('enable') : t('disable'))
					)
				),
				react.createElement(
					'div',
					{ className: 'misaka-body' },
					react.createElement(
						'div',
						{
							className: 'misaka-preview',
							style: { '--preview-scrim': scrimAlpha(section.overlay).toFixed(3) }
						},
						react.createElement('img', {
							src: previewUrl,
							alt: '',
							onError: () => {
								// One fallback only: never loop if the artwork fails too.
								if (section.imageUrl !== '' && !previewBroken) setPreviewBroken(true)
							}
						})
					),
					react.createElement(
						'div',
						{ className: 'misaka-fields' },
						react.createElement(RangeField, {
							label: t('overlay'),
							min: 0,
							max: 70,
							step: 5,
							value: section.overlay,
							display: `${section.overlay}%`,
							disabled,
							onInput: (value) => setKnob('overlay', value),
							onCommit: (value) => write({ overlay: value })
						}),
						react.createElement(RangeField, {
							label: t('wallpaperOpacity'),
							min: 0,
							max: 100,
							step: 5,
							value: section.wallpaperOpacity,
							display: `${section.wallpaperOpacity}%`,
							disabled,
							onInput: (value) => setKnob('wallpaperOpacity', value),
							onCommit: (value) => write({ wallpaperOpacity: value })
						}),
						react.createElement(RangeField, {
							label: t('wallpaperBlur'),
							min: 0,
							max: 60,
							step: 2,
							value: section.wallpaperBlur,
							display: `${section.wallpaperBlur}px`,
							disabled,
							onInput: (value) => setKnob('wallpaperBlur', value),
							onCommit: (value) => write({ wallpaperBlur: value })
						}),
						react.createElement(RangeField, {
							label: t('glassBlurLabel'),
							min: 0,
							max: 40,
							step: 1,
							value: section.glassBlur,
							display: `${section.glassBlur}px`,
							disabled: disabled || !section.glass,
							onInput: (value) => setKnob('glassBlur', value),
							onCommit: (value) => write({ glassBlur: value })
						}),
						react.createElement(RangeField, {
							label: t('intensity'),
							min: 0,
							max: 160,
							step: 10,
							value: section.artIntensity,
							display: `${section.artIntensity}%`,
							disabled: disabled || section.imageUrl !== '',
							onInput: () => {},
							onCommit: (value) => write({ artIntensity: value })
						})
					)
				),
				react.createElement(
					'div',
					{ className: 'misaka-sources' },
					react.createElement(
						'button',
						{
							type: 'button',
							className: 'misaka-btn',
							disabled: repaintDisabled,
							title: section.imageUrl !== '' ? t('seedNeedsBuiltIn') : undefined,
							onClick: () => write({ artSeed: (section.artSeed % 99) + 1 })
						},
						icon(['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6']),
						t('seed')
					),
					react.createElement(
						'button',
						{ type: 'button', className: 'misaka-btn', disabled, onClick: () => write({ glass: !section.glass }) },
						t('glass'),
						section.glass ? t('on') : t('off')
					),
					react.createElement(
						'div',
						{ className: 'misaka-url' },
						react.createElement('input', {
							type: 'text',
							value: urlDraft,
							placeholder: t('imagePlaceholder'),
							'aria-label': t('imageLabel'),
							disabled,
							onChange: (event) => setUrlDraft(event.target.value),
							onKeyDown: (event) => {
								if (event.key === 'Enter') write({ imageUrl: urlDraft })
							}
						}),
						react.createElement(
							'button',
							{ type: 'button', className: 'misaka-btn', disabled, onClick: () => write({ imageUrl: urlDraft }) },
							t('apply')
						)
					),
					react.createElement(
						'button',
						{
							type: 'button',
							className: 'misaka-btn',
							disabled,
							onClick: () => {
								setUrlDraft('')
								write({ imageUrl: '' })
							}
						},
						t('clear')
					),
					react.createElement(
						'button',
						{
							type: 'button',
							className: 'misaka-btn',
							disabled,
							onClick: () => {
								setUrlDraft('')
								// Clears the user's overrides, so whatever the plugin is
								// configured with (or the shipped defaults) takes over.
								resetSection()
							}
						},
						t('reset')
					)
				),
				react.createElement('div', { className: 'misaka-note' }, t('note'))
			)
		}

		//#endregion

		//#region plugin entry

		/** Services this client entry needs. */
		const inject = ['slots', 'locale']

		/**
		* Client plugin body: register the dictionaries and the General-settings
		* row, then keep the backdrop in sync with the section store.
		* @param ctx - client cordis context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-misaka-background: dictionaries')

			ctx.slots.inject('settings.general.item', () => ctx.slots.register({
				name: 'settings.general.item',
				id: 'dsh-misaka-background',
				order: 610,
				locale: NS
			}, BackgroundRow))

			applySection(readSection())
			// The effect returns `subscribeSection`'s detach, so cordis unsubscribes
			// it on dispose. That matters: the section store lives at module scope
			// and outlives this plugin generation, so a listener left behind would
			// be resurrected — and would repaint the whole backdrop — by the next
			// store write from a future generation.
			ctx.effect(() => subscribeSection(() => applySection(readSection())), 'dsh-misaka-background: backdrop subscription')

			// Adopt the plugin's own configuration once it arrives. Painting first
			// and repainting here keeps startup instant; the route is local, so the
			// repaint normally happens within a frame or two, and `loadConfig`
			// notifies subscribers only when it actually had something to adopt.
			void loadConfig()

			ctx.effect(() => {
				const observer = new MutationObserver(() => {
					if (active === false) return
					writeSchemeVars()
				})
				observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
				return () => observer.disconnect()
			}, 'dsh-misaka-background: scheme observer')

			ctx.effect(() => () => {
				applySection({ ...DEFAULTS, enabled: false })
				document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`)?.remove()
			}, 'dsh-misaka-background: backdrop teardown')
		}

		exports.apply = apply
		exports.inject = inject
		// Kept for the host-side inventory and for hand-testing in a console.
		exports.CSS_TAG = CSS_TAG
		exports.DEFAULTS = DEFAULTS
		exports.paintArtwork = paintArtwork

		// OWNED_VARS / SECTION_KEYS are documentation anchors: the painter writes
		// exactly these, and the reader understands exactly these.
		void OWNED_VARS
		void SECTION_KEYS

		return module.exports
	}
})
