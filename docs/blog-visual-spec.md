# blog.misaka.ren — Backdrop / "Background Effect" Visual Spec

Single fetch session. Target: `https://blog.misaka.ren/` — React Router v7 SSR on Cloudflare Workers
+ Tailwind v4 (Lightning CSS output), one stylesheet. Sources (all quoted text is verbatim):

| Tag | URL |
| --- | --- |
| HTML | https://blog.misaka.ren/ (59,239 chars) |
| CSS | https://blog.misaka.ren/assets/root-Ch1R5nPt.css (61,987 chars, **3 lines** — minified, so rules are cited by character offset `@N`) |
| JS (layout) | https://blog.misaka.ren/assets/public-layout-Cx-D8cwS.js (9,313 chars) |
| JS (root) | https://blog.misaka.ren/assets/root-Cg-WRMOR.js (2,365 chars) |
| Wallpaper | https://img-proxy.misaka.ren/7ed23f786f1d9f22cbc2e452f3ea0f7e |

**MEASURED** = read directly in the fetched bytes. **INFERRED** = my judgement, not stated in source.

## 0. Rendered DOM (MEASURED, HTML @4217–4776)

```html
<div class="site-scene flex min-h-screen min-h-dvh flex-col"
     style="--background-image:url(&quot;https://img-proxy.misaka.ren/7ed23f786f1d9f22cbc2e452f3ea0f7e&quot;);
            --background-x:50%;--background-y:0%;--mobile-background-x:76%;--mobile-background-y:38%;
            --background-overlay:0.4"
     data-theme="system" data-has-bg="true" suppressHydrationWarning>
  <a href="#main-content" class="fixed left-4 top-2 z-[60] ...">跳到正文</a>
  <span class="site-bg-image" aria-hidden="true"></span>
  <header class="fixed inset-x-0 top-0 z-40 h-14 ... lg:h-16 " ...>…</header>
  <div id="main-content" class="page-enter relative z-10 flex-1 pt-14 lg:pt-16">…</div>
  <footer class="relative z-10 mt-auto shrink-0 border-t border-line bg-surface/90 backdrop-blur-sm">…</footer>
</div>
```

Exactly **one** `<link rel="stylesheet">`, **zero** `<style>` blocks (MEASURED).

## 1. Layer stack — painting order (bottom → top)

**MEASURED** (CSS @9239, @9267, @9653, @11092, @11214, @11627, @19141):

```css
html{scroll-behavior:smooth}
body{background:var(--color-page);min-width:20rem;color:var(--color-ink);font-family:var(--font-sans);margin:0}
.site-scene{background-color:var(--color-page);--scene-overlay-rgb:247 248 252;position:relative}
.site-scene:before{z-index:0;background-color:var(--background-color,var(--color-page));content:"";position:fixed;inset:0}
.site-bg-image{z-index:0;background-image:var(--background-image);background-position:var(--mobile-background-x) var(--mobile-background-y);opacity:1;transition:opacity .48s var(--ease-out-expo);pointer-events:none;background-repeat:no-repeat;background-size:cover;position:fixed;inset:0}
.site-scene:after{z-index:0;background:rgb(var(--scene-overlay-rgb) / calc(.3 + var(--background-overlay)));content:"";pointer-events:none;position:fixed;inset:0}
.z-10{z-index:10}.z-40{z-index:40}.z-50{z-index:50}.z-\[60\]{z-index:60}
```
| # | Layer | Element | position | z-index | Notes |
| - | ----- | ------- | -------- | ------- | ----- |
| 1 | Canvas base | `html` + propagated `body` background-color `var(--color-page)` | static | — | MEASURED that `html` declares no background while `body{background:var(--color-page)}` does, so the body background propagates to the canvas. INFERRED (CSS background propagation) that this is bottom-most. |
| 2 | Scene base | `.site-scene` own `background-color:var(--color-page)` | `relative` | `auto` (no z utility; MEASURED class list `site-scene flex min-h-screen min-h-dvh flex-col`) | Same colour as layer 1. |
| 3 | Backdrop plate | `.site-scene::before` | `fixed;inset:0` | `0` | `var(--background-color, var(--color-page))`; `--background-color` is never defined (§2), so always `--color-page`. |
| 4 | Wallpaper | `span.site-bg-image` | `fixed;inset:0` | `0` | `aria-hidden="true"`, `pointer-events:none`; rendered only when `backgroundUrl` is set. |
| 5 | Scrim | `.site-scene::after` | `fixed;inset:0` | `0` | `pointer-events:none` — above the wallpaper, below content. |
| 6 | Content | `#main-content` (`z-10`), `footer` (`z-10`), `header` (`z-40`), mobile-nav overlay (`z-50`), skip link (`z-[60]`), `.nav-progress{z-index:70}` (CSS @12558) | mixed | 10–70 | MEASURED from class lists + the `.z-*` utility rules. |

**Stacking context.** `.site-scene` is `position:relative` with **no** `z-index` → it does **not**
establish a stacking context (MEASURED: the rule contains only `background-color`, one custom prop and
`position:relative`). So layers 3–5, each `position:fixed` **with** `z-index:0`, are painted in the
**root (html) stacking context**; among equal `z-index:0` items the order is tree order
(`::before` → `span.site-bg-image` → `::after`, since pseudo-elements are the first/last children by
definition and the span is the 2nd element child, HTML @4722). Content carries `z-index:10`, so it
always paints above the scrim. That is the whole trick: **the scrim is a sibling *above* the
wallpaper, not an overlay above the app.** (Ordering conclusion INFERRED from measured selectors,
per CSS 2.1 App. E.)

## 2. Theme + geometry variables (complete set affecting the backdrop)

**Light — default.** MEASURED, CSS @1670 `@layer theme{:root,:host{ … }}`:

```css
--color-page:#f7f8fc;--color-surface:#fff;--color-line:#17192314;--color-ink:#171923;
--color-ink-soft:#343849;--color-muted:#6b7183;--color-accent:#6d5dfb;--color-accent-strong:#5041db;
--color-accent-ink:#5041db;--color-accent-soft:#f0eeff;--color-mint:#2bc8b7;--color-mint-strong:#137e73;
```

plus MEASURED CSS @9653: `.site-scene{background-color:var(--color-page);--scene-overlay-rgb:247 248 252;position:relative}`

**Dark.** MEASURED, CSS @9750 and @10126 — two byte-identical blocks:

```css
.site-scene[data-theme=dark]{--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark;
  --color-page:#0d0f16;--color-surface:#171923;--color-line:#f7f8fc1a;--color-ink:#f7f8fc;
  --color-ink-soft:#d8dae4;--color-muted:#a5aabc;--color-accent-ink:#9a8bff;
  --color-accent-soft:#292449;--color-mint-strong:#57d9cb;--shadow-soft:0 8px 30px #0006;
  --scene-overlay-rgb:13 15 22}
```

| Token | Light | Dark | Source |
| ----- | ----- | ---- | ------ |
| `--color-page` | `#f7f8fc` (247,248,252) | `#0d0f16` (13,15,22) | CSS @4198 (theme layer) / @9848 / @10261 |
| `--scene-overlay-rgb` | `247 248 252` | `13 15 22` | CSS @9653 / @10097 / @10510 |
| `--background-overlay` | `0.4` | `0.4` (not theme-dependent) | MEASURED, HTML @4285 inline style. **NOT FOUND in CSS** — no declaration anywhere. |
| `--background-color` | undefined | undefined | **NOT FOUND** — see §11. Consumer: `.site-scene:before` fallback only. |
| `--ease-out-expo` | `cubic-bezier(.22, 1, .36, 1)` | same | CSS @4722 (theme layer) |

`backgroundOverlay` is an **integer percent** in the settings payload, divided by 100 in JS
(MEASURED, public-layout chunk @2614): `"--background-overlay":String(w.backgroundOverlay/100)`.
Streamed payload (MEASURED, HTML @58834) has `"backgroundPositionX",50,"backgroundPositionY",
"mobileBackgroundPositionX",76,"mobileBackgroundPositionY",38,"backgroundOverlay",40,"backgroundColor",`
→ setting **40** ⇒ `0.4`. The `backgroundPositionY` value slot is empty in the stream while the SSR
inline style reads `--background-y:0%`; INFERRED: the server normalises a missing value to `0`, and an
implementation should too (`Number.isFinite(v) ? v : 0`).

Hard-coded dark body colours (MEASURED, CSS @10732 / @11026), bypassing the variable:

```css
html:has(.site-scene[data-theme=dark]) body{background:#0d0f16}
@media (prefers-color-scheme:dark){ … html:has(.site-scene[data-theme=system]) body{background:#0d0f16} }
```

Also MEASURED in `<head>`: `<meta name="theme-color" content="#f7f8fc" media="(prefers-color-scheme: light)"/>`
and `<meta name="theme-color" content="#0d0f16" media="(prefers-color-scheme: dark)"/>`.

## 3. Scrim math

MEASURED literal (CSS @11627):
`background:rgb(var(--scene-overlay-rgb) / calc(.3 + var(--background-overlay)))`

Alpha is `calc(0.3 + var(--background-overlay))`. With `--background-overlay:0.4`:

| Theme | `--scene-overlay-rgb` | α = 0.3 + 0.4 | Resolved colour |
| ----- | --------------------- | ------------- | --------------- |
| light | `247 248 252` | **0.7** | `rgb(247 248 252 / 0.7)` = `#f7f8fc` @ 70 % |
| dark | `13 15 22` | **0.7** | `rgb(13 15 22 / 0.7)` = `#0d0f16` @ 70 % |

**Alpha floor:** the literal `0.3` means α can never drop below 0.3 even at overlay = 0; at
overlay = 100, α = 1.3, which CSS clamps to 1. (Clamping INFERRED from CSS Color 4; the `calc()` is
MEASURED.)

**Effective composite over mid-grey `#808080`:** `out = α·scrim + (1−α)·src`, α = 0.7 → 0.7/0.3:

* light: R `0.7·247 + 0.3·128 = 172.9 + 38.4 = 211.30`; G `0.7·248 + 0.3·128 = 173.6 + 38.4 = 212.00`;
  B `0.7·252 + 0.3·128 = 176.4 + 38.4 = 214.80` → **rgb(211,212,215) ≈ `#d3d4d7`**, rel. luminance ≈ 0.658
* dark: R `0.7·13 + 0.3·128 = 9.1 + 38.4 = 47.50`; G `0.7·15 + 0.3·128 = 10.5 + 38.4 = 48.90`;
  B `0.7·22 + 0.3·128 = 15.4 + 38.4 = 53.80` → **rgb(48,49,54) ≈ `#303136`**, rel. luminance ≈ 0.031

**Composite range** (same arithmetic):

| Source pixel | light result | dark result |
| ------------ | ------------ | ----------- |
| `#000000` | `rgb(173,174,176)` `#adaeb0` | `rgb(9,11,15)` `#090b0f` |
| `#808080` | `rgb(211,212,215)` `#d3d4d7` | `rgb(48,49,54)` `#303136` |
| `#ffffff` | `rgb(249,250,253)` `#f9fafd` | `rgb(86,87,92)` `#56575c` |

INFERRED consequence: light mode compresses the backdrop into ~80 levels of dynamic range (173→249) —
a faint watermark; dark mode spans 9→86 and shows far more texture. That asymmetry is the signature
of the effect.

## 4. Wallpaper geometry

MEASURED (CSS @11214, @11789):

```css
.site-bg-image{ … background-position:var(--mobile-background-x) var(--mobile-background-y);
  background-repeat:no-repeat;background-size:cover;position:fixed;inset:0; … }
@media (width>=64rem){.site-bg-image{background-position:var(--background-x) var(--background-y)}}
```

* `background-size:cover` — fills the viewport, preserves aspect ratio, crops overflow. MEASURED.
* `background-repeat:no-repeat` — MEASURED.
* `background-position` order is `<x> <y>` (horizontal first). Values are **percentages**, so per CSS
  semantics *"point P % of the image aligns with point P % of the container"*: 0 % pins top/left,
  100 % pins bottom/right, 50 % centres.
* Breakpoint `width>=64rem` = **1024 px** at a 16 px root. MEASURED: no `font-size` is declared on
  `html`, `:root` or `:host` anywhere in the stylesheet (regex-searched), so the initial 16 px root
  applies. `64rem` occurs 3×: this rule (@11789), Tailwind `.container` cap (@19377) and the `lg:`
  utility block (@49576) — so `lg:` and the wallpaper breakpoint coincide at 1024 px.
* Desktop `50% 0%` (MEASURED inline style): x centred (symmetric L/R crop), y pinned to the top edge.
* Mobile `76% 38%` (MEASURED inline style): x = 76 % biases the window to the **right** of the image,
  y = 38 % biases it slightly **above** centre.

**Cover arithmetic for this exact 1920×1080 asset** — `scale = max(vw/1920, vh/1080)`, offset
`= P·(viewport − scaled)`; INFERRED arithmetic on MEASURED inputs:

| Viewport | rule | scale | drawn | offset (x,y) | source crop |
| -------- | ---- | ----- | ----- | ------------ | ----------- |
| 1440×900 | `50% 0%` | 0.8333 | 1600×900 | −80, 0 | x 96→1824, y 0→1080 (full height) |
| 1024×768 | `50% 0%` | 0.7111 | 1365×768 | −171, 0 | x 240→1680, y 0→1080 |
| 390×844 | `76% 38%` | 0.7815 | 1500×844 | −844, 0 | x 1080→1579, y 0→1080 |

Whenever the viewport is narrower than 16:9 the height binds and the **y** percentage becomes a no-op
(offset y = 0 in every row above); the y setting only matters on viewports wider than 16:9. (INFERRED.)

## 5. Cross-fade behaviour

MEASURED (CSS @11214, @11502, @11556):

```css
.site-bg-image{ … opacity:1;transition:opacity .48s var(--ease-out-expo); … }
.site-scene[data-bg-pending] .site-bg-image{opacity:0}
@media (prefers-reduced-motion:reduce){.site-bg-image{transition:none}}
```

* Transitioned property: **`opacity` only** — no transform, no filter, no background-position animation.
* Duration **`.48s` = 480 ms**; easing `var(--ease-out-expo)` = `cubic-bezier(.22, 1, .36, 1)` (CSS @4722) — a hard ease-out, ~90 % of the distance covered in the first ~200 ms.
* The wallpaper does **not** fade on theme change; the scrim colour swaps instantly (no `transition` is declared on `.site-scene:after`). INFERRED from that absence.

**`prefers-reduced-motion` — two independent mechanisms, both MEASURED:**

1. Targeted, CSS @11556: `@media (prefers-reduced-motion:reduce){.site-bg-image{transition:none}}`
2. Global, CSS @9411 (`@layer base`):
   ```css
   @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,:before,:after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
   ```
   These `!important` declarations sit in a *lower* cascade layer, so they beat the non-important `transition` in `@layer components`. Net effect: **no fade at all** under reduced motion; the wallpaper appears instantly. (Layer-precedence reasoning INFERRED; rule text MEASURED.)

## 6. `data-bg-pending` — the fade-in gate (exact mechanism)

**Step 1 — set synchronously before hydration by an inline `<script>` at the end of `<body>`**
(MEASURED, HTML @50640; the identical string is the SSR template literal `p` in root-Cg-WRMOR.js @646):

```html
<script>(function(){try{var t=localStorage.getItem("misaka-theme");var s=document.querySelector(".site-scene");if(!s)return;if(t==="light"||t==="dark"||t==="system")s.setAttribute("data-theme",t);if(s.getAttribute("data-has-bg")==="true")s.setAttribute("data-bg-pending","");}catch(e){}})();</script>
```

The gate is applied whenever `data-has-bg="true"`; the server HTML itself does **not** contain `data-bg-pending` (MEASURED: `bg-pending` occurs in the HTML only inside that script string).
`data-has-bg` has **no CSS rule** (§11) — it is purely a JS/SSR flag. Note `data-bg-pending=""` still matches `[data-bg-pending]`, since an empty value is not an absent attribute.

**Step 2 — cleared on image load by a React effect in the layout** (MEASURED, public-layout @2118):

```js
(0,v.useEffect)(()=>{
  let e=document.querySelector(`.site-scene`);
  if(!w.backgroundUrl||!e?.hasAttribute(`data-bg-pending`))return;
  let t=new Image(),
      n=()=>e.removeAttribute(`data-bg-pending`);
  return t.onload=n, t.onerror=n, t.src=w.backgroundUrl,
         ()=>{t.onload=null,t.onerror=null}
},[w.backgroundUrl]);
```

Precisely:

1. A **detached `new Image()` preloader** is created (not the visible `<span>`), with the *same* URL
   the span already uses via `--background-image`.
2. `onload` **and** `onerror` both call `removeAttribute("data-bg-pending")`, so a failed fetch still
   clears the gate — the backdrop can never stay permanently hidden.
3. `.src` is assigned last, so handlers exist before the fetch starts.
4. Removing the attribute flips the span `opacity:0 → opacity:1`, which is what runs the 480 ms
   `cubic-bezier(.22,1,.36,1)` fade. The fade therefore begins after hydration, not at first paint.
5. Cleanup nulls the handlers on unmount/re-run (no stale removal).

INFERRED: since the preloader and the span request the same URL, the span is normally served from the
HTTP cache, so the fade reveals an already-decoded image with no visible progressive paint.

## 7. Backdrop-only tokens (framing/scrim) — the portable set

Text/nav/article styling is deliberately out of scope. Everything that changes the backdrop:

```
--color-page                 #f7f8fc      | #0d0f16        light | dark     (flat fill layers)
--scene-overlay-rgb          247 248 252  | 13 15 22       light | dark     (scrim colour, space-separated)
--background-overlay         0.4          (unitless fraction, from setting 40/100)
--background-image           url("https://img-proxy.misaka.ren/7ed23f786f1d9f22cbc2e452f3ea0f7e")
--background-x / --background-y                 50%  /  0%   (used at >= 1024px)
--mobile-background-x / --mobile-background-y   76%  / 38%   (used below 1024px)
--ease-out-expo              cubic-bezier(.22, 1, .36, 1)
--background-color           undefined; consumed only as var(--background-color, var(--color-page))
```

Static geometry constants: `position:fixed; inset:0` on all three backdrop layers; `background-size:cover`; `background-repeat:no-repeat`; `pointer-events:none` on wallpaper + scrim; `opacity 480ms cubic-bezier(.22,1,.36,1)` on the wallpaper; breakpoint `64rem` = 1024 px.
Explicitly **not** needed: `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--shadow-soft`, `--color-surface/ink/muted/accent*` (content or chrome only).

## 8. `prefers-color-scheme` handling for `data-theme="system"`

MEASURED, CSS @10126 — one media query, two sections (variables, then scrollbar/body colours):

```css
@media (prefers-color-scheme:dark){.site-scene[data-theme=system]{--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark;--color-page:#0d0f16;--color-surface:#171923;--color-line:#f7f8fc1a;--color-ink:#f7f8fc;--color-ink-soft:#d8dae4;--color-muted:#a5aabc;--color-accent-ink:#9a8bff;--color-accent-soft:#292449;--color-mint-strong:#57d9cb;--shadow-soft:0 8px 30px #0006;--scene-overlay-rgb:13 15 22}
.site-scene[data-theme=system]{--scrollbar-thumb:#f7f8fc3d;--scrollbar-thumb-hover:#9a8bff8c}
html:has(.site-scene[data-theme=system]){--scrollbar-thumb:#f7f8fc3d;--scrollbar-thumb-hover:#9a8bff8c}
html:has(.site-scene[data-theme=system]) body{background:#0d0f16}}
```

The dark block for `[data-theme=system]` is **byte-identical** to the `[data-theme=dark]` block — same 12 declarations, including `--scene-overlay-rgb:13 15 22`. There is **no** `@media (prefers-color-scheme:light)` block; light is the implicit default from the theme layer.
`color-scheme:dark` is also set here; `--lightningcss-light`/`--lightningcss-dark` are Lightning CSS sentinels, not real tokens. Resolution order (MEASURED, inline script §6 + public-layout @2010): `localStorage["misaka-theme"]` ∈ {`light`,`dark`,`system`} overrides the SSR `data-theme`; React state is seeded from `settings.themeMode` (payload: `"themeMode","system"`).

## 9. How to port (to a desktop chat app / any unrelated UI)

1. **Three stacked full-viewport layers, bottom → top:** flat theme fill → wallpaper → flat scrim, all
   `position:fixed; inset:0`. Do not fold the scrim into the wallpaper with a filter or gradient — the
   site keeps them separate so the scrim colour can be theme-switched without touching the image.
2. **Scrim above wallpaper, below app content.** Give wallpaper and scrim `z-index:0` and your content
   root `z-index:10` (or a later sibling with a positive z-index). The scrim must be a *sibling* of the
   wallpaper, never an ancestor of the content, or your app's own surfaces inherit the scrim.
3. **`pointer-events:none` on wallpaper and scrim** so input reaches the app.
4. **Scrim = theme-switched rgba composite:** `alpha = 0.3 + userOverlay` (site default overlay `0.4`
   → `0.7`); colour `#f7f8fc` light / `#0d0f16` dark. Keep the `0.3` floor separate so a user slider
   can never fully expose the image.
5. **Wallpaper:** `background-size:cover; background-repeat:no-repeat` on a fixed element, positioned
   with **percentages** (not pixels) so framing survives resizes.
6. **Two position pairs, one 1024 px breakpoint:** below → `76% 38%`, at/above → `50% 0%`. Order is
   `<x> <y>`; 50 % = centre, 0 % = pin top/left.
7. **Fade in once, on load:** start at `opacity:0`, preload the URI with a detached `new Image()`, and
   clear the hidden state from **both** `onload` and `onerror`; transition
   `opacity 480ms cubic-bezier(.22,1,.36,1)`. Never gate on a `setTimeout`.
8. **Honour reduced motion:** drop the fade entirely (`transition:none`).
9. **Propagate the base colour to the window canvas too**, so overscroll/rubber-band areas match
   (`body{background:var(--color-page)}` plus a hard-coded dark override).
10. **Expose it as 6 variables** — `pageColor`, `scrimRgb`, `overlay (0…1)`, `imageUri`, `desktopPos`,
    `mobilePos` — and treat a missing position component as `0`: the site's own payload ships an empty
    value there while the rendered style shows `0%`.

## 10. Wallpaper asset verification (MEASURED)

`https://img-proxy.misaka.ren/7ed23f786f1d9f22cbc2e452f3ea0f7e`, fetched with `node fetch`:

| Property | Value |
| -------- | ----- |
| HTTP status | `200` |
| `content-type` | `image/png` |
| `content-length` (reported) | `2231776` |
| bytes received | `2231776` (222.1 KiB / 2.13 MiB) |
| magic bytes (first 8) | `89504e470d0a1a0a` (PNG signature) |
| IHDR | offsets 16/20 big-endian `uint32` → **1920 × 1080** |
| other IHDR fields | bit depth `8`, colour type `6` (RGBA) |

Exactly 16:9 at 1920×1080 — which is why the `y` position component is inert on viewports narrower
than 16:9 (§4).

## 11. NOT FOUND / unresolved

* `--background-color` declaration — **NOT FOUND**. Regex-searched `--background-color\s*:` in
  `root-Ch1R5nPt.css` and the literal `background-color` in all 7 downloaded JS chunks. Exists only as
  an optional runtime style and as the `var()` fallback in `.site-scene:before`.
* `--background-overlay` declaration — **NOT FOUND**. Searched `--background-overlay\s*:` in the
  stylesheet and `background-overlay` in every JS chunk (only hit: the layout chunk's inline style
  object). The value `0.4` exists solely in the SSR inline style attribute.
* `data-has-bg` CSS rule — **NOT FOUND** (0 matches for `data-has-bg` in the stylesheet); consumed
  only by the inline script.
* `@media (prefers-color-scheme:light)` — **NOT FOUND** (0 matches for `prefers-color-scheme:light`).
  Light is the implicit default.
* `transition` on the scrim — **NOT FOUND**: `.site-scene:after{…}` contains no `transition`.
* `background-attachment` — **NOT FOUND** anywhere in the stylesheet. The wallpaper does not scroll
  because the layer is `position:fixed`, not because of `background-attachment`.
* Wallpaper blur / `backdrop-filter` on the backdrop — **NOT FOUND** on `.site-bg-image`, `::before`
  or `::after` (8 `backdrop-filter` occurrences exist, none of them on backdrop layers; e.g.
  `backdrop-blur-md` on `header` chrome only).
