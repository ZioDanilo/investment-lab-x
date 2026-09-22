import { MonteCarloUserInput, MonteCarloSnapshot } from '../models/monte-carlo-contracts.model';
import { evolveMonteCarloPortfolioPath } from '../portfolio/monte-carlo-portfolio-path-engine';
import { generateMonthlyReturnVector } from '../returns/monte-carlo-return-engine';
import { getMonteCarloPrecomputationCacheStats, prepareMonteCarloPrecomputation } from '../precomputation/monte-carlo-precomputation';
import { SeededRandom } from './seeded-random';

export interface GeneralBenchmarkPathMetric {
  cagr: number;
  annualizedVolatility: number;
  candidateVectors: number;
  acceptedVectors: number;
  rejectedVectors: number;
  physicalFloorRejectedVectors: number;
}

export interface GeneralBenchmarkResult {
  executionId: string;
  generalBenchmarkCAGR: number;
  generalBenchmarkVolatility: number;
  completedPaths: number;
  monthsProcessed: number;
  candidateVectors: number;
  acceptedVectors: number;
  rejectedVectors: number;
  physicalFloorRejectedVectors: number;
  pathMetrics: GeneralBenchmarkPathMetric[];
}

export const DEFAULT_GENERAL_BENCHMARK_PATHS = 1000;

export const calculateTrimmedMean5Percent = (values: number[]): number => {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((left, right) => left - right);
  const trimCount = Math.floor(sorted.length * 0.05);
  if (trimCount === 0) {
    return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  }
  const start = trimCount;
  const end = sorted.length - trimCount;
  if (end <= start) {
    return sorted[Math.floor(sorted.length / 2)];
  }
  const trimmed = sorted.slice(start, end);
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
};

export const calculatePathCagr = (
  initialCapital: number,
  finalCapital: number,
  horizonYears: number
): number => {
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    throw new Error(`initialCapital must be finite and > 0, got ${initialCapital}`);
  }
  if (!Number.isFinite(horizonYears) || horizonYears <= 0) {
    throw new Error(`horizonYears must be finite and > 0, got ${horizonYears}`);
  }
  if (!Number.isFinite(finalCapital)) {
    throw new Error(`finalCapital must be finite, got ${finalCapital}`);
  }
  if (finalCapital === 0) return -1;
  return Math.pow(finalCapital / initialCapital, 1 / horizonYears) - 1;
};

export const calculateWelfordVolatility = (returns: number[]): number => {
  if (returns.length < 2) return 0;
  let count = 0;
  let mean = 0;
  let m2 = 0;
  for (const value of returns) {
    count += 1;
    const delta = value - mean;
    mean += delta / count;
    const delta2 = value - mean;
    m2 += delta * delta2;
  }
  if (count < 2) return 0;
  const variance = m2 / (count - 1);
  return Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
};

const createRandomSource = (seed?: number): (() => number) => {
  const rng = new SeededRandom(seed ?? Date.now());
  return () => rng.next();
};

export const runGeneralBenchmark = (
  snapshot: MonteCarloSnapshot,
  input: MonteCarloUserInput,
  seed?: number,
  simulationCount = 1000
): GeneralBenchmarkResult => {
  if (!Number.isInteger(simulationCount) || simulationCount <= 0) {
    throw new Error(`simulationCount must be a positive integer, got ${simulationCount}`);
  }

  const precomputeStartedAt = performance.now();
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const precomputeMs = performance.now() - precomputeStartedAt;
  const horizonMonths = input.horizonYears * 12;
  const random = createRandomSource(seed);
  const pathMetrics: GeneralBenchmarkPathMetric[] = [];
  const generalSummary = {
    generalPrecomputeMs: precomputeMs,
    generalMacroTimelineMs: 0,
    generalMonthlyReturnGenerationMs: 0,
    generalPortfolioEvolutionMs: 0,
    generalPathMetricsMs: 0,
    generalFinalAggregationMs: 0,
    generalResultBuildMs: 0,
    generalTotalMs: 0
  };
  let candidateVectors = 0;
  let acceptedVectors = 0;
  let rejectedVectors = 0;
  let physicalFloorRejectedVectors = 0;

  for (let simulationId = 0; simulationId < simulationCount; simulationId += 1) {
    const macroStart = performance.now();
    const monthlyVectors = Array.from({ length: horizonMonths }, () =>
      generateMonthlyReturnVector(snapshot, precompute, 'expansion', 0, random)
    );
    generalSummary.generalMonthlyReturnGenerationMs += performance.now() - macroStart;
    const portfolioStart = performance.now();
    const path = evolveMonteCarloPortfolioPath(input, monthlyVectors);
    generalSummary.generalPortfolioEvolutionMs += performance.now() - portfolioStart;
    const portfolioReturns = path.monthly.map((entry) => entry.portfolioReturn);
    const cagr = calculatePathCagr(input.initialCapital, path.finalCapital, input.horizonYears);
    const annualizedVolatility = calculateWelfordVolatility(portfolioReturns);

    const metric: GeneralBenchmarkPathMetric = {
      cagr,
      annualizedVolatility,
      candidateVectors: monthlyVectors.reduce((sum, vector) => sum + (vector.diagnostics.rangeDiagnostics?.candidateVectors ?? 0), 0),
      acceptedVectors: monthlyVectors.reduce((sum, vector) => sum + (vector.diagnostics.rangeDiagnostics?.acceptedVectors ?? 0), 0),
      rejectedVectors: monthlyVectors.reduce((sum, vector) => sum + (vector.diagnostics.rangeDiagnostics?.rejectedVectors ?? 0), 0),
      physicalFloorRejectedVectors: monthlyVectors.reduce((sum, vector) => sum + (vector.diagnostics.rangeDiagnostics?.physicalFloorRejectedVectors ?? 0), 0)
    };

    pathMetrics.push(metric);
    candidateVectors += metric.candidateVectors;
    acceptedVectors += metric.acceptedVectors;
    rejectedVectors += metric.rejectedVectors;
    physicalFloorRejectedVectors += metric.physicalFloorRejectedVectors;
  }

  const cagrValues = pathMetrics.map((metric) => metric.cagr);
  const volatilityValues = pathMetrics.map((metric) => metric.annualizedVolatility);
  const generalResultStart = performance.now();
  const result = {
    executionId: `general-benchmark-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    generalBenchmarkCAGR: calculateTrimmedMean5Percent(cagrValues),
    generalBenchmarkVolatility: calculateTrimmedMean5Percent(volatilityValues),
    completedPaths: pathMetrics.length,
    monthsProcessed: horizonMonths * pathMetrics.length,
    candidateVectors,
    acceptedVectors,
    rejectedVectors,
    physicalFloorRejectedVectors,
    pathMetrics
  };
  generalSummary.generalPathMetricsMs = performance.now() - generalResultStart;
  generalSummary.generalFinalAggregationMs = 0;
  generalSummary.generalResultBuildMs = 0;
  generalSummary.generalTotalMs = precomputeMs + generalSummary.generalMonthlyReturnGenerationMs + generalSummary.generalPortfolioEvolutionMs + generalSummary.generalPathMetricsMs;
  return { ...result, __profilingSummary: generalSummary };
};
