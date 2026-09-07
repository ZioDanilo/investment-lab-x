import {
  calibrateTargetLogAndSigma,
  CORRELATION_EPSILON,
  MAX_CORRELATION_CELL_DELTA,
  MonteCarloPrecomputationError,
  precomputeEtfScenarioParameters,
  prepareCorrelationMatrix,
  prepareMonteCarloPrecomputation
} from './monte-carlo-precomputation';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  MonteCarloSnapshot
} from '../models/monte-carlo-contracts.model';

const assertClose = (actual: number, expected: number, epsilon = 1e-9): void => {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`Expected ${actual} to be within ${epsilon} of ${expected}`);
  }
};

const expectError = (action: () => void, code: string): void => {
  try {
    action();
  } catch (error) {
    if (error instanceof MonteCarloPrecomputationError && error.code === code) return;
    if (error instanceof Error && error.message === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
};

const createSnapshot = (isins: string[], correlations: MonteCarloSnapshot['correlations']): MonteCarloSnapshot => ({
  etfs: isins.map((isin) => ({
    isin,
    name: isin,
    nickname: null,
    statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
      expectedReturn: 0.12,
      volatility: 0.2,
      returnRange: { min: -0.28, max: 0.52 }
    }])) as MonteCarloSnapshot['etfs'][number]['statistics']
  })),
  structuralProbabilities: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, 0.25])) as MonteCarloSnapshot['structuralProbabilities'],
  transitionMatrix: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((from) => [from, Object.fromEntries(MONTE_CARLO_SCENARIOS.map((to) => [to, 0.25]))])) as MonteCarloSnapshot['transitionMatrix'],
  inertiaConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 }])) as MonteCarloSnapshot['inertiaConfigurations'],
  intensityConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, { meanIntensity: 0.5, stdDevIntensity: 0.1 }])) as MonteCarloSnapshot['intensityConfigurations'],
  globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [key, 0.4])) as MonteCarloSnapshot['globalProperties'],
  correlations
});

const sameCorrelation = (isin1: string, isin2: string, value: number): MonteCarloSnapshot['correlations'][number] => ({
  isin1,
  isin2,
  expansion: value,
  recession: value,
  stagflation: value,
  soft_landing: value
});

const reconstructFromFactor = (factor: number[][]): number[][] => factor.map((row) =>
  factor.map((column) => row.reduce((total, value, index) => total + value * column[index], 0))
);

const parameters = precomputeEtfScenarioParameters({
  expectedReturn: 0.12,
  volatility: 0.2,
  returnRange: { min: -0.28, max: 0.52 }
});
assertClose(parameters.targetLogGrowthMonthly, Math.log(1 + 0.12) / 12, 1e-12);
assertClose(parameters.calibratedMonthlyLocation, parameters.monthlyExpectedReturn, 1e-12);
assertClose(parameters.monthlyVolatility, 0.2 / Math.sqrt(12), 1e-12);
assertClose(parameters.zMin ?? NaN, -2, 1e-12);
assertClose(parameters.zMax ?? NaN, 2, 1e-12);
assertClose(parameters.monthlyRangeMin, parameters.monthlyExpectedReturn - 2 * parameters.monthlyVolatility, 1e-12);
assertClose(parameters.monthlyRangeMax, parameters.monthlyExpectedReturn + 2 * parameters.monthlyVolatility, 1e-12);

const calibratedTarget = calibrateTargetLogAndSigma(Math.log(1 + 0.12) / 12, 0.2 / Math.sqrt(12));
assertClose(calibratedTarget, parameters.monthlyExpectedReturn, 1e-10);
expectError(() => calibrateTargetLogAndSigma(Number.NaN, 0.2 / Math.sqrt(12)), 'CALIBRATION_INVALID_INPUT');

const identitySnapshot = createSnapshot(['ETF-A', 'ETF-B'], [sameCorrelation('ETF-A', 'ETF-B', 0)]);
const identityPrepared = prepareCorrelationMatrix(identitySnapshot, 'expansion');
if (identityPrepared.correctionApplied || identityPrepared.correctedMatrix !== null) {
  throw new Error('Identity matrix must not be corrected');
}
assertClose(identityPrepared.operationalMatrix[0][0], 1);
assertClose(identityPrepared.operationalMatrix[0][1], 0);
assertClose(identityPrepared.factorReconstructionError, 0, CORRELATION_EPSILON);

const psdSnapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C'], [
  sameCorrelation('ETF-A', 'ETF-B', 0.5),
  sameCorrelation('ETF-A', 'ETF-C', 0.3),
  sameCorrelation('ETF-B', 'ETF-C', 0.2)
]);
const psdPrepared = prepareMonteCarloPrecomputation(psdSnapshot);
if (psdPrepared.correlationMatrices.expansion.correctionApplied) {
  throw new Error('PSD matrix must not be corrected');
}
assertClose(psdPrepared.correlationMatrices.expansion.factorReconstructionError, 0, CORRELATION_EPSILON);

const correctibleSnapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C'], [
  sameCorrelation('ETF-A', 'ETF-B', 0.9),
  sameCorrelation('ETF-A', 'ETF-C', 0.9),
  sameCorrelation('ETF-B', 'ETF-C', 0.619)
]);
const corrected = prepareCorrelationMatrix(correctibleSnapshot, 'expansion');
if (!corrected.correctionApplied || corrected.correctedMatrix === null) {
  throw new Error('Near-PSD matrix must be corrected');
}
if (corrected.maxCellDelta > MAX_CORRELATION_CELL_DELTA || corrected.minimumEigenvalueAfter < -CORRELATION_EPSILON) {
  throw new Error('Corrected matrix failed correction constraints');
}
assertClose(corrected.factorReconstructionError, 0, CORRELATION_EPSILON);

const nearPsdSnapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C'], [
  sameCorrelation('ETF-A', 'ETF-B', 0.9),
  sameCorrelation('ETF-A', 'ETF-C', 0.9),
  sameCorrelation('ETF-B', 'ETF-C', 0.6199999)
]);
const nearPsdPrepared = prepareCorrelationMatrix(nearPsdSnapshot, 'expansion');
if (!nearPsdPrepared.correctionApplied || nearPsdPrepared.minimumEigenvalueBefore < -1e-6) {
  throw new Error('Near-PSD negative eigenvalue must be rebuilt without a structural failure');
}
for (let index = 0; index < nearPsdPrepared.operationalMatrix.length; index += 1) {
  assertClose(nearPsdPrepared.operationalMatrix[index][index], 1, CORRELATION_EPSILON);
}
if (nearPsdPrepared.minimumEigenvalueAfter < -CORRELATION_EPSILON || nearPsdPrepared.maxCellDelta > MAX_CORRELATION_CELL_DELTA) {
  throw new Error('Near-PSD matrix cleanup violated PSD or correction-delta constraints');
}
const factorReconstruction = reconstructFromFactor(nearPsdPrepared.factor);
for (let row = 0; row < factorReconstruction.length; row += 1) {
  for (let column = 0; column < factorReconstruction.length; column += 1) {
    assertClose(factorReconstruction[row][column], nearPsdPrepared.operationalMatrix[row][column], CORRELATION_EPSILON);
  }
}

const excessiveCorrectionSnapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C'], [
  sameCorrelation('ETF-A', 'ETF-B', 0.9),
  sameCorrelation('ETF-A', 'ETF-C', 0.9),
  sameCorrelation('ETF-B', 'ETF-C', -0.9)
]);
expectError(() => prepareCorrelationMatrix(excessiveCorrectionSnapshot, 'expansion'), 'CORRELATION_MATRIX_CORRECTION_TOO_LARGE');

console.log('Monte Carlo Step 3 precomputation tests passed.');