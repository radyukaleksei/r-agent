# Официальный образ Playwright уже содержит Chromium/Firefox/WebKit
# со всеми системными зависимостями — не нужно ставить их вручную.
#
# ВАЖНО: сборка выполняется из КОРНЯ монорепо, а не из services/browser-worker:
#   docker build -f services/browser-worker/Dockerfile -t browser-worker .
# Это нужно, чтобы скопировать локальные workspace-пакеты packages/*.

FROM mcr.microsoft.com/playwright:v1.47.0-jammy AS builder
WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY services/browser-worker ./services/browser-worker

# Здесь ставим ВСЕ зависимости, включая dev (typescript и т.п. нужны для сборки).
RUN npm ci --include-workspace-root

RUN npm run build:packages
RUN npm run build --workspace=services/browser-worker

# Прод-образ: только то, что реально нужно в рантайме.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy AS runtime
WORKDIR /app

COPY package*.json ./
COPY packages/types/package.json ./packages/types/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY services/browser-worker/package.json ./services/browser-worker/package.json

RUN npm ci --omit=dev --workspace=services/browser-worker --include-workspace-root

COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/services/browser-worker/dist ./services/browser-worker/dist

# Непривилегированный пользователь — контейнер не должен работать от root.
RUN useradd --create-home worker && chown -R worker:worker /app
USER worker

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/services/browser-worker
CMD ["node", "dist/index.js"]
