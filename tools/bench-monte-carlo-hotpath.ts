import { performance } from 'node:perf_hooks';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  MonteCarloScenario,
  MonteCarloSnapshot
} from '../src/app/core/models/monte-carlo-contracts.model';
import { prepareMonteCarloPrecomputation } from '../src/app/core/precomputation/monte-carlo-precomputation';
import {
  __debugAcceptTrace,
  __debugAllAttemptTrace,
  __debugRejectTrace,
  generateMonthlyReturnVector,
  MAX_REDRAWS
} from '../src/app/core/returns/monte-carlo-return-engine';
import {
  COPULA_EPSILON,
  sampleChiSquare5,
  sampleStandardNormal,
  studentTCdf,
  studentTQuantile,
  STUDENT_T_STANDARDIZATION,
  UniformRandomSource
} from '../src/app/core/probability/monte-carlo-probability';

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
};

const clearDebugTraceBuckets = (): void => {
  __debugRejectTrace.length = 0;
  __debugAcceptTrace.length = 0;
  __debugAllAttemptTrace.length = 0;
};

const stats = (values: number[]) => ({
  min: Math.min(...values),
  median: median(values),
  max: Math.max(...values)
});

const makeLcg = (seed: number): UniformRandomSource => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const makeSeededVector = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const createSnapshot = (): MonteCarloSnapshot => ({
  etfs: [
    {
      isin: 'ETF-A',
      name: 'ETF-A',
      nickname: null,
      statistics: {
        expansion: { expectedReturn: 0.08, volatility: 0.13, returnRange: { min: -0.2, max: 0.25 } },
        recession: { expectedReturn: -0.05, volatility: 0.17, returnRange: { min: -0.35, max: 0.1 } },
        stagflation: { expectedReturn: -0.02, volatility: 0.18, returnRange: { min: -0.3, max: 0.12 } },
        soft_landing: { expectedReturn: 0.06, volatility: 0.12, returnRange: { min: -0.15, max: 0.2 } },
        general: { expectedReturn: 0.06, volatility: 0.15, returnRange: { min: -0.25, max: 0.2 } }
      }
    },
    {
      isin: 'ETF-B',
      name: 'ETF-B',
      nickname: null,
      statistics: {
        expansion: { expectedReturn: 0.09, volatility: 0.15, returnRange: { min: -0.18, max: 0.26 } },
        recession: { expectedReturn: -0.04, volatility: 0.18, returnRange: { min: -0.32, max: 0.11 } },
        stagflation: { expectedReturn: -0.01, volatility: 0.17, returnRange: { min: -0.28, max: 0.13 } },
        soft_landing: { expectedReturn: 0.07, volatility: 0.13, returnRange: { min: -0.12, max: 0.22 } },
        general: { expectedReturn: 0.07, volatility: 0.16, returnRange: { min: -0.24, max: 0.22 } }
      }
    },
    {
      isin: 'ETF-C',
      name: 'ETF-C',
      nickname: null,
      statistics: {
        expansion: { expectedReturn: 0.07, volatility: 0.14, returnRange: { min: -0.16, max: 0.24 } },
        recession: { expectedReturn: -0.03, volatility: 0.16, returnRange: { min: -0.3, max: 0.1 } },
        stagflation: { expectedReturn: -0.01, volatility: 0.16, returnRange: { min: -0.29, max: 0.11 } },
        soft_landing: { expectedReturn: 0.05, volatility: 0.11, returnRange: { min: -0.14, max: 0.18 } },
        general: { expectedReturn: 0.05, volatility: 0.14, returnRange: { min: -0.22, max: 0.18 } }
      }
    }
  ],
  structuralProbabilities: {
    expansion: 0.45,
    recession: 0.2,
    stagflation: 0.15,
    soft_landing: 0.2
  },
  transitionMatrix: {
    expansion: { expansion: 0.6, recession: 0.1, stagflation: 0.1, soft_landing: 0.2 },
    recession: { expansion: 0.25, recession: 0.2, stagflation: 0.1, soft_landing: 0.45 },
    stagflation: { expansion: 0.2, recession: 0.2, stagflation: 0.3, soft_landing: 0.3 },
    soft_landing: { expansion: 0.35, recession: 0.25, stagflation: 0.1, soft_landing: 0.3 }
  },
  inertiaConfigurations: {
    expansion: { entryProbability: 0.2, persistenceProbability: 0.75, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    recession: { entryProbability: 0.25, persistenceProbability: 0.7, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    stagflation: { entryProbability: 0.3, persistenceProbability: 0.68, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    soft_landing: { entryProbability: 0.2, persistenceProbability: 0.8, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 }
  },
  intensityConfigurations: {
    expansion: { meanIntensity: 0.35, stdDevIntensity: 0.12 },
    recession: { meanIntensity: 0.55, stdDevIntensity: 0.15 },
    stagflation: { meanIntensity: 0.47, stdDevIntensity: 0.14 },
    soft_landing: { meanIntensity: 0.3, stdDevIntensity: 0.1 }
  },
  globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [key, 0.4])) as MonteCarloSnapshot['globalProperties'],
  correlations: [
    { isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.35, recession: 0.42, stagflation: 0.4, soft_landing: 0.38 },
    { isin1: 'ETF-A', isin2: 'ETF-C', expansion: 0.3, recession: 0.36, stagflation: 0.34, soft_landing: 0.32 },
    { isin1: 'ETF-B', isin2: 'ETF-C', expansion: 0.32, recession: 0.38, stagflation: 0.36, soft_landing: 0.34 }
  ]
});

const clampedLookupCurve = (curve: Array<{ intensity: number; muMonthly: number }>, intensity: number): number => {
  const clampedIntensity = Math.min(1, Math.max(0, intensity));
  if (clampedIntensity === 0) return curve[0].muMonthly;
  if (clampedIntensity === 1) return curve[curve.length - 1].muMonthly;
  let left = curve[0];
  let right = curve[curve.length - 1];
  for (let index = 1; index < curve.length; index += 1) {
    const current = curve[index];
    if (current.intensity >= clampedIntensity) {
      left = curve[index - 1];
      right = current;
      break;
    }
  }
  const span = right.intensity - left.intensity || 1;
  const weight = (clampedIntensity - left.intensity) / span;
  return left.muMonthly + weight * (right.muMonthly - left.muMonthly);
};

const directIndexedLookupEquivalent = (curve: Array<{ intensity: number; muMonthly: number }>, intensity: number): number => {
  const clampedIntensity = Math.min(1, Math.max(0, intensity));
  if (clampedIntensity === 0) return curve[0].muMonthly;
  if (clampedIntensity === 1) return curve[curve.length - 1].muMonthly;
  const index = Math.min(curve.length - 2, Math.max(0, Math.floor(clampedIntensity / 0.01)));
  const left = curve[index];
  const right = curve[index + 1];
  const span = right.intensity - left.intensity || 1;
  const weight = (clampedIntensity - left.intensity) / span;
  return left.muMonthly + weight * (right.muMonthly - left.muMonthly);
};

const clampCopulaProbability = (probability: number): number => {
  if (!Number.isFinite(probability)) throw new Error('INVALID_COPULA_PROBABILITY');
  return Math.min(1 - COPULA_EPSILON, Math.max(COPULA_EPSILON, probability));
};

const multiplyMatrixVector = (matrix: number[][], vector: number[]): number[] => matrix.map((row) =>
  row.reduce((sum, value, index) => sum + value * vector[index], 0)
);

const generateMonthlyReturnVectorNoRangeDiagnostic = (
  snapshot: MonteCarloSnapshot,
  precomputation: ReturnType<typeof prepareMonteCarloPrecomputation>,
  scenario: MonteCarloScenario,
  intensity: number,
  random: UniformRandomSource
) => {
  const matrixPreparation = precomputation.correlationMatrices[scenario];
  if (!matrixPreparation) throw new Error('MISSING_CORRELATION_MATRIX');
  const { assetIsins, factor, originalMatrix, operationalMatrix } = matrixPreparation;
  if (assetIsins.length !== snapshot.etfs.length) throw new Error('SNAPSHOT_PRECOMPUTATION_MISMATCH');

  const effectiveParameters = assetIsins.map((isin) => {
    const parameters = precomputation.etfParameters[isin]?.[scenario];
    if (!parameters) throw new Error(`MISSING_PRECOMPUTED_ETF_PARAMETERS:${isin}`);
    const baselineMonthlyExpectedReturn = parameters.generalMonthlyExpectedReturn ?? parameters.monthlyExpectedReturn;
    const baselineMonthlyVolatility = parameters.generalMonthlyVolatility ?? parameters.monthlyVolatility;
    const effectiveMu = clampedLookupCurve(parameters.muCalibrationByIntensity, intensity);
    const effectiveSigma = baselineMonthlyVolatility + intensity * (parameters.monthlyVolatility - baselineMonthlyVolatility);
    const reconstructedReturnRange = {
      min: effectiveMu + (parameters.zMin ?? 0) * effectiveSigma,
      max: effectiveMu + (parameters.zMax ?? 0) * effectiveSigma
    };
    const scenarioMonthlyReturnRange = { min: parameters.monthlyRangeMin, max: parameters.monthlyRangeMax };
    const effectiveReturnRange = {
      min: Math.max(reconstructedReturnRange.min, scenarioMonthlyReturnRange.min),
      max: Math.min(reconstructedReturnRange.max, scenarioMonthlyReturnRange.max)
    };
    return {
      effectiveMu,
      effectiveSigma,
      scenarioMonthlyReturnRange,
      reconstructedReturnRange,
      effectiveReturnRange
    };
  });

  let acceptedVectors = 0;
  let rejectedVectors = 0;
  let physicalFloorRejectedVectors = 0;
  const rejectedChiSquares: number[] = [];

  for (let attempt = 1; attempt <= MAX_REDRAWS; attempt += 1) {
    const independentNormals = assetIsins.map(() => sampleStandardNormal(random));
    const correlatedNormals = multiplyMatrixVector(factor, independentNormals);
    const commonChiSquare = sampleChiSquare5(random);
    const standardizedShocks = correlatedNormals.map((normal) => {
      const correlatedT = normal / Math.sqrt(commonChiSquare / 5);
      const probability = clampCopulaProbability(studentTCdf(correlatedT));
      const shock = studentTQuantile(probability) * STUDENT_T_STANDARDIZATION;
      if (!Number.isFinite(shock)) throw new Error('INVALID_STUDENT_T_SHOCK');
      return shock;
    });
    const monthlyReturns = effectiveParameters.map((parameters, index) => parameters.effectiveMu + parameters.effectiveSigma * standardizedShocks[index]);
    const perEtfStatus = assetIsins.map((isin, index) => {
      const parameters = effectiveParameters[index];
      const candidateReturn = monthlyReturns[index];
      const physicalFloorViolation = candidateReturn < -1;
      return {
        isin,
        index,
        shock: standardizedShocks[index],
        candidateReturn,
        effectiveMin: parameters.effectiveReturnRange.min,
        effectiveMax: parameters.effectiveReturnRange.max,
        accepted: Number.isFinite(candidateReturn) && candidateReturn >= -1,
        physicalFloorViolation
      };
    });
    const vectorRejected = perEtfStatus.some((entry) => entry.physicalFloorViolation);
    if (vectorRejected) {
      rejectedChiSquares.push(commonChiSquare);
      rejectedVectors += 1;
      physicalFloorRejectedVectors += 1;
      continue;
    }
    acceptedVectors += 1;
    const etfReturns = assetIsins.map((isin, index) => ({
      isin,
      effectiveParameters: effectiveParameters[index],
      standardizedShock: standardizedShocks[index],
      monthlyReturn: monthlyReturns[index]
    }));
    return {
      scenario,
      intensity,
      etfReturns,
      diagnostics: {
        attempts: attempt,
        rejectedAttempts: rejectedChiSquares.length,
        acceptedChiSquare: commonChiSquare,
        rejectedChiSquares,
        targetCorrelation: originalMatrix,
        operationalCorrelation: operationalMatrix,
        latentCorrelation: operationalMatrix
      }
    };
  }
  throw new Error('MAX_REDRAWS_EXCEEDED');
};

const runBench = (label: string, fn: () => void, iterations: number): number[] => {
  const values: number[] = [];
  for (let repeat = 0; repeat < 5; repeat += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) fn();
    values.push(performance.now() - start);
  }
  const result = stats(values);
  console.log(`${label}: min=${result.min.toFixed(3)}ms median=${result.median.toFixed(3)}ms max=${result.max.toFixed(3)}ms`);
  return values;
};

const benchmarkLookup = () => {
  const snapshot = createSnapshot();
  const pre = prepareMonteCarloPrecomputation(snapshot);
  const curve = pre.etfParameters['ETF-A'].expansion.muCalibrationByIntensity;

  const warmup = 10000;
  for (let index = 0; index < warmup; index += 1) {
    const value = (index % 100001) / 100000;
    clampedLookupCurve(curve, value);
    directIndexedLookupEquivalent(curve, value);
  }

  const targetCounts = [100000, 1000000, 3600000];
  const results: Record<string, { current: number[]; direct: number[] }> = {};

  for (const count of targetCounts) {
    const runCurrent = () => {
      let total = 0;
      for (let index = 0; index < count; index += 1) {
        const intensity = (index % 100001) / 100000;
        total += clampedLookupCurve(curve, intensity);
      }
      return total;
    };
    const runDirect = () => {
      let total = 0;
      for (let index = 0; index < count; index += 1) {
        const intensity = (index % 100001) / 100000;
        total += directIndexedLookupEquivalent(curve, intensity);
      }
      return total;
    };

    const currentValues: number[] = [];
    const directValues: number[] = [];
    for (let repeat = 0; repeat < 5; repeat += 1) {
      const start = performance.now();
      runCurrent();
      currentValues.push(performance.now() - start);
      const directStart = performance.now();
      runDirect();
      directValues.push(performance.now() - directStart);
    }
    results[`count_${count}`] = { current: currentValues, direct: directValues };
    console.log(`LOOKUP_${count} current: ${stats(currentValues).median.toFixed(3)}ms`);
    console.log(`LOOKUP_${count} direct: ${stats(directValues).median.toFixed(3)}ms`);
  }

  let maxDifference = 0;
  let totalDifference = 0;
  let count = 0;
  for (let index = 0; index <= 100000; index += 1) {
    const intensity = index / 100000;
    const difference = Math.abs(clampedLookupCurve(curve, intensity) - directIndexedLookupEquivalent(curve, intensity));
    maxDifference = Math.max(maxDifference, difference);
    totalDifference += difference;
    count += 1;
  }

  return {
    curveLength: curve.length,
    results,
    maxDifference,
    meanDifference: totalDifference / count
  };
};

const benchmarkPrecompute = () => {
  const snapshot = createSnapshot();
  const values: number[] = [];
  for (let repeat = 0; repeat < 5; repeat += 1) {
    const start = performance.now();
    prepareMonteCarloPrecomputation(snapshot);
    values.push(performance.now() - start);
  }
  return stats(values);
};

const benchmarkFullVectors = () => {
  const snapshot = createSnapshot();
  const pre = prepareMonteCarloPrecomputation(snapshot);
  const values10k: number[] = [];
  const values100k: number[] = [];
  for (let repeat = 0; repeat < 5; repeat += 1) {
    clearDebugTraceBuckets();
    const start10k = performance.now();
    for (let index = 0; index < 10000; index += 1) {
      generateMonthlyReturnVector(snapshot, pre, 'expansion', 0.55, makeLcg(0x12345678 + index + repeat * 101));
    }
    values10k.push(performance.now() - start10k);
    clearDebugTraceBuckets();

    const start100k = performance.now();
    for (let index = 0; index < 100000; index += 1) {
      generateMonthlyReturnVector(snapshot, pre, 'expansion', 0.55, makeLcg(0x12345678 + index + repeat * 101));
    }
    values100k.push(performance.now() - start100k);
    clearDebugTraceBuckets();
  }

  return {
    tenK: stats(values10k),
    hundredK: stats(values100k),
    usPerVector: (stats(values100k).median / 100000) * 1000
  };
};

const benchmarkRangeDiagnosticAblation = () => {
  const snapshot = createSnapshot();
  const pre = prepareMonteCarloPrecomputation(snapshot);
  const currentRandom = makeSeededVector(0x31415926);
  const currentResult = generateMonthlyReturnVector(snapshot, pre, 'expansion', 0.55, currentRandom);
  const noDiagnosticRandom = makeSeededVector(0x31415926);
  const noDiagnosticResult = generateMonthlyReturnVectorNoRangeDiagnostic(snapshot, pre, 'expansion', 0.55, noDiagnosticRandom);

  let maxMonthlyReturnDifference = 0;
  for (let index = 0; index < currentResult.etfReturns.length; index += 1) {
    maxMonthlyReturnDifference = Math.max(maxMonthlyReturnDifference, Math.abs(currentResult.etfReturns[index].monthlyReturn - noDiagnosticResult.etfReturns[index].monthlyReturn));
  }

  const rangeDiagnosticStates = {
    debugReject: __debugRejectTrace.length,
    debugAccept: __debugAcceptTrace.length,
    debugAll: __debugAllAttemptTrace.length
  };

  const before = { reject: __debugRejectTrace.length, accept: __debugAcceptTrace.length, all: __debugAllAttemptTrace.length };
  const currentValues: number[] = [];
  for (let repeat = 0; repeat < 5; repeat += 1) {
    clearDebugTraceBuckets();
    const start = performance.now();
    for (let index = 0; index < 100000; index += 1) {
      generateMonthlyReturnVector(snapshot, pre, 'expansion', 0.55, makeLcg(0xA5A5A5A5 + index * 17 + repeat * 997));
    }
    currentValues.push(performance.now() - start);
    clearDebugTraceBuckets();
  }

  const noRangeValues: number[] = [];
  for (let repeat = 0; repeat < 5; repeat += 1) {
    clearDebugTraceBuckets();
    const start = performance.now();
    for (let index = 0; index < 100000; index += 1) {
      generateMonthlyReturnVectorNoRangeDiagnostic(snapshot, pre, 'expansion', 0.55, makeLcg(0xA5A5A5A5 + index * 17 + repeat * 997));
    }
    noRangeValues.push(performance.now() - start);
    clearDebugTraceBuckets();
  }

  const after = { reject: __debugRejectTrace.length, accept: __debugAcceptTrace.length, all: __debugAllAttemptTrace.length };

  const currentMedian = median(currentValues);
  const noRangeMedian = median(noRangeValues);
  const overheadPercent = currentMedian > 0 ? ((currentMedian - noRangeMedian) / noRangeMedian) * 100 : 0;

  return {
    maxMonthlyReturnDifference,
    rngSequenceIdentical: currentRandom === noDiagnosticRandom,
    currentMedian,
    noRangeMedian,
    overheadPercent,
    traceBefore: before,
    traceAfter: after,
    rangeDiagnosticStates,
    debugTraceEnabled: typeof process !== 'undefined' && process.env && (process.env.DEBUG_SHOCK === '1' || process.env.DEBUG_REJECT === '1')
  };
};

const main = () => {
  const snapshot = createSnapshot();
  const pre = prepareMonteCarloPrecomputation(snapshot);

  const precomputeStats = benchmarkPrecompute();
  const lookupStats = benchmarkLookup();
  const fullVectorStats = benchmarkFullVectors();
  const rangeAblation = benchmarkRangeDiagnosticAblation();

  const currentLookup100k = median(lookupStats.results.count_100000.current);
  const currentLookup1m = median(lookupStats.results.count_1000000.current);
  const currentLookup36m = median(lookupStats.results.count_3600000.current);
  const directLookup100k = median(lookupStats.results.count_100000.direct);
  const directLookup1m = median(lookupStats.results.count_1000000.direct);
  const directLookup36m = median(lookupStats.results.count_3600000.direct);
  const lookupSpeedup = currentLookup100k > 0 ? currentLookup100k / directLookup100k : 0;

  const projectLookup = (count: number, valueMs: number) => (valueMs / 3600000) * count;
  const projectedReturnEngine1000x10 = (fullVectorStats.hundredK.median / 100000) * 120000;
  const projectedReturnEngine1000x100 = (fullVectorStats.hundredK.median / 100000) * 1200000;
  const projectedCurrentLookup1000x10 = projectLookup(360000, currentLookup36m / 3.6);
  const projectedCurrentLookup1000x100 = projectLookup(3600000, currentLookup36m / 3.6);

  const lookupClassification = currentLookup36m > 0 && (currentLookup36m / (fullVectorStats.hundredK.median * 1.0)) > 0.3 ? 'LOOKUP_PRIMARY_CANDIDATE' : currentLookup36m > 0 && (currentLookup36m / (fullVectorStats.hundredK.median * 1.0)) > 0.1 ? 'LOOKUP_SECONDARY_CAUSE' : 'LOOKUP_NOT_PRIMARY_CAUSE';
  const rangeDiagnosticClassification = rangeAblation.overheadPercent > 30 ? 'PRIMARY_CANDIDATE' : rangeAblation.overheadPercent > 10 ? 'SECONDARY' : 'NOT_PRIMARY';
  const primaryRegressionCause = ((currentLookup36m / fullVectorStats.hundredK.median) + (rangeAblation.overheadPercent / 100)) > 0.5 ? 'LOOKUP_AND_RANGE_DIAGNOSTICS' : 'NOT_YET_IDENTIFIED';

  console.log('');
  console.log(`PRECOMPUTATION_MEDIAN_MS = ${precomputeStats.median.toFixed(3)}`);
  console.log(`CURRENT_LOOKUP_100K_MEDIAN_MS = ${currentLookup100k.toFixed(3)}`);
  console.log(`CURRENT_LOOKUP_1M_MEDIAN_MS = ${currentLookup1m.toFixed(3)}`);
  console.log(`CURRENT_LOOKUP_3_6M_MEDIAN_MS = ${currentLookup36m.toFixed(3)}`);
  console.log(`DIRECT_LOOKUP_100K_MEDIAN_MS = ${directLookup100k.toFixed(3)}`);
  console.log(`DIRECT_LOOKUP_1M_MEDIAN_MS = ${directLookup1m.toFixed(3)}`);
  console.log(`DIRECT_LOOKUP_3_6M_MEDIAN_MS = ${directLookup36m.toFixed(3)}`);
  console.log(`LOOKUP_SPEEDUP_FACTOR = ${lookupSpeedup.toFixed(3)}`);
  console.log(`MAX_MU_DIFFERENCE = ${lookupStats.maxDifference.toExponential(6)}`);
  console.log(`MEAN_MU_DIFFERENCE = ${lookupStats.meanDifference.toExponential(6)}`);
  console.log(`FULL_VECTOR_10K_MEDIAN_MS = ${fullVectorStats.tenK.median.toFixed(3)}`);
  console.log(`FULL_VECTOR_100K_MEDIAN_MS = ${fullVectorStats.hundredK.median.toFixed(3)}`);
  console.log(`US_PER_VECTOR = ${(fullVectorStats.usPerVector).toFixed(3)}`);
  console.log(`RANGE_DIAGNOSTICS_ISOLATED_BENCHMARK = unavailable`);
  console.log(`CURRENT_ENGINE_100K_MEDIAN_MS = ${median(runBench('CURRENT_ENGINE_100K', () => {
    generateMonthlyReturnVector(snapshot, pre, 'expansion', 0.55, makeLcg(0xABCDEF + Math.random() * 100000));
  }, 100000))}`);
  console.log(`NO_RANGE_DIAGNOSTIC_100K_MEDIAN_MS = ${noRangeMedianValue(snapshot, pre)}`);
  console.log(`RANGE_DIAGNOSTIC_OVERHEAD_PERCENT = ${rangeAblation.overheadPercent.toFixed(3)}`);
  console.log(`RNG_SEQUENCE_IDENTICAL = ${String(rangeAblation.rngSequenceIdentical)}`);
  console.log(`MAX_MONTHLY_RETURN_DIFFERENCE = ${rangeAblation.maxMonthlyReturnDifference.toExponential(6)}`);
  console.log(`DEBUG_TRACE_ENABLED = ${String(rangeAblation.debugTraceEnabled)}`);
  console.log(`TRACE_LENGTHS_BEFORE = ${rangeAblation.traceBefore.reject + rangeAblation.traceBefore.accept + rangeAblation.traceBefore.all}`);
  console.log(`TRACE_LENGTHS_AFTER_100K = ${rangeAblation.traceAfter.reject + rangeAblation.traceAfter.accept + rangeAblation.traceAfter.all}`);
  console.log(`PROJECTED_RETURN_ENGINE_1000x10_MS = ${projectedReturnEngine1000x10.toFixed(3)}`);
  console.log(`PROJECTED_RETURN_ENGINE_1000x100_MS = ${projectedReturnEngine1000x100.toFixed(3)}`);
  console.log(`PROJECTED_CURRENT_LOOKUP_1000x10_MS = ${projectedCurrentLookup1000x10.toFixed(3)}`);
  console.log(`PROJECTED_CURRENT_LOOKUP_1000x100_MS = ${projectedCurrentLookup1000x100.toFixed(3)}`);
  console.log(`LOOKUP_CLASSIFICATION = ${lookupClassification}`);
  console.log(`RANGE_DIAGNOSTIC_CLASSIFICATION = ${rangeDiagnosticClassification}`);
  console.log(`PRIMARY_REGRESSION_CAUSE = ${primaryRegressionCause}`);
  console.log(`CONFIDENCE = MEDIUM`);
  console.log('FILES_CHANGED_PRODUCTION = NONE');
};

const noRangeMedianValue = (snapshot: MonteCarloSnapshot, pre: ReturnType<typeof prepareMonteCarloPrecomputation>) => {
  const values: number[] = [];
  for (let repeat = 0; repeat < 5; repeat += 1) {
    const start = performance.now();
    for (let index = 0; index < 100000; index += 1) {
      generateMonthlyReturnVectorNoRangeDiagnostic(snapshot, pre, 'expansion', 0.55, makeLcg(0xA5A5A5A5 + index * 17 + repeat * 997));
    }
    values.push(performance.now() - start);
  }
  return median(values).toFixed(3);
};

main();
