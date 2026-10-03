import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CorrelationMatrixItem,
  CrossAssetQuote,
  MacroDataPoint,
  MarketNewsStory,
  RiskOffClassification,
  ScenarioItem,
  ScheduledEconomicEvent,
  ShockAlert,
} from '../types.ts';

const NEWS_ARCHIVE_LIMIT = 5000;
const NEWS_ARCHIVE_FILE = path.resolve(process.cwd(), 'data', 'market_news.json');
const BLS_CALENDAR_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';
const FOREX_FACTORY_WEEKLY_JSON_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const REQUEST_HEADERS = { 'User-Agent': 'QRA-Gold-Terminal/1.0 (+market intelligence)' };

type FeedConfig = { id: string; name: string; url: string; type: string; tier: 1 | 2 | 3; enabled: boolean; apiKeyEnv?: string };

function cleanXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_match, number: string) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/\s+/g, ' ').trim();
}

function xmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? cleanXml(match[1]) : '';
}

function titleCategory(title: string): { category: string; mechanism: MarketNewsStory['mechanism']; severity: number } {
  const value = title.toLowerCase();
  if (/employment situation|nonfarm|payroll|unemployment|job openings|jolts/.test(value)) return { category: 'US_LABOR', mechanism: 'YIELDS', severity: 9 };
  if (/consumer price|\bcpi\b|producer price|\bppi\b|inflation|pce price/.test(value)) return { category: 'INFLATION', mechanism: 'YIELDS', severity: 9 };
  if (/fomc|federal reserve|fed funds|interest rate|powell/.test(value)) return { category: 'CENTRAL_BANK_POLICY', mechanism: 'YIELDS', severity: 9 };
  if (/war|missile|airstrike|invasion|military|conflict|ceasefire|sanction|strait of hormuz/.test(value)) return { category: 'GEOPOLITICS', mechanism: 'SAFE_HAVEN', severity: 8 };
  if (/gold|bullion|central bank purchases|gold reserve/.test(value)) return { category: 'GOLD_MARKET', mechanism: 'CB_DEMAND', severity: 6 };
  if (/gdp|retail sales|ism|manufacturing|tariff|trade/.test(value)) return { category: 'GENERAL_MACRO', mechanism: 'DOLLAR', severity: 6 };
  return { category: 'GENERAL', mechanism: 'NONE', severity: 3 };
}

function stableStoryId(url: string, title: string): string {
  return `news_${crypto.createHash('sha1').update(url || title).digest('hex').slice(0, 20)}`;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function unescapeIcs(value: string): string {
  return value.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function parseIcsTimestamp(line: string): number | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const meta = line.slice(0, colon);
  const raw = line.slice(colon + 1).trim();
  const parts = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!parts) return null;
  const [, year, month, day, hour = '00', minute = '00', second = '00', isZulu] = parts;
  const local = [Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second)];
  const desiredUtc = Date.UTC(local[0], local[1] - 1, local[2], local[3], local[4], local[5]);
  if (isZulu) return desiredUtc;
  const zone = meta.match(/TZID=([^;:]+)/i)?.[1]?.replace(/"/g, '') || 'America/New_York';
  let utc = desiredUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(utc));
    const fields = Object.fromEntries(shown.map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second));
    const desired = desiredUtc;
    const correction = desired - represented;
    utc += correction;
    if (correction === 0) break;
  }
  return utc;
}

function eventImpact(title: string): ScheduledEconomicEvent['impact'] {
  return /employment situation|consumer price|producer price|fomc|personal consumption|gdp|retail sales|powell|job openings|ism manufacturing/i.test(title)
    ? 'HIGH'
    : /unemployment claims|durable goods|consumer confidence|housing starts|trade balance/i.test(title) ? 'MEDIUM' : 'LOW';
}

class MarketIntelligenceEngine {
  private crossAssets = new Map<string, CrossAssetQuote>();
  private macroData: MacroDataPoint[] = [];
  private stories: MarketNewsStory[] = [];
  private scheduledEvents: ScheduledEconomicEvent[] = [];
  private blsScheduledEvents: ScheduledEconomicEvent[] = [];
  private forexFactoryEvents: ScheduledEconomicEvent[] = [];
  private calendarFetchedAt = 0;
  private blsCalendarFetchedAt = 0;
  private forexFactoryFetchedAt = 0;
  private activeShock: ShockAlert | null = null;
  private riskOffClassification: RiskOffClassification = {
    type: 'MIXED_UNCLEAR', goldVelocity: 0, dxyVelocity: 0, yieldsVelocity: 0,
    confidence: 0, sampleCount: 0,
    description: 'Insufficient fresh gold, dollar, and yield data to classify the flow.',
    descriptionKm: 'មិនទាន់មានទិន្នន័យមាស ដុល្លារ និង yield ថ្មីគ្រប់គ្រាន់សម្រាប់ចាត់ថ្នាក់លំហូរ។',
  };
  private feeds: FeedConfig[] = [];
  private pollIntervals: ReturnType<typeof setInterval>[] = [];

  constructor() {
    try {
      const configPath = path.resolve(process.cwd(), 'sources.json');
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { sources?: FeedConfig[] };
      this.feeds = (parsed.sources || []).filter((feed) => feed.enabled);
    } catch {
      this.feeds = [];
    }
  }

  public async start() {
    this.loadNewsArchive();
    await Promise.allSettled([
      this.fetchRealCrossAssets(),
      this.fetchFredMacroSeries(),
      this.fetchConfiguredNewsFeeds(true),
      this.fetchBlsCalendar(),
      this.fetchForexFactoryCalendar(),
    ]);
    this.pollIntervals.push(setInterval(() => { void this.fetchRealCrossAssets(); }, 60_000));
    this.pollIntervals.push(setInterval(() => { void this.fetchFredMacroSeries(); }, 6 * 60 * 60_000));
    this.pollIntervals.push(setInterval(() => { void this.fetchConfiguredNewsFeeds(false); }, 5 * 60_000));
    this.pollIntervals.push(setInterval(() => { void this.fetchBlsCalendar(); }, 6 * 60 * 60_000));
    this.pollIntervals.push(setInterval(() => { void this.fetchForexFactoryCalendar(); }, 5 * 60_000));
  }

  public stop() {
    for (const interval of this.pollIntervals) clearInterval(interval);
    this.pollIntervals = [];
  }

  private loadNewsArchive() {
    try {
      const parsed = JSON.parse(fs.readFileSync(NEWS_ARCHIVE_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        this.stories = parsed.slice(0, NEWS_ARCHIVE_LIMIT).map((story: MarketNewsStory) => ({
          ...story,
          // Older builds assigned fabricated verification and directional labels.
          verificationStatus: 'UNVERIFIED',
          confidence: 0,
          novelty: 0,
          goldImpact: story.mechanism === 'SAFE_HAVEN' ? 'MIXED' : 'NEUTRAL',
        }));
      }
    } catch {
      this.stories = [];
    }
  }

  private persistNewsArchive() {
    try {
      fs.mkdirSync(path.dirname(NEWS_ARCHIVE_FILE), { recursive: true });
      const temporaryPath = `${NEWS_ARCHIVE_FILE}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(this.stories.slice(0, NEWS_ARCHIVE_LIMIT), null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPath, NEWS_ARCHIVE_FILE);
    } catch (error) {
      console.warn('Could not persist market news archive:', error instanceof Error ? error.message : error);
    }
  }

  private async fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: REQUEST_HEADERS, signal: controller.signal });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchRealCrossAssets() {
    const symbols: Record<string, { yahoo: string; name: string }> = {
      DXY: { yahoo: 'DX-Y.NYB', name: 'US Dollar Index' },
      US10Y: { yahoo: '^TNX', name: 'US 10-Year Treasury Yield' },
      VIX: { yahoo: '^VIX', name: 'CBOE Volatility Index' },
      XAGUSD: { yahoo: 'SI=F', name: 'Silver Futures' },
      SPX: { yahoo: '^GSPC', name: 'S&P 500 Index' },
      NAS100: { yahoo: '^NDX', name: 'Nasdaq 100 Index' },
      USOIL: { yahoo: 'CL=F', name: 'WTI Crude Oil Futures' },
      EURUSD: { yahoo: 'EURUSD=X', name: 'Euro / US Dollar' },
      USDJPY: { yahoo: 'USDJPY=X', name: 'US Dollar / Japanese Yen' },
    };
    await Promise.allSettled(Object.entries(symbols).map(async ([symbol, metadata]) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(metadata.yahoo)}?interval=5m&range=1d`;
      const raw = await this.fetchText(url, 7000);
      if (!raw) return;
      try {
        const result = JSON.parse(raw).chart?.result?.[0];
        const quote = result?.indicators?.quote?.[0];
        const closes = (quote?.close || []).filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value));
        const price = Number(result?.meta?.regularMarketPrice);
        if (!Number.isFinite(price) || price <= 0) return;
        const prior = Number(result.meta.chartPreviousClose || result.meta.previousClose || closes[0] || price);
        const change = prior > 0 ? Number((((price - prior) / prior) * 100).toFixed(2)) : 0;
        const sparkline = closes.slice(-10);
        const sourceTime = Number(result.meta.regularMarketTime || result.timestamp?.at(-1) || 0);
        this.crossAssets.set(symbol, {
          symbol,
          name: metadata.name,
          price: Number(price.toFixed(symbol.includes('USD') || symbol === 'EURUSD' ? 4 : 2)),
          change24h: change,
          high24h: Number((Math.max(...closes, price)).toFixed(4)),
          low24h: Number((Math.min(...closes, price)).toFixed(4)),
          lastUpdated: sourceTime > 0 ? sourceTime * 1000 : Date.now(),
          direction: change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT',
          sparkline: sparkline.length ? sparkline : [price],
        });
      } catch {
        // Keep only the last successfully fetched real quote; never synthesize a replacement.
      }
    }));
  }

  private async fetchFredMacroSeries() {
    const end = new Date();
    const start = new Date(end.getTime() - 370 * 24 * 60 * 60_000);
    const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
    const series = [
      { id: 'DFII10', name: '10-Year Real Treasury Yield (TIPS)' },
      { id: 'DFF', name: 'Effective Federal Funds Rate' },
    ];
    const results = await Promise.all(series.map(async (item): Promise<MacroDataPoint | null> => {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${item.id}&cosd=${dateOnly(start)}&coed=${dateOnly(end)}`;
      const csv = await this.fetchText(url, 10_000);
      if (!csv) return null;
      const rows = csv.trim().split(/\r?\n/).slice(1).map((row) => row.split(','));
      const observations = rows.map(([date, rawValue]) => ({ date, value: Number(rawValue) }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value));
      if (observations.length < 2) return null;
      const latest = observations[observations.length - 1];
      const prior = observations[Math.max(0, observations.length - 6)];
      const delta = latest.value - prior.value;
      const biasForGold: MacroDataPoint['biasForGold'] = Math.abs(delta) < 0.02
        ? 'NEUTRAL'
        : delta < 0 ? 'BULLISH' : 'BEARISH';
      return {
        id: item.id,
        name: item.name,
        value: latest.value,
        formattedValue: `${latest.value.toFixed(2)}%`,
        unit: '%',
        asOf: latest.date,
        frequency: 'daily',
        source: 'Federal Reserve Bank of St. Louis FRED',
        biasForGold,
      };
    }));
    const lastKnown = new Map(this.macroData.map((point) => [point.id, point]));
    for (const point of results) if (point) lastKnown.set(point.id, point);
    this.macroData = [...lastKnown.values()];
  }

  private async fetchGdeltWindow(feed: FeedConfig, startMs?: number, endMs?: number): Promise<MarketNewsStory[]> {
    const query = '(gold OR XAUUSD OR inflation OR CPI OR "nonfarm payroll" OR "Employment Situation" OR "Federal Reserve" OR FOMC OR war OR conflict OR military OR sanctions OR tariff)';
    const range = startMs !== undefined && endMs !== undefined
      ? `&startdatetime=${new Date(startMs).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}&enddatetime=${new Date(endMs).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`
      : '&timespan=1day';
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=250${range}&format=json`;
    const raw = await this.fetchText(url, 12_000);
    if (!raw) return [];
    try {
      const articles = JSON.parse(raw).articles || [];
      const stories: MarketNewsStory[] = [];
      for (const article of articles) {
        const title = String(article.title || '').trim();
        if (!title) continue;
        const dateText = String(article.seendate || '');
        const gdeltDate = dateText.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
        const parsedTime = gdeltDate
          ? Date.UTC(Number(gdeltDate[1]), Number(gdeltDate[2]) - 1, Number(gdeltDate[3]), Number(gdeltDate[4]), Number(gdeltDate[5]), Number(gdeltDate[6]))
          : Date.parse(dateText);
        if (!Number.isFinite(parsedTime)) continue;
        stories.push(this.toStory({
          title,
          url: article.url || '',
          source: article.domain || article.source || 'GDELT',
          publishedAt: Math.floor(parsedTime / 1000),
          summary: '',
          tier: feed.tier,
        }));
      }
      return stories;
    } catch {
      return [];
    }
  }

  private async fetchConfiguredNewsFeeds(backfill = false) {
    const additions: MarketNewsStory[] = [];
    await Promise.allSettled(this.feeds.map(async (feed) => {
      if (feed.type === 'RSS') {
        const xml = await this.fetchText(feed.url);
        if (!xml) return;
        const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].slice(0, 100);
        for (const [item] of items) {
          const title = xmlTag(item, 'title');
          if (!title) continue;
          const link = xmlTag(item, 'link') || xmlTag(item, 'guid') || feed.url;
          const parsedTime = Date.parse(xmlTag(item, 'pubDate'));
          if (!Number.isFinite(parsedTime)) continue;
          const publishedAt = Math.floor(parsedTime / 1000);
          additions.push(this.toStory({
            title, url: link, source: hostOf(link) || feed.name, publishedAt,
            summary: xmlTag(item, 'description'), tier: feed.tier,
          }));
        }
        return;
      }
      if (feed.type === 'GDELT') {
        if (!backfill) {
          additions.push(...await this.fetchGdeltWindow(feed));
          return;
        }
        // The DOC API supports precise date searches only within its recent 3-month window.
        // Fetch week-sized windows with a small concurrency limit to build a useful archive.
        const now = Date.now();
        const from = now - 90 * 24 * 60 * 60_000;
        const windows: Array<[number, number]> = [];
        for (let start = from; start < now; start += 7 * 24 * 60 * 60_000) {
          windows.push([start, Math.min(now, start + 7 * 24 * 60 * 60_000)]);
        }
        for (let index = 0; index < windows.length; index += 3) {
          const batch = windows.slice(index, index + 3);
          const results = await Promise.all(batch.map(([start, end]) => this.fetchGdeltWindow(feed, start, end)));
          additions.push(...results.flat());
        }
        return;
      }
      if (feed.type === 'NEWS_API' && feed.apiKeyEnv) {
        const key = process.env[feed.apiKeyEnv];
        if (!key) return;
        const url = `${feed.url}${feed.url.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(key)}`;
        const raw = await this.fetchText(url);
        if (!raw) return;
        try {
          const payload = JSON.parse(raw);
          for (const article of payload.data || []) {
            const title = String(article.title || '').trim();
            if (!title) continue;
            const parsedTime = Date.parse(String(article.published_at || ''));
            if (!Number.isFinite(parsedTime)) continue;
            additions.push(this.toStory({
              title, url: article.url || '', source: article.source || 'Marketaux',
              publishedAt: Math.floor(parsedTime / 1000),
              summary: cleanXml(String(article.description || '')), tier: feed.tier,
            }));
          }
        } catch {
          // Optional key-based source; malformed responses do not affect other feeds.
        }
      }
    }));
    if (additions.length) this.mergeStories(additions);
  }

  private toStory(input: { title: string; url: string; source: string; publishedAt: number; summary: string; tier: 1 | 2 | 3 }): MarketNewsStory {
    const now = Math.floor(Date.now() / 1000);
    const classification = titleCategory(input.title);
    const url = input.url || '';
    return {
      id: stableStoryId(url, input.title),
      title: input.title,
      summary: input.summary.slice(0, 1200),
      source: input.source,
      url,
      publishedAt: input.publishedAt,
      receivedAt: now,
      latencySeconds: Math.max(0, now - input.publishedAt),
      tier: input.tier,
      category: classification.category,
      region: 'Global',
      severity: classification.severity,
      novelty: 0,
      // Direction is deliberately neutral/mixed until price reaction confirms it.
      goldImpact: classification.mechanism === 'SAFE_HAVEN' ? 'MIXED' : 'NEUTRAL',
      mechanism: classification.mechanism,
      confidence: 0,
      verificationStatus: 'UNVERIFIED',
      headlineIdsUsed: url ? [url] : [],
    };
  }

  private mergeStories(additions: MarketNewsStory[]) {
    const byId = new Map(this.stories.map((story) => [story.id, story]));
    for (const story of additions) if (!byId.has(story.id)) byId.set(story.id, story);
    const all = [...byId.values()];
    const exactTitles = new Map<string, MarketNewsStory[]>();
    for (const story of all) {
      const key = story.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (key.length < 24 || !hostOf(story.url)) continue;
      const matches = exactTitles.get(key) || [];
      matches.push(story);
      exactTitles.set(key, matches);
    }
    for (const story of all) {
      const key = story.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (key.length < 24) continue;
      const nearbyDomains = new Set((exactTitles.get(key) || [])
        .filter((other) => Math.abs(other.publishedAt - story.publishedAt) <= 6 * 60 * 60 && hostOf(other.url))
        .map((other) => hostOf(other.url)));
      if (nearbyDomains.size > 1) story.verificationStatus = 'MULTI-SOURCE';
    }
    this.stories = all.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, NEWS_ARCHIVE_LIMIT);
    this.persistNewsArchive();
  }

  private async fetchBlsCalendar() {
    const ics = await this.fetchText(BLS_CALENDAR_URL, 10_000);
    if (!ics) return;
    const unfolded = ics.replace(/\r?\n[ \t]/g, '');
    const blocks = unfolded.split('BEGIN:VEVENT').slice(1).map((event) => event.split('END:VEVENT')[0]);
    const nowSec = Math.floor(Date.now() / 1000);
    const events: ScheduledEconomicEvent[] = [];
    for (const block of blocks) {
      const summaryLine = block.split(/\r?\n/).find((line) => line.startsWith('SUMMARY'));
      const dateLine = block.split(/\r?\n/).find((line) => line.startsWith('DTSTART'));
      if (!summaryLine || !dateLine) continue;
      const title = unescapeIcs(summaryLine.slice(summaryLine.indexOf(':') + 1));
      const scheduledMs = parseIcsTimestamp(dateLine);
      if (!title || !scheduledMs) continue;
      const scheduledAt = Math.floor(scheduledMs / 1000);
      if (scheduledAt < nowSec - 6 * 60 * 60 || scheduledAt > nowSec + 120 * 24 * 60 * 60) continue;
      const category = titleCategory(title);
      const eventImpactValue = eventImpact(title);
      if (eventImpactValue === 'LOW' && category.severity < 6) continue;
      const url = `https://www.bls.gov/schedule/news_release/`;
      events.push({
        id: `bls_${crypto.createHash('sha1').update(`${title}_${scheduledAt}`).digest('hex').slice(0, 16)}`,
        title,
        country: 'US',
        impact: eventImpactValue,
        scheduledAt,
        source: 'U.S. Bureau of Labor Statistics',
        url,
        status: scheduledAt <= nowSec ? 'RELEASED' : 'SCHEDULED',
      });
    }
    if (events.length === 0) return;
    this.blsScheduledEvents = events.sort((a, b) => a.scheduledAt - b.scheduledAt);
    this.blsCalendarFetchedAt = Date.now();
    this.refreshScheduledEvents();
  }

  private async fetchForexFactoryCalendar() {
    const raw = await this.fetchText(FOREX_FACTORY_WEEKLY_JSON_URL, 10_000);
    if (!raw) return;
    try {
      const payload: unknown = JSON.parse(raw);
      const rows: unknown[] = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as { events?: unknown[] }).events)
          ? (payload as { events: unknown[] }).events
          : [];
      const nowSec = Math.floor(Date.now() / 1000);
      const events: ScheduledEconomicEvent[] = [];
      for (const item of rows) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const title = String(row.title || row.event || '').trim();
        const country = String(row.country || row.currency || '').trim().toUpperCase();
        const dateValue = String(row.date || row.datetime || row.datetime_utc || '').trim();
        const scheduledMs = Date.parse(dateValue);
        if (!title || !country || !Number.isFinite(scheduledMs)) continue;
        const scheduledAt = Math.floor(scheduledMs / 1000);
        if (scheduledAt < nowSec - 6 * 60 * 60 || scheduledAt > nowSec + 8 * 24 * 60 * 60) continue;
        const impactText = String(row.impact || '').toLowerCase();
        const impact: ScheduledEconomicEvent['impact'] = impactText.includes('high') ? 'HIGH'
          : impactText.includes('medium') ? 'MEDIUM' : 'LOW';
        const identity = `${country}_${title}_${scheduledAt}`;
        events.push({
          id: `ff_${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 18)}`,
          title,
          country,
          impact,
          scheduledAt,
          actual: row.actual === undefined || row.actual === null ? undefined : String(row.actual).trim(),
          forecast: row.forecast === undefined || row.forecast === null ? undefined : String(row.forecast).trim(),
          previous: row.previous === undefined || row.previous === null ? undefined : String(row.previous).trim(),
          source: 'Forex Factory calendar',
          url: 'https://www.forexfactory.com/calendar/',
          status: scheduledAt <= nowSec ? 'RELEASED' : 'SCHEDULED',
        });
      }
      this.forexFactoryEvents = events.sort((a, b) => a.scheduledAt - b.scheduledAt);
      this.forexFactoryFetchedAt = Date.now();
      this.refreshScheduledEvents();
    } catch {
      // Invalid/unavailable exports do not erase the last good calendar data.
    }
  }

  private refreshScheduledEvents() {
    const unique = new Map<string, ScheduledEconomicEvent>();
    for (const event of [...this.forexFactoryEvents, ...this.blsScheduledEvents]) {
      const key = `${event.country}|${event.scheduledAt}|${event.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      if (!unique.has(key)) unique.set(key, event);
    }
    this.scheduledEvents = [...unique.values()].sort((a, b) => a.scheduledAt - b.scheduledAt);
    this.calendarFetchedAt = Math.max(this.blsCalendarFetchedAt, this.forexFactoryFetchedAt);
  }

  public getScheduledEvents(): ScheduledEconomicEvent[] {
    const now = Math.floor(Date.now() / 1000);
    return this.scheduledEvents
      .filter((event) => event.scheduledAt >= now - 6 * 60 * 60 && event.scheduledAt <= now + 30 * 24 * 60 * 60)
      .map((event) => ({ ...event, status: event.scheduledAt <= now ? 'RELEASED' as const : 'SCHEDULED' as const }));
  }

  public getCalendarStatus() {
    const freshnessWindow = 36 * 60 * 60_000;
    const sources = [
      this.forexFactoryFetchedAt > 0 && Date.now() - this.forexFactoryFetchedAt < freshnessWindow ? 'Forex Factory weekly export' : '',
      this.blsCalendarFetchedAt > 0 && Date.now() - this.blsCalendarFetchedAt < freshnessWindow ? 'U.S. BLS calendar' : '',
    ].filter(Boolean);
    return {
      source: sources.join(' + ') || `${FOREX_FACTORY_WEEKLY_JSON_URL} + ${BLS_CALENDAR_URL}`,
      fetchedAt: this.calendarFetchedAt,
      isAvailable: sources.length > 0,
    };
  }

  public evaluateRiskOffClassification(goldChangePercent?: number): RiskOffClassification {
    const dxy = this.crossAssets.get('DXY');
    const us10y = this.crossAssets.get('US10Y');
    const freshAfter = Date.now() - 15 * 60_000;
    if (goldChangePercent === undefined || !dxy || !us10y || dxy.lastUpdated < freshAfter || us10y.lastUpdated < freshAfter) {
      this.riskOffClassification = {
        type: 'MIXED_UNCLEAR', goldVelocity: goldChangePercent ?? 0,
        dxyVelocity: dxy?.change24h ?? 0, yieldsVelocity: us10y?.change24h ?? 0,
        confidence: 0, sampleCount: 0,
        description: 'Not enough fresh aligned gold, dollar, and yield observations.',
        descriptionKm: 'មិនទាន់មានទិន្នន័យមាស ដុល្លារ និង yield ដែលថ្មី និងស្របពេលគ្នាគ្រប់គ្រាន់។',
      };
      return this.riskOffClassification;
    }
    const safeHaven = goldChangePercent > 0.2 && dxy.change24h <= 0.05 && us10y.change24h <= 0;
    const dollarLed = dxy.change24h > 0.3 && goldChangePercent < 0;
    this.riskOffClassification = {
      type: safeHaven ? 'SAFE_HAVEN_GOLD' : dollarLed ? 'DOLLAR_SMILE' : 'MIXED_UNCLEAR',
      goldVelocity: goldChangePercent,
      dxyVelocity: dxy.change24h,
      yieldsVelocity: us10y.change24h,
      confidence: safeHaven || dollarLed ? 100 : 33,
      sampleCount: 3,
      description: safeHaven
        ? 'Rule alignment: gold rose while DXY was flat/down and US10Y yield fell.'
        : dollarLed
          ? 'Rule alignment: DXY rose while gold fell.'
          : 'Observed gold, DXY, and US10Y moves do not meet a single directional rule.',
      descriptionKm: safeHaven
        ? 'លក្ខខណ្ឌតម្លៃស្របគ្នា៖ មាសឡើង ខណៈ DXY មិនឡើង និង US10Y yield ចុះ។'
        : dollarLed
          ? 'លក្ខខណ្ឌតម្លៃស្របគ្នា៖ DXY ឡើង ខណៈមាសចុះ។'
          : 'ចលនាមាស DXY និង US10Y មិនទាន់ស្របតាមលក្ខខណ្ឌទិសដៅតែមួយ។',
    };
    return this.riskOffClassification;
  }

  public checkUnscheduledShock(candles: any[], atr14: number, spread: number): ShockAlert | null {
    if (candles.length < 3 || !Number.isFinite(atr14) || atr14 <= 0) return this.activeShock;
    const cNow = candles[candles.length - 1];
    const cPrev = candles[candles.length - 2];
    const move = Math.abs(cNow.close - cPrev.open);
    if (move > 1.5 * atr14 || spread > 3.0) {
      if (this.activeShock?.status === 'ACTIVE' && Date.now() / 1000 - this.activeShock.timestamp <= 300) {
        this.activeShock.velocityAtr = Number((move / atr14).toFixed(2));
        this.activeShock.spreadMultiplier = Number((spread / 0.35).toFixed(2));
        return this.activeShock;
      }
      const topStory = this.stories.find((story) => Date.now() / 1000 - story.publishedAt < 60 * 60);
      this.activeShock = {
        id: `shock_${Math.floor(Date.now() / 1000)}`,
        timestamp: Math.floor(Date.now() / 1000),
        velocityAtr: Number((move / atr14).toFixed(2)),
        spreadMultiplier: Number((spread / 0.35).toFixed(2)),
        tickRateSurge: 0,
        likelyCauseStoryId: topStory?.id,
        likelyCauseTitle: topStory?.title,
        status: 'ACTIVE',
      };
      return this.activeShock;
    }
    if (this.activeShock && this.activeShock.status === 'ACTIVE' && Date.now() / 1000 - this.activeShock.timestamp > 300) this.activeShock.status = 'RESOLVED';
    return this.activeShock;
  }

  public getCorrelationMatrix(): CorrelationMatrixItem[] {
    // No aligned rolling return series are currently retained for these instruments.
    return [];
  }

  public getMacroData(): MacroDataPoint[] {
    return this.macroData;
  }

  public getScenarios(): ScenarioItem[] {
    // Scenario levels and event-study statistics require a reproducible historical sample.
    return [];
  }

  public getCrossAssets(): CrossAssetQuote[] { return Array.from(this.crossAssets.values()); }
  public getStories(limit = NEWS_ARCHIVE_LIMIT, offset = 0): MarketNewsStory[] {
    return this.stories.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit));
  }
  public getStoryCount(): number { return this.stories.length; }
  public getRiskOff(): RiskOffClassification { return this.riskOffClassification; }
  public getGriIndex(): number | undefined { return undefined; }
  public getActiveShock(): ShockAlert | null { return this.activeShock; }
}

export const marketIntelligence = new MarketIntelligenceEngine();
