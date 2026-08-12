FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs \
    && mkdir -p /app/.data/blobs \
    && chown -R nextjs:nodejs /app/.data
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/db-migrate.mjs ./scripts/db-migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/bootstrap-public-workspace.mts ./scripts/bootstrap-public-workspace.mts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/provision-public-owner.mts ./scripts/provision-public-owner.mts
COPY --from=builder --chown=nextjs:nodejs /app/infra/postgres/migrations ./infra/postgres/migrations
COPY --from=builder --chown=nextjs:nodejs /app/src/server/auth ./src/server/auth
COPY --from=builder --chown=nextjs:nodejs /app/src/server/collaboration-bootstrap.ts ./src/server/collaboration-bootstrap.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/server/postgres/client.ts ./src/server/postgres/client.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/server/postgres/human-auth-repository.ts ./src/server/postgres/human-auth-repository.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/server/postgres/transaction.ts ./src/server/postgres/transaction.ts
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
