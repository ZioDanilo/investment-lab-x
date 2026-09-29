export type MonteCarloScenario = 'expansion' | 'soft_landing' | 'recession' | 'stagflation' | 'general';

export class SeededRandom {
  constructor(seed?: number | string);
  next(): number;
  nextFloat(): number;
  nextInt(min: number, max: number): number;
}

export function derivePathSeed(runSeed: number | string, pathId: number): number;
export function toCompactPathResult(result: unknown): unknown;
export class MonteCarloPortfolioPathError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export function evolveMonteCarloPortfolioPath(input: any, monthlyReturnVectors: any[]): any;
export function normalCdf(x: number): number;
export function normalQuantile(p: number): number;
export function sampleStandardNormal(): number;
export function studentTCdf(x: number, df: number): number;
export function studentTQuantile(p: number, df: number): number;
export function sampleTruncatedNormal(mean: number, variance: number, lower: number, upper: number): number;
export function solveTruncatedNormalMeanForQuantile(quantile: number, variance: number, lower: number, upper: number): number;
export function truncatedNormalQuantile(p: number, mean: number, variance: number, lower: number, upper: number): number;
export const MACRO_SCENARIOS: readonly MonteCarloScenario[];
export const SCENARIO_LABELS: Record<string, string>;
export const DEFAULT_STRUCTURAL_PROBABILITIES: Record<string, number>;
export const DEFAULT_TRANSITION_MATRIX: Record<string, Record<string, number>>;
export const DEFAULT_DISTRIBUTION_SETTINGS: Record<string, number>;
export const DEFAULT_REBALANCE_SETTINGS: Record<string, number>;

export const INTENSITY_AR_RHO: number;
export const ENTRY_SOFT_QUANTILE: number;
export class MonteCarloMacroEngineError extends Error {}
export function getStayProbability(...args: any[]): any;
export function generateMonthlyMacroTimeline(...args: any[]): any;
export const macroEngineConstants: Record<string, unknown>;

export const MAX_REDRAWS: number;
export class MonteCarloReturnEngineError extends Error {}
export function __debugRejectTrace(...args: any[]): any;
export function __debugAcceptTrace(...args: any[]): any;
export function __debugAllAttemptTrace(...args: any[]): any;
export const returnVectorProfilerState: {
  activeWorkerId: number | null;
  enabled: boolean;
  calls: number;
  parameterLookupMs: number;
  randomGenerationMs: number;
  distributionTransformMs: number;
  correlationVectorMs: number;
  matrixMathMs: number;
  etfReturnCalculationMs: number;
  diagnosticsMs: number;
  otherMs: number;
};
export function beginReturnVectorBatchProfile(workerId: number): void;
export function endReturnVectorBatchProfile(workerId: number, calls: number): void;
export function calculateEffectiveMonthlyParameters(...args: any[]): any;
export function isMonthlyReturnAccepted(...args: any[]): any;
export function generateMonthlyReturnVector(...args: any[]): any;
export class ReturnCorrelationDiagnosticsAccumulator {}

export const PSD_EPSILON: number;
export const CORRELATION_EPSILON: number;
export const MAX_CORRELATION_CELL_DELTA: number;
export const MAX_CORRELATION_P95_DELTA: number;
export const MAX_CORRELATION_RMS_DELTA: number;
export const NEAREST_CORRELATION_TOLERANCE: number;
export const NEAREST_CORRELATION_MAX_ITERATIONS: number;
export class MonteCarloPrecomputationError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export function calibrateTargetLogAndSigma(...args: any[]): any;
export function calibrateMonthlyLocation(...args: any[]): any;
export function assessCorrelationMatrixDistortion(...args: any[]): any;
export function precomputeEtfScenarioParameters(...args: any[]): any;
export function prepareCorrelationMatrix(...args: any[]): any;
export function buildMuCalibrationCurve(...args: any[]): any;
export function prepareMonteCarloPrecomputation(...args: any[]): any;

export const createDeterministicRandom: (simulationId: number | string, runSeed: number | string) => SeededRandom;
