# Compress

Drop a photo or a batch into the browser, get a smaller version back. Server-side native image compression with sharp + libvips, plus libheif for HEIC round-trips.

## What it does

- **Drag-and-drop anywhere** on the page; single file returns the compressed image directly, batches return a zip.
- **Auto-routing** by input type:
  - JPEG/HEIC → MozJPEG q75 4:2:0 (Squoosh-equivalent quality, native speed)
  - PNG with alpha → PNG (palette) or WebP lossless
  - PNG without alpha → text-safe JPEG or palette PNG depending on content
- **Profiles** in the Advanced disclosure: Compatible (default), WebP, Smallest (AVIF), Lossless (PNG).
- **HEIC** in by default. When a HEIC file is in the queue, a "Save as HEIC" checkbox appears so the source format can round-trip via libheif's x265 encoder.

## Stack

- Node 24 + TypeScript (ESM)
- Express + multer for uploads
- sharp / libvips for decode + native encode
- libheif (`heif-convert`, `heif-enc`) for HEIC decode + re-encode
- React + Vite for the client
- archiver for streaming zip output

## Run locally

```bash
npm install
npm run build
npm start
```

Open http://localhost:3000.

For development:

```bash
npm run dev    # server with reload; vite dev not wired
```

## Deploy with Docker

```bash
docker compose build
docker compose up -d
```

The image bundles `libheif-tools` so HEIC paths work out of the box. The container runs as the non-root `node` user and uses `tini` as PID 1 for clean SIGTERM forwarding.

The compose file joins an external `proxy_net` network so a reverse proxy in the same network (e.g. Caddy) can reach the app at `compress:3000`.

```caddyfile
compress.example.com {
    reverse_proxy compress:3000
}
```

## Config

Copy `.env.example` to `.env` and tweak if needed:

| Var | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Set by compose; in dev `npm start` uses whatever's exported |
| `PORT` | `3000` | Internal listen port |
| `HEIC_IMPORT` | `1` | Set to `0` to refuse HEIC uploads outright |

## Endpoints

| Method | Path | Use |
| --- | --- | --- |
| `POST` | `/api/compress` | Multipart upload; `images` (one or more files), `profile` (`maximum-compatible` \| `widely-supported` \| `smallest-modern` \| `lossless-screenshots`), optional `outputHeic` (`true`/`false`) |
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/version` | App version + bundle hash served |
| `GET` | `/api/inventory` | sharp/libvips/libheif versions + tool availability |

Responses include `X-Mode` (`single`/`zip`), `X-Input-Bytes`, `X-Output-Bytes`, `X-Output-Filename` so the client can show savings without parsing the body.

## Layout

```
src/
├── client/                 React app (single page, single component)
├── server/
│   ├── index.ts            Express wiring
│   ├── http/
│   │   ├── cache.ts        no-store + immutable static asset headers
│   │   ├── compress-route.ts
│   │   ├── errors.ts       Multer error mapping + production safe-message
│   │   ├── filenames.ts    MIME map + RFC-5987 Content-Disposition
│   │   ├── logger.ts       Minimal access log (no PII)
│   │   ├── security.ts     CSP, X-Frame-Options, Referrer-Policy, HSTS
│   │   ├── shutdown.ts     SIGTERM drain + process error handlers
│   │   ├── upload.ts       multer config + file-type filter
│   │   └── version.ts      Reads bundle hash from built index.html
│   ├── pipeline/
│   │   ├── canonical.ts    Extension/animation classification
│   │   ├── classify.ts     128px thumb → photo vs UI-text
│   │   ├── decide.ts       Pure: metadata + class + profile → encoding choice
│   │   ├── heic.ts         libheif binary detection + decode/encode shells
│   │   ├── index.ts        Batch orchestrator + processOne
│   │   ├── run.ts          Single sharp pipeline executor
│   │   └── types.ts
│   ├── classifier.ts       Pixel-level UI/photo heuristic
│   ├── config.ts           Limits + defaults
│   ├── inventory.ts        /api/inventory snapshot
│   └── sanitize.ts         Filename hygiene
└── shared/
    └── types.ts            CompressionProfile + ManifestEntry
```

## License

MIT — do whatever you want, no warranty.
