# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN groupadd --gid 10001 shlita \
  && useradd --uid 10001 --gid 10001 --home-dir /var/lib/shlita --shell /usr/sbin/nologin shlita
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-ui ./dist-ui
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /var/lib/shlita/backups \
  && chown -R shlita:shlita /var/lib/shlita
ENV SHLITA_DB_PATH=/var/lib/shlita/ledger.db \
    SHLITA_STATE_DIR=/var/lib/shlita \
    SHLITA_BACKUP_DIR=/var/lib/shlita/backups \
    PORT=4000
EXPOSE 4000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/packages/gateway/src/index.js"]
