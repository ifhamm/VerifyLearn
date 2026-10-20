# ---- Stage 1: build Tailwind CSS ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:css

# ---- Stage 2: lean production image (runtime deps only) ----
FROM node:20-alpine

WORKDIR /app

# INSTALL_DEV=true keeps devDependencies (tailwind, concurrently) for the
# dev compose file, which mounts source over /app but inherits node_modules
# from the image. Production builds (default) install runtime deps only.
ARG INSTALL_DEV=false
COPY package*.json ./
RUN if [ "$INSTALL_DEV" = "true" ]; then npm ci; else npm ci --omit=dev; fi

# Compiled CSS comes from the builder; src is plain CommonJS (no build step)
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/app.js"]
