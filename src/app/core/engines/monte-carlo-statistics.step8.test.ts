import assert from 'node:assert/strict';
import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';

const makePath = (simulationId: number, finalCapital: number, maxDrawdown: number, cagr: number, maxRecoveryTimeMonths: number | null, monthly: Array<{ month: number; year: number; portfolioReturn: number; endingCapital: number; capital?: number; intensity?: number; }> = []) => ({
  simulationId,
  dominantEtfIsin: 'A',
  dominantEtfName: 'A',
  initialCapital: 100,
  finalCapital,
  totalReturn: finalCapital / 100 - 1,
  cagr,
  maxDrawdown,
  maxRecoveryTimeMonths,
  unrecovered: false,
  unrecoveredDurationMonths: null,
  monthly,
  years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [], portfolioReturn: finalCapital / 100 - 1, startingCapital: 100, endingCapital: finalCapital, runningPeak: 100, drawdown: finalCapital / 100 - 1 }],
  scenarioPath: { years: [], frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } },
  portfolioSnapshot: { generatedAt: new Date().toISOString(), positions: [], totalWeightBeforeNormalization: 1, normalized: true }
} as any);

const trimMean = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.floor(sorted.length * 0.05);
  if (k === 0) return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const trimmed = sorted.slice(k, sorted.length - k);
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const fraction = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * fraction;
};

const testTrimmedMean = () => {
  const values = [-0.5, -0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
  const expected = trimMean(values);
  assert.equal(MonteCarloStatisticsEngine.calculateTrimmedMean5Percent(values), expected);
};

const testPercentiles = () => {
  const values = [0, 10, 20, 30, 40];
  assert.equal(MonteCarloStatisticsEngine.calculateLinearPercentile(values, 25), 10);
  assert.equal(MonteCarloStatisticsEngine.calculateLinearPercentile(values, 50), 20);
  assert.equal(MonteCarloStatisticsEngine.calculateLinearPercentile([0, 10, 20, 30], 50), 15);
};

const testCagrZero = () => {
  const cagr = MonteCarloStatisticsEngine.calculatePathCagr(100, 0, 5);
  assert.equal(cagr, -1);
};

const testCagrTotalReturnIdentity = () => {
  const initialCapital = 100;
  const finalCapital = 180;
  const horizonYears = 3;
  const cagr = MonteCarloStatisticsEngine.calculatePathCagr(initialCapital, finalCapital, horizonYears);
  const totalReturn = finalCapital / initialCapital - 1;
  assert.ok(Math.abs((1 + cagr) - Math.pow(1 + totalReturn, 1 / horizonYears)) < 1e-9);
};

const testRobustMaxDrawdownAndVolatility = () => {
  const monthly = [
    { month: 1, year: 1, portfolioReturn: 0.02, endingCapital: 102 },
    { month: 2, year: 1, portfolioReturn: -0.10, endingCapital: 91.8 },
    { month: 3, year: 1, portfolioReturn: 0.05, endingCapital: 96.39 },
    { month: 4, year: 1, portfolioReturn: 0.03, endingCapital: 99.30 },
    { month: 5, year: 1, portfolioReturn: 0.04, endingCapital: 103.27 },
    { month: 6, year: 1, portfolioReturn: 0.06, endingCapital: 109.47 },
  ];
  const vol = MonteCarloStatisticsEngine.calculatePathVolatility(monthly.map((entry) => entry.portfolioReturn));
  assert.ok(Number.isFinite(vol));
  assert.ok(vol > 0);
};

const testRecoveryOnlyCompleted = () => {
  const paths = [
    makePath(1, 90, 0.10, -0.10, 2, [{ month: 1, year: 1, portfolioReturn: -0.2, endingCapital: 80 }, { month: 2, year: 1, portfolioReturn: 0.25, endingCapital: 100 }]),
    makePath(2, 110, 0.20, 0.10, null, [{ month: 1, year: 1, portfolioReturn: -0.2, endingCapital: 80 }, { month: 2, year: 1, portfolioReturn: 0.1, endingCapital: 88 }]),
    makePath(3, 130, 0.30, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: -0.5, endingCapital: 50 }, { month: 2, year: 1, portfolioReturn: 0.4, endingCapital: 70 }, { month: 3, year: 1, portfolioReturn: 0.3, endingCapital: 91 }, { month: 4, year: 1, portfolioReturn: 0.4, endingCapital: 127.4 }])
  ];
  const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
  assert.equal(result.mainKpis.recoveryTimeMonths, trimMean([2, 3]));
  assert.equal(result.percentiles.recoveryTimeMonths?.p50, percentile([2, 3], 50));
};

const testP50EqualsMedianCagr = () => {
  const values = [-1, -0.2, 0.1, 0.3, 0.4];
  const median = MonteCarloStatisticsEngine.calculateMedian(values);
  const set = MonteCarloStatisticsEngine.buildPercentileSet(values);
  assert.equal(set.p50, median);
};

const testZeroAndMinus100Percentiles = () => {
  const values = [-1, 0, 0.2, 0.5];
  const set = MonteCarloStatisticsEngine.buildPercentileSet(values);
  assert.equal(set.p5, percentile(values, 5));
  assert.equal(set.p95, percentile(values, 95));
};

const testCapitalFanAndRepresentativePath = () => {
  const worstA = makePath(1, 70, 0.70, -0.20, 6, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: -0.05, endingCapital: 95 - i * 2 })));
  const worstB = makePath(2, 75, 0.75, -0.10, 4, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: -0.04, endingCapital: 96 - i * 2 })));
  const best = makePath(3, 140, 0.10, 0.40, 1, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: 0.02, endingCapital: 100 + i * 2 })));
  const median = makePath(4, 110, 0.20, 0.10, 2, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: 0.01, endingCapital: 100 + i })));
  const result = MonteCarloStatisticsEngine.buildOfficialResult([worstA, worstB, best, median], 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
  assert.ok(result.capitalFan.length === 1);
  assert.ok(result.capitalFan[0].capitalP5 <= result.capitalFan[0].capitalP50);
  assert.equal(result.representativePath.simulationId, 2);
};

const testStatisticsAndTechnicalChecks = () => {
  const paths = [
    makePath(1, 100, 0.15, 0.00, 2, [{ month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 10 }, { month: 2, year: 1, portfolioReturn: -0.01, endingCapital: 100, intensity: 30 }]),
    makePath(2, 120, 0.20, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: 0.02, endingCapital: 102, intensity: 40 }, { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 104, intensity: 50 }]),
    makePath(3, 0, 1.00, -1, null, [{ month: 1, year: 1, portfolioReturn: -1, endingCapital: 0, intensity: 90 }, { month: 2, year: 1, portfolioReturn: 0.00, endingCapital: 0, intensity: 95 }])
  ];
  const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }) as any;
  assert.ok('scenario' in result.statistics && 'intensity' in result.statistics && 'correlations' in result.statistics);
  assert.equal(result.technicalChecks.passed, true);
};

const testIntensityStatsUseDecimalBandsAndMean = () => {
  const paths = [
    makePath(1, 100, 0.15, 0.0, 2, [{ month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 0.1 }, { month: 2, year: 1, portfolioReturn: -0.01, endingCapital: 100, intensity: 0.3 }]),
    makePath(2, 120, 0.20, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: 0.02, endingCapital: 102, intensity: 0.5 }, { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 104, intensity: 0.7 }]),
    makePath(3, 0, 1.00, -1, null, [{ month: 1, year: 1, portfolioReturn: -1, endingCapital: 0, intensity: 0.9 }, { month: 2, year: 1, portfolioReturn: 0.00, endingCapital: 0, intensity: 1.0 }])
  ];
  const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }) as any;
  const distribution = result.statistics.intensity.distribution;
  const expectedMean = (0.1 + 0.3 + 0.5 + 0.7 + 0.9 + 1.0) / 6;
  assert.ok(Math.abs(distribution.mean - expectedMean) < 1e-9, `expected decimal mean ${expectedMean}, got ${distribution.mean}`);
  assert.equal(distribution.bands['0-20'], 1);
  assert.equal(distribution.bands['20-40'], 1);
  assert.equal(distribution.bands['40-60'], 1);
  assert.equal(distribution.bands['60-80'], 1);
  assert.equal(distribution.bands['80-100'], 2);
  const bandTotal = Object.values(distribution.bands as Record<string, number>).reduce((sum: number, value: number) => sum + value, 0);
  assert.equal(bandTotal, 6);
};

const testMissingKpiInputAndInvalidMaxDrawdownFailFast = () => {
  const paths = [makePath(1, 110, 0.10, 0.10, 2)];
  assert.throws(() => MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4 } as any), /longTermExpectedReturn/i);

  const badPath = makePath(1, 110, 2.0, 0.10, 2);
  assert.throws(() => MonteCarloStatisticsEngine.buildOfficialResult([badPath], 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }), /invalid maxDrawdown/i);
};

const testRecoveryZeroIsAllowedOnlyForCompletedRecovery = () => {
  const paths = [
    makePath(1, 100, 0.10, 0.00, null),
    makePath(2, 100, 0.20, 0.00, 0)
  ];
  const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }) as any;
  assert.equal(result.mainKpis.recoveryTimeMonths, 0);
};

const testCorrelationDiagnosticsAndGeneralBenchmark = () => {
  const paths = [
    makePath(1, 110, 0.10, 0.10, 2),
    makePath(2, 120, 0.20, 0.20, 3),
    makePath(3, 90, 0.30, -0.10, 4)
  ];
  const diagnostics = {
    correlations: {
      target: [[1, 0.5], [0.5, 1]],
      operational: [[1, 0.6], [0.6, 1]],
      latent: [[1, 0.4], [0.4, 1]],
      empiricalLatentShock: [[1, 0.7], [0.7, 1]],
      empiricalReturn: [[1, 0.8], [0.8, 1]],
      pearsonPrimary: [[1, 0.75], [0.75, 1]],
      spearmanDiagnostic: [[1, 0.65], [0.65, 1]],
      lowerTailDependence5: [[1, 0.2], [0.2, 1]],
      upperTailDependence5: [[1, 0.3], [0.3, 1]],
      deltas: [[0, 0.1], [0.1, 0]],
      absoluteDeltas: [[0, 0.1], [0.1, 0]],
      maeByScenario: { expansion: 0.01, recession: 0.02 },
      rmseByScenario: { expansion: 0.02, recession: 0.03 },
      maxAbsoluteErrorByScenario: { expansion: 0.04, recession: 0.05 }
    },
    generalBenchmark: {
      expectedReturn: 0.08,
      volatility: 0.12,
      simulatedLongTermReturn: 0.09,
      simulatedVolatility: 0.11
    }
  };
  const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }, diagnostics as any);
  assert.ok(Math.abs((result.statistics as any).correlations.pearsonPrimary[0][1] - 0.75) < 1e-9);
  assert.ok(Math.abs((result.statistics as any).correlations.lowerTailDependence5[0][1] - 0.2) < 1e-9);
  assert.ok(Math.abs((result.statistics as any).generalComparison.targetExpectedReturnDelta - 0.01) < 1e-9);
  assert.ok(Math.abs((result.statistics as any).generalComparison.targetVolatilityDelta + 0.01) < 1e-9);
};

const testMatricesCoherentFalseIsFalsifiable = () => {
  const paths = [makePath(1, 110, 0.10, 0.10, 2), makePath(2, 120, 0.20, 0.20, 3)];
  const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }, { matricesCoherent: false } as any);
  assert.equal(result.technicalChecks.matricesCoherent, false);
  assert.equal(result.technicalChecks.passed, false);
};

const testLargeMonthlyArrayDoesNotOverflow = () => {
  const hugeMonthly = Array.from({ length: 500_000 }, (_, index) => ({
    month: index + 1,
    year: 1,
    portfolioReturn: index % 2 === 0 ? 0.02 : -0.01,
    endingCapital: 100 + (index * 0.01),
    capital: 100 + (index * 0.01),
    intensity: 0.5
  }));
  const path = makePath(1, 100 + (hugeMonthly.length * 0.01), 0.2, 0.08, 2, hugeMonthly);
  const result = MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
  assert.ok(Number.isFinite(result.mainKpis.robustCagr));
  assert.ok(Number.isFinite(result.statistics.returns.minimumMonthlyReturn));
  assert.ok(Number.isFinite(result.statistics.returns.maximumMonthlyReturn));
};

const tests = [
  testTrimmedMean,
  testPercentiles,
  testCagrZero,
  testCagrTotalReturnIdentity,
  testRobustMaxDrawdownAndVolatility,
  testRecoveryOnlyCompleted,
  testP50EqualsMedianCagr,
  testZeroAndMinus100Percentiles,
  testCapitalFanAndRepresentativePath,
  testStatisticsAndTechnicalChecks,
  testIntensityStatsUseDecimalBandsAndMean,
  testMissingKpiInputAndInvalidMaxDrawdownFailFast,
  testRecoveryZeroIsAllowedOnlyForCompletedRecovery,
  testCorrelationDiagnosticsAndGeneralBenchmark,
  testMatricesCoherentFalseIsFalsifiable
];

for (const test of tests) {
  test();
}

console.log('Step 8 Monte Carlo aggregation tests passed.');
