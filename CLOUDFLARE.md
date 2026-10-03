# Cloudflare deployment

This project uses one Cloudflare Worker for the Vite/React frontend and routing, a single Cloudflare Container for the existing Express API, SQLite and live WebSocket feed, and R2 for durable application-state snapshots. The one-container design keeps the in-memory market feed and connected clients on the same backend instance.

The Worker keeps `/api/*`, `/ws` and `/health` on the backend; all other routes use the built Vite assets with SPA fallback. The container restores the latest verified SQLite, JSON history, market-news archive and signal-source settings from R2 before starting the market services. A five-minute scheduled snapshot keeps the live backend warm while it is running and stores a previous snapshot for recovery.

## Prerequisites

- A Cloudflare account with Workers, Durable Objects, Containers and R2 enabled for the account.
- Docker Desktop (or another working Docker daemon); Wrangler builds and uploads the Linux container image during deploy.
- Node.js 22 or newer and npm.
- Cloudflare secrets entered through Wrangler. Do not add production keys to `wrangler.jsonc`, Docker files or the frontend.

## First deployment

1. Install the project packages and authenticate with Cloudflare:

   ```sh
   npm install
   npx wrangler login
   ```

2. Create the R2 bucket configured in `wrangler.jsonc`:

   ```sh
   npx wrangler r2 bucket create qra-gold-terminal-backups
   ```

   Create it in the same Cloudflare account that owns the `trading` Worker. Before retrying a failed deployment, verify the exact bucket name in the R2 dashboard or run `npx wrangler r2 bucket list` with credentials for that account. A bucket in another account is not visible to this Worker.

3. Add the required internal token. Generate a random value locally and paste it into Wrangler's prompt; use the same Worker-managed secret for the Worker and Container binding:

   ```sh
   npx wrangler secret put CF_INTERNAL_TOKEN
   ```

4. Add whichever integrations the app uses. Wrangler prompts for each value without putting it in source control:

   ```sh
   npx wrangler secret put DEEPSEEK_API_KEY
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put TV_SESSION
   npx wrangler secret put TV_SIGNATURE
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   ```

   Optional runtime values such as `PRIMARY_SYMBOL`, `SIGNAL_TRIGGER_TF`, `LIVE_SIGNAL_SCAN_INTERVAL_MS` and `LIVE_AI_REVIEW` can also be set as Worker variables in the Cloudflare dashboard. API keys used by feeds in `sources.json` should be added as Wrangler secrets with the exact environment-variable names configured there.

5. Ensure Docker is running, then build and deploy both parts:

   ```sh
   npm run cf:deploy
   ```

   The first container rollout may take several minutes to become ready. Check status with `npx wrangler containers list` and view Worker/Container logs in the Cloudflare dashboard.

## Local Cloudflare development

Use `npm run cf:dev` with Docker running. Add local-only values in `.dev.vars` (which is git-ignored); never commit that file. `wrangler.jsonc` keeps the R2 binding and routes consistent with production.

## Git connected Cloudflare builds

Connect this repository as a **Worker with Workers Builds**, since the deployment includes a Container and Durable Object. The Worker name in `wrangler.jsonc` must match the connected Worker (`trading`). Use `npm run build` as the Build command and `npx wrangler deploy` as the Deploy command. The obsolete Bun lockfile has been removed; `package-lock.json` is the dependency lockfile for this npm project. Do not configure this as a Pages-only static deployment, which would omit the backend Container.

## Data and operating notes

- The Docker build deliberately excludes `.env`, `data/` and local SQLite files. A first deployment starts with a new cloud history; it does not upload this computer's existing trading records.
- While the backend is active, R2 snapshots run every five minutes. A sudden container failure can lose changes made since the most recent completed snapshot. The previous completed snapshot is retained as a fallback.
- The snapshot schedule checks the live backend and refreshes its activity timeout, so the market feed remains running after the dashboard is closed. Cloudflare Container runtime usage continues while that backend stays warm.
- The unofficial TradingView websocket integration and external feeds still connect outbound from the Cloudflare Container. Its image needs internet access for these feeds and any configured AI/news APIs.
- Container services and usage are account-plan dependent. Review Cloudflare's current Container pricing and limits before production use.

## Main files

- `wrangler.jsonc`: Worker assets, Durable Object/Container, R2 and schedule bindings.
- `cloudflare/worker.ts`: frontend/backend routing, Container lifecycle, startup restore and periodic R2 backup.
- `Dockerfile`: Linux image for the existing Node/Express backend.
- `server.ts`: authenticated internal snapshot/restore hooks and deferred feed startup for Cloudflare.
