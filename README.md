# dsh-misaka-background

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web-GUI plugin that
recreates the backdrop treatment of **[blog.misaka.ren](https://blog.misaka.ren)** — a fixed
wallpaper behind the whole app frame, a theme-aware readability scrim, a 480 ms fade-in, and
frosted-glass fills for the surfaces that float over the art.

![The backdrop in a session](docs/screenshots/app.png)

The settings row it adds to **Settings → General**:

![The Reference background row](docs/screenshots/settings-row.png)

> Independent reimplementation: the effect is described and measured from the site's public
> CSS; no code was copied from the blog or from other plugins.

## What it does

| Layer | Behaviour (measured from the site) |
| --- | --- |
| Wallpaper | `position: fixed; inset: 0`, `background-size: cover`, no-repeat. Framing `76% 38%` below 1024 px, `50% 0%` at or above it (the blog's `64rem` breakpoint). |
| Fade-in | Opacity only, `480ms cubic-bezier(.22, 1, .36, 1)`, gated on the wallpaper being decoded. The gate closes **instantly** (no transition) and reopens one painted frame later, so the reveal is a real `0 → 1` transition on every change — see *Fade mechanics* below. `prefers-reduced-motion` removes it. |
| Scrim | `rgb(13 15 22 / α)` in the dark scheme, `rgb(247 248 252 / α)` in the light one, where `α = 0.3 + overlay/100` (the blog's `backgroundOverlay: 40` ⇒ **0.7**). The `0.3` floor can never be undercut. |
| Frosted panels | Composer card, message bubbles, code blocks, tool IO cards and skill instruction cards get a translucent fill plus `backdrop-filter: blur() saturate() brightness()`. Dialogs, the settings UI, menus, tooltips and toasts keep the official opaque paint — they are reading surfaces. |
| Uninstall | Every DOM node, inline property and injected rule is retracted on dispose, so switching the plugin off restores the exact official paint. |

The default wallpaper is **drawn procedurally on a canvas** from the site's accent palette
(indigo `#5041db`, violet `#9a8bff`, mint `#57d9cb` over `#f7f8fc`): no binary asset ships,
nothing is fetched, and the look is reproducible from an integer seed.

## Install

```sh
dsh plugin --profile desktop add /path/to/plugins/dsh-misaka-background
```

Restart the app (the plugin roster is composed at startup). From a checkout of the harness
itself, use `pnpm dsh plugin --profile desktop add <path>`. To remove:

```sh
dsh plugin --profile desktop remove dsh-misaka-background
```

## Use

**Settings → General → Reference background** (the row sits next to *Appearance*).

| Control | Meaning |
| --- | --- |
| Enable | Paints or retracts the whole treatment. |
| Scrim | 0–70 %, i.e. scrim alpha 0.30–1.00. Lower lets the art through; higher protects text contrast. |
| Wallpaper | Wallpaper layer opacity, 0–100 %. |
| Wallpaper blur | Blur on the art itself, 0–60 px (the layer is scaled up to hide the blurred fringe). |
| Glass blur | `backdrop-filter` radius on the frosted surfaces, 0–40 px. |
| Art intensity | Wash strength of the procedural art, 0–160 %. Ignored while a custom image is set. |
| Repaint | Draws the next procedural artwork (seed + 1). Disabled while a custom image is set, because the custom image is what is on screen. |
| Frosted | Toggles the glass fills independently of the wallpaper. |
| Image URL | Paste an image link and press Enter or *Apply* to use it instead of the built-in art. Any non-empty string is accepted and handed to `img.src` as-is; a URL that cannot be decoded falls back to the built-in thumbnail in this preview (and the wallpaper keeps the plate + scrim rather than a broken frame). *Use built-in* returns to the procedural wallpaper. |
| Reset all | Restores the shipped defaults. |

Every slider step paints immediately, and under React 18 an `<input type="range">` reports each
step as `onChange`, so a drag also persists each step rather than only its final value. The writes
are 143 bytes each, so this is deliberately accepted rather than damped with pointer-up bookkeeping.
The section is persisted in `localStorage` under `dsh-misaka-background:settings`, and only the
fields you actually touched are stored, so a configured value keeps applying to everything else.

## Configure it from the plugin

Every knob the settings row has can also be set from the plugin itself — useful when you want a
wallpaper committed to the profile rather than to one browser, or when you want it applied
without touching the UI at all.

**A `config.json` beside the plugin** (edit the plugin folder):

```json
{
  "imageUrl": "https://example.com/art.png",
  "overlay": 30,
  "wallpaperBlur": 0
}
```

**The plugin row's `config:` in the profile patch** — for the desktop app that is
`~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- id: dsh-misaka-background
  name: "dsh-misaka-background"
  config:
    imageUrl: "https://example.com/art.png"
    overlay: 30
```

Precedence, later winning:

| # | Layer | Notes |
| --- | --- | --- |
| 1 | shipped defaults | `overlay` 40 (scrim α 0.7), built-in procedural wallpaper |
| 2 | `config.json` beside the plugin | edit the plugin folder |
| 3 | the row's `config:` in the profile patch | edit the profile; wins over 2 |
| 4 | what you change in the settings row | stored per field, so changing one slider never discards a configured URL |

*Reset all* in the row clears layer 4, so layers 2–3 take over again.

Recognized keys: `enabled`, `imageUrl`, `overlay` (0–70), `wallpaperOpacity` (0–100),
`wallpaperBlur` (0–60), `glass`, `glassBlur` (0–40), `artSeed` (1–99), `artIntensity` (0–160).
Unknown keys are ignored, out-of-range numbers are clamped, and keys you leave out keep the layer
below them.

**Both require an app restart.** The profile is read at host startup, and the host half resolves
the configuration once when the plugin row loads — the client then fetches it from
`/dsh-misaka-background/config.json` on the same origin. (That route is read-only, answers GET and
HEAD only, refuses an explicitly cross-site request, and sends no CORS header.)

## Fade mechanics

The fade is the one part of this plugin that is easy to get subtly wrong, so it is worth
stating exactly how it works.

A CSS transition only animates if the browser has already **painted** the state it starts
from. Two failure modes follow, and both were reproduced in Chromium during development:

1. Reopening the gate in the same task (or the same frame) that closes it leaves nothing to
   transition from, and the wallpaper snaps.
2. Closing the gate *with* the transition active, then reopening it a couple of frames later,
   interrupts a `1 → 0` transition that has barely started — the opacity never gets near 0 and
   the visible fade is negligible.

So the plugin does what the blog does:

- **Close instantly.** `setSource` stamps `data-instant="true"` (which sets `transition: none`)
  together with `data-ready="false"`, so the layer is at opacity 0 immediately.
- **Reveal once the bitmap has settled and a frame has been painted.** The visible element's own
  `load`/`error` decides the settle (a decode failure resolves too, so a broken source cannot
  leave the wallpaper invisible), and `afterPaintedFrame` then waits for two
  `requestAnimationFrame` callbacks — which guarantees a rendering update, and therefore a
  composition carrying the closed gate, happened in between. The reveal clears `data-instant` and
  sets `data-ready="true"`, so the `0 → 1` transition runs from a real 0.
- **Preload before swapping.** For a non-`data:` source the new bitmap decodes on a detached
  `Image` first, so the visible element never shows a stale frame while a new one downloads.
- **Bound the wait.** A remote request that is accepted but never answered cannot hold the gate
  beyond 10 s: the watchdog gives up and reveals the artwork that is already on screen.

Consequently a wallpaper change is: brief hide → 480ms fade-in. That matches the site, whose
gate also has no transition of its own (`blog-visual-spec.md` §5–6).



```
package.json        dsh.bundle.patch + dsh.client declaration
cordis.patch.yml    inserts the plugin row into the web roster
lib/index.js        host half: resolves the configuration, serves it on one GET route
lib/client.js       the client bundle: the whole effect
```

`lib/index.js` exists because a browser plugin row is only composed for a loader entry with a live
fiber, so a host half must exist and export `apply`. It also resolves the plugin's configuration
(`config.json`, then the row's `config:`) and publishes it on
`GET /dsh-misaka-background/config.json`, which is how the choices above reach the page. It reads
no other service, writes no file, and does nothing at all when no webserver is composed.

`lib/client.js` is a **hand-written client module bundle** — a classic script calling
`window.__ModuleLoader__.load({ id, factory })` where `id` is the package name and the factory
returns the plugin exports (`apply`, `inject`). No build step is involved, and the only module
it requires is `react`, one of the shell's seed modules. The config route path is a literal in
both halves because they are separate bundles and cannot import from each other.

## Development

```sh
cd .dev
npm install                     # jsdom + puppeteer-core
npm test                        # the two browser-free suites (what CI runs)
npm run test:all                # every harness below, with a bundle-hash guard
```

| Harness | Covers |
| --- | --- |
| `contract.test.mjs` | DOM contract in jsdom: layers, gates, variables, teardown ownership, the canvas-failure path |
| `artwork-retry.test.mjs` | a failed artwork render is retried, not memoized |
| `render-probe.mjs` | computed styles in real Chrome (probe.html), writes `shots/` |
| `fade-determinism.mjs` | the fade on first paint and on source changes, plus reduced motion (probe-delayed.html) |
| `preview-roundtrip.mjs` | preview + wallpaper across a built-in ↔ custom round trip |
| `failure-paths.test.mjs` | reachable / 404 / hanging sources, and an **in-page** change against a harness-owned HTTP server |
| `config-e2e.mjs` | a configured URL actually becomes the wallpaper, a later row edit does not discard it, and clearing overrides restores it |
| `config-file-e2e.mjs` | `config.json` → row `config:` precedence, run against a copy of the plugin |
| `gui-verify.mjs` · `check-config-route.mjs` | drive a real `dsh web` instance; they take its authenticated URL as an argument, so they are run by hand |

`run-all.mjs` prints the bundle's SHA256 before and after the suite and marks the run void if it
changed, so a mid-run edit cannot silently invalidate a result. Set `CHROME_PATH` to use a
different Chrome.

Two things about these harnesses are load-bearing:

- **`fade-determinism.mjs` uses `probe-delayed.html`**, which applies the plugin 300ms after
  document start, so a document-start sampler can record the very first frames. Measuring the
  fade on the normal probe page is unreliable: generating the 1920×1080 artwork blocks the main
  thread, which starves the sampler and can make a broken fade look correct.
- **Every browser harness pins `prefers-reduced-motion`.** Chromium derives that preference from
  the host OS, and on a machine with Windows animations switched off it reports `reduce`, which
  makes the plugin's own reduced-motion rule disable the transition — every fade then reads a
  single opacity step and looks broken. The plugin is behaving correctly there; the harness has to
  say which state it measures. `inspect-transition.mjs` is the diagnostic for that trap.

Also note that `fade-determinism.mjs` and `preview-roundtrip.mjs` swap the wallpaper by
**reloading** the page, which is not the same code path as a change made inside a running page.
`failure-paths.test.mjs` covers the in-page change — and that is the path that exposed the
reveal/pop defect. `gui-verify.mjs` and `check-config-route.mjs` additionally drive a real
`dsh web` instance (they take its authenticated URL as an argument).

Both traps above, and the full defect history from the reviews, are written up in
[`docs/verification.md`](docs/verification.md).

## Repository layout

```
lib/client.js        the client bundle: the whole effect (hand-written, no build step)
lib/index.js         host half: resolves the configuration, serves it on one GET route
cordis.patch.yml     inserts the plugin row into the web roster
config.example.json  the optional file-based configuration; copy it to config.json
docs/                the measured visual spec, the verification write-up, screenshots
.dev/                the harnesses (jsdom suites + real-Chromium probes)
.github/workflows/   CI: syntax check plus the browser-free suites
```

The measured specification the numbers come from is
[`docs/blog-visual-spec.md`](docs/blog-visual-spec.md) — every value there carries the URL and the
verbatim CSS rule it was read from, and anything that could not be found is written down as not
found rather than guessed.

## Notes and limits

- The glass selectors lean on the host's CSS-module suffixes (`_bubble`, `[data-composer-card]`,
  `.md-code-block`). A host restyle that renames them silently drops the glass — the wallpaper,
  the scrim and the fade are unaffected. The bubble suffix shares its name with
  `Tooltip.module.css`, so it is excluded by `role` and kept in its own declaration block: a
  future collision costs the bubbles their glass, not the other four surfaces.
- The composer card takes its `backdrop-filter` from a `::before` pseudo-element. Chromium makes
  any element carrying a `backdrop-filter` a Backdrop Root, and the composer's picker menu is an
  absolutely positioned child of the card: with the filter on the card itself the menu would
  sample only the card's own paint.
- Teardown restores an inline property only if it still holds the value this plugin wrote, so a
  plugin-private token that someone else re-themed while the wallpaper was live survives
  disposal. The two tokens the host *also* owns (`--dsw-alias-bg-base`,
  `--dsw-specific-sidebar-fill`) are the deliberate exception: a value comparison cannot tell
  "we wrote this" from "somebody wrote the same string", so their pre-plugin value is restored
  unconditionally.
- A remote source that is accepted but never answered is abandoned after 10 s and the previous
  artwork is revealed again; the stored URL is left in place so it can be corrected.
- Only one wallpaper can be active, so installing a second background plugin at the same time
  is not supported.
- The section lives in `localStorage`, not in the profile's settings document, so it is per
  browser profile rather than per harness profile. Nothing else about the plugin writes to disk.

## License

MIT — see [LICENSE](LICENSE).

The artwork this plugin ships is **not** from the blog. The default wallpaper is generated at
runtime on a canvas from the site's accent palette, so the package carries no image and the
reproduction is a reimplementation of a visual treatment, not a redistribution of an asset.
`docs/blog-visual-spec.md` records the measurements it is based on; the site itself is a separate
project.
