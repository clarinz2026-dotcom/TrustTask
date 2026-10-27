FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
RUN addgroup -S app && adduser -S app -G app
COPY --chown=app:app package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/src/db/migrations ./src/db/migrations
USER app
EXPOSE 3000
CMD ["node", "dist/server.js"]
