import { MonteCarloScenario } from '../models/monte-carlo-contracts.model';
import {
  STUDENT_T_STANDARDIZATION,
  studentTCdf,
  studentTQuantile
} from '../probability/monte-carlo-probability';

const BISECTION_TOLERANCE = 1e-10;
const BISECTION_MAX_ITERATIONS = 100;
const REPORT_GRID_SIZE = 8193;
const VALIDATION_GRID_SIZE = 8191;
const EXACT_MINUS_ONE_TOLERANCE = 1e-12;

interface RegimeDefinition {
  name: string;
  targetAnnualCagr: number;
  annualVolatility: number;
}

interface RegimeDiagnostics {
  regime: string;
  targetAnnualCagr: number;
  annualVolatility: number;
  sigmaMonthly: number;
  targetLogGrowthMonthly: number;
  calibratedMuMonthly: number;
  calibratedMuAnnualCompoundedEquivalent: number;
  validationMeanSimpleReturnMonthly: number;
  validationMeanLogGrowthMonthly: number;
  validationImpliedCagr: number;
  cagrErrorAbsolute: number;
  cagrErrorBps: number;
  physicalFloorRejectCount: number;
  physicalFloorRejectRate: number;
  exactMinusOneCount: number;
  currentFormulaMuMonthly: number;
  currentFormulaImpliedCagr: number;
  currentFormulaCagrErrorBps: number;
  acceptanceProbability: number;
}

interface IntensityInterpolationResult {
  regime: string;
  intensity: number;
  targetLogEff: number;
  targetCagrEff: number;
  sigmaEff: number;
  muEffMonthly: number;
  impliedCagr: number;
  cagrErrorBps: number;
}

interface VolatilitySensitivityResult {
  volatility: number;
  calibratedMuMonthly: number;
  impliedCagr: number;
  cagrErrorBps: number;
}

const REGIMES: RegimeDefinition[] = [
  { name: 'GENERAL', targetAnnualCagr: 0.08, annualVolatility: 0.165 },
  { name: 'EXPANSION', targetAnnualCagr: 0.135, annualVolatility: 0.155 },
  { name: 'SOFT_LANDING', targetAnnualCagr: 0.105, annualVolatility: 0.135 },
  { name: 'RECESSION', targetAnnualCagr: -0.14, annualVolatility: 0.24 },
  { name: 'STAGFLATION', targetAnnualCagr: -0.06, annualVolatility: 0.20 }
] as const;

const constantPdfStudentT5 = (x: number): number => {
  const degreesOfFreedom = 5;
  const gammaFactor = Math.exp(
    0.5 * Math.log(Math.PI * degreesOfFreedom) +
    (degreesOfFreedom / 2) * Math.log(degreesOfFreedom) -
    Math.log(2) -
    Math.log(Math.sqrt(Math.PI))
  );
  const denominator = gammaFactor * Math.pow(1 + (x * x) / degreesOfFreedom, (degreesOfFreedom + 1) / 2);
  return 1 / denominator;
};

const buildDeterministicShockGrid = (sampleSize: number, offset: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + offset) / (sampleSize + 1);
    const value = studentTQuantile(probability) * STUDENT_T_STANDARDIZATION;
    shocks.push(value);
  }
  return shocks;
};

const evaluateLogGrowthMoment = (
  muMonthly: number,
  sigmaMonthly: number,
  shockGrid: number[]
): {
  meanLogGrowth: number;
  meanSimpleReturn: number;
  physicalFloorRejectCount: number;
  exactMinusOneCount: number;
  acceptanceRate: number;
} => {
  let totalLogGrowth = 0;
  let totalSimpleReturn = 0;
  let acceptedCount = 0;
  let physicalFloorRejectCount = 0;
  let exactMinusOneCount = 0;

  for (const shock of shockGrid) {
    const grossReturn = 1 + muMonthly + sigmaMonthly * shock;
    if (grossReturn <= 0) {
      if (Math.abs(grossReturn + 1) <= EXACT_MINUS_ONE_TOLERANCE) {
        exactMinusOneCount += 1;
      } else {
        physicalFloorRejectCount += 1;
      }
      continue;
    }
    const simpleReturn = muMonthly + sigmaMonthly * shock;
    const logGrowth = Math.log(grossReturn);
    totalLogGrowth += logGrowth;
    totalSimpleReturn += simpleReturn;
    acceptedCount += 1;
  }

  const acceptanceRate = acceptedCount / shockGrid.length;
  return {
    meanLogGrowth: acceptedCount === 0 ? Number.NaN : totalLogGrowth / acceptedCount,
    meanSimpleReturn: acceptedCount === 0 ? Number.NaN : totalSimpleReturn / acceptedCount,
    physicalFloorRejectCount,
    exactMinusOneCount,
    acceptanceRate
  };
};

const solveCalibratedMuMonthly = (targetLogGrowthMonthly: number, sigmaMonthly: number): {
  muMonthly: number;
  diagnostics: ReturnType<typeof evaluateLogGrowthMoment>;
} => {
  const baseGrid = buildDeterministicShockGrid(REPORT_GRID_SIZE, 0.5);
  const lowerBracket = -0.9999;
  let lowerMu = lowerBracket;
  let lowerValue = evaluateLogGrowthMoment(lowerMu, sigmaMonthly, baseGrid).meanLogGrowth;
  let upperMu = 0.25;
  let upperValue = evaluateLogGrowthMoment(upperMu, sigmaMonthly, baseGrid).meanLogGrowth;

  while (Number.isFinite(lowerValue) && lowerValue > targetLogGrowthMonthly) {
    lowerMu -= 0.5;
    lowerValue = evaluateLogGrowthMoment(lowerMu, sigmaMonthly, baseGrid).meanLogGrowth;
    if (!Number.isFinite(lowerValue)) {
      throw new Error(`Bisection lower bracket failed for target ${targetLogGrowthMonthly}`);
    }
  }

  while (upperValue < targetLogGrowthMonthly) {
    upperMu *= 2;
    upperValue = evaluateLogGrowthMoment(upperMu, sigmaMonthly, baseGrid).meanLogGrowth;
    if (!Number.isFinite(upperValue) || upperMu > 10) {
      throw new Error(`Bisection upper bracket failed for target ${targetLogGrowthMonthly}`);
    }
  }

  let left = lowerMu;
  let right = upperMu;
  let leftValue = evaluateLogGrowthMoment(left, sigmaMonthly, baseGrid).meanLogGrowth;
  let rightValue = evaluateLogGrowthMoment(right, sigmaMonthly, baseGrid).meanLogGrowth;

  for (let iteration = 0; iteration < BISECTION_MAX_ITERATIONS; iteration += 1) {
    const midpoint = (left + right) / 2;
    const midpointValue = evaluateLogGrowthMoment(midpoint, sigmaMonthly, baseGrid).meanLogGrowth;
    if (Math.abs(midpointValue - targetLogGrowthMonthly) <= BISECTION_TOLERANCE) {
      const diagnostics = evaluateLogGrowthMoment(midpoint, sigmaMonthly, baseGrid);
      return { muMonthly: midpoint, diagnostics };
    }
    if (midpointValue < targetLogGrowthMonthly) {
      left = midpoint;
      leftValue = midpointValue;
    } else {
      right = midpoint;
      rightValue = midpointValue;
    }

    if (Math.abs(right - left) <= BISECTION_TOLERANCE) {
      const finalMu = (left + right) / 2;
      const diagnostics = evaluateLogGrowthMoment(finalMu, sigmaMonthly, baseGrid);
      return { muMonthly: finalMu, diagnostics };
    }
  }

  throw new Error(`Bisection did not converge for target ${targetLogGrowthMonthly}`);
};

const annualizedFromMonthlyLogReturn = (monthlyLogGrowth: number): number => Math.exp(12 * monthlyLogGrowth) - 1;

const runSingleRegime = (definition: RegimeDefinition): RegimeDiagnostics => {
  const sigmaMonthly = definition.annualVolatility / Math.sqrt(12);
  const targetLogGrowthMonthly = Math.log(1 + definition.targetAnnualCagr) / 12;

  const calibration = solveCalibratedMuMonthly(targetLogGrowthMonthly, sigmaMonthly);
  const calibratedMuMonthly = calibration.muMonthly;
  const calibratedEquivalentAnnual = annualizedFromMonthlyLogReturn(
    evaluateLogGrowthMoment(calibratedMuMonthly, sigmaMonthly, buildDeterministicShockGrid(REPORT_GRID_SIZE, 0.5)).meanLogGrowth
  );

  const validationGrid = buildDeterministicShockGrid(VALIDATION_GRID_SIZE, 0.25);
  const validationResult = evaluateLogGrowthMoment(calibratedMuMonthly, sigmaMonthly, validationGrid);
  const impliedAnnualCagr = annualizedFromMonthlyLogReturn(validationResult.meanLogGrowth);
  const cagrErrorAbsolute = Math.abs(impliedAnnualCagr - definition.targetAnnualCagr);
  const cagrErrorBps = cagrErrorAbsolute * 10000;

  const currentMuMonthly = Math.pow(1 + definition.targetAnnualCagr, 1 / 12) - 1;
  const currentFormulaResult = evaluateLogGrowthMoment(currentMuMonthly, sigmaMonthly, validationGrid);
  const currentFormulaImpliedCagr = annualizedFromMonthlyLogReturn(currentFormulaResult.meanLogGrowth);
  const currentFormulaCagrErrorBps = Math.abs(currentFormulaImpliedCagr - definition.targetAnnualCagr) * 10000;

  return {
    regime: definition.name,
    targetAnnualCagr: definition.targetAnnualCagr,
    annualVolatility: definition.annualVolatility,
    sigmaMonthly,
    targetLogGrowthMonthly,
    calibratedMuMonthly,
    calibratedMuAnnualCompoundedEquivalent: calibratedEquivalentAnnual,
    validationMeanSimpleReturnMonthly: validationResult.meanSimpleReturn,
    validationMeanLogGrowthMonthly: validationResult.meanLogGrowth,
    validationImpliedCagr: impliedAnnualCagr,
    cagrErrorAbsolute,
    cagrErrorBps,
    physicalFloorRejectCount: validationResult.physicalFloorRejectCount,
    physicalFloorRejectRate: validationResult.physicalFloorRejectCount / validationGrid.length,
    exactMinusOneCount: validationResult.exactMinusOneCount,
    currentFormulaMuMonthly: currentMuMonthly,
    currentFormulaImpliedCagr,
    currentFormulaCagrErrorBps,
    acceptanceProbability: validationResult.acceptanceRate
  };
};

const solveIntensityCalibration = (general: RegimeDefinition, scenario: RegimeDefinition, intensity: number): IntensityInterpolationResult => {
  const generalSigmaMonthly = general.annualVolatility / Math.sqrt(12);
  const scenarioSigmaMonthly = scenario.annualVolatility / Math.sqrt(12);
  const targetLogGeneral = Math.log(1 + general.targetAnnualCagr) / 12;
  const targetLogScenario = Math.log(1 + scenario.targetAnnualCagr) / 12;
  const targetLogEff = targetLogGeneral + intensity * (targetLogScenario - targetLogGeneral);
  const sigmaEff = generalSigmaMonthly + intensity * (scenarioSigmaMonthly - generalSigmaMonthly);
  const baseGrid = buildDeterministicShockGrid(REPORT_GRID_SIZE, 0.5);

  const lowerBracket = -0.9999;
  let lowerMu = lowerBracket;
  let lowerValue = evaluateLogGrowthMoment(lowerMu, sigmaEff, baseGrid).meanLogGrowth;
  let upperMu = 0.25;
  let upperValue = evaluateLogGrowthMoment(upperMu, sigmaEff, baseGrid).meanLogGrowth;

  while (Number.isFinite(lowerValue) && lowerValue > targetLogEff) {
    lowerMu -= 0.5;
    lowerValue = evaluateLogGrowthMoment(lowerMu, sigmaEff, baseGrid).meanLogGrowth;
  }

  while (upperValue < targetLogEff) {
    upperMu *= 2;
    upperValue = evaluateLogGrowthMoment(upperMu, sigmaEff, baseGrid).meanLogGrowth;
    if (!Number.isFinite(upperValue) || upperMu > 10) {
      throw new Error(`Intensity interpolation failed to bracket target ${targetLogEff}`);
    }
  }

  let left = lowerMu;
  let right = upperMu;
  for (let iteration = 0; iteration < BISECTION_MAX_ITERATIONS; iteration += 1) {
    const midpoint = (left + right) / 2;
    const midpointValue = evaluateLogGrowthMoment(midpoint, sigmaEff, baseGrid).meanLogGrowth;
    if (Math.abs(midpointValue - targetLogEff) <= BISECTION_TOLERANCE) {
      const validationGrid = buildDeterministicShockGrid(VALIDATION_GRID_SIZE, 0.25);
      const validationResult = evaluateLogGrowthMoment(midpoint, sigmaEff, validationGrid);
      const impliedCagr = annualizedFromMonthlyLogReturn(validationResult.meanLogGrowth);
      return {
        regime: `${general.name}→${scenario.name}`,
        intensity,
        targetLogEff,
        targetCagrEff: annualizedFromMonthlyLogReturn(targetLogEff),
        sigmaEff,
        muEffMonthly: midpoint,
        impliedCagr,
        cagrErrorBps: Math.abs(impliedCagr - annualizedFromMonthlyLogReturn(targetLogEff)) * 10000
      };
    }
    if (midpointValue < targetLogEff) {
      left = midpoint;
    } else {
      right = midpoint;
    }
  }

  throw new Error(`Intensity interpolation did not converge for ${general.name}→${scenario.name} at I=${intensity}`);
};

const runVolatilitySensitivity = (): VolatilitySensitivityResult[] => {
  const targetCagr = 0.08;
  const volatilities = [0.10, 0.165, 0.20, 0.25, 0.30];
  const results: VolatilitySensitivityResult[] = [];

  for (const volatility of volatilities) {
    const sigmaMonthly = volatility / Math.sqrt(12);
    const targetLogGrowth = Math.log(1 + targetCagr) / 12;
    const calibration = solveCalibratedMuMonthly(targetLogGrowth, sigmaMonthly);
    const validationGrid = buildDeterministicShockGrid(VALIDATION_GRID_SIZE, 0.25);
    const validationResult = evaluateLogGrowthMoment(calibration.muMonthly, sigmaMonthly, validationGrid);
    const impliedCagr = annualizedFromMonthlyLogReturn(validationResult.meanLogGrowth);
    results.push({
      volatility,
      calibratedMuMonthly: calibration.muMonthly,
      impliedCagr,
      cagrErrorBps: Math.abs(impliedCagr - targetCagr) * 10000
    });
  }

  return results;
};

const formatNumber = (value: number): string => Number.isFinite(value) ? value.toFixed(12) : 'NaN';

const printSummaryTables = (): void => {
  const results = REGIMES.map(runSingleRegime);

  console.log('=== CAG R CALIBRATION POC ===');
  console.table(results.map((result) => ({
    REGIME: result.regime,
    TARGET_CAGR: formatNumber(result.targetAnnualCagr),
    ANNUAL_VOLATILITY: formatNumber(result.annualVolatility),
    SIGMA_MONTHLY: formatNumber(result.sigmaMonthly),
    TARGET_LOG_GROWTH_MONTHLY: formatNumber(result.targetLogGrowthMonthly),
    CALIBRATED_MU_MONTHLY: formatNumber(result.calibratedMuMonthly),
    CALIBRATED_MU_ANNUAL_COMPOUNDED_EQUIVALENT: formatNumber(result.calibratedMuAnnualCompoundedEquivalent),
    VALIDATION_MEAN_SIMPLE_RETURN_MONTHLY: formatNumber(result.validationMeanSimpleReturnMonthly),
    VALIDATION_MEAN_LOG_GROWTH_MONTHLY: formatNumber(result.validationMeanLogGrowthMonthly),
    VALIDATION_IMPLIED_CAGR: formatNumber(result.validationImpliedCagr),
    CAGR_ERROR_ABSOLUTE: formatNumber(result.cagrErrorAbsolute),
    CAGR_ERROR_BPS: formatNumber(result.cagrErrorBps),
    PHYSICAL_FLOOR_REJECT_COUNT: result.physicalFloorRejectCount,
    PHYSICAL_FLOOR_REJECT_RATE: formatNumber(result.physicalFloorRejectRate),
    EXACT_MINUS_ONE_COUNT: result.exactMinusOneCount,
    CURRENT_FORMULA_MU: formatNumber(result.currentFormulaMuMonthly),
    CURRENT_FORMULA_IMPLIED_CAGR: formatNumber(result.currentFormulaImpliedCagr),
    CURRENT_FORMULA_CAGR_ERROR_BPS: formatNumber(result.currentFormulaCagrErrorBps),
    ACCEPTANCE_PROBABILITY: formatNumber(result.acceptanceProbability)
  })));

  const intensityPairs = [
    { general: REGIMES[0], scenario: REGIMES[1] },
    { general: REGIMES[0], scenario: REGIMES[2] },
    { general: REGIMES[0], scenario: REGIMES[3] },
    { general: REGIMES[0], scenario: REGIMES[4] }
  ];

  const intensityResults: IntensityInterpolationResult[] = [];
  for (const pair of intensityPairs) {
    for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
      intensityResults.push(solveIntensityCalibration(pair.general, pair.scenario, intensity));
    }
  }

  console.log('=== INTENSITY INTERPOLATION RESULTS ===');
  console.table(intensityResults.map((result) => ({
    REGIME: result.regime,
    INTENSITY: result.intensity,
    TARGET_LOG_EFF: formatNumber(result.targetLogEff),
    TARGET_CAGR_EFF: formatNumber(result.targetCagrEff),
    SIGMA_EFF: formatNumber(result.sigmaEff),
    MU_EFF_MONTHLY: formatNumber(result.muEffMonthly),
    IMPLIED_CAGR: formatNumber(result.impliedCagr),
    CAGR_ERROR_BPS: formatNumber(result.cagrErrorBps)
  })));

  const sensitivityResults = runVolatilitySensitivity();
  console.log('=== VOLATILITY SENSITIVITY ===');
  console.table(sensitivityResults.map((result) => ({
    VOLATILITY: formatNumber(result.volatility),
    CALIBRATED_MU_MONTHLY: formatNumber(result.calibratedMuMonthly),
    IMPLIED_CAGR: formatNumber(result.impliedCagr),
    CAGR_ERROR_BPS: formatNumber(result.cagrErrorBps)
  })));

  const maxEndpointErrorBps = Math.max(...results.map((result) => result.cagrErrorBps));
  const buildResult = maxEndpointErrorBps <= 10 ? 'PASS' : 'FAIL';
  console.log('MAX_ENDPOINT_CAGR_ERROR_BPS', formatNumber(maxEndpointErrorBps));
  console.log('ALL_ENDPOINTS_WITHIN_10_BPS', buildResult === 'PASS');
  console.log('BUILD_RESULT', buildResult);
};

export const runMonteCarloCagrCalibrationPoc = (): void => {
  printSummaryTables();
};

if (typeof document === 'undefined') {
  runMonteCarloCagrCalibrationPoc();
}

export const monteCarloCagrCalibrationReport = {
  regimes: REGIMES,
  solverTolerance: BISECTION_TOLERANCE,
  solverMaxIterations: BISECTION_MAX_ITERATIONS,
  expectationMethod: 'Deterministic quantile-grid conditional expectation under the same Student-t ν=5 distribution and R >= -1 floor rule used by production.',
  calibrationMethod: 'Bisection on the conditional expectation of log growth, using a deterministic Student-t shock grid and no Monte Carlo redraws during the solver loop.'
};

export const monteCarloCagrCalibrationSummary = () => {
  const results = REGIMES.map(runSingleRegime);
  const maxEndpointErrorBps = Math.max(...results.map((result) => result.cagrErrorBps));
  return {
    filesCreated: ['src/app/core/diagnostics/monte-carlo-cagr-calibration.poc.ts'],
    filesChanged: [],
    productionFilesChanged: false,
    calibrationMethod: 'Bisection on deterministic conditional log-growth expectation',
    numericalExpectationMethod: 'Quantile-grid integration of the Student-t ν=5 law with the same physical floor rule R >= -1',
    solverMethod: 'Bisection with tolerance 1e-10 and max 100 iterations',
    generalResult: results[0],
    expansionResult: results[1],
    softLandingResult: results[2],
    recessionResult: results[3],
    stagflationResult: results[4],
    maxEndpointCagrErrorBps: maxEndpointErrorBps,
    allEndpointsWithin10Bps: maxEndpointErrorBps <= 10,
    buildResult: maxEndpointErrorBps <= 10 ? 'PASS' : 'FAIL'
  };
};
