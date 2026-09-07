export const T_COPULA_DOF = 5;
export const STUDENT_T_STANDARDIZATION = Math.sqrt(3 / 5);
export const COPULA_EPSILON = 1e-12;
export const INTENSITY_MEAN_SOLVER_TOLERANCE = 1e-10;
export const INTENSITY_MEAN_SOLVER_MAX_ITERATIONS = 100;

const QUANTILE_TOLERANCE = 1e-12;
const QUANTILE_MAX_ITERATIONS = 200;

export type UniformRandomSource = () => number;

export class MonteCarloProbabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'MonteCarloProbabilityError';
  }
}

export interface TruncatedNormalParameters {
  mean: number;
  standardDeviation: number;
  lower: number;
  upper: number;
}

export interface TruncatedNormalMeanSolverInput extends TruncatedNormalParameters {
  quantile: number;
  targetValue: number;
}

const fail = (code: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new MonteCarloProbabilityError(code, message, details);
};

const assertFinite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) fail('INVALID_NUMERIC_VALUE', `${field} must be finite`, { field, value });
};

const assertProbability = (probability: number, field = 'probability'): void => {
  assertFinite(probability, field);
  if (probability <= 0 || probability >= 1) {
    fail('INVALID_PROBABILITY', `${field} must be strictly between 0 and 1`, { field, probability });
  }
};

const assertUniform = (value: number): void => {
  assertFinite(value, 'uniform random value');
  if (value < 0 || value >= 1) {
    fail('INVALID_UNIFORM_RANDOM_VALUE', 'uniform random source must return a value in [0, 1)', { value });
  }
};

const assertTruncatedNormalParameters = ({ mean, standardDeviation, lower, upper }: TruncatedNormalParameters): void => {
  assertFinite(mean, 'mean');
  assertFinite(standardDeviation, 'standardDeviation');
  assertFinite(lower, 'lower');
  assertFinite(upper, 'upper');
  if (standardDeviation <= 0) {
    fail('INVALID_STANDARD_DEVIATION', 'standardDeviation must be greater than zero', { standardDeviation });
  }
  if (lower >= upper) {
    fail('INVALID_TRUNCATION_INTERVAL', 'lower must be less than upper', { lower, upper });
  }
};

/** Standard normal CDF, evaluated with a stable complementary-error-function approximation. */
export const normalCdf = (value: number): number => {
  assertFinite(value, 'normal value');
  const z = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - polynomial * Math.exp(-z * z);
  return value >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
};

/** Acklam rational approximation of the inverse standard normal CDF. */
export const normalQuantile = (probability: number): number => {
  assertProbability(probability);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lowerRegion = 0.02425;
  const upperRegion = 1 - lowerRegion;

  if (probability < lowerRegion) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > upperRegion) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};

export const sampleStandardNormal = (random: UniformRandomSource): number => {
  const first = random();
  const second = random();
  assertUniform(first);
  assertUniform(second);
  const radius = Math.sqrt(-2 * Math.log(1 - first));
  const sample = radius * Math.cos(2 * Math.PI * second);
  assertFinite(sample, 'standard normal sample');
  return sample;
};

const logGamma = (value: number): number => {
  const coefficients = [
    0.9999999999998099,
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019571e-6,
    1.5056327351493116e-7
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const adjusted = value - 1;
  let series = coefficients[0];
  for (let index = 1; index < coefficients.length; index += 1) series += coefficients[index] / (adjusted + index);
  const t = adjusted + coefficients.length - 1.5;
  return 0.5 * Math.log(2 * Math.PI) + (adjusted + 0.5) * Math.log(t) - t + Math.log(series);
};

const betaContinuedFraction = (alpha: number, beta: number, value: number): number => {
  const maximumIterations = 200;
  const minimum = 1e-300;
  const threshold = 3e-14;
  const qab = alpha + beta;
  const qap = alpha + 1;
  const qam = alpha - 1;
  let c = 1;
  let d = 1 - qab * value / qap;
  if (Math.abs(d) < minimum) d = minimum;
  d = 1 / d;
  let h = d;
  for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
    const twiceIteration = 2 * iteration;
    let aa = iteration * (beta - iteration) * value / ((qam + twiceIteration) * (alpha + twiceIteration));
    d = 1 + aa * d;
    if (Math.abs(d) < minimum) d = minimum;
    c = 1 + aa / c;
    if (Math.abs(c) < minimum) c = minimum;
    d = 1 / d;
    h *= d * c;
    aa = -(alpha + iteration) * (qab + iteration) * value / ((alpha + twiceIteration) * (qap + twiceIteration));
    d = 1 + aa * d;
    if (Math.abs(d) < minimum) d = minimum;
    c = 1 + aa / c;
    if (Math.abs(c) < minimum) c = minimum;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < threshold) return h;
  }
  return fail('INCOMPLETE_BETA_FAILED', 'incomplete beta continued fraction did not converge');
};

const regularizedIncompleteBeta = (value: number, alpha: number, beta: number): number => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  const logTerm = logGamma(alpha + beta) - logGamma(alpha) - logGamma(beta) + alpha * Math.log(value) + beta * Math.log(1 - value);
  const front = Math.exp(logTerm);
  const result = value < (alpha + 1) / (alpha + beta + 2)
    ? front * betaContinuedFraction(alpha, beta, value) / alpha
    : 1 - front * betaContinuedFraction(beta, alpha, 1 - value) / beta;
  if (!Number.isFinite(result) || result < 0 || result > 1) {
    return fail('INCOMPLETE_BETA_FAILED', 'incomplete beta evaluation produced an invalid probability', { value, alpha, beta, result });
  }
  return result;
};

export const studentTCdf = (value: number): number => {
  assertFinite(value, 'Student-t value');
  const degreesOfFreedom = T_COPULA_DOF;
  const betaArgument = degreesOfFreedom / (degreesOfFreedom + value * value);
  const incompleteBeta = regularizedIncompleteBeta(betaArgument, degreesOfFreedom / 2, 0.5);
  return value >= 0 ? 1 - 0.5 * incompleteBeta : 0.5 * incompleteBeta;
};

export const studentTQuantile = (probability: number): number => {
  assertProbability(probability);
  if (probability === 0.5) return 0;
  let lower = -1;
  let upper = 1;
  while (studentTCdf(lower) > probability) lower *= 2;
  while (studentTCdf(upper) < probability) upper *= 2;
  for (let iteration = 0; iteration < QUANTILE_MAX_ITERATIONS; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const midpointProbability = studentTCdf(midpoint);
    if (Math.abs(midpointProbability - probability) <= QUANTILE_TOLERANCE) return midpoint;
    if (midpointProbability < probability) lower = midpoint;
    else upper = midpoint;
  }
  const result = (lower + upper) / 2;
  assertFinite(result, 'Student-t quantile');
  return result;
};

const sampleGamma = (shape: number, random: UniformRandomSource): number => {
  if (shape <= 0 || !Number.isFinite(shape)) fail('INVALID_GAMMA_SHAPE', 'gamma shape must be finite and greater than zero', { shape });
  if (shape < 1) {
    const uniform = random();
    assertUniform(uniform);
    return sampleGamma(shape + 1, random) * Math.pow(1 - uniform, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const normal = sampleStandardNormal(random);
    const candidate = 1 + c * normal;
    if (candidate <= 0) continue;
    const cube = candidate * candidate * candidate;
    const uniform = random();
    assertUniform(uniform);
    if (uniform < 1 - 0.0331 * normal ** 4 || Math.log(1 - uniform) < 0.5 * normal * normal + d * (1 - cube + Math.log(cube))) {
      return d * cube;
    }
  }
};

export const sampleChiSquare5 = (random: UniformRandomSource): number => {
  const sample = 2 * sampleGamma(T_COPULA_DOF / 2, random);
  if (!Number.isFinite(sample) || sample <= 0) fail('INVALID_CHI_SQUARE_SAMPLE', 'chi-square sample must be finite and positive', { sample });
  return sample;
};

export const sampleStandardizedStudentT5 = (random: UniformRandomSource): number => {
  const normal = sampleStandardNormal(random);
  const chiSquare = sampleChiSquare5(random);
  const sample = normal / Math.sqrt(chiSquare / T_COPULA_DOF) * STUDENT_T_STANDARDIZATION;
  assertFinite(sample, 'standardized Student-t sample');
  return sample;
};

export const truncatedNormalCdf = (value: number, parameters: TruncatedNormalParameters): number => {
  assertTruncatedNormalParameters(parameters);
  assertFinite(value, 'truncated normal value');
  const { mean, standardDeviation, lower, upper } = parameters;
  if (value <= lower) return 0;
  if (value >= upper) return 1;
  const lowerProbability = normalCdf((lower - mean) / standardDeviation);
  const upperProbability = normalCdf((upper - mean) / standardDeviation);
  const normalization = upperProbability - lowerProbability;
  if (!Number.isFinite(normalization) || normalization <= 0) {
    return fail('INVALID_TRUNCATED_NORMAL_NORMALIZATION', 'truncated normal normalization must be finite and positive', { ...parameters });
  }
  return (normalCdf((value - mean) / standardDeviation) - lowerProbability) / normalization;
};

export const truncatedNormalQuantile = (probability: number, parameters: TruncatedNormalParameters): number => {
  assertTruncatedNormalParameters(parameters);
  assertProbability(probability);
  const { mean, standardDeviation, lower, upper } = parameters;
  const lowerProbability = normalCdf((lower - mean) / standardDeviation);
  const upperProbability = normalCdf((upper - mean) / standardDeviation);
  const normalization = upperProbability - lowerProbability;
  if (!Number.isFinite(normalization) || normalization <= 0) {
    return fail('INVALID_TRUNCATED_NORMAL_NORMALIZATION', 'truncated normal normalization must be finite and positive', { ...parameters });
  }
  const quantile = mean + standardDeviation * normalQuantile(lowerProbability + probability * normalization);
  if (!Number.isFinite(quantile) || quantile < lower || quantile > upper) {
    return fail('INVALID_TRUNCATED_NORMAL_QUANTILE', 'truncated normal quantile is outside its interval', { ...parameters, probability, quantile });
  }
  return quantile;
};

export const sampleTruncatedNormal = (parameters: TruncatedNormalParameters, random: UniformRandomSource): number => {
  const uniform = random();
  assertUniform(uniform);
  const sample = truncatedNormalQuantile(uniform === 0 ? Number.MIN_VALUE : uniform, parameters);
  if (sample < parameters.lower || sample > parameters.upper) {
    return fail('INVALID_TRUNCATED_NORMAL_SAMPLE', 'truncated normal sample is outside its interval', { ...parameters, sample });
  }
  return sample;
};

export const solveTruncatedNormalMeanForQuantile = ({ mean, standardDeviation, lower, upper, quantile, targetValue }: TruncatedNormalMeanSolverInput): number => {
  assertTruncatedNormalParameters({ mean, standardDeviation, lower, upper });
  assertProbability(quantile, 'quantile');
  assertFinite(targetValue, 'targetValue');
  if (targetValue <= lower || targetValue >= upper) {
    fail('INVALID_TRUNCATED_NORMAL_TARGET', 'targetValue must be strictly inside the truncation interval', { lower, upper, targetValue });
  }
  const baseParameters = { mean, standardDeviation, lower, upper };
  if (truncatedNormalQuantile(quantile, baseParameters) <= targetValue) return mean;

  let upperMean = mean;
  let lowerMean = mean - standardDeviation;
  let step = standardDeviation;
  for (let iteration = 0; truncatedNormalQuantile(quantile, { mean: lowerMean, standardDeviation, lower, upper }) > targetValue; iteration += 1) {
    if (iteration >= INTENSITY_MEAN_SOLVER_MAX_ITERATIONS) {
      return fail('INTENSITY_MEAN_SOLVER_FAILED', 'unable to bracket the truncated normal target quantile', { mean, standardDeviation, lower, upper, quantile, targetValue });
    }
    step *= 2;
    lowerMean -= step;
  }

  for (let iteration = 0; iteration < INTENSITY_MEAN_SOLVER_MAX_ITERATIONS; iteration += 1) {
    const midpoint = (lowerMean + upperMean) / 2;
    const currentQuantile = truncatedNormalQuantile(quantile, { mean: midpoint, standardDeviation, lower, upper });
    if (Math.abs(currentQuantile - targetValue) <= INTENSITY_MEAN_SOLVER_TOLERANCE) return midpoint;
    if (currentQuantile > targetValue) upperMean = midpoint;
    else lowerMean = midpoint;
  }
  return fail('INTENSITY_MEAN_SOLVER_FAILED', 'truncated normal mean solver did not converge', { mean, standardDeviation, lower, upper, quantile, targetValue });
};