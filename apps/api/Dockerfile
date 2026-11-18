FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --filter @synaptech/api... --frozen-lockfile=false
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY config config
WORKDIR /app/apps/api
RUN pnpm prisma:generate
EXPOSE 3101 3111 3112 3113
CMD ["pnpm", "start"]
