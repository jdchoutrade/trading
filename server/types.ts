export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isForming?: boolean; // V2: distinguishes forming live bar from officially closed bar
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | 'D';

export type MarketRegimeType = 'TREND_BULL' | 'TREND_BEAR' | 'RANGE' | 'HIGH_VOLATILITY' | 'EVENT_DRIVEN';

export interface MarketRegime {
  type: MarketRegimeType;
  confidence: number; // 0 - 100
  adx: number;
  plusDI: number;
  minusDI: number;
  atrPercentile: number;
  bbWidth: number;
  isSqueeze: number; // 1 = squeeze, 0 = normal
  description: string;
  descriptionKm: string;
}

export type BiasType = 'BULL' | 'BEAR' | 'NEUTRAL';

export interface MultiTimeframeBias {
  h4Bias: BiasType;
  h1Bias: BiasType;
  m15Structure: BiasType;
  m5Trigger: 'BUY_READY' | 'SELL_READY' | 'WAIT';
  alignmentScore: number; // 0 - 100
  h1Ema50: number;
  h1Ema200: number;
  premiumDiscountZone: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
  dealingRange: { high: number; low: number; mid: number };
}

export interface LiquidityLevel {
  id: string;
  price: number;
  type: 'SWING_HIGH' | 'SWING_LOW' | 'EQUAL_HIGH' | 'EQUAL_LOW' | 'ASIA_HIGH' | 'ASIA_LOW' | 'LONDON_HIGH' | 'LONDON_LOW' | 'NY_HIGH' | 'NY_LOW' | 'PDH' | 'PDL' | 'DAILY_OPEN' | 'ROUND_NUMBER';
  time: number;
  swept: boolean;
  sweptTime?: number;
  label: string;
  strength: number; // 1 - 5
  status?: 'CONFIRMED' | 'TENTATIVE';
}

export interface OrderBlock {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  mid: number;
  time: number;
  timeframe: Timeframe;
  mitigated: boolean;
  mitigatedTime?: number;
  strength: number; // 1 - 10
  displacementSize: number;
  status: 'CONFIRMED' | 'TENTATIVE';
}

export interface FVG {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  mid: number;
  time: number;
  timeframe: Timeframe;
  filled: boolean;
  fillPercentage: number;
  size: number;
  status: 'CONFIRMED' | 'TENTATIVE';
}

export interface LiquiditySweep {
  time: number;
  levelType: string;
  levelPrice: number;
  sweepPrice: number;
  closePrice: number;
  direction: 'BULLISH_SWEEP' | 'BEARISH_SWEEP';
}

export interface StructureBreak {
  type: 'BOS' | 'CHOCH';
  direction: 'BULLISH' | 'BEARISH';
  time: number;
  brokenLevel: number;
  closePrice: number;
  timeframe: Timeframe;
  status: 'CONFIRMED' | 'TENTATIVE';
}

export interface SessionInfo {
  currentSession: 'ASIA' | 'LONDON' | 'NY' | 'OVERLAP' | 'ROLLOVER' | 'OFF_HOURS';
  isKillZone: boolean;
  killZoneName?: string;
  isRolloverBlocked: boolean;
  asiaRange?: { high: number; low: number };
  londonRange?: { high: number; low: number };
  nyRange?: { high: number; low: number };
  pdh?: number;
  pdl?: number;
  dailyOpen?: number;
  closesInUtc: string;
  closesInMinutes: number;
  localTimeKm: string;
}

export type FactorCode =
  | 'S'
  | 'H'
  | 'F'
  | 'K'
  | 'O'
  | 'T'
  | 'REG'
  | '4H'
  | 'D1'
  | 'VWAP'
  | 'MOM'
  | 'RAIL'
  | 'BLOCK'
  | 'XA'   // V2: Cross-Asset Alignment
  | 'COR'  // V2: Correlation Health
  | 'MAC'  // V2: Macro Fundamental Bias
  | 'NEWS' // V2: High-Impact News / Breaking Event
  | 'GEO'; // V2: Geopolitical Risk Index

export type FactorStatus = 'pass' | 'partial' | 'fail' | 'na';

export interface FactorDetail {
  code: FactorCode;
  name: string;
  status: FactorStatus;
  scoreContribution: number;
  weight: number;
  reason: string;
  reasonKm: string;
  dataAgeSeconds?: number;
  sourceProof?: string;
}

export type SignalVerdict = 'BUY' | 'SELL' | 'BUY_LEANS' | 'SELL_LEANS' | 'WAIT';
export type SignalGrade = 'A+' | 'A' | 'B' | 'C' | 'X';

export interface TradePlan {
  entryType: 'LIMIT' | 'MARKET';
  entryPrice: number;
  stopLoss: number;
  slAtrMultiple: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rr1: number;
  rr2: number;
  rr3: number;
  riskRewardValid: boolean;
  suggestedLotSize: number;
  invalidationLevel: number;
  // V2 Trade Management fields
  partialCloseTp1Percent: number; // e.g. 50%
  partialCloseTp2Percent: number; // e.g. 30%
  moveSlToBreakEvenAtTp1: boolean;
  trailingStopRule: string;
  timeStopMaxCandles: number;
}

export interface DeepSeekReview {
  verdict: 'BUY' | 'SELL' | 'WAIT';
  agreement: number; // 0 - 100
  reasons: string[];
  risks: string[];
  invalidation: number;
  comment_km: string;
  comment_en: string;
  modelUsed: string;
  reviewedAt: number;
  tokensUsed?: number;
  costEstimateUsd?: number;
}

export interface SignalLock {
  isLocked: boolean;
  lockUntil: number;
  lockedVerdict?: SignalVerdict;
  invalidationLevel?: number;
  remainingMinutes: number;
}

// V2 Cross-Asset & Macro Types
export interface CrossAssetQuote {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  lastUpdated: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  sparkline: number[];
}

export interface CorrelationMatrixItem {
  assetA: string;
  assetB: string;
  windowBars: number;
  correlation: number; // -1 to +1
  isBroken: boolean; // correlation divergence warning
  divergenceReason?: string;
}

export interface MacroDataPoint {
  id: string;
  name: string;
  value: number;
  formattedValue: string;
  unit: string;
  asOf: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  source: string;
  biasForGold: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface MarketNewsStory {
  id: string;
  title: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: number;
  receivedAt: number;
  latencySeconds: number;
  tier: 1 | 2 | 3;
  category: string;
  region: string;
  severity: number; // 0 - 10
  novelty: number; // 0 - 10
  goldImpact: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL';
  mechanism: 'SAFE_HAVEN' | 'DOLLAR' | 'YIELDS' | 'INFLATION' | 'CB_DEMAND' | 'NONE';
  confidence: number;
  verificationStatus: 'UNVERIFIED' | 'MULTI-SOURCE' | 'PRICE-CONFIRMED';
  headlineIdsUsed: string[];
  reasoningKm?: string;
}

export interface ScheduledEconomicEvent {
  id: string;
  title: string;
  country: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  scheduledAt: number; // Unix timestamp in seconds
  actual?: string;
  forecast?: string;
  previous?: string;
  source: string;
  url: string;
  status: 'SCHEDULED' | 'RELEASED';
}

export interface AnalysisStage {
  index: number;
  name: string;
  status: 'PASS' | 'PARTIAL' | 'FAIL' | 'WAIT';
  evidence: string;
}

export interface ScenarioItem {
  id: string;
  title: string;
  scenario: 'ESCALATION' | 'STATUS_QUO' | 'DE_ESCALATION';
  triggerCondition: string;
  keyLevels: number[];
  expectedReactionAtr: number;
  invalidation: number;
  sampleCount: number;
  sources: string[];
  status: 'ACTIVE' | 'TRIGGERED' | 'INVALIDATED';
}

export interface ShockAlert {
  id: string;
  timestamp: number;
  velocityAtr: number;
  spreadMultiplier: number;
  tickRateSurge: number;
  likelyCauseStoryId?: string;
  likelyCauseTitle?: string;
  status: 'ACTIVE' | 'COOLDOWN' | 'RESOLVED';
}

export interface RiskOffClassification {
  type: 'SAFE_HAVEN_GOLD' | 'DOLLAR_SMILE' | 'MIXED_UNCLEAR';
  goldVelocity: number;
  dxyVelocity: number;
  yieldsVelocity: number;
  confidence: number;
  sampleCount: number;
  description: string;
  descriptionKm: string;
}

export interface LiveTradeTracker {
  signalId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  spreadAtEntry: number;
  status: 'PENDING' | 'TRIGGERED' | 'TP1_HIT' | 'BE_MOVED' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'TIME_STOP' | 'INVALIDATED';
  currentR: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  timeInTradeSeconds: number;
  openTime: number;
  closeTime?: number;
  pnlDollar: number;
  lotSize: number;
}

export interface SignalSnapshotImmutable {
  hash: string;
  timestamp: number;
  signalId: string;
  symbol: string;
  timeframe: Timeframe;
  currentPrice: number;
  bid: number;
  ask: number;
  spread: number;
  atr14: number;
  primaryPrice: number;
  secondaryPrice?: number;
  divergenceAtr?: number;
  regime: MarketRegime;
  mtfBias: MultiTimeframeBias;
  factors: FactorDetail[];
  buyScore: number;
  sellScore: number;
  verdict: SignalVerdict;
  grade: SignalGrade;
  weightsVersion: string;
  aiReview?: DeepSeekReview;
  riskOffType?: RiskOffClassification['type'];
  griIndex?: number;
}

export interface FullAnalysisResult {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number;
  currentPrice: number;
  bid: number;
  ask: number;
  spread: number;
  atr14: number;
  primaryPrice: number;
  secondaryPrice: number;
  priceDivergenceAtr: number;
  isPriceDivergent: boolean;
  regime: MarketRegime;
  mtfBias: MultiTimeframeBias;
  session: SessionInfo;
  liquidityLevels: LiquidityLevel[];
  orderBlocks: OrderBlock[];
  fvgs: FVG[];
  recentBreaks: StructureBreak[];
  recentSweeps: LiquiditySweep[];
  buyFactors: FactorDetail[];
  sellFactors: FactorDetail[];
  buyScore: number;
  sellScore: number;
  verdict: SignalVerdict;
  grade: SignalGrade;
  signalLock: SignalLock;
  tradePlan?: TradePlan;
  deepSeekReview?: DeepSeekReview;
  isStale: boolean;
  dataAgeMs: number;
  hardBlockReason?: string;
  hardBlockReasonKm?: string;
  // V2 Desk Context
  riskOff?: RiskOffClassification;
  griIndex?: number;
  recentStories?: MarketNewsStory[];
  activeShock?: ShockAlert;
  analysisStages?: AnalysisStage[];
  scheduledEvents?: ScheduledEconomicEvent[];
}

export interface CalibrationBucket {
  scoreRange: string; // e.g. "80-89"
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number; // percentage or NaN if insufficient
  confidenceIntervalWilson: [number, number]; // [lower, upper]
  avgR: number;
  expectancy: number;
  isSampleSufficient: boolean; // true if totalTrades >= 30
}

export interface FactorAttributionStat {
  code: FactorCode;
  name: string;
  passCount: number;
  failCount: number;
  winRateWhenPassed: number;
  winRateWhenFailed: number;
  marginalContributionR: number;
  sampleCount: number;
  isSampleSufficient: boolean; // n >= 30
  suggestedWeightDelta: number;
}

export type SignalLifecycleStatus =
  | 'PENDING'
  | 'TRIGGERED'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'SL_HIT'
  | 'BE_EXIT'
  | 'TRAIL_EXIT'
  | 'SL_AFTER_TP1'
  | 'INVALIDATED'
  | 'TIME_STOP'
  | 'EXPIRED'
  | 'CANCELLED';

export interface SignalEvent {
  id: string;
  signalId: string;
  type: SignalLifecycleStatus;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  tsUtc: number; // Unix seconds
  source: 'tick' | 'candle' | 'reconstructed';
  note?: string;
}

export interface SignalOutcome {
  signalId: string;
  status: SignalLifecycleStatus;
  fillPrice?: number;
  exitPriceEffective?: number;
  rFinal?: number;
  rMaxMfe?: number;
  rMaxMae?: number;
  mfePrice?: number;
  mfeTs?: number;
  maePrice?: number;
  maeTs?: number;
  timeToTp1?: number;
  timeToTp2?: number;
  timeToTp3?: number;
  timeToSl?: number;
  duration?: number;
  firstHit?: 'TP1' | 'SL' | 'none';
  reconstructedFlag: boolean;
  ambiguousFlag: boolean;
  updatedAt: number;
}

export type SignalSource = 'INDICATOR' | 'ANALYSIS' | 'UNKNOWN_LEGACY';
export type SignalOrigin = 'engine_live' | 'replay' | 'legacy_v1' | 'UNKNOWN_LEGACY';
export type SignalAgreement = 'BOTH_SAME_DIR' | 'OPPOSITE_DIR' | 'SOLO' | 'UNKNOWN_LEGACY';

export interface SignalEntity {
  id: string;
  createdTs: number;
  candleCloseTs: number;
  symbol: string;
  sourceFeed: string;
  direction: 'BUY' | 'SELL';
  triggerTf: Timeframe;
  entryType: 'MARKET' | 'LIMIT_RETEST' | 'BREAKOUT';
  entryPrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rrPlanned: number;
  score: number;
  grade: SignalGrade;
  regime: MarketRegimeType;
  session: string;
  factors: any[];
  weightsVersion: string;
  configVersion: string;
  aiVerdict?: any;
  priceFeedSnapshot: {
    primaryPrice: number;
    secondaryPrice?: number;
    spread: number;
    latencyMs: number;
  };
  mgmtPlan: {
    partialCloseTp1Percent: number;
    partialCloseTp2Percent: number;
    moveSlToBreakEvenAtTp1: boolean;
    maxCandlesTimeStop: number;
  };
  snapshotHash: string;
  prevHash: string;
  brokerOffset: number;
  source: SignalSource;
  origin: SignalOrigin;
  groupId?: string;
  agreement: SignalAgreement;
  inputProvenance: Record<string, unknown>;
  aiState: 'ONLINE' | 'RULE_FUSION_ONLY' | 'OFFLINE' | 'NOT_USED' | 'UNKNOWN';
  hashVersion: number;
  tags?: string[];
  outcome?: SignalOutcome;
  events?: SignalEvent[];
}

export interface MyTradeEntity {
  id: string;
  signalId?: string;
  takenTs: number;
  symbol: string;
  direction: 'BUY' | 'SELL';
  actualEntry: number;
  actualSl: number;
  actualTp: number;
  lot: number;
  actualExit?: number;
  exitTs?: number;
  actualR?: number;
  notes?: string;
  screenshotRef?: string;
  status: 'OPEN' | 'CLOSED';
}

export interface HistorySummaryStats {
  totalSignals: number;
  triggeredCount: number;
  fillRate: number;
  wins: number;
  losses: number;
  beCount: number;
  openCount: number;
  winRate: number;
  wilsonInterval: [number, number];
  tp1HitRate: number;
  tp2HitRate: number;
  tp3HitRate: number;
  slHitRate: number;
  avgR: number;
  medianR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  longestWinStreak: number;
  longestLossStreak: number;
  avgTimeToTp1: number;
  avgDuration: number;
  isSampleSufficient: boolean;
  sampleCount: number;
  percentReconstructed: number;
  percentAmbiguous: number;
}

export interface CompareTradeRecord {
  signalId: string;
  tradeId?: string;
  taken: boolean;
  direction: 'BUY' | 'SELL';
  createdAt: number;
  signalR: number;
  myR: number;
  executionGapR: number;
  slippagePoints: number;
  status: string;
}

export interface SignalHistoryRecord {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  createdAt: number;
  direction: 'BUY' | 'SELL';
  grade: SignalGrade;
  score: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rr: number;
  status: SignalLifecycleStatus;
  outcomeTime?: number;
  realizedR?: number;
  maxFavorableExcursion?: number;
  maxAdverseExcursion?: number;
  session: string;
  regime: MarketRegimeType;
  topFactors: string[];
  aiAgreement?: number;
  immutableSnapshotHash?: string;
  notes?: string;
}

export interface PaperTrade {
  id: string;
  signalId?: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  pnl: number;
  pnlPips: number;
  status: 'OPEN' | 'CLOSED';
  openTime: number;
  closeTime?: number;
  closeReason?: 'TP' | 'SL' | 'MANUAL' | 'INVALIDATED' | 'TIME_STOP';
}
