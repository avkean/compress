// Encodes images in the browser for "On this device", with the same MozJPEG
// settings as Squoosh. The page decodes the image and sends it here.
import mozjpeg from '/vendor/mozjpeg_enc.js'

const MOZJPEG = {
  baseline: false,
  arithmetic: false,
  progressive: true,
  optimize_coding: true,
  smoothing: 0,
  color_space: 3,
  quant_table: 3,
  trellis_multipass: false,
  trellis_opt_zero: false,
  trellis_opt_table: false,
  trellis_loops: 1,
  auto_subsample: true,
  chroma_subsample: 2,
  separate_chroma_quality: false,
  chroma_quality: 75,
}

// Compact Display P3 profile (CC0), the same one libvips ships
const P3 = Uint8Array.from(atob(
  'AAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kguKocouKP/clPrmS7iTWrgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFAAMwBDbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///k4AAAOaAADAFFhZWiAAAAAAAACD3wAAPb8AAAAAWFlaIAAAAAAAAEq/AACxNwAACrVYWVogAAAAAAAAKDgAABEKAADIeHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb'
), (c) => c.charCodeAt(0))

let encoder = null

onmessage = async ({ data: { id, bitmap, width, height, quality } }) => {
  try {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { colorSpace: 'display-p3', willReadFrequently: true })
    if (!ctx) throw new Error('Too large for this device. Pick a smaller size or turn off On this device.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const pixels = ctx.getImageData(0, 0, width, height, { colorSpace: 'display-p3' })

    encoder ??= await mozjpeg({ noInitialRun: true })
    let jpeg = new Uint8Array(encoder.encode(pixels.data, width, height, { ...MOZJPEG, quality }))
    // Firefox has no Display P3 canvas and gives sRGB, which needs no profile
    if (pixels.colorSpace === 'display-p3') jpeg = addProfile(jpeg, P3)
    postMessage({ id, blob: new Blob([jpeg], { type: 'image/jpeg' }) })
  } catch (err) {
    postMessage({ id, error: err.message })
  }
}

// Puts an ICC profile into an APP2 marker right after the JPEG's start marker
function addProfile(jpeg, icc) {
  const head = new Uint8Array(18)
  const length = icc.length + 16
  head.set([0xff, 0xe2, length >> 8, length & 255])
  head.set([...'ICC_PROFILE'].map((c) => c.charCodeAt(0)), 4)
  head.set([0, 1, 1], 15)
  const out = new Uint8Array(jpeg.length + head.length + icc.length)
  out.set(jpeg.subarray(0, 2))
  out.set(head, 2)
  out.set(icc, 20)
  out.set(jpeg.subarray(2), 20 + icc.length)
  return out
}
