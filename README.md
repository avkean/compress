# Compress

A free and private image compressor.

[Try Compress](https://compress.avkean.com)

Images come back as JPEGs made with MozJPEG, through [sharp](https://sharp.pixelplumbing.com). It reads JPG, PNG, WebP, AVIF, GIF, TIFF and HEIC. Nothing is stored, and location details are removed.

With "On this device" turned on, the browser does the work instead, using the MozJPEG build from [jSquash](https://github.com/jamsinclair/jSquash), and nothing is uploaded. HEIC only works that way in Safari.

## Running it

Run `docker compose up -d --build`. The compose file expects an external Docker network called `proxy_net`, shared with the reverse proxy, which reaches the app on port 3000.

For development, run `npm install` and `npm start`. HEIC needs the `vips` command with HEIC support, so test that part in Docker.
