import {
  calculateEffectiveMonthlyParameters,
  generateMonthlyReturnVector,
  isMonthlyReturnAccepted,
  MAX_REDRAWS,
  MonteCarloReturnEngineError,
  ReturnCorrelationDiagnosticsAccumulator
} from './monte-carlo-return-engine';
import { prepareMonteCarloPrecomputation } from '../precomputation/monte-carlo-precomputation';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  MonteCarloSnapshot
} from '../models/monte-carlo-contracts.model';

const assertClose = (actual: number, expected: number, tolerance: number, label: string): void => {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: ${actual} is not within ${tolerance} of ${expected}`);
  }
};

const assertInterpolatedMean = (generalAnnual: number, scenarioAnnual: number, intensity: number): void => {
  const generalMonthly = Math.pow(1 + generalAnnual, 1 / 12) - 1;
  const scenarioMonthly = Math.pow(1 + scenarioAnnual, 1 / 12) - 1;
  const parameters = {
    monthlyExpectedReturn: scenarioMonthly,
    monthlyVolatility: 0.04,
    zMin: -2,
    zMax: 2,
    monthlyRangeMin: scenarioMonthly - 0.08,
    monthlyRangeMax: scenarioMonthly + 0.08,
    generalMonthlyExpectedReturn: generalMonthly,
    muCalibrationByIntensity: [
      { intensity: 0, targetLogGrowthMonthly: Math.log(1 + generalAnnual) / 12, sigmaMonthly: 0.04 / Math.sqrt(12), muMonthly: generalMonthly, impliedAnnualCagr: generalAnnual },
      { intensity: 1, targetLogGrowthMonthly: Math.log(1 + scenarioAnnual) / 12, sigmaMonthly: 0.04 / Math.sqrt(12), muMonthly: scenarioMonthly, impliedAnnualCagr: scenarioAnnual }
    ]
  } as any;

  const result = calculateEffectiveMonthlyParameters(parameters, intensity, 'ETF-INTERPOLATION');
  const expected = generalMonthly + intensity * (scenarioMonthly - generalMonthly);
  assertClose(result.effectiveMu, expected, 1e-12, `Interpolated mean for intensity ${intensity}`);
};

const createLcg = (): (() => number) => {
  let state = 0x31415926;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const createSequence = (values: number[]): (() => number) => {
  let index = 0;
  return () => {
    if (index >= values.length) {
      throw new Error(`Deterministic RNG sequence exhausted after ${values.length} values; the test fixture must not wrap and repeat the same candidate vector.`);
    }
    return values[index++];
  };
};

const createSnapshot = (correlation: number, range = { min: -1, max: 1 }): MonteCarloSnapshot => ({
  etfs: ['ETF-A', 'ETF-B'].map((isin) => ({
    isin,
    name: isin,
    nickname: null,
    statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
      expectedReturn: 0.12,
      volatility: 0.2,
      returnRange: range
    }])) as MonteCarloSnapshot['etfs'][number]['statistics']
  })),
  structuralProbabilities: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 },
  transitionMatrix: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((from) => [from, Object.fromEntries(MONTE_CARLO_SCENARIOS.map((to) => [to, from === to ? 1 : 0]))])) as MonteCarloSnapshot['transitionMatrix'],
  inertiaConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 }])) as MonteCarloSnapshot['inertiaConfigurations'],
  intensityConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, { meanIntensity: 0.5, stdDevIntensity: 0.1 }])) as MonteCarloSnapshot['intensityConfigurations'],
  globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [key, 0.4])) as MonteCarloSnapshot['globalProperties'],
  correlations: [{ isin1: 'ETF-A', isin2: 'ETF-B', expansion: correlation, recession: correlation, stagflation: correlation, soft_landing: correlation }]
});

const identitySnapshot = createSnapshot(0);
const identityPrecomputation = prepareMonteCarloPrecomputation(identitySnapshot);
assertInterpolatedMean(0.07, 0.115, 0);
assertInterpolatedMean(0.07, 0.115, 1);
assertInterpolatedMean(0.07, 0.115, 0.5);

const negativeScenarioValues: number[] = [];
for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
  const generalMonthly = Math.pow(1 + 0.07, 1 / 12) - 1;
  const scenarioMonthly = Math.pow(1 - 0.13, 1 / 12) - 1;
  const expected = generalMonthly + intensity * (scenarioMonthly - generalMonthly);
  const actual = calculateEffectiveMonthlyParameters({
    monthlyExpectedReturn: scenarioMonthly,
    monthlyVolatility: 0.04,
    zMin: -2,
    zMax: 2,
    monthlyRangeMin: scenarioMonthly - 0.08,
    monthlyRangeMax: scenarioMonthly + 0.08,
    generalMonthlyExpectedReturn: generalMonthly
  } as any, intensity, 'ETF-NEGATIVE').effectiveMu;

  negativeScenarioValues.push(actual);
  if (actual < Math.min(generalMonthly, scenarioMonthly) || actual > Math.max(generalMonthly, scenarioMonthly)) {
    throw new Error(`Negative scenario interpolation breaches the interval for intensity ${intensity}: ${actual} not in [${Math.min(generalMonthly, scenarioMonthly)}, ${Math.max(generalMonthly, scenarioMonthly)}]`);
  }
  if (Math.abs(actual - expected) > 1e-12) {
    throw new Error(`Negative scenario interpolation mismatch for intensity ${intensity}: ${actual} vs ${expected}`);
  }
}
for (let index = 1; index < negativeScenarioValues.length; index += 1) {
  if (negativeScenarioValues[index] > negativeScenarioValues[index - 1]) {
    throw new Error(`Negative scenario interpolation must be monotonic: ${negativeScenarioValues[index]} > ${negativeScenarioValues[index - 1]}`);
  }
}

const lowerPositiveScenarioValues: number[] = [];
for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
  const generalMonthly = Math.pow(1 + 0.07, 1 / 12) - 1;
  const scenarioMonthly = Math.pow(1 + 0.03, 1 / 12) - 1;
  const expected = generalMonthly + intensity * (scenarioMonthly - generalMonthly);
  const actual = calculateEffectiveMonthlyParameters({
    monthlyExpectedReturn: scenarioMonthly,
    monthlyVolatility: 0.04,
    zMin: -2,
    zMax: 2,
    monthlyRangeMin: scenarioMonthly - 0.08,
    monthlyRangeMax: scenarioMonthly + 0.08,
    generalMonthlyExpectedReturn: generalMonthly
  } as any, intensity, 'ETF-LOWER-POSITIVE').effectiveMu;

  lowerPositiveScenarioValues.push(actual);
  if (actual < Math.min(generalMonthly, scenarioMonthly) || actual > Math.max(generalMonthly, scenarioMonthly)) {
    throw new Error(`Lower positive scenario interpolation breaches the interval for intensity ${intensity}: ${actual} not in [${Math.min(generalMonthly, scenarioMonthly)}, ${Math.max(generalMonthly, scenarioMonthly)}]`);
  }
  if (Math.abs(actual - expected) > 1e-12) {
    throw new Error(`Lower positive scenario interpolation mismatch for intensity ${intensity}: ${actual} vs ${expected}`);
  }
}
for (let index = 1; index < lowerPositiveScenarioValues.length; index += 1) {
  if (lowerPositiveScenarioValues[index] > lowerPositiveScenarioValues[index - 1]) {
    throw new Error(`Lower positive scenario interpolation must be monotonic: ${lowerPositiveScenarioValues[index]} > ${lowerPositiveScenarioValues[index - 1]}`);
  }
}

const equalScenarioMonthly = Math.pow(1 + 0.07, 1 / 12) - 1;
for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
  const actual = calculateEffectiveMonthlyParameters({
    monthlyExpectedReturn: equalScenarioMonthly,
    monthlyVolatility: 0.04,
    zMin: -2,
    zMax: 2,
    monthlyRangeMin: equalScenarioMonthly - 0.08,
    monthlyRangeMax: equalScenarioMonthly + 0.08,
    generalMonthlyExpectedReturn: equalScenarioMonthly
  } as any, intensity, 'ETF-EQUAL').effectiveMu;
  if (Math.abs(actual - equalScenarioMonthly) > 1e-12) {
    throw new Error(`Equal general/scenario must be constant for intensity ${intensity}: ${actual} vs ${equalScenarioMonthly}`);
  }
}

const generalVolatilityMonthly = 0.145 / Math.sqrt(12);
const scenarioVolatilityMonthly = 0.22 / Math.sqrt(12);
for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
  const result = calculateEffectiveMonthlyParameters({
    monthlyExpectedReturn: Math.pow(1 + 0.07, 1 / 12) - 1,
    monthlyVolatility: scenarioVolatilityMonthly,
    generalMonthlyVolatility: generalVolatilityMonthly,
    zMin: -2,
    zMax: 2,
    monthlyRangeMin: -0.25,
    monthlyRangeMax: 0.25,
    generalMonthlyExpectedReturn: Math.pow(1 + 0.07, 1 / 12) - 1
  } as any, intensity, 'ETF-SCENARIO-LOWER');
  const expectedSigma = generalVolatilityMonthly + intensity * (scenarioVolatilityMonthly - generalVolatilityMonthly);
  assertClose(result.effectiveSigma, expectedSigma, 1e-12, `Volatility interpolation for recession intensity ${intensity}`);
  if (intensity === 0) assertClose(result.effectiveSigma, generalVolatilityMonthly, 1e-12, 'Intensity zero uses general volatility');
  if (intensity === 1) assertClose(result.effectiveSigma, scenarioVolatilityMonthly, 1e-12, 'Intensity one uses scenario volatility');
}

const generalVolatilityMonthlyLower = 0.145 / Math.sqrt(12);
const expansionVolatilityMonthly = 0.135 / Math.sqrt(12);
const lowerScenarioValues: number[] = [];
for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
  const value = calculateEffectiveMonthlyParameters({
    monthlyExpectedReturn: Math.pow(1 + 0.07, 1 / 12) - 1,
    monthlyVolatility: expansionVolatilityMonthly,
    generalMonthlyVolatility: generalVolatilityMonthlyLower,
    zMin: -2,
    zMax: 2,
    monthlyRangeMin: -0.25,
    monthlyRangeMax: 0.25,
    generalMonthlyExpectedReturn: Math.pow(1 + 0.07, 1 / 12) - 1
  } as any, intensity, 'ETF-SCENARIO-LOWER-EXPANSION').effectiveSigma;
  lowerScenarioValues.push(value);
}
for (let index = 1; index < lowerScenarioValues.length; index += 1) {
  if (lowerScenarioValues[index] > lowerScenarioValues[index - 1]) {
    throw new Error(`Expansion scenario volatility must be monotonic decreasing: ${lowerScenarioValues[index]} > ${lowerScenarioValues[index - 1]}`);
  }
}

const zeroIntensity = generateMonthlyReturnVector(identitySnapshot, identityPrecomputation, 'expansion', 0, createLcg());
for (const result of zeroIntensity.etfReturns) {
  const base = identityPrecomputation.etfParameters[result.isin].expansion;
  assertClose(result.effectiveParameters.effectiveMu, base.monthlyExpectedReturn, 1e-15, 'Intensity zero effective mean');
  assertClose(result.effectiveParameters.effectiveSigma, base.generalMonthlyVolatility ?? base.monthlyVolatility, 1e-15, 'Intensity zero uses general volatility');
}
const negativeZeroIntensity = generateMonthlyReturnVector(
  identitySnapshot,
  identityPrecomputation,
  'expansion',
  0,
  createSequence(Array.from({ length: 20 }, () => 0.5))
);
if (!negativeZeroIntensity.etfReturns.some((result) => result.monthlyReturn < 0)) {
  throw new Error('Intensity zero must still allow negative returns through the general-volatility baseline');
}
const fullIntensity = generateMonthlyReturnVector(identitySnapshot, identityPrecomputation, 'expansion', 1, createLcg());
const midpointIntensity = generateMonthlyReturnVector(identitySnapshot, identityPrecomputation, 'expansion', 0.5, createLcg());
for (const result of fullIntensity.etfReturns) {
  const base = identityPrecomputation.etfParameters[result.isin].expansion;
  assertClose(result.effectiveParameters.effectiveMu, base.monthlyExpectedReturn, 1e-15, 'Intensity one effective mean');
  assertClose(result.effectiveParameters.effectiveSigma, base.monthlyVolatility, 1e-15, 'Intensity one effective volatility');
}
for (const result of midpointIntensity.etfReturns) {
  const base = identityPrecomputation.etfParameters[result.isin].expansion;
  const generalVolatility = base.generalMonthlyVolatility ?? base.monthlyVolatility;
  const expectedSigma = generalVolatility + 0.5 * (base.monthlyVolatility - generalVolatility);
  assertClose(result.effectiveParameters.effectiveMu, base.monthlyExpectedReturn, 1e-15, 'Intermediate effective mean');
  assertClose(result.effectiveParameters.effectiveSigma, expectedSigma, 1e-15, 'Intermediate effective volatility');
  const expectedMinimum = result.effectiveParameters.effectiveMu + (base.zMin ?? 0) * result.effectiveParameters.effectiveSigma;
  assertClose(result.effectiveParameters.effectiveReturnRange.min, expectedMinimum, 1e-15, 'Effective return range');
}

const cappedParameters = calculateEffectiveMonthlyParameters({
  monthlyExpectedReturn: 0,
  monthlyVolatility: 0.1,
  zMin: -4,
  zMax: 4,
  monthlyRangeMin: -0.05,
  monthlyRangeMax: 0.05
}, 1, 'ETF-RANGE');
assertClose(cappedParameters.reconstructedReturnRange.min, -0.4, 1e-15, 'Reconstructed lower return range');
assertClose(cappedParameters.reconstructedReturnRange.max, 0.4, 1e-15, 'Reconstructed upper return range');
assertClose(cappedParameters.effectiveReturnRange.min, -0.05, 1e-15, 'Effective lower range limited by scenario range');
assertClose(cappedParameters.effectiveReturnRange.max, 0.05, 1e-15, 'Effective upper range limited by scenario range');
if (!isMonthlyReturnAccepted(-1, { min: -1, max: 0 }) || isMonthlyReturnAccepted(-1.0000001, { min: -2, max: 0 })) {
  throw new Error('A realized -100% return must be accepted and a return below -100% must be rejected without correction');
}
if (!isMonthlyReturnAccepted(0.12, { min: 0.2, max: 0.3 })) {
  throw new Error('A return inside the effective range must remain accepted even when it violates the legacy range diagnostic');
}
if (!zeroIntensity.diagnostics.rangeDiagnostics || zeroIntensity.diagnostics.rangeDiagnostics.candidateVectors !== 1 || zeroIntensity.diagnostics.rangeDiagnostics.acceptedVectors !== 1 || zeroIntensity.diagnostics.rangeDiagnostics.rejectedVectors !== 0) {
  throw new Error('Range diagnostics must remain observable without changing production acceptance semantics');
}

if (!zeroIntensity.diagnostics.rangeDiagnostics || zeroIntensity.diagnostics.rangeDiagnostics.physicalFloorRejectedVectors !== 0 || zeroIntensity.diagnostics.rangeDiagnostics.oldRangeViolationCount !== 0 || zeroIntensity.diagnostics.rangeDiagnostics.effectiveRangeRejectedVectors !== 0) {
  throw new Error('V1.3 diagnostics must initialize to zero for accepted vectors');
}

const rangeViolationSnapshot = {
  ...createSnapshot(0, { min: 0.1, max: 0.2 }),
  etfs: ['ETF-A', 'ETF-B'].map((isin) => ({
    isin,
    name: isin,
    nickname: null,
    statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
      expectedReturn: 0.12,
      volatility: 0.1,
      returnRange: { min: 0.1, max: 0.2 }
    }])) as MonteCarloSnapshot['etfs'][number]['statistics']
  }))
};
const rangeViolationPrecomputation = prepareMonteCarloPrecomputation(rangeViolationSnapshot);
const rangeViolationVector = generateMonthlyReturnVector(rangeViolationSnapshot, rangeViolationPrecomputation, 'expansion', 1, () => 0.999999999999);
const rangeViolationDiagnostics = rangeViolationVector.diagnostics.rangeDiagnostics;
if (!rangeViolationDiagnostics || rangeViolationVector.etfReturns.some((result) => result.monthlyReturn < -1) || rangeViolationVector.etfReturns.some((result) => result.monthlyReturn >= -1) === false || rangeViolationDiagnostics.acceptedVectors !== 1 || rangeViolationDiagnostics.rejectedVectors !== 0 || rangeViolationDiagnostics.physicalFloorRejectedVectors !== 0 || rangeViolationDiagnostics.effectiveRangeRejectedVectors !== 0 || rangeViolationDiagnostics.oldRangeViolationCount < 1) {
  throw new Error('V1.3 range violation must be diagnostic-only and must not trigger a rejection');
}

const correlatedSnapshot = createSnapshot(0.6);
const correlatedPrecomputation = prepareMonteCarloPrecomputation(correlatedSnapshot);
const accumulator = new ReturnCorrelationDiagnosticsAccumulator(
  correlatedPrecomputation.correlationMatrices.expansion.originalMatrix,
  correlatedPrecomputation.correlationMatrices.expansion.operationalMatrix
);
const correlationRandom = createLcg();
let shockSum = 0;
let shockSquareSum = 0;
const sampleCount = 20_000;
for (let index = 0; index < sampleCount; index += 1) {
  const vector = generateMonthlyReturnVector(correlatedSnapshot, correlatedPrecomputation, 'expansion', 1, correlationRandom);
  accumulator.record(vector);
  for (const result of vector.etfReturns) {
    shockSum += result.standardizedShock;
    shockSquareSum += result.standardizedShock * result.standardizedShock;
  }
}
const shockMean = shockSum / (sampleCount * 2);
const shockVariance = (shockSquareSum - sampleCount * 2 * shockMean * shockMean) / (sampleCount * 2 - 1);
assertClose(shockMean, 0, 0.03, 't-copula standardized shock mean');
assertClose(shockVariance, 1, 0.1, 't-copula standardized shock variance');
const diagnostics = accumulator.toDiagnostics();
assertClose(diagnostics.empiricalShockCorrelation?.[0][1] ?? NaN, 0.6, 0.05, 'Empirical shock correlation');
assertClose(diagnostics.empiricalReturnCorrelation?.[0][1] ?? NaN, 0.6, 0.05, 'Empirical return correlation');
if ((diagnostics.lowerTailDependence?.[0][1] ?? 0) <= 0.05 || (diagnostics.upperTailDependence?.[0][1] ?? 0) <= 0.05) {
  throw new Error('t-copula tail dependence must exceed independent-tail probability');
}
if (diagnostics.targetCorrelation[0][1] !== 0.6 || diagnostics.operationalCorrelation[0][1] !== 0.6 || diagnostics.latentCorrelation[0][1] !== 0.6) {
  throw new Error('Target, operational, and latent correlations must remain distinct diagnostics without calibration');
}

const floorRejectSnapshot = {
  ...createSnapshot(0, { min: -0.99, max: 1 }),
  etfs: ['ETF-A', 'ETF-B'].map((isin) => ({
    isin,
    name: isin,
    nickname: null,
    statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
      expectedReturn: 0.12,
      volatility: 3,
      returnRange: { min: -0.99, max: 1 }
    }])) as MonteCarloSnapshot['etfs'][number]['statistics']
  }))
};
const floorRejectPrecomputation = prepareMonteCarloPrecomputation(floorRejectSnapshot);
const invalidThenValidRandom = createSequence([
  ...Array.from({ length: 12 }, () => 0.5),
  ...Array.from({ length: 9 }, () => 0.999),
  0.53,
  0.7,
  0.87,
  ...Array.from({ length: 38 }, () => 0.5),
  ...Array.from({ length: 9 }, () => 0.999)
]);
const floorRejectVector = generateMonthlyReturnVector(floorRejectSnapshot, floorRejectPrecomputation, 'expansion', 1, invalidThenValidRandom);
if (floorRejectVector.diagnostics.attempts !== 2 || floorRejectVector.diagnostics.rejectedChiSquares.length !== 1 || floorRejectVector.etfReturns.some((result) => result.monthlyReturn < -1) || floorRejectVector.diagnostics.attempts <= 1) {
  throw new Error('The redraw fixture must reject the first invalid candidate and accept the second valid candidate without looping the RNG');
}

const impossibleSnapshot = {
  ...createSnapshot(0, { min: -0.99, max: 1 }),
  etfs: ['ETF-A', 'ETF-B'].map((isin) => ({
    isin,
    name: isin,
    nickname: null,
    statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
      expectedReturn: 0.12,
      volatility: 3,
      returnRange: { min: -0.99, max: 1 }
    }])) as MonteCarloSnapshot['etfs'][number]['statistics']
  }))
};
const impossiblePrecomputation = prepareMonteCarloPrecomputation(impossibleSnapshot);
const constantInvalidRandom = Object.assign(() => 0.5, {});
try {
  generateMonthlyReturnVector(impossibleSnapshot, impossiblePrecomputation, 'expansion', 1, constantInvalidRandom);
  throw new Error('Expected MAX_REDRAWS failure for repeated hard floor violations');
} catch (error) {
  if (!(error instanceof MonteCarloReturnEngineError) || error.code !== 'MAX_REDRAWS_EXCEEDED') throw error;
}
if (MAX_REDRAWS !== 1000) throw new Error('MAX_REDRAWS must remain fixed at 1000');

const epsilonVector = generateMonthlyReturnVector(
  identitySnapshot,
  identityPrecomputation,
  'expansion',
  1,
  createSequence([0.999999999999, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
);
if (epsilonVector.etfReturns.some((result) => !Number.isFinite(result.standardizedShock) || !Number.isFinite(result.monthlyReturn))) {
  throw new Error('t-copula output must remain finite near COPULA_EPSILON');
}

console.log('Monte Carlo Step 6 return engine tests passed.');