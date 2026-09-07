import {
  COPULA_EPSILON,
  sampleChiSquare5,
  sampleStandardizedStudentT5,
  sampleTruncatedNormal,
  solveTruncatedNormalMeanForQuantile,
  studentTCdf,
  studentTQuantile,
  truncatedNormalCdf,
  truncatedNormalQuantile
} from './monte-carlo-probability';

const assertClose = (actual: number, expected: number, tolerance: number, label: string): void => {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${actual} within ${tolerance} of ${expected}`);
  }
};

const random = (() => {
  let state = 0x6d2b79f5;
  return (): number => {
    state |= 0;
    state = state + 0x6d2b79f5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
})();

for (const probability of [1e-6, 0.001, 0.025, 0.5, 0.975, 0.999, 1 - 1e-6]) {
  assertClose(studentTCdf(studentTQuantile(probability)), probability, 2e-10, `CDF(quantile(${probability}))`);
}
assertClose(studentTCdf(1.25) + studentTCdf(-1.25), 1, 2e-12, 'Student-t symmetry');
assertClose(studentTQuantile(0.975), 2.5705818356, 2e-9, 'Student-t 97.5% reference quantile');
assertClose(studentTQuantile(0.95), 2.0150483733, 2e-9, 'Student-t 95% reference quantile');
if (!Number.isFinite(studentTQuantile(COPULA_EPSILON)) || !Number.isFinite(studentTQuantile(1 - COPULA_EPSILON))) {
  throw new Error('Student-t quantiles at COPULA_EPSILON must remain finite');
}

const sampleCount = 100_000;
let studentSum = 0;
let studentSquareSum = 0;
let chiSquareSum = 0;
let chiSquareSquareSum = 0;
for (let index = 0; index < sampleCount; index += 1) {
  const student = sampleStandardizedStudentT5(random);
  const chiSquare = sampleChiSquare5(random);
  if (chiSquare <= 0) throw new Error('Chi-square sample must be positive');
  studentSum += student;
  studentSquareSum += student * student;
  chiSquareSum += chiSquare;
  chiSquareSquareSum += chiSquare * chiSquare;
}
const studentMean = studentSum / sampleCount;
const studentVariance = (studentSquareSum - sampleCount * studentMean * studentMean) / (sampleCount - 1);
assertClose(studentMean, 0, 0.02, 'Standardized Student-t sample mean');
assertClose(studentVariance, 1, 0.08, 'Standardized Student-t sample variance');
const chiSquareMean = chiSquareSum / sampleCount;
const chiSquareVariance = (chiSquareSquareSum - sampleCount * chiSquareMean * chiSquareMean) / (sampleCount - 1);
assertClose(chiSquareMean, 5, 0.12, 'Chi-square mean');
assertClose(chiSquareVariance, 10, 0.6, 'Chi-square variance');

const truncatedParameters = { mean: 0.65, standardDeviation: 0.2, lower: 0, upper: 1 };
for (let index = 0; index < 2_000; index += 1) {
  const sample = sampleTruncatedNormal(truncatedParameters, random);
  if (sample < truncatedParameters.lower || sample > truncatedParameters.upper) {
    throw new Error('Truncated normal sample is outside its bounds');
  }
}
const truncatedP95 = truncatedNormalQuantile(0.95, truncatedParameters);
assertClose(truncatedNormalCdf(truncatedP95, truncatedParameters), 0.95, 1e-7, 'Truncated normal CDF/quantile');
const solvedMean = solveTruncatedNormalMeanForQuantile({
  ...truncatedParameters,
  quantile: 0.95,
  targetValue: 0.4
});
assertClose(truncatedNormalQuantile(0.95, { ...truncatedParameters, mean: solvedMean }), 0.4, 1e-10, 'Truncated normal P95 mean solver');

const impossibleSoftThresholdParameters = {
  mean: -0.20393047755788551,
  standardDeviation: 0.0737495762699692,
  lower: 0.778603725284297,
  upper: 1,
  quantile: 0.95,
  targetValue: 0.7
};
const clampedMean = solveTruncatedNormalMeanForQuantile(impossibleSoftThresholdParameters);
assert.ok(clampedMean >= impossibleSoftThresholdParameters.lower && clampedMean <= impossibleSoftThresholdParameters.upper, 'Clamped mean must still respect the truncation support');

console.log('Monte Carlo Step 4 probability tests passed.');