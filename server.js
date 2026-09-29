import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const PORT = Number(process.env.PORT) || 3000
const MAX_BYTES = 100 * 1024 * 1024
const MAX_PIXELS = 100_000_000
const SIZES = [0, 3840, 2560, 1920, 1280]
const MAX_RUNNING = 2
// Total size of uploads held in memory at once
const MAX_HELD = 600 * 1024 * 1024
const RATE_PER_IP = 120
const MAX_TRACKED_IPS = 20_000

const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; " +
  "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const run = promisify(execFile)
sharp.cache(false)

const JS = 'text/javascript; charset=utf-8'
const assets = new Map()
for (const [path, file, type] of [
  ['/', 'public/index.html', 'text/html; charset=utf-8'],
  ['/app.css', 'public/app.css', 'text/css; charset=utf-8'],
  ['/app.js', 'public/app.js', JS],
  ['/local.js', 'public/local.js', JS],
  ['/favicon.svg', 'public/favicon.svg', 'image/svg+xml'],
  ['/favicon-32.png', 'public/favicon-32.png', 'image/png'],
  ['/apple-touch-icon.png', 'public/apple-touch-icon.png', 'image/png'],
  ['/fonts/nunito-sans-5.3.0.woff2', 'public/fonts/nunito-sans-5.3.0.woff2', 'font/woff2'],
  ['/vendor/mozjpeg_enc.js', 'node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.js', JS],
  ['/vendor/mozjpeg_enc.wasm', 'node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm', 'application/wasm'],
]) {
  const body = await readFile(new URL(file, import.meta.url))
  const etag = '"' + createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"'
  assets.set(path, { body, type, etag })
}

// Requests per IP, wiped every minute
let hits = new Map()
setInterval(() => { hits = new Map() }, 60_000).unref()

function allow(ip) {
  if (!hits.has(ip) && hits.size >= MAX_TRACKED_IPS) return false
  const count = (hits.get(ip) ?? 0) + 1
  hits.set(ip, count)
  return count <= RATE_PER_IP
}

let running = 0
let held = 0
const waiting = []

async function inTurn(job) {
  if (running >= MAX_RUNNING) await new Promise((go) => waiting.push(go))
  running++
  try {
    return await job()
  } finally {
    running--
    waiting.shift()?.()
  }
}

class UserError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

async function compress(input, quality, size) {
  const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata()
  if (meta.width * meta.height > MAX_PIXELS) throw new UserError(413, 'Image is too large')

  const heic = meta.format === 'heif' && meta.compression === 'hevc'
  const source = heic ? await decodeHeic(input) : input
  const info = heic ? await sharp(source).metadata() : meta

  let image = sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
  if (!heic) image = image.rotate()
  if (size) image = image.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
  // Keep RGB profiles like Display P3. Anything else, like CMYK, becomes sRGB.
  if (info.icc && ['srgb', 'rgb16'].includes(info.space)) image = image.keepIccProfile()
  if (info.hasAlpha) image = image.flatten({ background: '#ffffff' })

  const { data, info: out } = await image.jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true })

  // If a JPEG or PNG would get bigger, return the original
  if (['jpeg', 'png'].includes(meta.format) && !size && data.length >= input.length) {
    const { width, height } = meta.autoOrient
    return { data: input, type: `image/${meta.format}`, width, height, kept: true }
  }
  return { data, type: 'image/jpeg', width: out.width, height: out.height, kept: false }
}

// sharp's libvips can't read HEVC, so the system one decodes the primary image.
// It also applies the rotation stored in the file.
async function decodeHeic(input) {
  const dir = await mkdtemp(join(tmpdir(), 'heic-'))
  try {
    await writeFile(join(dir, 'in.heic'), input)
    // sharp sets VIPSHOME, which hides the HEIC plugin from the system libvips
    await run('vips', ['copy', 'in.heic', 'out.tif'], { cwd: dir, timeout: 60_000, env: { PATH: process.env.PATH } })
    return await readFile(join(dir, 'out.tif'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function send(res, status, headers, body) {
  res.writeHead(status, {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'strict-transport-security': 'max-age=31536000',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...headers,
  })
  res.end(body)
}

const fail = (res, status, message) =>
  send(res, status, { 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ error: message }))

async function handleCompress(req, res, url) {
  // Bunny sets X-Real-IP, and the origin only accepts requests from Bunny
  if (!allow(req.headers['x-real-ip'] || req.socket.remoteAddress)) {
    return fail(res, 429, 'Too many images at once. Try again in a minute.')
  }
  const length = Number(req.headers['content-length'])
  if (!length) return fail(res, 400, 'Empty file')
  if (length > MAX_BYTES) return fail(res, 413, 'File is over 100 MB')
  if (held + length > MAX_HELD) return fail(res, 503, 'Busy right now. Try again in a moment.')

  const quality = Number(url.searchParams.get('quality') ?? 75)
  const size = Number(url.searchParams.get('size') ?? 0)
  if (!Number.isInteger(quality) || quality < 1 || quality > 100 || !SIZES.includes(size)) {
    return fail(res, 400, 'Bad settings')
  }

  held += length
  try {
    const input = await readBody(req)
    const out = await inTurn(() => compress(input, quality, size))
    send(res, 200, {
      'content-type': out.type,
      'cache-control': 'no-store',
      'x-width': out.width,
      'x-height': out.height,
      'x-kept': out.kept ? '1' : '0',
    }, out.data)
  } catch (err) {
    if (req.socket.destroyed) return
    if (err instanceof UserError) return fail(res, err.status, err.message)
    if (/unsupported image format|bad seek|corrupt|premature end/i.test(err.message)) {
      return fail(res, 415, "This file isn't an image it can read")
    }
    if (/pixel limit/i.test(err.message)) return fail(res, 413, 'Image is too large')
    console.error('compress failed:', err.message)
    fail(res, 500, "Couldn't compress this image")
  } finally {
    held -= length
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'POST' && url.pathname === '/compress') return handleCompress(req, res, url)

  const asset = assets.get(url.pathname)
  if (!asset) return fail(res, 404, 'Not found')
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed')
  const headers = { 'content-type': asset.type, 'cache-control': 'no-cache', etag: asset.etag }
  if (req.headers['if-none-match'] === asset.etag) return send(res, 304, headers)
  send(res, 200, headers, req.method === 'GET' ? asset.body : undefined)
})

server.listen(PORT, () => console.log(`compress listening on ${PORT}`))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
