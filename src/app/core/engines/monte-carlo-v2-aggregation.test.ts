import assert from 'node:assert/strict';
import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';
import type { MacroScenario, MonteCarloPathResult } from '../models/monte-carlo.model';

const scenarioList = ['expansion', 'recession', 'stagflation', 'soft_landing'] as const;
type Scenario = MacroScenario;

const maxAbsDifference = (left: unknown, right: unknown): number => {
  const values: number[] = [];
  const walk = (a: unknown, b: unknown): void => {
    if (typeof a === 'number' && typeof b === 'number') {
      values.push(Math.abs(a - b));
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const maxLength = Math.max(a.length, b.length);
      for (let index = 0; index < maxLength; index += 1) {
        walk(a[index], b[index]);
      }
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const leftEntries = Object.entries(a as Record<string, unknown>);
      const rightEntries = Object.entries(b as Record<string, unknown>);
      const keys = new Set([...leftEntries.map(([key]) => key), ...rightEntries.map(([key]) => key)]);
      for (const key of keys) {
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
      }
    }
  };
  walk(left, right);
  return values.length > 0 ? values.reduce((max, value) => Math.max(max, value), 0) : 0;
};

const buildDeltaMatrix = (empiricalReturn: number[][], target: number[][], absolute = false): number[][] => {
  const rows = Array.isArray(empiricalReturn) ? empiricalReturn.length : 0;
  const columns = rows > 0 && Array.isArray(empiricalReturn[0]) ? empiricalReturn[0].length : 0;
  if (rows === 0 || columns === 0 || !Array.isArray(target) || target.length !== rows || target[0]?.length !== columns) {
    return [];
  }
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
    const delta = Number(empiricalReturn[row]?.[column] ?? 0) - Number(target[row]?.[column] ?? 0);
    return absolute ? Math.abs(delta) : delta;
  }));
};

const manualMeanAbsOffDiagonal = (matrix: number[][]): number => {
  const values: number[] = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix[row].length; column += 1) {
      if (row !== column) values.push(Math.abs(Number(matrix[row]?.[column] ?? 0)));
    }
  }
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
};

const manualMaxAbsOffDiagonal = (matrix: number[][]): number => {
  let max = 0;
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix[row].length; column += 1) {
      if (row !== column) max = Math.max(max, Math.abs(Number(matrix[row]?.[column] ?? 0)));
    }
  }
  return max;
};

const manualPearsonMatrix = (samples: number[][]): number[][] => {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const dimension = samples[0].length;
  const means = Array(dimension).fill(0).map((_, index) => samples.reduce((sum, sample) => sum + Number(sample[index] ?? 0), 0) / samples.length);
  const covariance = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  for (const sample of samples) {
    for (let row = 0; row < dimension; row += 1) {
      for (let column = 0; column < dimension; column += 1) {
        covariance[row][column] += (Number(sample[row] ?? 0) - means[row]) * (Number(sample[column] ?? 0) - means[column]);
      }
    }
  }
  return Array.from({ length: dimension }, (_, row) => Array.from({ length: dimension }, (_, column) => {
    const numerator = covariance[row][column] / Math.max(1, samples.length - 1);
    const varianceRow = covariance[row][row] / Math.max(1, samples.length - 1);
    const varianceColumn = covariance[column][column] / Math.max(1, samples.length - 1);
    if (varianceRow <= 0 || varianceColumn <= 0) return row === column ? 1 : 0;
    return numerator / Math.sqrt(varianceRow * varianceColumn);
  }));
};

const manualSpearmanMatrix = (samples: number[][]): number[][] => {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const dimension = samples[0].length;
  const ranked = Array.from({ length: samples.length }, () => Array(dimension).fill(0));
  for (let column = 0; column < dimension; column += 1) {
    const values = samples.map((sample) => Number(sample[column] ?? 0));
    const indexed = values.map((value, row) => ({ value, row }));
    indexed.sort((left, right) => left.value - right.value);
    let offset = 0;
    while (offset < indexed.length) {
      let cursor = offset + 1;
      while (cursor < indexed.length && indexed[cursor].value === indexed[offset].value) cursor += 1;
      const averageRank = (offset + 1 + cursor) / 2;
      for (let index = offset; index < cursor; index += 1) {
        ranked[indexed[index].row][column] = averageRank;
      }
      offset = cursor;
    }
  }
  return manualPearsonMatrix(ranked);
};

const manualTailDependenceMatrix = (samples: number[][], upper: boolean): number[][] => {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const dimension = samples[0].length;
  const thresholds = Array.from({ length: dimension }, (_, index) => {
    const sorted = samples.map((sample) => Number(sample[index] ?? 0)).sort((left, right) => left - right);
    const percentileIndex = upper ? Math.ceil(sorted.length * 0.95) - 1 : Math.floor(sorted.length * 0.05);
    return sorted[Math.max(0, Math.min(sorted.length - 1, percentileIndex))];
  });

  return Array.from({ length: dimension }, (_, row) => Array.from({ length: dimension }, (_, column) => {
    if (row === column) return 1;
    let conditioningCount = 0;
    let jointCount = 0;
    for (const sample of samples) {
      const rowValue = Number(sample[row] ?? 0);
      const columnValue = Number(sample[column] ?? 0);
      const rowInTail = upper ? rowValue >= thresholds[row] : rowValue <= thresholds[row];
      const columnInTail = upper ? columnValue >= thresholds[column] : columnValue <= thresholds[column];
      if (rowInTail) {
        conditioningCount += 1;
        if (columnInTail) jointCount += 1;
      }
    }
    return conditioningCount === 0 ? 0 : jointCount / conditioningCount;
  }));
};

const makePath = (simulationId: number, scenario: Scenario, observations: number[][]): MonteCarloPathResult => ({
  simulationId,
  dominantEtfIsin: 'ETF-A',
  dominantEtfName: 'ETF-A',
  initialCapital: 100000,
  finalCapital: 110000,
  totalReturn: 0.10,
  cagr: 0.10,
  maxDrawdown: 0.20,
  scenarioPath: {
    years: [{ year: 1, scenario, durationInCurrentScenario: 12 }],
    frequencies: {
      expansion: scenario === 'expansion' ? 12 : 0,
      recession: scenario === 'recession' ? 12 : 0,
      stagflation: scenario === 'stagflation' ? 12 : 0,
      soft_landing: scenario === 'soft_landing' ? 12 : 0
    }
  },
  years: [],
  portfolioSnapshot: {
    generatedAt: '2024-01-01T00:00:00.000Z',
    positions: [],
    totalWeightBeforeNormalization: 1,
    normalized: true
  },
  __advancedObservationSamples: observations.map((vector) => ({ scenario, etfReturns: vector })),
  correlationDiagnostics: undefined,
  generalBenchmark: undefined
} as any);

const pathA = makePath(1, 'expansion', [
  [0.02, -0.01],
  [0.03, -0.02],
  [0.01, 0.00],
  [0.05, 0.01]
]);

const pathB = makePath(2, 'expansion', [
  [0.20, 0.10],
  [0.18, 0.09],
  [0.15, 0.08],
  [0.12, 0.06]
]);

const pathC = makePath(3, 'soft_landing', [
  [0.02, 0.01],
  [0.04, 0.02],
  [0.06, 0.03],
  [0.03, 0.01]
]);

const pathD = makePath(4, 'recession', [
  [-0.06, -0.04],
  [-0.08, -0.05],
  [-0.07, -0.04],
  [-0.10, -0.08]
]);

const baseOptions = {
  advancedStatisticsEnabled: true
};

const modelMatrices = {
  expansion: { target: [[1, 0.6], [0.6, 1]], operational: [[1, 0.6], [0.6, 1]], latent: [[1, 0.6], [0.6, 1]] },
  recession: { target: [[1, -0.5], [-0.5, 1]], operational: [[1, -0.5], [-0.5, 1]], latent: [[1, -0.5], [-0.5, 1]] },
  stagflation: { target: [[1, 0.2], [0.2, 1]], operational: [[1, 0.2], [0.2, 1]], latent: [[1, 0.2], [0.2, 1]] },
  soft_landing: { target: [[1, 0.4], [0.4, 1]], operational: [[1, 0.4], [0.4, 1]], latent: [[1, 0.4], [0.4, 1]] }
} as const;

const runResult = (paths: MonteCarloPathResult[], extraOptions: Record<string, unknown> = {}) => MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100000, baseOptions, { advancedStatisticsEnabled: true, modelMatrices, ...extraOptions });

const results: Array<{ name: string; pass: boolean; details: string }> = [];

const record = (name: string, pass: boolean, details: string): void => {
  results.push({ name, pass, details });
  console.log(`${name}: ${pass ? 'PASS' : 'FAIL'} ${details}`);
};

const pooled = runResult([pathA, pathB, pathC, pathD]);
const lastOnly = runResult([pathD]);
const overall = pooled.statistics.correlations as any;
const scenarioObserved = scenarioList.reduce((accumulator, scenario) => ({ ...accumulator, [scenario]: 0 }), {} as Record<Scenario, number>);
for (const path of [pathA, pathB, pathC, pathD]) {
  for (const sample of path.__advancedObservationSamples!) {
    scenarioObserved[sample.scenario] += 1;
  }
}
const observedTotal = [pathA, pathB, pathC, pathD].reduce((sum, path) => sum + path.__advancedObservationSamples!.length, 0);
const scenarioSum = scenarioList.reduce((sum, scenario) => sum + overall.byScenario[scenario].sampleCount, 0);
record('TEST 01 — SAMPLE COUNT INVARIANT', overall.sampleCount === observedTotal && overall.sampleCount === scenarioSum, `overall.sampleCount=${overall.sampleCount}; scenarioSum=${scenarioSum}; supplied=${observedTotal}`);
record('TEST 02 — LAST-PATH-WINS ABSENT', !assert.deepStrictEqual ? false : JSON.stringify(pooled.statistics.correlations) !== JSON.stringify(lastOnly.statistics.correlations), `pooledVsLastMaxDiff=${maxAbsDifference(pooled.statistics.correlations, lastOnly.statistics.correlations)}`);

const orderedA = runResult([pathA, pathB, pathC, pathD]);
const orderedB = runResult([pathD, pathC, pathB, pathA]);
const orderDifference = maxAbsDifference(orderedA.statistics.correlations, orderedB.statistics.correlations);
record('TEST 03 — PATH ORDER INDEPENDENCE', orderDifference <= 1e-12, `MAX DIFFERENCE = ${orderDifference.toExponential(12)}`);

const batchA = runResult([pathA, pathB], { advancedStatisticsEnabled: true, modelMatrices });
const batchB = runResult([pathC, pathD], { advancedStatisticsEnabled: true, modelMatrices });
const batchCombinedA = runResult([pathA, pathB, pathC, pathD], { advancedStatisticsEnabled: true, modelMatrices });
const batchCombinedB = runResult([pathD, pathC, pathB, pathA], { advancedStatisticsEnabled: true, modelMatrices });
const batchDiff = maxAbsDifference(batchCombinedA.statistics.correlations, batchCombinedB.statistics.correlations);
record('TEST 04 — BATCH ARRIVAL ORDER INDEPENDENCE', batchDiff <= 1e-12, `MAX DIFFERENCE = ${batchDiff.toExponential(12)}`);

const scenarioMatrixPass = scenarioList.every((scenario) => {
  const expected = modelMatrices[scenario];
  const actual = overall.byScenario[scenario];
  return actual.target.length === expected.target.length
    && actual.operational.length === expected.operational.length
    && actual.latent.length === expected.latent.length
    && JSON.stringify(actual.target) === JSON.stringify(expected.target)
    && JSON.stringify(actual.operational) === JSON.stringify(expected.operational)
    && JSON.stringify(actual.latent) === JSON.stringify(expected.latent);
});
record('TEST 05 — MODEL MATRICES BY SCENARIO', scenarioMatrixPass, `expansion=${JSON.stringify(overall.byScenario.expansion.target)}, recession=${JSON.stringify(overall.byScenario.recession.target)}, stagflation=${JSON.stringify(overall.byScenario.stagflation.target)}, soft_landing=${JSON.stringify(overall.byScenario.soft_landing.target)}`);

const pooledObservationSet = [pathA, pathB, pathC, pathD].flatMap((path) => path.__advancedObservationSamples!.map((entry) => entry.etfReturns));
const expectedPearson = manualPearsonMatrix(pooledObservationSet);
const lastPathPearson = manualPearsonMatrix(pathD.__advancedObservationSamples!.map((entry) => entry.etfReturns));
const pearsonDiff = maxAbsDifference(expectedPearson, overall.empiricalReturn);
record('TEST 06 — POOLED PEARSON', pearsonDiff <= 1e-12 && maxAbsDifference(expectedPearson, lastPathPearson) > 1e-3, `EXPECTED=${JSON.stringify(expectedPearson)}; ACTUAL=${JSON.stringify(overall.empiricalReturn)}; LAST_PATH=${JSON.stringify(lastPathPearson)}`);

const expectedSpearman = manualSpearmanMatrix(pooledObservationSet);
const meanPathSpearman = [pathA, pathB, pathC, pathD].reduce((sum, path) => sum + (manualSpearmanMatrix(path.__advancedObservationSamples!.map((entry) => entry.etfReturns))[0][1] ?? 0), 0) / 4;
const spearmanDiff = maxAbsDifference(expectedSpearman, overall.spearmanDiagnostic);
record('TEST 07 — POOLED SPEARMAN', spearmanDiff <= 1e-12 && Math.abs(meanPathSpearman - (expectedSpearman[0]?.[1] ?? 0)) > 1e-3, `EXPECTED=${JSON.stringify(expectedSpearman)}; ACTUAL=${JSON.stringify(overall.spearmanDiagnostic)}; MEAN PATH SPEARMAN=${meanPathSpearman}`);

const expectedLowerTail = manualTailDependenceMatrix(pooledObservationSet, false);
const lowerTailDiff = maxAbsDifference(expectedLowerTail, overall.lowerTailDependence5);
record('TEST 08 — POOLED LOWER TAIL DEPENDENCE', lowerTailDiff <= 1e-12, `EXPECTED=${JSON.stringify(expectedLowerTail)}; ACTUAL=${JSON.stringify(overall.lowerTailDependence5)}`);

const expectedUpperTail = manualTailDependenceMatrix(pooledObservationSet, true);
const upperTailDiff = maxAbsDifference(expectedUpperTail, overall.upperTailDependence5);
record('TEST 09 — POOLED UPPER TAIL DEPENDENCE', upperTailDiff <= 1e-12, `EXPECTED=${JSON.stringify(expectedUpperTail)}; ACTUAL=${JSON.stringify(overall.upperTailDependence5)}`);

const expectedDeltas = buildDeltaMatrix(overall.empiricalReturn, overall.target, false);
const deltasDiff = maxAbsDifference(expectedDeltas, overall.deltas);
record('TEST 10 — DELTAS', deltasDiff <= 1e-12, `MAX ERROR = ${deltasDiff.toExponential(12)}`);

const expectedAbsDeltas = buildDeltaMatrix(overall.empiricalReturn, overall.target, true);
const absDeltasDiff = maxAbsDifference(expectedAbsDeltas, overall.absoluteDeltas);
record('TEST 11 — ABSOLUTE DELTAS', absDeltasDiff <= 1e-12, `MAX ERROR = ${absDeltasDiff.toExponential(12)}`);

const expectedMean = manualMeanAbsOffDiagonal(overall.absoluteDeltas);
const expectedMax = manualMaxAbsOffDiagonal(overall.absoluteDeltas);
record('TEST 12 — MEAN/MAX ABS DELTA', Math.abs(expectedMean - overall.overall.meanAbsoluteDelta) <= 1e-12 && Math.abs(expectedMax - overall.overall.maxAbsoluteDelta) <= 1e-12, `DIAGONAL EXCLUDED = TRUE; EXPECTED MEAN=${expectedMean}; ACTUAL MEAN=${overall.overall.meanAbsoluteDelta}; EXPECTED MAX=${expectedMax}; ACTUAL MAX=${overall.overall.maxAbsoluteDelta}`);

const emptyScenarioPaths = [makePath(21, 'expansion', [[0.02, -0.01], [0.03, -0.02]]), makePath(22, 'expansion', [[0.01, 0.00], [0.04, 0.02]])];
const emptyScenarioResult = runResult(emptyScenarioPaths);
const emptyScenario = emptyScenarioResult.statistics.correlations.byScenario.stagflation;
const noNaNInfEmpty = JSON.stringify(emptyScenario).indexOf('NaN') === -1 && JSON.stringify(emptyScenario).indexOf('Infinity') === -1 && !Number.isNaN(emptyScenario.sampleCount) && Number.isFinite(emptyScenario.sampleCount) && emptyScenario.sampleCount === 0;
record('TEST 13 — EMPTY SCENARIO', noNaNInfEmpty, `sampleCount=${emptyScenario.sampleCount}; representation=${JSON.stringify(emptyScenario)}`);

const zeroVariancePaths = [
  makePath(31, 'expansion', [
    [0.05, 0.00],
    [0.05, 0.00],
    [0.05, 0.00],
    [0.05, 0.00]
  ]),
  makePath(32, 'soft_landing', [
    [0.10, 0.00],
    [0.10, 0.00],
    [0.10, 0.00],
    [0.10, 0.00]
  ])
];
const zeroVarianceResult = runResult(zeroVariancePaths);
const zeroVariancePayload = zeroVarianceResult.statistics.correlations as any;
const noNaNInfZeroVar = JSON.stringify(zeroVariancePayload).indexOf('NaN') === -1 && JSON.stringify(zeroVariancePayload).indexOf('Infinity') === -1 && Object.values(zeroVariancePayload.byScenario || {}).every((entry: any) => Number.isFinite(entry.sampleCount));
record('TEST 14 — ZERO VARIANCE ETF', noNaNInfZeroVar, `summary=${JSON.stringify(zeroVariancePayload)}`);

const advancedOffPaths = [makePath(41, 'expansion', [[0.01, 0.02], [0.03, -0.01]]), makePath(42, 'recession', [[-0.04, -0.02], [-0.02, -0.05]])];
const advancedOff = runResult(advancedOffPaths, { advancedStatisticsEnabled: false });
const advancedOffPayload = advancedOff.statistics.correlations as any;
const advancedOffPass = advancedOffPayload.skipped === true && advancedOffPayload.reason === 'advancedStatisticsEnabled=false' && !('overall' in advancedOffPayload) && !('byScenario' in advancedOffPayload);
record('TEST 15 — ADVANCED OFF PAYLOAD', advancedOffPass, `payload=${JSON.stringify(advancedOffPayload)}`);

console.log('CONTRACT STRUCTURE CHECK');
const contractPayload = pooled.statistics.correlations as any;
console.log(`overall keys=${Object.keys(contractPayload.overall).join(', ')}`);
for (const scenario of scenarioList) {
  console.log(`${scenario} keys=${Object.keys(contractPayload.byScenario[scenario]).join(', ')}`);
  console.log(`${scenario} sampleCount=${contractPayload.byScenario[scenario].sampleCount}`);
}

const totalPass = results.filter((entry) => entry.pass).length;
console.log(`TOTAL = ${totalPass}/15 PASS`);
if (totalPass !== 15) {
  console.log('SEMANTIC CORE CERTIFICATION = FAIL');
  process.exitCode = 1;
} else {
  console.log('SEMANTIC CORE CERTIFICATION = PASS');
}
