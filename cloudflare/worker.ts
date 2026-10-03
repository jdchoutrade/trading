import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  ASSETS: Fetcher;
  BACKUPS: R2Bucket;
  BACKEND: DurableObjectNamespace<QraBackend>;
  CF_INTERNAL_TOKEN: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  TV_SESSION?: string;
  TV_SIGNATURE?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  PRIMARY_SYMBOL?: string;
  SIGNAL_TRIGGER_TF?: string;
  LIVE_SIGNAL_SCAN_INTERVAL_MS?: string;
  LIVE_AI_REVIEW?: string;
}

const LATEST_SNAPSHOT_KEY = 'terminal/latest.json';
const PREVIOUS_SNAPSHOT_KEY = 'terminal/previous.json';
const INTERNAL_TOKEN_HEADER = 'x-qra-internal-token';

export class QraBackend extends Container<Env> {
  defaultPort = 3000;
  pingEndpoint = 'localhost/health';
  sleepAfter = '30m';
  envVars: Record<string, string>;
  private readonly bindings: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.bindings = env;
    this.envVars = {
      NODE_ENV: 'production',
      CF_CONTAINER_MANAGED: 'true',
      GOLD_DESK_DB_PATH: '/app/data/gold_desk.db',
      CF_INTERNAL_TOKEN: env.CF_INTERNAL_TOKEN,
    };

    for (const name of [
      'PRIMARY_SYMBOL',
      'SIGNAL_TRIGGER_TF',
      'LIVE_SIGNAL_SCAN_INTERVAL_MS',
      'LIVE_AI_REVIEW',
    ] as const) {
      const value = env[name];
      if (value) this.envVars[name] = value;
    }

    for (const [name, value] of Object.entries(env as unknown as Record<string, unknown>)) {
      if (typeof value === 'string' && /(?:_API_KEY|_TOKEN|_SESSION|_SIGNATURE)$/.test(name) && name !== 'CF_INTERNAL_TOKEN') {
        this.envVars[name] = value;
      }
    }
  }

  override async onStart(): Promise<void> {
    let foundSnapshot = false;
    let restored = false;

    for (const key of [LATEST_SNAPSHOT_KEY, PREVIOUS_SNAPSHOT_KEY]) {
      const object = await this.bindings.BACKUPS.get(key);
      if (!object) continue;
      foundSnapshot = true;

      const response = await this.containerFetch('http://localhost/_cloudflare/restore', {
        method: 'POST',
        headers: { [INTERNAL_TOKEN_HEADER]: this.bindings.CF_INTERNAL_TOKEN, 'content-type': 'application/json' },
        body: object.body,
      });
      if (response.ok) {
        restored = true;
        break;
      }
      console.error(`Could not restore ${key}:`, response.status, await response.text());
    }

    if (foundSnapshot && !restored) {
      throw new Error('No valid Cloudflare R2 snapshot could be restored; refusing to start with empty state.');
    }

    const startResponse = await this.containerFetch('http://localhost/_cloudflare/start', {
      method: 'POST',
      headers: { [INTERNAL_TOKEN_HEADER]: this.bindings.CF_INTERNAL_TOKEN },
    });
    if (!startResponse.ok) throw new Error(`Could not start QRA background services: ${startResponse.status}`);
  }

  async backupIfRunning(): Promise<void> {
    const state = await this.getState();
    if (state.status !== 'healthy') return;

    const response = await this.containerFetch('http://localhost/_cloudflare/backup', {
      headers: { [INTERNAL_TOKEN_HEADER]: this.bindings.CF_INTERNAL_TOKEN },
    });
    if (!response.ok) throw new Error(`QRA state backup failed: ${response.status}`);

    const current = await this.bindings.BACKUPS.get(LATEST_SNAPSHOT_KEY);
    if (current) {
      await this.bindings.BACKUPS.put(PREVIOUS_SNAPSHOT_KEY, current.body, {
        httpMetadata: { contentType: 'application/json' },
      });
    }
    await this.bindings.BACKUPS.put(LATEST_SNAPSHOT_KEY, response.body, {
      httpMetadata: { contentType: 'application/json' },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/_cloudflare/')) return new Response('Not found', { status: 404 });

    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ws' || pathname === '/health') {
      return getContainer(env.BACKEND, 'qra-primary').fetch(request);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await env.BACKEND.getByName('qra-primary').backupIfRunning();
  },
};
