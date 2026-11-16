# syntax=docker/dockerfile:1
FROM golang:1.26-bookworm AS go

FROM node:24-bookworm AS build
COPY --from=go /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}" CGO_ENABLED=0
WORKDIR /tooling
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/genesys ./packages/genesys
COPY docs ./docs
COPY GLOSSARY.md ./
RUN npm install --global pnpm@12.17.0 && pnpm install --ignore-scripts --frozen-lockfile
RUN pnpm --filter @genesys/cli build

WORKDIR /opt/native-workers
COPY examples/native-workers/go.mod examples/native-workers/go.sum ./
RUN go mod download
COPY examples/native-workers/temporal ./temporal
RUN node /tooling/packages/genesys/dist/cli.js build /opt/native-workers > /tmp/build.json
# Select once at image build time. Both links retain the immutable native paths.
RUN node --input-type=module -e '\
  import { readFileSync, mkdirSync, symlinkSync } from "node:fs"; \
  const build = JSON.parse(readFileSync("/opt/native-workers/.gsys/compile/manifest.json")); \
  const { start } = build.workers.find(worker => worker.name === "greeting"); \
  mkdirSync("/launch"); \
  symlinkSync(start.cwd, "/launch/project"); \
  symlinkSync(start.executable, "/launch/greeting");'

FROM debian:bookworm-slim
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=65532:65532 /opt/native-workers/.gsys /opt/native-workers/.gsys
COPY --from=build --chown=65532:65532 /launch /launch
USER 65532:65532
WORKDIR /launch/project
ENTRYPOINT ["/launch/greeting"]
