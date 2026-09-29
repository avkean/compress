const MAX_BYTES = 100 * 1024 * 1024
const AT_ONCE = 3
const IMAGE_EXT = /\.(jpe?g|jfif|png|webp|avif|heic|heif|gif|tiff?|bmp)$/i

const $ = (id) => document.getElementById(id)
const $list = $('list'), $summary = $('summary'), $picker = $('picker')
const $quality = $('quality'), $qualityOut = $('quality-out'), $size = $('size')
const $all = $('all-btn'), $about = $('about'), $local = $('local-btn')

// Settings are remembered in this browser only
const PREFS_KEY = 'compress'
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  if (saved.quality) $quality.value = saved.quality
  if ([...$size.options].some((o) => o.value === saved.size)) $size.value = saved.size
  if (saved.local) $local.setAttribute('aria-pressed', 'true')
} catch {}
const isLocal = () => $local.getAttribute('aria-pressed') === 'true'
const settings = () => `quality=${$quality.value}&size=${$size.value}` + (isLocal() ? '&local' : '')

// Phones get the share sheet, so photos can go straight to the camera roll
const touch = matchMedia('(pointer: coarse)').matches
// iPhones can't make canvases over about 16.7 MP, so phones get that limit
const LOCAL_MAX_PIXELS = touch ? 4096 * 4096 : 100_000_000
const canShare = (files) => touch && navigator.canShare?.({ files })

let items = []

const mb = (bytes) => bytes < 1e6
  ? Math.max(1, Math.round(bytes / 1e3)) + ' KB'
  : (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0) + ' MB'
const outName = (name) => name.replace(/\.[^.]*$/, '') + '.jpg'
const dotsHtml = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>'

function add(files) {
  for (const file of files) {
    const item = { file, state: 'queued', result: null, error: '' }
    if (!file.type.startsWith('image/') && !IMAGE_EXT.test(file.name)) {
      item.state = 'error'; item.error = 'Not an image'; item.invalid = true
    } else if (file.size > MAX_BYTES) {
      item.state = 'error'; item.error = 'Over 100 MB'; item.invalid = true
    }
    item.el = row(item)
    $list.append(item.el)
    items.push(item)
    draw(item)
  }
  pump()
  update()
}

function row(item) {
  const li = document.createElement('li')
  li.className = 'item'
  li.innerHTML = `
    <div class="thumb"><svg class="i" aria-hidden="true"><use href="#i-image"/></svg></div>
    <div class="info"><div class="name"></div><div class="detail"></div></div>
    <div class="saving"></div>
    <div class="row-actions">
      <button class="icon-btn dl" type="button" aria-label="Download" title="Download"><svg class="i"><use href="#i-down"/></svg></button>
      <button class="icon-btn rm" type="button" aria-label="Remove" title="Remove"><svg class="i"><use href="#i-x"/></svg></button>
    </div>`
  li.querySelector('.name').textContent = item.file.name
  li.querySelector('.name').title = item.file.name
  li.querySelector('.dl').onclick = () => save([item])
  li.querySelector('.rm').onclick = () => remove(item)
  return li
}

function draw(item) {
  const { el, result } = item
  const busy = item.state === 'queued' || item.state === 'busy'
  el.classList.toggle('busy', busy)
  el.classList.toggle('done', !!result)
  el.classList.toggle('stale', busy && !!result)
  el.classList.toggle('error', item.state === 'error')

  const detail = el.querySelector('.detail')
  const saving = el.querySelector('.saving')
  if (item.state === 'error') {
    detail.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-alert"/></svg><span></span>'
    detail.lastChild.textContent = item.error
    saving.textContent = ''
    return
  }
  if (!result) {
    detail.innerHTML = dotsHtml + `<span>${item.state === 'busy' ? 'Compressing' : 'Waiting'}</span>`
    saving.textContent = ''
    return
  }

  const change = 1 - result.blob.size / item.file.size
  detail.innerHTML = '<span></span><span class="dims"></span>'
  detail.firstChild.textContent = result.kept
    ? `${mb(item.file.size)}, kept the original as it's already smaller`
    : `${mb(item.file.size)} → ${mb(result.blob.size)}`
  detail.lastChild.textContent = `· ${result.width} × ${result.height}`
  const pct = Math.round(Math.abs(change) * 100)
  saving.textContent = pct === 0 ? '0%' : (change > 0 ? '−' : '+') + pct + '%'
  saving.className = 'saving ' + (change > 0 && pct > 0 ? 'good' : 'flat')

  const thumb = el.querySelector('.thumb')
  let img = thumb.querySelector('img')
  if (!img) {
    img = document.createElement('img')
    img.alt = ''
    img.decoding = 'async'
    img.onload = () => img.classList.add('ready')
    thumb.append(img)
  }
  if (img.src !== result.url) img.src = result.url
}

function pump() {
  const running = items.filter((i) => i.state === 'busy').length
  const next = items.filter((i) => i.state === 'queued').slice(0, (isLocal() ? 1 : AT_ONCE) - running)
  for (const item of next) compress(item)
}

async function compress(item) {
  item.state = 'busy'
  const mine = item.controller = new AbortController()
  const key = settings()
  draw(item)
  update()
  try {
    const out = isLocal() ? await onDevice(item.file) : await onServer(item.file, key, mine.signal)
    if (item.removed || item.controller !== mine) return
    // Server is full, so wait and queue again
    if (out.busy) {
      await new Promise((go) => setTimeout(go, 3000))
      if (item.removed || item.controller !== mine) return
      item.state = 'queued'
      draw(item)
      pump()
      return
    }
    if (item.result) URL.revokeObjectURL(item.result.url)
    item.result = { ...out, url: URL.createObjectURL(out.blob), key }
    item.state = 'done'
  } catch (err) {
    if (err.name === 'AbortError') return
    item.state = 'error'
    item.error = err instanceof TypeError ? "Couldn't reach the server" : err.message
  }
  if (item.removed) return
  draw(item)
  pump()
  update()
}

async function onServer(file, key, signal) {
  const res = await fetch('/compress?' + key, { method: 'POST', body: file, signal })
  if (res.status === 503) return { busy: true }
  if (!res.ok) {
    let message = "Couldn't compress this image"
    try { message = (await res.json()).error || message } catch {}
    throw new Error(message)
  }
  return {
    blob: await res.blob(),
    width: res.headers.get('x-width'),
    height: res.headers.get('x-height'),
    kept: res.headers.get('x-kept') === '1',
  }
}

let worker = null
let jobId = 0
const jobs = new Map()

async function onDevice(file) {
  const bitmap = await decode(file)
  const { width, height } = bitmap
  const size = Number($size.value)
  const scale = size ? Math.min(1, size / Math.max(width, height)) : 1
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  if (w * h > LOCAL_MAX_PIXELS) {
    bitmap.close()
    throw new Error('Too large for this device. Pick a smaller size or turn off On this device.')
  }
  const { blob } = await inWorker(bitmap, w, h)
  // If a JPEG or PNG would get bigger, return the original
  if (['image/jpeg', 'image/png'].includes(file.type) && !size && blob.size >= file.size) {
    return { blob: file, width, height, kept: true }
  }
  return { blob, width: w, height: h, kept: false }
}

// Safari opens HEIC in an <img> even where createImageBitmap can't
async function decode(file) {
  try { return await createImageBitmap(file) } catch {}
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return await createImageBitmap(img)
  } catch {
    throw new Error(/\.hei[cf]$/i.test(file.name)
      ? "This browser can't open HEIC. Use Safari, or turn off On this device."
      : "This file isn't an image it can read")
  } finally {
    URL.revokeObjectURL(url)
  }
}

function inWorker(bitmap, width, height) {
  if (!worker) {
    worker = new Worker('/local.js', { type: 'module' })
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id)
      jobs.delete(data.id)
      data.error ? job.reject(new Error(data.error)) : job.resolve(data)
    }
    worker.onerror = () => {
      for (const job of jobs.values()) job.reject(new Error("This browser can't compress on the device"))
      jobs.clear()
      worker = null
    }
  }
  const id = jobId++
  const done = new Promise((resolve, reject) => jobs.set(id, { resolve, reject }))
  worker.postMessage({ id, bitmap, width, height, quality: Number($quality.value) }, [bitmap])
  return done
}

function remove(item) {
  item.removed = true
  item.controller?.abort()
  if (item.result) URL.revokeObjectURL(item.result.url)
  item.el.remove()
  items = items.filter((i) => i !== item)
  pump()
  update()
}

function clearAll() {
  for (const item of [...items]) remove(item)
}

function update() {
  document.body.classList.toggle('has-files', items.length > 0)
  const done = items.filter((i) => i.state === 'done')
  const working = items.filter((i) => i.state === 'queued' || i.state === 'busy').length
  const failed = items.filter((i) => i.state === 'error').length

  $all.disabled = working > 0 || done.length === 0
  $all.lastChild.textContent = done.length > 1 || working ? 'Download all' : 'Download'

  if (!items.length) {
    $summary.textContent = ''
    return
  }
  if (working) {
    $summary.innerHTML = dotsHtml + '<span></span>'
    $summary.lastChild.textContent = `Compressing, ${done.length} of ${items.length - failed} done`
    return
  }
  const before = done.reduce((n, i) => n + i.file.size, 0)
  const after = done.reduce((n, i) => n + i.result.blob.size, 0)
  const parts = []
  if (done.length) {
    const count = done.length === 1 ? '1 image' : `${done.length} images`
    const saved = before ? Math.round((1 - after / before) * 100) : 0
    parts.push(`${count} · ${mb(before)} → ${mb(after)}` + (saved > 0 ? ` · <b>${saved}% smaller</b>` : ''))
  }
  if (failed) parts.push(failed === 1 ? '1 failed' : `${failed} failed`)
  $summary.innerHTML = `<span>${parts.join(' · ')}</span>`
}

// Old results stay, dimmed, until the new ones arrive
let redoTimer = null
function redo() {
  document.body.classList.toggle('local', isLocal())
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ quality: $quality.value, size: $size.value, local: isLocal() })) } catch {}
  clearTimeout(redoTimer)
  redoTimer = setTimeout(() => {
    const key = settings()
    for (const item of items) {
      if (item.invalid || (item.state === 'done' && item.result.key === key)) continue
      item.controller?.abort()
      item.state = 'queued'
      draw(item)
    }
    pump()
    update()
  }, 400)
}

function showQuality() {
  $qualityOut.textContent = $quality.value
  const fill = ($quality.value - $quality.min) / ($quality.max - $quality.min) * 100
  $quality.style.setProperty('--fill', fill + '%')
}

async function save(list) {
  const files = list.map((i) => new File([i.result.blob],
    i.result.kept ? i.file.name : outName(i.file.name), { type: i.result.blob.type }))
  if (canShare(files)) {
    try { await navigator.share({ files }) } catch {}
    return
  }
  if (files.length === 1) return download(files[0], files[0].name)
  download(await zip(files), 'compressed.zip')
}

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

// Stored zip, JPEGs don't compress any further
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(bytes) {
  let c = -1
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

async function zip(files) {
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const taken = new Map()
  const parts = [], central = []
  let offset = 0

  for (const file of files) {
    // Two photos called IMG_0001.jpg become IMG_0001.jpg and IMG_0001 (2).jpg
    let name = file.name
    const count = taken.get(name.toLowerCase()) ?? 0
    taken.set(name.toLowerCase(), count + 1)
    if (count) name = name.replace(/(\.[^.]*)?$/, ` (${count + 1})$1`)

    const data = new Uint8Array(await file.arrayBuffer())
    const nameBytes = new TextEncoder().encode(name)
    const crc = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // file names are UTF-8
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    parts.push(local, nameBytes, data)

    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(12, time, true)
    entry.setUint16(14, date, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, data.length, true)
    entry.setUint16(28, nameBytes.length, true)
    entry.setUint32(42, offset, true)
    central.push(entry, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }

  const dirSize = central.reduce((n, p) => n + p.byteLength, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, dirSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end], { type: 'application/zip' })
}

const pick = () => $picker.click()
$('pick-btn').onclick = (e) => { e.stopPropagation(); pick() }
$('empty').onclick = pick
$('add-btn').onclick = pick
$picker.onchange = () => { add([...$picker.files]); $picker.value = '' }

$all.onclick = () => save(items.filter((i) => i.state === 'done'))
$('clear-btn').onclick = clearAll

$quality.oninput = () => { showQuality(); redo() }
$size.onchange = redo
$local.onclick = () => {
  $local.setAttribute('aria-pressed', String(!isLocal()))
  redo()
}

let dragDepth = 0
const hasFiles = (e) => e.dataTransfer?.types.includes('Files')
addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth++
  document.body.classList.add('dragging')
})
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging') }
})
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault() })
addEventListener('drop', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  document.body.classList.remove('dragging')
  add([...e.dataTransfer.files])
})

addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])]
  if (files.length) add(files)
})

$('about-btn').onclick = () => $about.showModal()
$about.addEventListener('click', (e) => { if (e.target === $about) $about.close() })

// Shorter size names on phones, so the toolbar fits on one line
const phone = matchMedia('(max-width: 720px)')
const fitLabels = () => {
  for (const o of $size.options) {
    o.dataset.full ??= o.text
    o.text = phone.matches ? o.dataset.short : o.dataset.full
  }
}
phone.addEventListener('change', fitLabels)

fitLabels()
showQuality()
document.body.classList.toggle('local', isLocal())
update()
