# QRA Terminal Setup & Environment Configuration Guide

## 1. Environment Variables (.env)

Create a `.env` file in the project root:

```bash
# TradingView live market feed
TV_SESSION="your-tradingview-session"
TV_SIGNATURE="your-tradingview-signature"
PRIMARY_SYMBOL="OANDA:XAUUSD"

# Scan the forming candle before it closes
SIGNAL_TRIGGER_TF="5m"
LIVE_SIGNAL_SCAN_INTERVAL_MS="750"
LIVE_AI_REVIEW="true"

# Gemini API Key (Automatically injected in Google AI Studio)
GEMINI_API_KEY="your-gemini-api-key"

# DeepSeek API Key (Optional: for deepseek-chat or deepseek-reasoner R1)
DEEPSEEK_API_KEY=""

# Optional corroborated news source
MARKETAUX_API_KEY=""

# Telegram Bot Integration (Optional: for live trade broadcasting)
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
```

The economic calendar loads the current week's published Forex Factory JSON export and combines it with the U.S. BLS release calendar. Forex Factory events are refreshed every five minutes, converted from their ISO timestamps for local display, and passed to the 12-stage release guard and AI context. The integration consumes only the published weekly export; it does not build or republish a Forex Factory history archive. Calendar: https://www.forexfactory.com/calendar/

## 2. Running Unit Tests

The SMC quantitative engine features a 100% automated test suite using `vitest`:

```bash
npm test
```

## 3. Keyboard Shortcuts

- `⌘ / Ctrl + F`: Open "Ask QRA" interactive AI assistant
- `⌘ / Ctrl + S`: Open 12-Step Quant Setup Plan side drawer
- `⌘ / Ctrl + B`: Toggle between Indicators custom chart and TradingView live widget
- `⌘ / Ctrl + ?`: View keyboard shortcuts reference

## 4. How Indicators & SMC Levels Are Calculated

- **BOS & CHoCH:** Evaluates previous fractal swing highs/lows. A candle body close above a swing high marks a BOS (continuation) or CHoCH (reversal). Wicks do not qualify.
- **Order Blocks (OB):** Identifies the last opposing candle prior to a displacement move exceeding 1.3× ATR(14). Tracks subsequent bars to detect mitigation.
- **Fair Value Gaps (FVG):** Measured across 3 consecutive candles where candle 1 high and candle 3 low do not overlap with a gap ≥ 0.3× ATR. Tracks fill percentage.
- **Liquidity Sweeps:** Detected when a candle's wick breaks past a swing point or session extreme but the body closes back within the boundary.
- **Position Sizing:** `Lot Size = (Account Balance × Risk %) / (SL Distance in Points × 100)`.
