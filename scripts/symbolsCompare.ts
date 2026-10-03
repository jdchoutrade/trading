// Tool to compare quotes across multiple TradingView symbols for Gold (XAUUSD)
// and calculate broker offset automatically against a manual reference quote.
// Usage: tsx scripts/symbolsCompare.ts [brokerReferencePrice]

const TradingView = require('@mathieuc/tradingview');

async function runSymbolsComparison() {
  console.log('===============================================================');
  console.log('📊 QRA GOLD TERMINAL · SYMBOL COMPARISON & BROKER OFFSET TOOL');
  console.log('===============================================================');

  const manualRefArg = process.argv[2] ? parseFloat(process.argv[2]) : null;
  if (manualRefArg) {
    console.log(`Manual Broker Reference Price: $${manualRefArg.toFixed(2)}\n`);
  }

  const client = new TradingView.Client();
  const quoteSession = new client.Session.Quote({
    customFields: ['lp', 'bid', 'ask', 'volume', 'lp_time'],
  });

  const SYMBOLS = [
    { symbol: 'OANDA:XAUUSD', desc: 'OANDA Spot Gold (Terminal Default)' },
    { symbol: 'FX:XAUUSD', desc: 'FXCM Spot Gold' },
    { symbol: 'TVC:GOLD', desc: 'TradingView Spot Gold Index' },
    { symbol: 'FOREXCOM:XAUUSD', desc: 'Forex.com Spot Gold' },
  ];

  console.log('Connecting to TradingView WebSocket and querying live quotes...\n');

  const quotes: Record<string, { lp: number; bid: number; ask: number; spread: number; time: number }> = {};

  await Promise.all(
    SYMBOLS.map((s) => {
      return new Promise<void>((resolve) => {
        const m = new quoteSession.Market(s.symbol);
        const timeout = setTimeout(() => {
          resolve();
        }, 6000);

        m.onData((data: any) => {
          if (data.lp) {
            quotes[s.symbol] = {
              lp: data.lp,
              bid: data.bid || data.lp,
              ask: data.ask || data.lp,
              spread: data.bid && data.ask ? Number((data.ask - data.bid).toFixed(2)) : 0.35,
              time: data.lp_time || Math.floor(Date.now() / 1000),
            };
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    })
  );

  console.log('---------------------------------------------------------------');
  console.log('SYMBOL            | LAST PRICE | BID / ASK      | SPREAD | AGE');
  console.log('---------------------------------------------------------------');

  const basePrice = quotes['OANDA:XAUUSD']?.lp || 0;
  const atrEstimate = 4.0;

  for (const s of SYMBOLS) {
    const q = quotes[s.symbol];
    if (q) {
      const ageSec = (Date.now() / 1000 - q.time).toFixed(1);
      const diffFromBase = basePrice > 0 ? (q.lp - basePrice).toFixed(2) : '0.00';
      console.log(
        `${s.symbol.padEnd(17)} | $${q.lp.toFixed(2).padEnd(9)} | $${q.bid.toFixed(2)} / $${q.ask.toFixed(2)} | $${q.spread.toFixed(2).padEnd(6)} | ${ageSec}s (diff: ${diffFromBase >= '0' ? '+' : ''}${diffFromBase})`
      );
    } else {
      console.log(`${s.symbol.padEnd(17)} | [NO DATA / TIMEOUT]`);
    }
  }

  console.log('---------------------------------------------------------------');

  if (manualRefArg && basePrice > 0) {
    const suggestedOffset = Number((manualRefArg - basePrice).toFixed(2));
    const offsetAtr = (Math.abs(suggestedOffset) / atrEstimate).toFixed(2);

    console.log('\n🎯 BROKER OFFSET CALCULATION:');
    console.log(`Your Broker Price   : $${manualRefArg.toFixed(2)}`);
    console.log(`OANDA Feed Price    : $${basePrice.toFixed(2)}`);
    console.log(`Calculated Offset   : ${suggestedOffset >= 0 ? '+' : ''}${suggestedOffset} pts (${offsetAtr}x ATR)`);
    console.log(`Configure in Settings or POST /api/settings/offset { "offset": ${suggestedOffset} }`);
  }

  await client.end();
  process.exit(0);
}

runSymbolsComparison().catch((err) => {
  console.error('Symbols comparison error:', err);
  process.exit(1);
});
