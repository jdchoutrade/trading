FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    CF_CONTAINER_MANAGED=true \
    GOLD_DESK_DB_PATH=/app/data/gold_desk.db

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

COPY server.ts ./server.ts
COPY server ./server
COPY weights.indicator.json weights.analysis.json sources.json outcome_rules.json metadata.json ./

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]
