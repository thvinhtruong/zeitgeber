# ---------- build frontend ----------
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY web/package.json web/bun.lock* web/
RUN cd web && bun install
COPY web web
RUN cd web && bun run build

# ---------- runtime ----------
FROM oven/bun:1.3 AS runtime
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production
COPY server server
COPY --from=build /app/web/dist web/dist

ENV PORT=3001
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3001
CMD ["bun", "run", "server/index.ts"]
