FROM node:24-alpine
# The system libvips reads HEIC through libheif and libde265.
RUN apk add --no-cache vips-tools vips-heif
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY public public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
