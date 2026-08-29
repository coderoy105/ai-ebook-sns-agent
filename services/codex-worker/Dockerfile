FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=8787 \
    CODEX_DATA_ROOT=/data/codex-users

WORKDIR /app
COPY package.json ./package.json
RUN npm install --omit=dev --ignore-scripts=false \
    && node ./node_modules/@openai/codex/bin/codex.js --version \
    && npm cache clean --force
COPY server.mjs ./server.mjs
RUN mkdir -p /data/codex-users && chown -R node:node /app /data

USER node
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "server.mjs"]
