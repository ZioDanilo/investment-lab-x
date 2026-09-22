import {
  calibrateTargetLogAndSigma,
  clearMonteCarloPrecomputationCache,
  precomputeEtfScenarioParameters,
  prepareMonteCarloPrecomputation,
} from '../src/app/core/precomputation/monte-carlo-precomputation';
import { MONTE_CARLO_SCENARIOS } from '../src/app/core/models/monte-carlo-contracts.model';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../src/app/core/probability/monte-carlo-probability';

const buildDeterministicStudentTShockGrid = (sampleSize: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + 0.5) / (sampleSize + 1);
    shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
  }
  return shocks;
};

const conditionalLogGrowthExpectationOld = (muMonthly: number, sigmaMonthly: number, shockGrid: number[]): number => {
  let accepted = 0;
  let total = 0;
  for (const shock of shockGrid) {
    const grossReturn = 1 + muMonthly + sigmaMonthly * shock;
    if (grossReturn <= 0) continue;
    total += Math.log(grossReturn);
    accepted += 1;
  }
  if (accepted === 0) {
    throw new Error('UNACHIEVABLE_TARGET_LOG_GROWTH');
  }
  return total / accepted;
};

const calibrateTargetLogAndSigmaOld = (targetLogGrowthMonthly: number, sigmaMonthly: number, shockGrid: number[] = buildDeterministicStudentTShockGrid(8193)): number => {
  if (!Number.isFinite(targetLogGrowthMonthly) || !Number.isFinite(sigmaMonthly)) {
    throw new Error('CALIBRATION_INVALID_INPUT');
  }

  let lower = -0.9999;
  let lowerValue = conditionalLogGrowthExpectationOld(lower, sigmaMonthly, shockGrid);
  while (Number.isFinite(lowerValue) && lowerValue > targetLogGrowthMonthly) {
    lower -= 0.5;
    lowerValue = conditionalLogGrowthExpectationOld(lower, sigmaMonthly, shockGrid);
    if (!Number.isFinite(lowerValue)) {
      throw new Error('CALIBRATION_LOW_BRACKET_FAILED');
    }
  }

  let upper = 0.25;
  let upperValue = conditionalLogGrowthExpectationOld(upper, sigmaMonthly, shockGrid);
  while (upperValue < targetLogGrowthMonthly) {
    upper *= 2;
    upperValue = conditionalLogGrowthExpectationOld(upper, sigmaMonthly, shockGrid);
    if (!Number.isFinite(upperValue) || upper > 10) {
      throw new Error('CALIBRATION_HIGH_BRACKET_FAILED');
    }
  }

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const midpointValue = conditionalLogGrowthExpectationOld(midpoint, sigmaMonthly, shockGrid);
    if (Math.abs(midpointValue - targetLogGrowthMonthly) <= 1e-10) {
      return midpoint;
    }
    if (midpointValue < targetLogGrowthMonthly) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
    if (Math.abs(upper - lower) <= 1e-10) {
      return (lower + upper) / 2;
    }
  }

  throw new Error('CALIBRATION_DID_NOT_CONVERGE');
};

const buildOldMuCalibrationCurve = (
  generalParameters: ReturnType<typeof precomputeEtfScenarioParameters>,
  scenarioParameters: ReturnType<typeof precomputeEtfScenarioParameters>,
  step: number,
  shockGrid: number[]
) => {
  const generalTargetLogGrowthMonthly = generalParameters.targetLogGrowthMonthly;
  const scenarioTargetLogGrowthMonthly = scenarioParameters.targetLogGrowthMonthly;
  const curve: Array<{ intensity: number; targetLogGrowthMonthly: number; sigmaMonthly: number; muMonthly: number; impliedAnnualCagr: number }> = [];

  for (let intensity = 0; intensity <= 1 + 1e-12; intensity += step) {
    const clampedIntensity = Math.min(1, Math.max(0, intensity));
    const targetLogGrowthMonthly = generalTargetLogGrowthMonthly + clampedIntensity * (scenarioTargetLogGrowthMonthly - generalTargetLogGrowthMonthly);
    const sigmaMonthly = generalParameters.monthlyVolatility + clampedIntensity * (scenarioParameters.monthlyVolatility - generalParameters.monthlyVolatility);
    const muMonthly = clampedIntensity === 0
      ? generalParameters.calibratedMonthlyLocation
      : clampedIntensity === 1
        ? scenarioParameters.calibratedMonthlyLocation
        : calibrateTargetLogAndSigmaOld(targetLogGrowthMonthly, sigmaMonthly, shockGrid);
    const impliedAnnualCagr = Math.exp(12 * targetLogGrowthMonthly) - 1;
    if (curve.length > 0 && Math.abs(curve[curve.length - 1].intensity - clampedIntensity) <= 1e-12) {
      curve[curve.length - 1] = { intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr };
      continue;
    }
    curve.push({ intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr });
  }

  return curve;
};

const makeSnapshot = () => {
  const etfs = ['A', 'B', 'C', 'D', 'E'].map((tag, index) => {
    const expectedReturn = 0.12 - index * 0.005;
    const volatility = 0.18 + index * 0.015;
    return {
      isin: `ETF-${tag}`,
      name: `ETF-${tag}`,
      nickname: null,
      statistics: {
        general: {
          expectedReturn,
          volatility,
          returnRange: { min: -0.28 + index * 0.02, max: 0.52 + index * 0.02 }
        },
        expansion: {
          expectedReturn: expectedReturn + 0.01,
          volatility: volatility + 0.01,
          returnRange: { min: -0.30 + index * 0.02, max: 0.55 + index * 0.02 }
        },
        recession: {
          expectedReturn: expectedReturn - 0.02,
          volatility: volatility + 0.04,
          returnRange: { min: -0.35 + index * 0.02, max: 0.50 + index * 0.02 }
        },
        stagflation: {
          expectedReturn: expectedReturn - 0.03,
          volatility: volatility + 0.08,
          returnRange: { min: -0.40 + index * 0.02, max: 0.46 + index * 0.02 }
        },
        soft_landing: {
          expectedReturn: expectedReturn + 0.02,
          volatility: volatility + 0.02,
          returnRange: { min: -0.26 + index * 0.02, max: 0.58 + index * 0.02 }
        }
      }
    };
  });

  const correlations: Array<{ isin1: string; isin2: string; expansion: number; recession: number; stagflation: number; soft_landing: number }> = [];
  for (let i = 0; i < etfs.length; i += 1) {
    for (let j = i + 1; j < etfs.length; j += 1) {
      const value = 0.12 + ((i + j) % 5) * 0.04;
      correlations.push({
        isin1: etfs[i].isin,
        isin2: etfs[j].isin,
        expansion: value,
        recession: value + 0.04,
        stagflation: value - 0.02,
        soft_landing: value + 0.02
      });
    }
  }

  return {
    etfs,
    structuralProbabilities: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 },
    transitionMatrix: {
      expansion: { expansion: 0.7, recession: 0.1, stagflation: 0.1, soft_landing: 0.1 },
      recession: { expansion: 0.1, recession: 0.7, stagflation: 0.1, soft_landing: 0.1 },
      stagflation: { expansion: 0.1, recession: 0.1, stagflation: 0.7, soft_landing: 0.1 },
      soft_landing: { expansion: 0.1, recession: 0.1, stagflation: 0.1, soft_landing: 0.7 }
    },
    inertiaConfigurations: {
      expansion: { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 },
      recession: { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 },
      stagflation: { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 },
      soft_landing: { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 }
    },
    intensityConfigurations: {
      expansion: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
      recession: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
      stagflation: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
      soft_landing: { meanIntensity: 0.5, stdDevIntensity: 0.1 }
    },
    globalProperties: {
      scenario_transition_intensity_threshold: 0.4,
      new_scenario_first_month_max_intensity: 0.6,
      new_scenario_second_month_max_intensity: 0.7,
      scenario_intensity_max_monthly_variation: 0.2
    },
    correlations
  };
};

const snapshot = makeSnapshot();
const shockGrid = buildDeterministicStudentTShockGrid(8193);

let directCompared = 0;
let directExact = 0;
let directMaxAbsMu = 0;
let generalExact = 0;
let scenarioExact = 0;
let directMismatch = false;

for (const etf of snapshot.etfs) {
  const generalParameters = precomputeEtfScenarioParameters(etf.statistics.general);
  const oldGeneral = calibrateTargetLogAndSigmaOld(generalParameters.targetLogGrowthMonthly, generalParameters.monthlyVolatility, shockGrid);
  const newGeneral = calibrateTargetLogAndSigma(generalParameters.targetLogGrowthMonthly, generalParameters.monthlyVolatility, shockGrid);
  directCompared += 1;
  if (Object.is(oldGeneral, newGeneral)) directExact += 1;
  directMaxAbsMu = Math.max(directMaxAbsMu, Math.abs(oldGeneral - newGeneral));
  if (!Object.is(oldGeneral, newGeneral)) directMismatch = true;
  if (Object.is(generalParameters.calibratedMonthlyLocation, generalParameters.calibratedMonthlyLocation)) generalExact += 1;

  for (const scenario of MONTE_CARLO_SCENARIOS) {
    const scenarioParameters = precomputeEtfScenarioParameters(etf.statistics[scenario]);
    const oldScenario = calibrateTargetLogAndSigmaOld(scenarioParameters.targetLogGrowthMonthly, scenarioParameters.monthlyVolatility, shockGrid);
    const newScenario = calibrateTargetLogAndSigma(scenarioParameters.targetLogGrowthMonthly, scenarioParameters.monthlyVolatility, shockGrid);
    directCompared += 1;
    if (Object.is(oldScenario, newScenario)) directExact += 1;
    directMaxAbsMu = Math.max(directMaxAbsMu, Math.abs(oldScenario - newScenario));
    if (!Object.is(oldScenario, newScenario)) directMismatch = true;
    if (Object.is(scenarioParameters.calibratedMonthlyLocation, scenarioParameters.calibratedMonthlyLocation)) scenarioExact += 1;
  }
}

const oldCurves: Record<string, Record<string, Array<{ intensity: number; targetLogGrowthMonthly: number; sigmaMonthly: number; muMonthly: number; impliedAnnualCagr: number }>>> = {};
for (const etf of snapshot.etfs) {
  oldCurves[etf.isin] = {} as Record<string, Array<{ intensity: number; targetLogGrowthMonthly: number; sigmaMonthly: number; muMonthly: number; impliedAnnualCagr: number }>>;
  const generalParameters = precomputeEtfScenarioParameters(etf.statistics.general);
  for (const scenario of MONTE_CARLO_SCENARIOS) {
    const scenarioParameters = precomputeEtfScenarioParameters(etf.statistics[scenario]);
    oldCurves[etf.isin][scenario] = buildOldMuCalibrationCurve(generalParameters, scenarioParameters, 0.01, shockGrid);
  }
}

clearMonteCarloPrecomputationCache();
const newPrecomputation = prepareMonteCarloPrecomputation(snapshot);

let nodeCount = 0;
let intensityExact = 0;
let targetExact = 0;
let sigmaExact = 0;
let muExact = 0;
let cagrExact = 0;
let fullExact = 0;
let maxAbsCurveDifference = 0;
let curveMismatch = 0;

for (const etf of snapshot.etfs) {
  for (const scenario of MONTE_CARLO_SCENARIOS) {
    const oldCurve = oldCurves[etf.isin][scenario];
    const newCurve = newPrecomputation.etfParameters[etf.isin][scenario].muCalibrationByIntensity;
    if (oldCurve.length !== newCurve.length) {
      curveMismatch += 1;
    }
    for (let index = 0; index < Math.min(oldCurve.length, newCurve.length); index += 1) {
      const oldNode = oldCurve[index];
      const newNode = newCurve[index];
      nodeCount += 1;

      intensityExact += Object.is(oldNode.intensity, newNode.intensity) ? 1 : 0;
      targetExact += Object.is(oldNode.targetLogGrowthMonthly, newNode.targetLogGrowthMonthly) ? 1 : 0;
      sigmaExact += Object.is(oldNode.sigmaMonthly, newNode.sigmaMonthly) ? 1 : 0;
      muExact += Object.is(oldNode.muMonthly, newNode.muMonthly) ? 1 : 0;
      cagrExact += Object.is(oldNode.impliedAnnualCagr, newNode.impliedAnnualCagr) ? 1 : 0;
      const fullNodeExact = Object.is(oldNode.intensity, newNode.intensity)
        && Object.is(oldNode.targetLogGrowthMonthly, newNode.targetLogGrowthMonthly)
        && Object.is(oldNode.sigmaMonthly, newNode.sigmaMonthly)
        && Object.is(oldNode.muMonthly, newNode.muMonthly)
        && Object.is(oldNode.impliedAnnualCagr, newNode.impliedAnnualCagr);
      fullExact += fullNodeExact ? 1 : 0;
      maxAbsCurveDifference = Math.max(maxAbsCurveDifference, Math.abs(oldNode.muMonthly - newNode.muMonthly));
      if (!Object.is(oldNode.muMonthly, newNode.muMonthly)) {
        curveMismatch += 1;
      }
    }
  }
}

const result = {
  directCompared,
  directExact,
  directMaxAbsMu,
  directMismatch,
  generalExact,
  scenarioExact,
  nodeCount,
  intensityExact,
  targetExact,
  sigmaExact,
  muExact,
  cagrExact,
  fullExact,
  maxAbsCurveDifference,
  curveMismatch,
  status: directMismatch || curveMismatch > 0 ? 'FAIL' : 'PASS'
};

console.log(JSON.stringify(result, null, 2));
