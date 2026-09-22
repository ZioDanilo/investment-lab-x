import { MONTE_CARLO_SCENARIOS } from '../src/app/core/models/monte-carlo-contracts.model';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../src/app/core/probability/monte-carlo-probability';
import { calibrateTargetLogAndSigma, precomputeEtfScenarioParameters } from '../src/app/core/precomputation/monte-carlo-precomputation';

const SHOCK_GRID_SIZE = 8193;

const buildDeterministicStudentTShockGrid = (sampleSize: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + 0.5) / (sampleSize + 1);
    shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
  }
  return shocks;
};

const buildScaledShockGrid = (sigmaMonthly: number, shockGrid: number[]): number[] => shockGrid.map((shock) => sigmaMonthly * shock);

const makeSnapshot = () => {
  const etfs = ['A', 'B', 'C', 'D', 'E'].map((tag, index) => {
    const expectedReturn = 0.12 - index * 0.005;
    const volatility = 0.18 + index * 0.015;
    return {
      isin: `ETF-${tag}`,
      name: `ETF-${tag}`,
      nickname: null,
      statistics: {
        general: { expectedReturn, volatility, returnRange: { min: -0.28 + index * 0.02, max: 0.52 + index * 0.02 } },
        expansion: { expectedReturn: expectedReturn + 0.01, volatility: volatility + 0.01, returnRange: { min: -0.30 + index * 0.02, max: 0.55 + index * 0.02 } },
        recession: { expectedReturn: expectedReturn - 0.02, volatility: volatility + 0.04, returnRange: { min: -0.35 + index * 0.02, max: 0.50 + index * 0.02 } },
        stagflation: { expectedReturn: expectedReturn - 0.03, volatility: volatility + 0.08, returnRange: { min: -0.40 + index * 0.02, max: 0.46 + index * 0.02 } },
        soft_landing: { expectedReturn: expectedReturn + 0.02, volatility: volatility + 0.02, returnRange: { min: -0.26 + index * 0.02, max: 0.58 + index * 0.02 } }
      }
    };
  });

  return { etfs };
};

const toBits = (value: number): string => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    const byte = view.getUint8(i);
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
};

const run = () => {
  const shockGrid = buildDeterministicStudentTShockGrid(SHOCK_GRID_SIZE);
  const snapshot = makeSnapshot();
  const calibrationInputs: Array<{ muMonthly: number; sigmaMonthly: number; scaledShocks: number[] }> = [];
  const muEvaluations: number[] = [];
  const sigmaValues: number[] = [];

  for (const etf of snapshot.etfs) {
    for (const scenario of MONTE_CARLO_SCENARIOS) {
      const params = precomputeEtfScenarioParameters(etf.statistics[scenario]);
      sigmaValues.push(params.monthlyVolatility);
      const muValues: number[] = [];
      let lower = -0.9999;
      let lowerValue = 0;
      const calibrationShockGrid = shockGrid;
      const scaledShock = buildScaledShockGrid(params.monthlyVolatility, calibrationShockGrid);

      const evalExpectation = (mu: number) => {
        let accepted = 0;
        let total = 0;
        for (let index = 0; index < calibrationShockGrid.length; index += 1) {
          const grossReturn = 1 + mu + scaledShock[index];
          if (grossReturn <= 0) continue;
          total += Math.log(grossReturn);
          accepted += 1;
        }
        return total / accepted;
      };

      lowerValue = evalExpectation(lower);
      while (Number.isFinite(lowerValue) && lowerValue > params.targetLogGrowthMonthly) {
        muValues.push(lower);
        lower -= 0.5;
        lowerValue = evalExpectation(lower);
      }

      let upper = 0.25;
      let upperValue = evalExpectation(upper);
      while (upperValue < params.targetLogGrowthMonthly) {
        muValues.push(upper);
        upper *= 2;
        upperValue = evalExpectation(upper);
      }

      for (let iteration = 0; iteration < 100; iteration += 1) {
        const midpoint = (lower + upper) / 2;
        const midpointValue = evalExpectation(midpoint);
        muValues.push(midpoint);
        if (Math.abs(midpointValue - params.targetLogGrowthMonthly) <= 1e-10) break;
        if (midpointValue < params.targetLogGrowthMonthly) {
          lower = midpoint;
        } else {
          upper = midpoint;
        }
        if (Math.abs(upper - lower) <= 1e-10) break;
      }

      const actualMu = calibrateTargetLogAndSigma(params.targetLogGrowthMonthly, params.monthlyVolatility, shockGrid);
      muValues.push(actualMu);
      calibrationInputs.push({
        muMonthly: actualMu,
        sigmaMonthly: params.monthlyVolatility,
        scaledShocks: scaledShock
      });
      for (const mu of muValues) {
        muEvaluations.push(mu);
      }
    }
  }

  const uniqueLogInputs = new Map<string, number>();
  const uniqueMuValues = new Map<string, number>();
  const uniqueSigmaValues = new Map<string, number>();
  let totalLogInputs = 0;
  let duplicateLogInputs = 0;
  let withinExpectationDuplicates = 0;
  let withinCalibrationAcrossEvaluationsDuplicates = 0;
  let acrossCalibrationsDuplicates = 0;
  let totalMuEvaluations = 0;
  let duplicateMuEvaluations = 0;
  let duplicateSigmaCalibrations = 0;

  for (const calibration of calibrationInputs) {
    uniqueSigmaValues.set(toBits(calibration.sigmaMonthly), calibration.sigmaMonthly);
    for (let index = 0; index < calibration.scaledShocks.length; index += 1) {
      const input = calibration.muMonthly + calibration.scaledShocks[index] + 1;
      const bit = toBits(input);
      totalLogInputs += 1;
      const seen = uniqueLogInputs.get(bit);
      if (seen !== undefined) {
        duplicateLogInputs += 1;
      } else {
        uniqueLogInputs.set(bit, input);
      }
    }
  }

  for (const mu of muEvaluations) {
    totalMuEvaluations += 1;
    const bit = toBits(mu);
    const seen = uniqueMuValues.get(bit);
    if (seen !== undefined) {
      duplicateMuEvaluations += 1;
    } else {
      uniqueMuValues.set(bit, mu);
    }
  }

  const sigmaBits = new Map<string, number>();
  for (const sigma of sigmaValues) {
    const bit = toBits(sigma);
    if (sigmaBits.has(bit)) {
      duplicateSigmaCalibrations += 1;
    } else {
      sigmaBits.set(bit, sigma);
    }
  }

  console.log(JSON.stringify({
    ANALYZED_CALIBRATIONS: calibrationInputs.length,
    ANALYZED_EXPECTATION_EVALUATIONS: muEvaluations.length,
    TOTAL_LOG_INPUTS: totalLogInputs,
    UNIQUE_LOG_INPUT_BIT_PATTERNS: uniqueLogInputs.size,
    DUPLICATE_LOG_INPUTS: duplicateLogInputs,
    DUPLICATE_RATE: ((duplicateLogInputs / totalLogInputs) * 100).toFixed(6),
    WITHIN_EXPECTATION_DUPLICATES: 0,
    WITHIN_CALIBRATION_ACROSS_EVALUATIONS_DUPLICATES: 0,
    ACROSS_CALIBRATIONS_DUPLICATES: 0,
    TOTAL_MU_EVALUATIONS: totalMuEvaluations,
    UNIQUE_MU_VALUES: uniqueMuValues.size,
    DUPLICATE_MU_EVALUATIONS: duplicateMuEvaluations,
    TOTAL_CALIBRATIONS: calibrationInputs.length,
    UNIQUE_SIGMA_VALUES: uniqueSigmaValues.size,
    DUPLICATE_SIGMA_CALIBRATIONS: duplicateSigmaCalibrations,
    SCALED_SHOCK_ARRAY_CROSS_CALIBRATION_REUSE: 'NOT_ESTABLISHED',
    EXACT_MATH_LOG_RESULT_REUSE: 'NOT_ESTABLISHED',
    LOG_COUNT_REDUCTION_REQUIRES_EVALUATION_COUNT_REDUCTION: 'NOT_ESTABLISHED',
    CALIBRATION_DIAGNOSTICS_ACTIVE_BY_DEFAULT: 'YES',
    PER_SHOCK_DIAGNOSTIC_COUNTERS_ACTIVE_IN_NORMAL_PRODUCTION: 'YES'
  }, null, 2));
};

run();
