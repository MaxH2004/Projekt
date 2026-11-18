# syntax=docker/dockerfile:1.7
# One build, three images. Build from the repository root:
#   docker build -f infra/docker/Dockerfile --target api -t hv-api .
#   docker build -f infra/docker/Dockerfile --target web -t hv-web .
#   docker build -f infra/docker/Dockerfile --target worker -t hv-worker .
# Behind a TLS-intercepting proxy, pass its CA as a build secret:
#   --secret id=ca,src=/path/to/ca.pem

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    corepack install && pnpm install --frozen-lockfile
RUN pnpm build

# Runtime images run as the unprivileged "node" user and carry no sources
# beyond what each process loads.
FROM base AS runtime
ENV NODE_ENV=production
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /app /app
# Uploaded files when FILE_STORAGE=local; mount a volume here. Created as
# root, owned by the user the API runs as, so a fresh volume is writable.
USER root
RUN mkdir -p /data/files && chown node:node /data/files
USER node
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??3001)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

# Migrations run once per deployment as the schema owner, before the API starts.
FROM runtime AS migrate
COPY --from=build --chown=node:node /app /app
WORKDIR /app/packages/db
CMD ["node", "dist/cli.js"]

FROM runtime AS web
COPY --from=build --chown=node:node /app/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /app/apps/web/.next/static /app/apps/web/.next/static
WORKDIR /app/apps/web
EXPOSE 3000
ENV HOSTNAME=0.0.0.0 PORT=3000
CMD ["node", "server.js"]
