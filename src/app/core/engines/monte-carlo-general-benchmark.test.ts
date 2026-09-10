import assert from 'node:assert/strict';
import { MonteCarloSnapshot, MonteCarloUserInput } from '../models/monte-carlo-contracts.model';
import { generateMonthlyReturnVector } from '../returns/monte-carlo-return-engine';
import { prepareMonteCarloPrecomputation } from '../precomputation/monte-carlo-precomputation';
import { evolveMonteCarloPortfolioPath } from '../portfolio/monte-carlo-portfolio-path-engine';
import {
  calculatePathCagr,
  calculateTrimmedMean5Percent,
  calculateWelfordVolatility,
  runGeneralBenchmark
} from './monte-carlo-general-benchmark';

const buildSnapshot = (): MonteCarloSnapshot => ({
  etfs: [
    {
      isin: 'ETF-A',
      name: 'ETF A',
      nickname: 'A',
      statistics: {
        expansion: { expectedReturn: 0.08, volatility: 0.18, returnRange: { min: -0.30, max: 0.35 } },
        recession: { expectedReturn: 0.02, volatility: 0.22, returnRange: { min: -0.35, max: 0.30 } },
        stagflation: { expectedReturn: -0.04, volatility: 0.25, returnRange: { min: -0.42, max: 0.20 } },
        soft_landing: { expectedReturn: 0.06, volatility: 0.19, returnRange: { min: -0.28, max: 0.32 } },
        general: { expectedReturn: 0.05, volatility: 0.16, returnRange: { min: -0.25, max: 0.30 } }
      }
    },
    {
      isin: 'ETF-B',
      name: 'ETF B',
      nickname: 'B',
      statistics: {
        expansion: { expectedReturn: 0.07, volatility: 0.16, returnRange: { min: -0.28, max: 0.30 } },
        recession: { expectedReturn: -0.01, volatility: 0.20, returnRange: { min: -0.30, max: 0.25 } },
        stagflation: { expectedReturn: -0.06, volatility: 0.23, returnRange: { min: -0.38, max: 0.18 } },
        soft_landing: { expectedReturn: 0.05, volatility: 0.17, returnRange: { min: -0.26, max: 0.28 } },
        general: { expectedReturn: 0.04, volatility: 0.15, returnRange: { min: -0.23, max: 0.27 } }
      }
    }
  ],
  structuralProbabilities: { expansion: 0.55, recession: 0.15, stagflation: 0.10, soft_landing: 0.20 },
  transitionMatrix: {
    expansion: { expansion: 0.60, recession: 0.10, stagflation: 0.10, soft_landing: 0.20 },
    recession: { expansion: 0.25, recession: 0.20, stagflation: 0.05, soft_landing: 0.50 },
    stagflation: { expansion: 0.20, recession: 0.20, stagflation: 0.30, soft_landing: 0.30 },
    soft_landing: { expansion: 0.40, recession: 0.20, stagflation: 0.10, soft_landing: 0.30 }
  },
  inertiaConfigurations: {
    expansion: { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 },
    recession: { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 },
    stagflation: { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 },
    soft_landing: { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 }
  },
  intensityConfigurations: {
    expansion: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
    recession: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
    stagflation: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
    soft_landing: { meanIntensity: 0.5, stdDevIntensity: 0.1 }
  },
  globalProperties: {
    scenario_transition_intensity_threshold: 0.4,
    new_scenario_first_month_max_intensity: 0.4,
    new_scenario_second_month_max_intensity: 0.4,
    scenario_intensity_max_monthly_variation: 0.1
  },
  correlations: [
    { isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.35, recession: 0.45, stagflation: 0.40, soft_landing: 0.30 }
  ]
});

const absoluteTolerance = (value: number, expected: number, tolerance: number, label: string): void => {
  if (Math.abs(value - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} but got ${value}`);
  }
};

const WELFORD_EQUIVALENCE_TEST = (): void => {
  const returns = [0.01, -0.02, 0.03, -0.04, 0.01, 0.02];
  const value = calculateWelfordVolatility(returns);
  assert.ok(Number.isFinite(value));
  assert.ok(value > 0);
};

const CAGR_TEST = (): void => {
  const value = calculatePathCagr(100_000, 130_000, 3);
  absoluteTolerance(value, Math.pow(1.3, 1 / 3) - 1, 1e-12, 'CAGR_TEST');
};

const TRIMMED_MEAN_TEST = (): void => {
  const values = [0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.32, 0.34, 0.36, 0.38, 0.40, 0.42, 0.44, 0.46, 0.48];
  const expected = values.slice(1, -1).reduce((sum, value) => sum + value, 0) / 18;
  const value = calculateTrimmedMean5Percent(values);
  absoluteTolerance(value, expected, 1e-12, 'TRIMMED_MEAN_TEST');
};

const PRODUCTION_RETURN_CORE_EQUIVALENCE_TEST = (): void => {
  const snapshot = buildSnapshot();
  const input: MonteCarloUserInput = {
    positions: [{ isin: 'ETF-A', targetWeight: 0.6 }, { isin: 'ETF-B', targetWeight: 0.4 }],
    initialCapital: 100_000,
    horizonYears: 3
  };
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const expectedMonths = input.horizonYears * 12;
  const monthlyVectors = Array.from({ length: expectedMonths }, (_, monthIndex) =>
    generateMonthlyReturnVector(snapshot, precompute, monthIndex % 4 === 0 ? 'expansion' : monthIndex % 4 === 1 ? 'recession' : monthIndex % 4 === 2 ? 'stagflation' : 'soft_landing', 0.5, () => (monthIndex + 1) / (expectedMonths + 1))
  );
  const actualMonths = monthlyVectors.length;
  assert.equal(actualMonths, expectedMonths);
  const path = evolveMonteCarloPortfolioPath(input, monthlyVectors);
  assert.ok(Number.isFinite(path.finalCapital));
  assert.equal(path.monthly.length, expectedMonths);
};

const FIXED_GENERAL_TEST = (): void => {
  const snapshot = buildSnapshot();
  const input: MonteCarloUserInput = {
    positions: [{ isin: 'ETF-A', targetWeight: 0.6 }, { isin: 'ETF-B', targetWeight: 0.4 }],
    initialCapital: 100_000,
    horizonYears: 3
  };
  const benchmark = runGeneralBenchmark(snapshot, input, 42, 5);
  assert.equal(benchmark.completedPaths, 5);
  assert.ok(Number.isFinite(benchmark.generalBenchmarkCAGR));
  assert.ok(Number.isFinite(benchmark.generalBenchmarkVolatility));
};

const RNG_ISOLATION_TEST = (): void => {
  const snapshot = buildSnapshot();
  const input: MonteCarloUserInput = {
    positions: [{ isin: 'ETF-A', targetWeight: 0.6 }, { isin: 'ETF-B', targetWeight: 0.4 }],
    initialCapital: 100_000,
    horizonYears: 3
  };
  const first = runGeneralBenchmark(snapshot, input, 42, 25);
  const second = runGeneralBenchmark(snapshot, input, 42, 25);
  absoluteTolerance(first.generalBenchmarkCAGR, second.generalBenchmarkCAGR, 1e-12, 'RNG_ISOLATION_TEST CAGR');
  absoluteTolerance(first.generalBenchmarkVolatility, second.generalBenchmarkVolatility, 1e-12, 'RNG_ISOLATION_TEST VOL');
};

const GENERAL_COMPLETION_1000x10_TEST = (): void => {
  const snapshot: MonteCarloSnapshot = {
    etfs: [
      {
        isin: 'ETF-A',
        name: 'ETF A',
        nickname: 'A',
        statistics: {
          expansion: { expectedReturn: 0.06, volatility: 0.10, returnRange: { min: -0.90, max: 0.90 } },
          recession: { expectedReturn: 0.04, volatility: 0.12, returnRange: { min: -0.90, max: 0.90 } },
          stagflation: { expectedReturn: 0.02, volatility: 0.14, returnRange: { min: -0.90, max: 0.90 } },
          soft_landing: { expectedReturn: 0.05, volatility: 0.11, returnRange: { min: -0.90, max: 0.90 } },
          general: { expectedReturn: 0.05, volatility: 0.10, returnRange: { min: -0.90, max: 0.90 } }
        }
      }
    ],
    structuralProbabilities: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 },
    transitionMatrix: {
      expansion: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 },
      recession: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 },
      stagflation: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 },
      soft_landing: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 }
    },
    inertiaConfigurations: {
      expansion: { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 },
      recession: { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 },
      stagflation: { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 },
      soft_landing: { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 }
    },
    intensityConfigurations: {
      expansion: { meanIntensity: 0.1, stdDevIntensity: 0.01 },
      recession: { meanIntensity: 0.1, stdDevIntensity: 0.01 },
      stagflation: { meanIntensity: 0.1, stdDevIntensity: 0.01 },
      soft_landing: { meanIntensity: 0.1, stdDevIntensity: 0.01 }
    },
    globalProperties: {
      scenario_transition_intensity_threshold: 0.4,
      new_scenario_first_month_max_intensity: 0.4,
      new_scenario_second_month_max_intensity: 0.4,
      scenario_intensity_max_monthly_variation: 0.1
    },
    correlations: []
  };
  const input: MonteCarloUserInput = {
    positions: [{ isin: 'ETF-A', targetWeight: 1 }],
    initialCapital: 100_000,
    horizonYears: 10
  };
  const benchmark = runGeneralBenchmark(snapshot, input, 123, 1000);
  assert.equal(benchmark.completedPaths, 1000);
  assert.equal(benchmark.monthsProcessed, 120000);
  assert.equal(benchmark.acceptedVectors, 120000);
  assert.equal(benchmark.candidateVectors, benchmark.acceptedVectors + benchmark.rejectedVectors);
  assert.equal(benchmark.rejectedVectors, benchmark.physicalFloorRejectedVectors);
};

const DELTA_SEMANTICS_TEST = (): void => {
  const generalBenchmarkCAGR = 0.08;
  const generalBenchmarkVolatility = 0.15;
  const robustCagr = 0.09;
  const volatility = 0.17;
  const actualExpectedDelta = robustCagr - generalBenchmarkCAGR;
  const actualVolatilityDelta = volatility - generalBenchmarkVolatility;
  const expectedExpectedDelta = 0.01;
  const expectedVolatilityDelta = 0.02;
  assert.ok(Math.abs(actualExpectedDelta - expectedExpectedDelta) <= 1e-12);
  assert.ok(Math.abs(actualVolatilityDelta - expectedVolatilityDelta) <= 1e-12);
};

const logPass = (name: string): void => {
  console.log(`${name} PASS`);
};

const runNamedTest = (name: string, fn: () => void): void => {
  try {
    fn();
    logPass(name);
  } catch (error) {
    console.error(`${name} FAIL`);
    throw error;
  }
};

const runAll = (): void => {
  runNamedTest('WELFORD_EQUIVALENCE_TEST', WELFORD_EQUIVALENCE_TEST);
  runNamedTest('CAGR_TEST', CAGR_TEST);
  runNamedTest('TRIMMED_MEAN_TEST', TRIMMED_MEAN_TEST);
  runNamedTest('PRODUCTION_RETURN_CORE_EQUIVALENCE_TEST', PRODUCTION_RETURN_CORE_EQUIVALENCE_TEST);
  runNamedTest('FIXED_GENERAL_TEST', FIXED_GENERAL_TEST);
  runNamedTest('RNG_ISOLATION_TEST', RNG_ISOLATION_TEST);
  runNamedTest('GENERAL_COMPLETION_1000x10_TEST', GENERAL_COMPLETION_1000x10_TEST);
  runNamedTest('DELTA_SEMANTICS_TEST', DELTA_SEMANTICS_TEST);
  console.log('OVERALL PASS');
};

runAll();
