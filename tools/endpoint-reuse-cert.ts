import {
  clearMonteCarloPrecomputationCache,
  getLastMonteCarloPrecomputationDiagnostics,
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

const conditionalLogGrowthExpectation = (muMonthly: number, sigmaMonthly: number, shockGrid: number[]): number => {
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
  let lowerValue = conditionalLogGrowthExpectation(lower, sigmaMonthly, shockGrid);
  while (Number.isFinite(lowerValue) && lowerValue > targetLogGrowthMonthly) {
    lower -= 0.5;
    lowerValue = conditionalLogGrowthExpectation(lower, sigmaMonthly, shockGrid);
    if (!Number.isFinite(lowerValue)) {
      throw new Error('CALIBRATION_LOW_BRACKET_FAILED');
    }
  }

  let upper = 0.25;
  let upperValue = conditionalLogGrowthExpectation(upper, sigmaMonthly, shockGrid);
  while (upperValue < targetLogGrowthMonthly) {
    upper *= 2;
    upperValue = conditionalLogGrowthExpectation(upper, sigmaMonthly, shockGrid);
    if (!Number.isFinite(upperValue) || upper > 10) {
      throw new Error('CALIBRATION_HIGH_BRACKET_FAILED');
    }
  }

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const midpointValue = conditionalLogGrowthExpectation(midpoint, sigmaMonthly, shockGrid);
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

const oldBuildMuCalibrationCurve = (
  generalParameters: ReturnType<typeof precomputeEtfScenarioParameters>,
  scenarioParameters: ReturnType<typeof precomputeEtfScenarioParameters>,
  step: number,
  shockGrid: number[]
) => {
  const generalTargetLogGrowthMonthly = generalParameters.targetLogGrowthMonthly;
  const scenarioTargetLogGrowthMonthly = scenarioParameters.targetLogGrowthMonthly;
  const curve: any[] = [];

  for (let intensity = 0; intensity <= 1 + 1e-12; intensity += step) {
    const clampedIntensity = Math.min(1, Math.max(0, intensity));
    const targetLogGrowthMonthly = generalTargetLogGrowthMonthly + clampedIntensity * (scenarioTargetLogGrowthMonthly - generalTargetLogGrowthMonthly);
    const sigmaMonthly = generalParameters.monthlyVolatility + clampedIntensity * (scenarioParameters.monthlyVolatility - generalParameters.monthlyVolatility);
    const muMonthly = calibrateTargetLogAndSigmaOld(targetLogGrowthMonthly, sigmaMonthly, shockGrid);
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

  const correlations: any[] = [];
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
const oldCurves: Record<string, Record<string, any[]>> = {};

for (const etf of snapshot.etfs) {
  oldCurves[etf.isin] = {} as Record<string, any[]>;
  const generalParameters = precomputeEtfScenarioParameters(etf.statistics.general);
  for (const scenario of MONTE_CARLO_SCENARIOS) {
    const scenarioParameters = precomputeEtfScenarioParameters(etf.statistics[scenario]);
    oldCurves[etf.isin][scenario] = oldBuildMuCalibrationCurve(generalParameters, scenarioParameters, 0.01, shockGrid);
  }
}

clearMonteCarloPrecomputationCache();
const newPrecomputation = prepareMonteCarloPrecomputation(snapshot);

const metrics = {
  intensity: 0,
  target: 0,
  sigma: 0,
  mu: 0,
  cagr: 0,
  full: 0,
  total: 0,
  maxAbsTarget: 0,
  maxAbsSigma: 0,
  maxAbsMu: 0,
  maxAbsCagr: 0,
  curveLengthMismatch: 0
};

for (const etf of snapshot.etfs) {
  for (const scenario of MONTE_CARLO_SCENARIOS) {
    const oldCurve = oldCurves[etf.isin][scenario];
    const newCurve = newPrecomputation.etfParameters[etf.isin][scenario].muCalibrationByIntensity;
    if (oldCurve.length !== 101 || newCurve.length !== 101) {
      metrics.curveLengthMismatch += 1;
    }

    for (let index = 0; index < Math.min(oldCurve.length, newCurve.length); index += 1) {
      const oldNode = oldCurve[index];
      const newNode = newCurve[index];
      metrics.total += 1;
      metrics.intensity += Object.is(oldNode.intensity, newNode.intensity) ? 1 : 0;
      metrics.target += Object.is(oldNode.targetLogGrowthMonthly, newNode.targetLogGrowthMonthly) ? 1 : 0;
      metrics.sigma += Object.is(oldNode.sigmaMonthly, newNode.sigmaMonthly) ? 1 : 0;
      metrics.mu += Object.is(oldNode.muMonthly, newNode.muMonthly) ? 1 : 0;
      metrics.cagr += Object.is(oldNode.impliedAnnualCagr, newNode.impliedAnnualCagr) ? 1 : 0;
      const fullNode = Object.is(oldNode.intensity, newNode.intensity)
        && Object.is(oldNode.targetLogGrowthMonthly, newNode.targetLogGrowthMonthly)
        && Object.is(oldNode.sigmaMonthly, newNode.sigmaMonthly)
        && Object.is(oldNode.muMonthly, newNode.muMonthly)
        && Object.is(oldNode.impliedAnnualCagr, newNode.impliedAnnualCagr);
      metrics.full += fullNode ? 1 : 0;
      metrics.maxAbsTarget = Math.max(metrics.maxAbsTarget, Math.abs(oldNode.targetLogGrowthMonthly - newNode.targetLogGrowthMonthly));
      metrics.maxAbsSigma = Math.max(metrics.maxAbsSigma, Math.abs(oldNode.sigmaMonthly - newNode.sigmaMonthly));
      metrics.maxAbsMu = Math.max(metrics.maxAbsMu, Math.abs(oldNode.muMonthly - newNode.muMonthly));
      metrics.maxAbsCagr = Math.max(metrics.maxAbsCagr, Math.abs(oldNode.impliedAnnualCagr - newNode.impliedAnnualCagr));
    }
  }
}

if (metrics.intensity !== 2020 || metrics.target !== 2020 || metrics.sigma !== 2020 || metrics.mu !== 2020 || metrics.cagr !== 2020 || metrics.full !== 2020 || metrics.curveLengthMismatch !== 0) {
  console.log(JSON.stringify({ metrics, status: 'FAIL' }, null, 2));
  process.exit(1);
}

const diagnostics = getLastMonteCarloPrecomputationDiagnostics();
console.log(JSON.stringify({
  status: 'PASS',
  metrics,
  diagnostics,
  structuralCallReduction: { oldCalls: 2020, newCalls: 1980, eliminated: 40, reductionPercent: 1.98 }
}, null, 2));
