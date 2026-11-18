# motorbench server image.
#
#   docker build -t motorbench .
#   docker run --init --ipc=host -p 8765:8765 \
#     -e MOTORBENCH_TOKEN=change-me -v "$PWD/results:/app/results" motorbench
#
# --ipc=host (or --shm-size=1g) keeps Chromium from running out of shared memory.
FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
# Runtime dependencies only (TypeScript is run directly by Node), plus Chromium and
# the system libraries it needs.
RUN npm ci --omit=dev \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY bench.ts ./
COPY src ./src
COPY web ./web

ENV NODE_ENV=production
EXPOSE 8765
VOLUME /app/results

# Listening on all interfaces requires a token: pass -e MOTORBENCH_TOKEN=...
CMD ["node", "bench.ts", "serve", "--host", "0.0.0.0", "--port", "8765"]
