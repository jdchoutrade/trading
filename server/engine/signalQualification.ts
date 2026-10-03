import type { FactorDetail } from '../types.ts';

const technicalTriggerCodes = new Set(['S', 'F', 'K', 'O']);

export function countTechnicalPasses(factors: FactorDetail[]): number {
  return factors.filter((factor) => technicalTriggerCodes.has(factor.code) && factor.status === 'pass').length;
}

/** Require one directional trigger (structure or sweep/reclaim) and one active SMC zone (FVG or OB). */
export function hasDirectionalSmcSetup(factors: FactorDetail[]): boolean {
  const passed = new Set(factors.filter((factor) => factor.status === 'pass').map((factor) => factor.code));
  return (passed.has('S') || passed.has('K')) && (passed.has('F') || passed.has('O'));
}
