import fs from 'node:fs';
import path from 'node:path';
import { SignalSource } from '../types.ts';
import { RegimeWeightsConfig } from './defaultWeights.ts';

export interface SignalSourceConfig {
  version: string;
  enabled: boolean;
  minScore: number;
  minGrade: 'A+' | 'A' | 'B' | 'C' | 'X';
  cooldownSeconds: number;
  minimumTechnicalPasses: number;
  aiOfflineMode?: 'RULE_FUSION_ONLY' | 'BLOCK';
  weights: RegimeWeightsConfig;
}

const configPaths: Record<Exclude<SignalSource, 'UNKNOWN_LEGACY'>, string> = {
  INDICATOR: 'weights.indicator.json',
  ANALYSIS: 'weights.analysis.json',
};
const loaded = new Map<string, SignalSourceConfig>();

function validate(config: SignalSourceConfig, filePath: string): SignalSourceConfig {
  const validGrades = ['A+', 'A', 'B'];
  const weightKeys = ['S', 'H', 'F', 'K', 'O', 'T', 'REG', '4H', 'D1', 'VWAP', 'MOM', 'RAIL', 'XA', 'COR', 'MAC', 'NEWS', 'GEO'];
  if (typeof config.version !== 'string' || typeof config.enabled !== 'boolean') {
    throw new Error(`Invalid version or enabled flag in ${filePath}.`);
  }
  if (!Number.isFinite(config.minScore) || config.minScore < 60 || config.minScore > 100) {
    throw new Error('Minimum score must be between 60 and 100.');
  }
  if (!validGrades.includes(config.minGrade)) {
    throw new Error('Minimum grade must be B, A, or A+.');
  }
  if (!Number.isFinite(config.cooldownSeconds) || config.cooldownSeconds < 0) {
    throw new Error('Cooldown must be zero or greater.');
  }
  if (!Number.isInteger(config.minimumTechnicalPasses) || config.minimumTechnicalPasses < 2 || config.minimumTechnicalPasses > 4) {
    throw new Error('Technical confirmations must be between 2 and 4.');
  }
  if (
    (config.aiOfflineMode !== undefined && config.aiOfflineMode !== 'RULE_FUSION_ONLY' && config.aiOfflineMode !== 'BLOCK')
    || !config.weights?.TREND
    || !config.weights?.RANGE
    || !config.weights?.HIGH_VOLATILITY
  ) {
    throw new Error(`Invalid AI mode or missing regime weights in ${filePath}.`);
  }

  for (const regime of [config.weights.TREND, config.weights.RANGE, config.weights.HIGH_VOLATILITY]) {
    for (const key of weightKeys) {
      const value = regime[key as keyof typeof regime];
      if (!Number.isFinite(value) || value < 0) throw new Error(`Weight ${key} in ${regime} must be a non-negative number.`);
    }
  }
  return config;
}

export function getSignalSourceConfig(source: Exclude<SignalSource, 'UNKNOWN_LEGACY'>): SignalSourceConfig {
  const existing = loaded.get(source);
  if (existing) return existing;

  const filePath = path.resolve(process.cwd(), configPaths[source]);
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SignalSourceConfig;
  // Migrate older strict profiles to the current balanced B-grade baseline.
  const minScore = Number.isFinite(stored.minScore) ? Math.max(60, stored.minScore) : 60;
  const minGrade = stored.minGrade === 'A+' || stored.minGrade === 'A' || stored.minGrade === 'B' ? stored.minGrade : 'B';
  const minimumTechnicalPasses = Number.isInteger(stored.minimumTechnicalPasses)
    ? Math.min(4, Math.max(2, stored.minimumTechnicalPasses))
    : 2;
  const needsMigration = minScore !== stored.minScore
    || minGrade !== stored.minGrade
    || minimumTechnicalPasses !== stored.minimumTechnicalPasses;
  const migrated = needsMigration
    ? { ...stored, version: `${source.toLowerCase()}-${Date.now()}-quality`, minScore, minGrade, minimumTechnicalPasses }
    : stored;
  const parsed = validate(migrated, filePath);
  if (needsMigration) {
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  }
  loaded.set(source, parsed);
  return parsed;
}

export function updateSignalSourceConfig(
  source: Exclude<SignalSource, 'UNKNOWN_LEGACY'>,
  updates: Partial<Pick<SignalSourceConfig, 'enabled' | 'minScore' | 'minGrade' | 'cooldownSeconds' | 'minimumTechnicalPasses' | 'aiOfflineMode' | 'weights'>>
): SignalSourceConfig {
  const config = getSignalSourceConfig(source);
  const filePath = path.resolve(process.cwd(), configPaths[source]);
  const next = validate({
    ...config,
    ...updates,
    version: `${source.toLowerCase()}-${Date.now()}`,
  }, filePath);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
  loaded.set(source, next);
  return next;
}
