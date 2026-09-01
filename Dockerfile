# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json yarn.lock ./
# BuildKit cache mounts survive `--no-cache` and forced rebuilds, so one
# truncated tarball in the cache fails every subsequent build with "the file
# appears to be corrupt" until somebody prunes it by hand. Retrying against a
# cleaned cache costs one slow build instead of a broken deploy.
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile || (yarn cache clean && yarn install --frozen-lockfile)

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN yarn prisma generate

# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/app/generated ./app/generated
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
# `next build` imports lib/auth.ts during static analysis and better-auth
# refuses a short secret. This value never reaches runtime.
ENV BETTER_AUTH_SECRET="build-time-placeholder-must-be-32-chars-long"

RUN yarn build

# ── runner ───────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apk add --no-cache curl \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# `prisma migrate deploy` runs at container start, so the CLI and the schema
# have to ship in the runtime image. node_modules is copied whole because the
# Prisma CLI's dependency tree is hoisted and pruning it by hand is fragile.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/app/generated ./app/generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000

# /api/health touches Postgres, so a pod with a dead database is marked
# unhealthy instead of serving errors on every request.
# Uses $PORT so the check follows the port the server actually binds to.
HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
