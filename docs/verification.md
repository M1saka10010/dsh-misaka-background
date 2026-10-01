# Verification

This plugin's whole value is a visual effect that is easy to get *almost* right, so the tests
here are the point rather than a formality. Everything below was run against the released code.

## Running the harnesses

```sh
cd .dev
npm install          # jsdom + puppeteer-core; the plugin itself has no dependencies
npm test             # the two browser-free suites (what CI runs)
npm run test:all     # all six, with a bundle-hash guard
```

`run-all.mjs` prints the SHA256 of `lib/client.js` before and after the suite and marks the run
void if it changed mid-way, so an edit made while the tests were running cannot be mistaken for a
passing result.

| Harness | Covers |
| --- | --- |
| `contract.test.mjs` | DOM contract in jsdom: layer order, body gates, every CSS variable, the fade gate, teardown ownership, the canvas-failure path, two plugin generations |
| `artwork-retry.test.mjs` | a failed artwork render is retried rather than memoized |
| `render-probe.mjs` | computed styles in real Chrome: the framing switch at 1024px, per-scheme scrim tint, the glass `backdrop-filter` chain |
| `fade-determinism.mjs` | the fade on first paint and on source changes, plus `prefers-reduced-motion` |
| `preview-roundtrip.mjs` | the preview card and the wallpaper both decode across a built-in ↔ custom round trip |
| `failure-paths.test.mjs` | reachable / 404 / hanging sources, and an **in-page** change, against a harness-owned HTTP server |
| `config-e2e.mjs` `config-file-e2e.mjs` | a configured wallpaper actually becomes the wallpaper, a later row edit does not discard it, `config.json` → row `config:` precedence |

The browser harnesses need a local Chrome; set `CHROME_PATH` to point at it.

## Two traps worth knowing about

**1. `prefers-reduced-motion` is inherited from the host OS.** Chromium reads it from the system,
and on a machine with Windows animations switched off it reports `reduce` — which correctly
disables the transition, so every fade measurement collapses to a single opacity step and looks
like a failure. The plugin behaves correctly in that state; the *harness* has to say which state
it is measuring, so each browser harness pins the feature with `page.emulateMediaFeatures(...)`
and the reduced-motion degradation is asserted separately (no animation, still visible).
`inspect-transition.mjs` is the diagnostic that identifies this.

**2. A reload is not a wallpaper change.** `fade-determinism.mjs` and `preview-roundtrip.mjs` swap
the wallpaper by reloading the page, which is a different code path from a change made inside a
running page. That blind spot let a real bug through: `applySection`'s "source unchanged" branch
revealed the wallpaper without restoring the transition, so any settings write landing in the
two-frame reveal window turned the fade into a pop. `failure-paths.test.mjs` now drives the
in-page path and asserts that no reveal ever happens while `data-instant` is still set.

## What went wrong on the way

Two independent adversarial reviews were run against the code as it evolved. Every defect they
demonstrated is fixed and has a regression test.

| # | Defect | Fix |
| --- | --- | --- |
| 1 | the 480ms fade never played on a wallpaper change — the reveal happened in the same task that closed the gate, so the browser never painted `opacity: 0` | instant close, then reveal once the bitmap has settled *and* a frame has been painted |
| 2 | closing the gate *with* the transition active made the fade invisible: reopening two frames later interrupted a `1 → 0` transition that had barely started | `data-instant` closes the gate with no transition at all |
| 3 | a failed artwork render was memoized, stranding that seed on the flat plate colour forever | failures are not cached |
| 4 | teardown wrote a stale snapshot back over a value the host had since changed | value comparison for the plugin's own tokens; unconditional restore for the two the host also owns |
| 5 | a 404 left the settings preview showing a broken-image glyph | one-shot fallback to the built-in thumbnail |
| 6 | a hanging image request held the gate closed forever, hiding the wallpaper | a 10s watchdog abandons the attempt and reveals what is already on screen |
| 7 | `load`/`error` listeners were removed but never added, so the "gated on decode" claim was false and the reveal could land before the bitmap existed | the visible element's own decode is now the real gate |
| 8 | the `source === ''` branch had no generation guard, so a stale attempt could open a newer attempt's gate | the same guard as `commit()` |
| 9 | a section write landing in the reveal window turned the fade into a pop | `markReady()` clears `data-instant`, so every reveal restores the transition |
| 10 | one `:not([role='tooltip'])` guard sat on a shared selector list, so a single future collision would cost all five glassed surfaces their glass | bubbles moved into their own rule block |
| 11 | `jsdom`/`puppeteer-core` declared as runtime dependencies; a dead `currentSource` local; README claims that did not match the code | fixed, and the docs now describe real behaviour |

The reviews also refuted several plausible-sounding worries with evidence: no subscription leak
(cordis collects the returned detach), `localStorage` throwing on read *and* write is handled, a
persisted `null` payload cannot crash the normalizer, a double `apply()` does not duplicate
layers, and none of the glass selectors collide with unintended surfaces (all 72 UI bundles in the
application were scanned).

## How the numbers in the README were obtained

`docs/blog-visual-spec.md` is the measured specification: the layer stack, both scrim tints, the
`0.3 + overlay/100` formula with its resolved alpha, the two framings and their `64rem`
breakpoint, the fade's duration and easing, and the reduced-motion override — each with the URL
and the verbatim rule it came from, and with anything not found written down as not found rather
than guessed.
