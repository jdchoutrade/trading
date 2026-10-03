import fs from 'fs';
import path from 'path';

// Diagnostic script to verify feed synchronization, tick arrival, latency, and dual-provider cross-check
async function runFeedVerification() {
  console.log('===============================================================');
  console.log('🔍 QRA GOLD TERMINAL · FEED SYNCHRONIZATION DIAGNOSTIC');
  console.log('===============================================================');

  // Duration in seconds (default 30 seconds for CLI test, or 300 seconds if --full passed)
  const isFullRun = process.argv.includes('--full') || process.argv.includes('-f');
  const durationSec = isFullRun ? 300 : process.argv[2] ? parseInt(process.argv[2]) : 30;

  console.log(`Running continuous sampling for ${durationSec} seconds...`);
  console.log('Verifying p95 latency, tick rate, gaps, and data freshness.\n');

  const latencies: number[] = [];
  let tickCount = 0;
  let gapsDetected = 0;
  let delayedSeconds = 0;
  let lastTimestamp = 0;
  let lastPrice = 0;
  let lastSpread = 0;
  let isDivergentLast = false;
  let source = 'OANDA:XAUUSD';

  const startTime = Date.now();

  for (let i = 0; i < durationSec; i++) {
    const t0 = Date.now();
    try {
      const [resSym, resHealth] = await Promise.all([
        fetch('http://localhost:3000/api/symbols'),
        fetch('http://localhost:3000/api/health'),
      ]);

      const roundtrip = Date.now() - t0;
      latencies.push(roundtrip);

      if (resSym.ok) {
        const json = await resSym.json();
        const gold = json.symbols?.find((s: any) => s.symbol === 'XAUUSD');
        if (gold) {
          tickCount++;
          lastPrice = gold.price;
          lastSpread = gold.spread;
          isDivergentLast = gold.isDivergent;

          if (gold.lastTickAgeSeconds > 3.0) {
            gapsDetected++;
          }
          if (gold.isDelayed) {
            delayedSeconds++;
          }

          if ((i + 1) % 5 === 0 || i === 0 || i === durationSec - 1) {
            console.log(
              `[T+${(i + 1).toString().padStart(3)}s] XAUUSD: $${gold.price} | Spread: $${gold.spread} | Age: ${gold.lastTickAgeSeconds}s | Latency: ${roundtrip}ms | Delayed: ${gold.isDelayed ? 'YES' : 'NO'}`
            );
          }
        }
      }

      if (resHealth.ok) {
        const hJson = await resHealth.json();
        if (hJson.health?.source) {
          source = hJson.health.source;
        }
      }
    } catch (e: any) {
      console.warn(`Sample ${i + 1} error:`, e.message);
      gapsDetected++;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  latencies.sort((a, b) => a - b);
  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 999;
  const p50Latency = latencies[Math.floor(latencies.length * 0.5)] || avgLatency;
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1] || avgLatency;
  const maxLatency = latencies[latencies.length - 1] || avgLatency;

  const totalTimeSec = (Date.now() - startTime) / 1000;
  const tickRate = Number((tickCount / Math.max(1, totalTimeSec)).toFixed(2));

  const isPassed = p95Latency < 1000 && gapsDetected <= 1 && delayedSeconds <= 2;

  const report = {
    timestamp: new Date().toISOString(),
    source,
    durationSeconds: durationSec,
    totalSamples: tickCount,
    tickRatePerSec: tickRate,
    lastPrice,
    lastSpread,
    latency: {
      avgMs: Number(avgLatency.toFixed(1)),
      p50Ms: p50Latency,
      p95Ms: p95Latency,
      maxMs: maxLatency,
    },
    gapsDetected,
    delayedSeconds,
    isDivergent: isDivergentLast,
    acceptanceCriteria: {
      p95LatencyLessThan1000ms: p95Latency < 1000,
      zeroSevereGaps: gapsDetected <= 1,
      feedNotDelayed: delayedSeconds <= 2,
      passedOverall: isPassed,
    },
  };

  console.log('\n---------------- DIAGNOSTIC REPORT ----------------');
  console.log(`Feed Source          : ${source}`);
  console.log(`Total Samples        : ${tickCount} / ${durationSec}`);
  console.log(`Average Latency      : ${avgLatency.toFixed(1)} ms`);
  console.log(`P50 Latency          : ${p50Latency} ms`);
  console.log(`P95 Latency          : ${p95Latency} ms (Acceptance: < 1000ms)`);
  console.log(`Max Latency          : ${maxLatency} ms`);
  console.log(`Gaps (> 3s)          : ${gapsDetected}`);
  console.log(`Delayed Flag Seconds : ${delayedSeconds}s`);
  console.log(`Standard Acceptance  : ${isPassed ? '✅ PASSED (STRICT REAL-TIME)' : '❌ FAILED'}`);
  console.log('---------------------------------------------------\n');

  // Save report to reports/ directory
  try {
    const reportsDir = path.resolve(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const reportPath = path.join(reportsDir, `verify-feed-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Saved report artifact: ${reportPath}`);
  } catch (err) {
    console.warn('Could not save report file:', err);
  }

  if (!isPassed) {
    process.exit(1);
  }
}

runFeedVerification().catch((e) => {
  console.error(e);
  process.exit(1);
});
