import assert from 'node:assert/strict';

import { MONTE_CARLO_GLOBAL_PROPERTY_KEYS, MONTE_CARLO_SCENARIOS } from '../src/app/core/models/monte-carlo-contracts.model';
import { buildPathResult, toCompactPathResult } from '../src/app/core/engines/monte-carlo-worker';
import { MonteCarloStatisticsEngine } from '../src/app/core/engines/monte-carlo-statistics.engine';
import { prepareMonteCarloPrecomputation } from '../src/app/core/precomputation/monte-carlo-precomputation';

const strictCompare = (left: unknown, right: unknown, label: string): void => {
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (a === b) return;

    if (typeof a === 'number' && typeof b === 'number') {
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error(`${label} :: ${path} :: non-finite numeric mismatch: ${a} !== ${b}`);
      }
      if (Math.abs(a - b) > 0) {
        throw new Error(`${label} :: ${path} :: numeric mismatch: ${a} !== ${b}`);
      }
      return;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        throw new Error(`${label} :: ${path} :: array length mismatch: ${a.length} !== ${b.length}`);
      }
      for (let i = 0; i < a.length; i += 1) {
        walk(a[i], b[i], `${path}[${i}]`);
      }
      return;
    }

    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a as Record<string, unknown>);
      const bKeys = Object.keys(b as Record<string, unknown>);
      if (aKeys.length !== bKeys.length || aKeys.some((key) => !bKeys.includes(key))) {
        throw new Error(`${label} :: ${path} :: object key mismatch: ${JSON.stringify(aKeys)} !== ${JSON.stringify(bKeys)}`);
      }
      for (const key of aKeys) {
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return;
    }

    throw new Error(`${label} :: ${path} :: mismatched value: ${String(a)} !== ${String(b)}`);
  };

  walk(left, right, 'root');
};

const maxAbsDiff = (left: unknown, right: unknown): number => {
  let max = 0;
  const walk = (a: unknown, b: unknown): void => {
    if (a === b) return;
    if (typeof a === 'number' && typeof b === 'number') {
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error(`non-finite numeric in diff check: ${a} vs ${b}`);
      }
      max = Math.max(max, Math.abs(a - b));
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        throw new Error(`array length mismatch in diff check: ${a.length} !== ${b.length}`);
      }
      for (let i = 0; i < a.length; i += 1) {
        walk(a[i], b[i]);
      }
      return;
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a as Record<string, unknown>);
      const bKeys = Object.keys(b as Record<string, unknown>);
      if (aKeys.length !== bKeys.length || aKeys.some((key) => !bKeys.includes(key))) {
        throw new Error(`object key mismatch in diff check: ${JSON.stringify(aKeys)} !== ${JSON.stringify(bKeys)}`);
      }
      for (const key of aKeys) {
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
      }
      return;
    }
    throw new Error(`unsupported diff check type: ${typeof a} vs ${typeof b}`);
  };

  walk(left, right);
  return max;
};

const createValidSnapshot = (etfCount: number) => {
  const etfs = Array.from({ length: etfCount }, (_, index) => `ETF-${String(index + 1).padStart(2, '0')}`);
  return {
    etfs: etfs.map((isin, index) => ({
      isin,
      name: isin,
      nickname: null,
      statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
        expectedReturn: 0.08 + index * 0.01,
        volatility: 0.12 + index * 0.02,
        returnRange: { min: -0.2, max: 0.3 }
      }]))
    })),
    structuralProbabilities: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 },
    transitionMatrix: {
      expansion: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 },
      recession: { expansion: 0, recession: 1, stagflation: 0, soft_landing: 0 },
      stagflation: { expansion: 0, recession: 0, stagflation: 1, soft_landing: 0 },
      soft_landing: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 1 }
    },
    inertiaConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario: string) => [scenario, {
      entryProbability: 0,
      persistenceProbability: 0,
      entryMonths: 3,
      exitStartMonth: 6,
      exitDecay: 0
    }])) as any,
    intensityConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario: string) => [scenario, {
      meanIntensity: scenario === 'expansion' ? 0.8 : 0.5,
      stdDevIntensity: 0.01
    }])) as any,
    globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key: string) => [
      key,
      key === 'scenario_transition_intensity_threshold' ? 0.6 :
      key === 'new_scenario_first_month_max_intensity' ? 0.4 :
      key === 'new_scenario_second_month_max_intensity' ? 0.7 :
      key === 'scenario_intensity_max_monthly_variation' ? 0.4 :
      0.4
    ])),
    correlations: etfs.flatMap((isinA, i) => etfs.slice(i + 1).map((isinB, j) => ({
      isin1: isinA,
      isin2: isinB,
      expansion: 0.35 + (i + j) * 0.05,
      recession: 0.25 + (i + j) * 0.05,
      stagflation: 0.30 + (i + j) * 0.04,
      soft_landing: 0.20 + (i + j) * 0.04
    })))
  };
};

const makeInput = (etfs: string[], horizonYears: number, initialCapital: number) => ({
  initialCapital,
  horizonYears,
  positions: etfs.map((isin, index) => ({
    isin,
    targetWeight: 1 / etfs.length,
    minWeight: 0,
    maxWeight: 1,
    name: isin,
    priority: index
  })),
  rebalance: { enabled: true, frequencyYears: 1 }
});

const matrixFromCount = (count: number) => {
  const base = Array.from({ length: count }, (_, i) =>
    Array.from({ length: count }, (_, j) => (i === j ? 1 : 0.2 + Math.min(0.6, ((i + j) % 5) * 0.1)))
  );
  return {
    expansion: { target: base.map((row) => row.slice()), operational: base.map((row) => row.slice()), latent: base.map((row) => row.slice()) },
    recession: { target: base.map((row) => row.slice()), operational: base.map((row) => row.slice()), latent: base.map((row) => row.slice()) },
    stagflation: { target: base.map((row) => row.slice()), operational: base.map((row) => row.slice()), latent: base.map((row) => row.slice()) },
    soft_landing: { target: base.map((row) => row.slice()), operational: base.map((row) => row.slice()), latent: base.map((row) => row.slice()) }
  };
};

const observationCounts = (paths: any[]) => {
  const vectors = paths.reduce((sum, path) => sum + ((Array.isArray(path.__advancedObservationSamples) ? path.__advancedObservationSamples : []).length), 0);
  const scalars = paths.reduce((sum, path) => {
    const samples = Array.isArray(path.__advancedObservationSamples) ? path.__advancedObservationSamples : [];
    return sum + samples.reduce((acc: number, sample: any) => acc + (Array.isArray(sample.etfReturns) ? sample.etfReturns.length : 0), 0);
  }, 0);
  return { vectors, scalars };
};

const baseOptions = { weightedAverageScenarioCorrelation: 0.35, maxScenarioCorrelation: 0.6, longTermExpectedReturn: 0.06 };

const smoke1 = () => {
  const snapshot = createValidSnapshot(1);
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const input = makeInput(['ETF-01'], 10, 100000);
  const seed = 0x12345678 >>> 0;
  const path = buildPathResult(input, snapshot, precompute, 0, seed, true);
  const samples = Array.isArray(path.__advancedObservationSamples) ? path.__advancedObservationSamples : [];
  assert.equal(samples.length, 120, `expected 120 monthly advanced samples, got ${samples.length}`);
  assert.ok(samples.every((sample) => sample && Array.isArray(sample.etfReturns) && sample.etfReturns.length === 1 && sample.etfReturns.every((value) => Number.isFinite(value))), 'all samples must be finite');
  console.log(JSON.stringify({ smoke: { seed, monthlySamples: samples.length, finite: true } }, null, 2));
};

const gate2 = () => {
  const snapshot = createValidSnapshot(1);
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const input = makeInput(['ETF-01'], 10, 100000);
  const seed = 0x12345678 >>> 0;
  const paths = Array.from({ length: 1000 }, (_, index) => buildPathResult(input, snapshot, precompute, index, (seed + index) >>> 0, true));
  const compact = paths.map((path) => toCompactPathResult(path));
  const counts = observationCounts(compact);
  const result = MonteCarloStatisticsEngine.buildOfficialResult(compact, 10, input.initialCapital, baseOptions, { advancedStatisticsEnabled: true, modelMatrices: matrixFromCount(1) });
  const correlation = (result.statistics as any).correlations;
  const byScenario = correlation.byScenario;
  const byScenarioSum = MONTE_CARLO_SCENARIOS.reduce((sum: number, scenario: string) => sum + Number(byScenario[scenario].sampleCount ?? 0), 0);

  assert.equal(counts.vectors, 120000, `expected 120000 transported vectors, got ${counts.vectors}`);
  assert.equal(counts.scalars, 120000, `expected 120000 transported scalars, got ${counts.scalars}`);
  assert.equal(correlation.overall.sampleCount, 120000, `overall sampleCount expected 120000, got ${correlation.overall.sampleCount}`);
  assert.equal(byScenarioSum, 120000, `sum(byScenario.sampleCount) expected 120000, got ${byScenarioSum}`);

  console.log(JSON.stringify({
    gate2: {
      fixedSeed: seed,
      transportedVectors: counts.vectors,
      transportedScalars: counts.scalars,
      overallSampleCount: correlation.overall.sampleCount,
      expansion: byScenario.expansion.sampleCount,
      soft_landing: byScenario.soft_landing.sampleCount,
      recession: byScenario.recession.sampleCount,
      stagflation: byScenario.stagflation.sampleCount,
      byScenarioSum
    }
  }, null, 2));
};

const gate3 = () => {
  const etfs = Array.from({ length: 5 }, (_, index) => `ETF-${String(index + 1).padStart(2, '0')}`);
  const snapshot = createValidSnapshot(5);
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const input = makeInput(etfs, 10, 100000);
  const seed = 0x5a5a5a5a >>> 0;
  const paths = Array.from({ length: 1000 }, (_, index) => buildPathResult(input, snapshot, precompute, index, (seed + index) >>> 0, true));
  const compact = paths.map((path) => toCompactPathResult(path));
  const counts = observationCounts(compact);
  const result = MonteCarloStatisticsEngine.buildOfficialResult(compact, 10, input.initialCapital, baseOptions, { advancedStatisticsEnabled: true, modelMatrices: matrixFromCount(5) });
  const correlation = (result.statistics as any).correlations;
  const byScenario = correlation.byScenario;
  const byScenarioSum = MONTE_CARLO_SCENARIOS.reduce((sum: number, scenario: string) => sum + Number(byScenario[scenario].sampleCount ?? 0), 0);
  const pearson = correlation.overall.pearsonPrimary;
  const spearman = correlation.overall.spearmanDiagnostic;
  const lower = correlation.overall.lowerTailDependence5;
  const upper = correlation.overall.upperTailDependence5;

  assert.equal(counts.vectors, 120000, `expected 120000 transported vectors, got ${counts.vectors}`);
  assert.equal(counts.scalars, 600000, `expected 600000 transported scalars, got ${counts.scalars}`);
  assert.equal(correlation.overall.sampleCount, 120000, `overall sampleCount expected 120000, got ${correlation.overall.sampleCount}`);
  assert.equal(byScenarioSum, 120000, `sum(byScenario.sampleCount) expected 120000, got ${byScenarioSum}`);
  assert.equal(pearson.length, 5, `pearson expected 5 rows, got ${pearson.length}`);
  assert.equal(spearman.length, 5, `spearman expected 5 rows, got ${spearman.length}`);
  assert.equal(lower.length, 5, `lower-tail expected 5 rows, got ${lower.length}`);
  assert.equal(upper.length, 5, `upper-tail expected 5 rows, got ${upper.length}`);
  assert.ok(pearson.every((row: number[]) => row.length === 5), 'pearson must have 5 values per row');
  assert.ok(spearman.every((row: number[]) => row.length === 5), 'spearman must have 5 values per row');
  assert.ok(lower.every((row: number[]) => row.length === 5), 'lower-tail must have 5 values per row');
  assert.ok(upper.every((row: number[]) => row.length === 5), 'upper-tail must have 5 values per row');
  assert.ok(pearson.every((row: number[]) => row.every((value) => Number.isFinite(value))), 'pearson matrix must be finite');
  assert.ok(spearman.every((row: number[]) => row.every((value) => Number.isFinite(value))), 'spearman matrix must be finite');
  assert.ok(lower.every((row: number[]) => row.every((value) => Number.isFinite(value))), 'lower-tail matrix must be finite');
  assert.ok(upper.every((row: number[]) => row.every((value) => Number.isFinite(value))), 'upper-tail matrix must be finite');
  assert.ok(pearson.some((row: number[], r: number) => row.some((value, c) => r !== c && Number.isFinite(value))), 'expected at least one finite empirical off-diagonal value');

  console.log(JSON.stringify({
    gate3: {
      fixedSeed: seed,
      transportedVectors: counts.vectors,
      transportedScalars: counts.scalars,
      overallSampleCount: correlation.overall.sampleCount,
      byScenarioSum,
      pearsonDimension: `${pearson.length}x${pearson[0]?.length ?? 0}`,
      spearmanDimension: `${spearman.length}x${spearman[0]?.length ?? 0}`,
      lowerTailDimension: `${lower.length}x${lower[0]?.length ?? 0}`,
      upperTailDimension: `${upper.length}x${upper[0]?.length ?? 0}`,
      finiteMatrices: true,
      empiricalOffDiagonalPresent: true
    }
  }, null, 2));
};

const gate4 = () => {
  const snapshot = createValidSnapshot(3);
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const input = makeInput(['ETF-01', 'ETF-02', 'ETF-03'], 10, 100000);
  const seed = 0x1234abcd >>> 0;
  const off = Array.from({ length: 250 }, (_, index) => buildPathResult(input, snapshot, precompute, index, (seed + index) >>> 0, false));
  const on = Array.from({ length: 250 }, (_, index) => buildPathResult(input, snapshot, precompute, index, (seed + index) >>> 0, true));

  const pathIdentity = off.every((path, index) => path.simulationId === on[index].simulationId && path.dominantEtfIsin === on[index].dominantEtfIsin && path.initialCapital === on[index].initialCapital);
  const scenarioSequenceIdentical = off.every((path, index) => JSON.stringify(path.scenarioPath.years) === JSON.stringify(on[index].scenarioPath.years));
  const monthlyPortfolioDiff = Math.max(...off.map((path, index) => maxAbsDiff(path.monthly.map((entry) => entry.portfolioReturn), on[index].monthly.map((entry) => entry.portfolioReturn))));
  const etfMonthlyDiff = Math.max(...off.map((path, index) => {
    const left = path.monthly.flatMap((entry) => (entry as any).positions.map((position: any) => position.value));
    const right = on[index].monthly.flatMap((entry: any) => (entry as any).positions.map((position: any) => position.value));
    return maxAbsDiff(left, right);
  }));
  const monthlyCapitalDiff = Math.max(...off.map((path, index) => maxAbsDiff(path.monthly.map((entry) => entry.endingCapital), on[index].monthly.map((entry) => entry.endingCapital))));
  const finalCapitalDiff = Math.max(...off.map((path, index) => Math.abs(path.finalCapital - on[index].finalCapital)));
  const cagrDiff = Math.max(...off.map((path, index) => Math.abs(path.cagr - on[index].cagr)));
  const volatilityDiff = Math.max(...off.map((path, index) => Math.abs(MonteCarloStatisticsEngine.calculatePathVolatility(path.monthly.map((entry) => entry.portfolioReturn)) - MonteCarloStatisticsEngine.calculatePathVolatility(on[index].monthly.map((entry) => entry.portfolioReturn)))));
  const maxddDiff = Math.max(...off.map((path, index) => Math.abs(path.maxDrawdown - on[index].maxDrawdown)));
  const medianFinalCapitalDiff = Math.abs(
    [...off.map((path) => path.finalCapital)].sort((a, b) => a - b)[Math.floor(off.length / 2)] -
    [...on.map((path) => path.finalCapital)].sort((a, b) => a - b)[Math.floor(on.length / 2)]
  );
  const scenarioFrequencyMaxDiff = Math.max(
    ...MONTE_CARLO_SCENARIOS.map((scenario: string) => {
      const left = off.reduce((sum, path) => sum + (path.scenarioPath.frequencies?.[scenario] ?? 0), 0);
      const right = on.reduce((sum, path) => sum + (path.scenarioPath.frequencies?.[scenario] ?? 0), 0);
      return Math.abs(left - right);
    })
  );
  const baseFinancialMaxDiff = Math.max(monthlyPortfolioDiff, etfMonthlyDiff, monthlyCapitalDiff, finalCapitalDiff, cagrDiff, volatilityDiff, maxddDiff, medianFinalCapitalDiff, scenarioFrequencyMaxDiff);

  assert.equal(pathIdentity, true, 'path identity should be IDENTICAL');
  assert.equal(scenarioSequenceIdentical, true, 'scenario sequences should be IDENTICAL');
  assert.equal(monthlyPortfolioDiff, 0, `monthly portfolio return max diff expected 0, got ${monthlyPortfolioDiff}`);
  assert.equal(etfMonthlyDiff, 0, `ETF monthly return max diff expected 0, got ${etfMonthlyDiff}`);
  assert.equal(monthlyCapitalDiff, 0, `monthly capital max diff expected 0, got ${monthlyCapitalDiff}`);
  assert.equal(finalCapitalDiff, 0, `final capital max diff expected 0, got ${finalCapitalDiff}`);
  assert.equal(cagrDiff, 0, `CAGR diff expected 0, got ${cagrDiff}`);
  assert.equal(volatilityDiff, 0, `volatility diff expected 0, got ${volatilityDiff}`);
  assert.equal(maxddDiff, 0, `MaxDD diff expected 0, got ${maxddDiff}`);
  assert.equal(medianFinalCapitalDiff, 0, `median final capital diff expected 0, got ${medianFinalCapitalDiff}`);
  assert.equal(scenarioFrequencyMaxDiff, 0, `scenario frequency max diff expected 0, got ${scenarioFrequencyMaxDiff}`);
  assert.equal(baseFinancialMaxDiff, 0, `base financial max diff expected 0, got ${baseFinancialMaxDiff}`);

  console.log(JSON.stringify({
    gate4: {
      fixedSeed: seed,
      pathIdentity,
      scenarioSequenceIdentical,
      monthlyPortfolioReturnMaxDiff: monthlyPortfolioDiff,
      etfMonthlyReturnMaxDiff: etfMonthlyDiff,
      monthlyCapitalMaxDiff: monthlyCapitalDiff,
      finalCapitalMaxDiff: finalCapitalDiff,
      cagrDiff,
      volatilityDiff,
      maxddDiff,
      medianFinalCapitalDiff,
      scenarioFrequencyMaxDiff,
      baseFinancialMaxDiff
    }
  }, null, 2));
};

(async () => {
  smoke1();
  gate2();
  gate3();
  gate4();
  console.log('ALL_GATES_CHECKED');
})();
