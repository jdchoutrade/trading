import http from 'http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { apiRouter } from './server/routes.ts';
import { marketProvider } from './server/market/dataProvider.ts';
import { marketIntelligence } from './server/intel/marketIntelligence.ts';
import { liveOutcomeTracker } from './server/market/outcomeTracker.ts';
import { startSourceIngest } from './server/engine/sourceIngest.ts';
import { signalEmitter } from './server/engine/signalEmitter.ts';
import { sqliteStore } from './server/db/sqliteStore.ts';
import { dbStore } from './server/db/store.ts';

dotenv.config();

const app = express();
const port = 3000;
const isDev = process.env.NODE_ENV !== 'production';
const isCloudflareContainer = process.env.CF_CONTAINER_MANAGED === 'true';
let backgroundServicesStarted = false;

function isAuthorizedCloudflareRequest(req: express.Request): boolean {
  const expected = process.env.CF_INTERNAL_TOKEN;
  const provided = req.header('x-qra-internal-token');
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && crypto.timingSafeEqual(expectedBytes, providedBytes);
}

function encodeSnapshotValue(value: string | Buffer | null) {
  if (value === null) return null;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return {
    base64: bytes.toString('base64'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function decodeSnapshotValue(value: unknown): Buffer | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || !('base64' in value) || !('sha256' in value)) {
    throw new Error('Snapshot file entry is invalid.');
  }
  const entry = value as { base64: unknown; sha256: unknown };
  if (typeof entry.base64 !== 'string' || typeof entry.sha256 !== 'string') throw new Error('Snapshot file entry is invalid.');
  const bytes = Buffer.from(entry.base64, 'base64');
  if (bytes.toString('base64') !== entry.base64) throw new Error('Snapshot file encoding is invalid.');
  const actualHash = crypto.createHash('sha256').update(bytes).digest();
  const expectedHash = Buffer.from(entry.sha256, 'hex');
  if (expectedHash.length !== actualHash.length || !crypto.timingSafeEqual(expectedHash, actualHash)) {
    throw new Error('Snapshot file checksum does not match.');
  }
  return bytes;
}

function writeCloudflareStateFile(fileName: string, bytes: Buffer | null) {
  const allowedFiles = new Set(['market_news.json', 'weights.indicator.json', 'weights.analysis.json']);
  if (!allowedFiles.has(fileName)) throw new Error('Snapshot contains an unsupported file.');
  if (bytes === null) return;
  const filePath = path.resolve(process.cwd(), fileName === 'market_news.json' ? 'data/market_news.json' : fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.restore.tmp`;
  fs.writeFileSync(temporaryPath, bytes);
  fs.renameSync(temporaryPath, filePath);
}

function startBackgroundServices() {
  if (backgroundServicesStarted) return;
  backgroundServicesStarted = true;
  startSourceIngest();
  marketProvider.start().catch((err) => console.warn('Market provider startup warning:', err));
  marketIntelligence.start().catch((err) => console.warn('Market intelligence startup warning:', err));
  liveOutcomeTracker.start().catch((err) => console.warn('Live outcome tracker startup warning:', err));
}

app.get('/health', (_req, res) => res.json({ ok: true, managed: isCloudflareContainer }));

app.get('/_cloudflare/backup', (req, res) => {
  if (!isAuthorizedCloudflareRequest(req)) return res.status(404).end();
  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    const readOptional = (filePath: string) => fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    res.json({
      version: 1,
      createdAt: new Date().toISOString(),
      files: {
        sqlite: encodeSnapshotValue(sqliteStore.exportSnapshot()),
        jsonStore: encodeSnapshotValue(dbStore.exportSnapshot()),
        marketNews: encodeSnapshotValue(readOptional(path.join(dataDir, 'market_news.json'))),
        weightsIndicator: encodeSnapshotValue(readOptional(path.resolve(process.cwd(), 'weights.indicator.json'))),
        weightsAnalysis: encodeSnapshotValue(readOptional(path.resolve(process.cwd(), 'weights.analysis.json'))),
      },
    });
  } catch (error) {
    console.error('Cloudflare state snapshot failed:', error);
    res.status(500).json({ error: 'State snapshot failed.' });
  }
});

app.post('/_cloudflare/restore', express.json({ limit: '128mb' }), (req, res) => {
  if (!isAuthorizedCloudflareRequest(req)) return res.status(404).end();
  try {
    const snapshot = req.body as {
      version?: unknown;
      files?: Record<string, unknown>;
    };
    if (snapshot?.version !== 1 || !snapshot.files) throw new Error('Unsupported snapshot version.');

    const sqlite = decodeSnapshotValue(snapshot.files.sqlite);
    const jsonStore = decodeSnapshotValue(snapshot.files.jsonStore);
    const marketNews = decodeSnapshotValue(snapshot.files.marketNews);
    const weightsIndicator = decodeSnapshotValue(snapshot.files.weightsIndicator);
    const weightsAnalysis = decodeSnapshotValue(snapshot.files.weightsAnalysis);
    if (!sqlite || !jsonStore || !weightsIndicator || !weightsAnalysis) throw new Error('Snapshot is missing required state.');

    sqliteStore.restoreSnapshot(sqlite);
    dbStore.restoreSnapshot(jsonStore.toString('utf8'));
    writeCloudflareStateFile('market_news.json', marketNews);
    writeCloudflareStateFile('weights.indicator.json', weightsIndicator);
    writeCloudflareStateFile('weights.analysis.json', weightsAnalysis);
    res.json({ ok: true });
  } catch (error) {
    console.error('Cloudflare state restore failed:', error);
    res.status(400).json({ error: 'State restore failed.' });
  }
});

app.use(express.json({ limit: '1mb' }));

app.post('/_cloudflare/start', (req, res) => {
  if (!isAuthorizedCloudflareRequest(req)) return res.status(404).end();
  startBackgroundServices();
  res.json({ ok: true });
});

// API Routes
app.use('/api', apiRouter);

const server = http.createServer(app);

// WebSocket Server attached to HTTP server
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();
let messageSeq = 0;

wss.on('connection', (ws) => {
  clients.add(ws);

  // Send initial welcome & heartbeat state
  ws.send(
    JSON.stringify({
      type: 'INIT',
      seq: ++messageSeq,
      serverTs: Date.now(),
      symbols: marketProvider.getAllSymbols(),
      health: marketProvider.getHealth(),
      latestSourceSignals: {
        INDICATOR: sqliteStore.getAllSignals({ source: 'INDICATOR', origin: 'engine_live', limit: 1 }).signals[0] || null,
        ANALYSIS: sqliteStore.getAllSignals({ source: 'ANALYSIS', origin: 'engine_live', limit: 1 }).signals[0] || null,
      },
      latestAiReview: signalEmitter.getLatestLiveAiReview(),
    })
  );

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'PING') {
        ws.send(
          JSON.stringify({
            type: 'PONG',
            seq: ++messageSeq,
            serverTs: Date.now(),
            clientTs: parsed.timestamp,
          })
        );
      }
    } catch (e) {
      // ignore malformed ws messages
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// Broadcast real-time ticks to connected WebSocket clients
marketProvider.subscribe((symbol, tick) => {
  const symData = marketProvider.getSymbolData(symbol);
  if (!symData) return;

  const seq = ++messageSeq;
  const serverTs = Date.now();

  const payload = JSON.stringify({
    type: 'TICK',
    seq,
    serverTs,
    symbol,
    price: tick.price,
    bid: tick.bid,
    ask: tick.ask,
    spread: tick.spread,
    latencyMs: symData.latencyMs,
    isStale: symData.isStale,
    isDelayed: symData.isDelayed,
    isDivergent: symData.isDivergent,
    time: tick.time,
    isForming: tick.isForming,
  });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
});

// Broadcast live outcome events (TP hit, SL hit, BE exit) to connected WebSocket clients
liveOutcomeTracker.onBroadcast((payload) => {
  const jsonStr = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonStr);
    }
  }
});

signalEmitter.onSignalCreated((payload) => {
  const message = JSON.stringify({ ...payload, seq: ++messageSeq, serverTs: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
});

signalEmitter.onAiReview((payload) => {
  const message = JSON.stringify({ ...payload, seq: ++messageSeq, serverTs: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
});

async function startServer() {
  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!isCloudflareContainer) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`QRA Gold Terminal running at http://0.0.0.0:${port}`);
  });

  // In Cloudflare Containers, the Worker restores R2 state before starting live services.
  if (!isCloudflareContainer) startBackgroundServices();
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
