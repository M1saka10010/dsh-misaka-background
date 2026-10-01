/**
 * Host half of `dsh-misaka-background`.
 *
 * The effect renders entirely in the browser, so this half has one job: make the
 * wallpaper configuration reachable from the plugin itself rather than only from
 * the GUI. It resolves the configuration and publishes it on a small same-origin
 * GET route that the client half fetches on startup.
 *
 * Sources, later ones winning:
 *
 *   1. the shipped defaults (mirrored in `lib/client.js`);
 *   2. an optional `config.json` beside this package — edit the plugin folder;
 *   3. the plugin row's `config:` in the profile patch — edit the profile, e.g.
 *      `~/.dsh/profiles/desktop/cordis.patch.yml`:
 *
 *          - id: dsh-misaka-background
 *            name: "dsh-misaka-background"
 *            config:
 *              imageUrl: "https://example.com/art.png"
 *              overlay: 40
 *
 * Values the user changes in the settings row are stored in the browser and take
 * precedence over all of these; "reset all" clears them so the configuration
 * takes over again.
 *
 * No webserver (a headless composition, say) simply means nobody can fetch the
 * route; the client then uses its own defaults. That is not an error.
 */
import { readFileSync } from 'node:fs'

/** Route the client half fetches its baseline from. */
export const CONFIG_ROUTE = '/dsh-misaka-background/config.json'

/** The numeric bounds the client also enforces, with each field's default. */
const LIMITS = {
  overlay: [0, 70, 40],
  wallpaperOpacity: [0, 100, 100],
  wallpaperBlur: [0, 60, 0],
  glassBlur: [0, 40, 18],
  artSeed: [1, 99, 7],
  artIntensity: [0, 160, 100]
}

/** Clamp one numeric field, falling back when it is not finite. */
function clamp(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

/**
* Coerce arbitrary configuration into the shape the client understands.
*
* Only keys that are actually present survive, so the client keeps its own
* defaults for everything the configuration does not mention instead of this half
* inventing values for them.
*
* @param raw - configuration from the plugin row or from `config.json`.
* @returns the recognized keys, normalized.
*/
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const output = {}
  if (typeof input.enabled === 'boolean') output.enabled = input.enabled
  if (typeof input.glass === 'boolean') output.glass = input.glass
  for (const [key, [min, max, fallback]] of Object.entries(LIMITS)) {
    if (input[key] === undefined || input[key] === null) continue
    output[key] = clamp(input[key], min, max, fallback)
  }
  if (typeof input.imageUrl === 'string') output.imageUrl = input.imageUrl.trim()
  return output
}

/** Read the optional `config.json` beside this package; absent or broken is fine. */
function readConfigFile() {
  try {
    return JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) return {}
    throw error
  }
}

/** Build the request handler for one resolved configuration. */
function configHandler(body) {
  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      response.end('method not allowed\n')
      return
    }
    // This route is unfenced: the webserver owns no authentication, and route
    // owners bring their own policy. A cross-site reader is already blocked by
    // same-origin policy (no CORS header is sent), but the configured URL can
    // carry a signed token, so refuse an explicitly cross-site request outright.
    const site = request.headers['sec-fetch-site']
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('cross-site request refused\n')
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      // The configuration is resolved once at startup; a cached copy would only
      // ever be stale.
      'cache-control': 'no-store'
    })
    if (request.method === 'HEAD') response.end()
    else response.end(body)
  }
}

/**
* Host plugin body: resolve the configuration and publish it for the client.
*
* @param ctx - host cordis context.
* @param config - the plugin row's `config:` block, when the profile sets one.
*/
export function apply(ctx, config) {
  // The file is the base, so an explicit row config always wins over it.
  const resolved = { ...normalizeConfig(readConfigFile()), ...normalizeConfig(config) }
  const body = JSON.stringify(resolved)

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: CONFIG_ROUTE,
      handler: configHandler(body)
    }), 'dsh-misaka-background: config route')
  })
}

export default { apply, name: 'dsh-misaka-background', CONFIG_ROUTE }
