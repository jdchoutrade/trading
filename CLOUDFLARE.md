# Cloudflare deployment

This project uses one Cloudflare Worker for the Vite/React frontend and routing, a single Cloudflare Container for the existing Express API, SQLite and live WebSocket feed, and Neon Postgres for durable application-state snapshots. The one-container design keeps the in-memory market feed and connected clients on the same backend instance.

The Worker keeps `/api/*`, `/ws` and `/health` on the backend; all other routes use the built Vite assets with SPA fallback. The container restores the latest verified SQLite, JSON history, market-news archive and signal-source settings from Neon before starting the market services. A five-minute scheduled snapshot keeps the live backend warm while it is running and stores the previous snapshot for recovery. The existing SQLite application store remains inside the container; Neon stores the checksummed recovery snapshots.

## Prerequisites

- A Cloudflare **Workers Paid** plan on the account that owns this Worker. Containers are unavailable on Workers Free; the Paid plan starts at $5/month and Container overage can apply. See [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/).
- Durable Objects and Containers enabled for that same Cloudflare account.
- A Neon Postgres database and its pooled connection string.
- Docker Desktop (or another working Docker daemon); Wrangler builds and uploads the Linux container image during deploy.
- Node.js 22 or newer and npm.
- Cloudflare secrets entered through Wrangler. Do not add production keys to `wrangler.jsonc`, Docker files or the frontend.

## First deployment

1. Install the project packages and authenticate with Cloudflare:

   ```sh
   npm install
   npx wrangler login
   ```

2. Add the Neon connection string as a Cloudflare Worker secret:

   ```sh
   npx wrangler secret put NEON_DATABASE_URL
   ```

   Paste the pooled Postgres connection string from Neon when Wrangler prompts. Keep it out of source files, build variables and frontend code. The backend creates its snapshot table automatically on first use. Cloudflare uses the `cloudflare` snapshot scope by default.

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

For the regular localhost server, copy `.env.example` to `.env`, add your Neon pooled connection string, then run `npm run dev`. It restores the latest local snapshot on startup and saves a fresh snapshot immediately and every five minutes. The example uses the `localhost` scope so local runs do not overwrite Cloudflare production snapshots in the same Neon database.

For `npm run cf:dev`, use `.dev.vars` for local-only Cloudflare Worker secrets (it is git-ignored); add `NEON_DATABASE_URL` and set `NEON_SNAPSHOT_SCOPE=localhost` there. Never commit `.env` or `.dev.vars`.

## Git connected Cloudflare builds

Connect this repository as a **Worker with Workers Builds**, since the deployment includes a Container and Durable Object. The Worker name in `wrangler.jsonc` must match the connected Worker (`trading`). Use `npm run build` as the Build command and `npx wrangler deploy` as the Deploy command. The obsolete Bun lockfile has been removed; `package-lock.json` is the dependency lockfile for this npm project. Do not configure this as a Pages-only static deployment, which would omit the backend Container.

In **Worker Settings → Builds → API token**, select a user API token scoped to the account that owns `trading`. Give it **Account: Containers Edit** and **Account: Workers Scripts Edit** (plus **Zone: Workers Routes Edit** only if deploying a zone route). The automatically generated Workers Builds token does not include Containers permission by default; see [Workers Builds token configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

### Troubleshooting `/containers/me`

If a build completes the Vite and Docker steps, uploads the Worker, then fails at `/accounts/<account>/containers/me`, the frontend bundle and Dockerfile are not the failing steps. Confirm the account is on Workers Paid and the selected Workers Builds API token has **Containers Edit** for that exact account. If both are already set, open the full build log and check the HTTP status/response body for the Containers API request; the short Wrangler summary may omit the reason.

To distinguish a Workers Builds token problem from an account-plan/access problem, deploy once from a machine authenticated with Wrangler directly:

```sh
npx wrangler login
npm run cf:deploy
```

This publishes the Worker and Container to the Cloudflare account selected by Wrangler. If it succeeds while Git-connected Builds still fails, replace the API token selected under **Worker Settings → Builds** with one that has the permissions listed above. If the direct deploy also fails at `/containers/me`, verify the account's Workers Paid plan and Containers access; changing this repository cannot grant those account permissions.

## Data and operating notes

- The Docker build deliberately excludes `.env`, `data/` and local SQLite files. A first deployment starts with a new cloud history; it does not upload this computer's existing trading records.
- While the backend is active, Neon snapshots run every five minutes. A sudden container failure can lose changes made since the most recent completed snapshot. The previous completed snapshot is retained as a fallback.
- The snapshot schedule checks the live backend and refreshes its activity timeout, so the market feed remains running after the dashboard is closed. Cloudflare Container runtime usage continues while that backend stays warm.
- The unofficial TradingView websocket integration and external feeds still connect outbound from the Cloudflare Container. Its image needs internet access for these feeds and any configured AI/news APIs.
- Container services and usage are account-plan dependent. Review Cloudflare's current Container pricing and limits before production use.

## Main files

- `wrangler.jsonc`: Worker assets, Durable Object/Container and schedule configuration.
- `cloudflare/worker.ts`: frontend/backend routing, Container lifecycle, startup restore and periodic Neon backup.
- `Dockerfile`: Linux image for the existing Node/Express backend.
- `server.ts` and `server/db/neonSnapshotStore.ts`: authenticated snapshot/restore hooks and Neon-backed snapshot storage.
