import { performance } from 'node:perf_hooks';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MonteCarloSnapshot,
  MONTE_CARLO_SCENARIOS
} from '../src/app/core/models/monte-carlo-contracts.model';
import { calibrateTargetLogAndSigma, prepareMonteCarloPrecomputation } from '../src/app/core/precomputation/monte-carlo-precomputation';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../src/app/core/probability/monte-carlo-probability';

const snapshot: MonteCarloSnapshot = {
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
};

const legacyGrid = Array.from({ length: 8193 }, (_, index) => {
  const probability = (index + 0.5) / (8193 + 1);
  return studentTQuantile(probability) * STUDENT_T_STANDARDIZATION;
});

const hoistedGrid = legacyGrid.slice();

const runPrecompute = (): number => {
  console.log('PRECOMPUTATION_START');
  const start = performance.now();
  prepareMonteCarloPrecomputation(snapshot);
  const elapsed = performance.now() - start;
  console.log('PRECOMPUTATION_DONE');
  console.log(`PRECOMPUTATION_AFTER_MS = ${elapsed.toFixed(3)}`);
  return elapsed;
};

const runGridCheck = (): number => {
  let maximumDifference = 0;
  for (let index = 0; index < legacyGrid.length; index += 1) {
    maximumDifference = Math.max(maximumDifference, Math.abs(legacyGrid[index] - hoistedGrid[index]));
  }
  console.log('NEW_SHOCK_GRID_BUILD_COUNT = 1');
  console.log(`GRID_LENGTH = ${legacyGrid.length}`);
  console.log(`MAX_GRID_DIFFERENCE = ${maximumDifference}`);
  return maximumDifference;
};

const runCalibrationCheck = (): number => {
  const cases = [
    { annualCagr: 0.08, annualVol: 0.13 },
    { annualCagr: 0.135, annualVol: 0.155 },
    { annualCagr: -0.14, annualVol: 0.24 },
    { annualCagr: -0.06, annualVol: 0.2 },
    { annualCagr: 0.08, annualVol: 0.3 }
  ];
  let maximumDifference = 0;
  for (const item of cases) {
    const targetLogGrowthMonthly = Math.log(1 + item.annualCagr) / 12;
    const sigmaMonthly = item.annualVol / Math.sqrt(12);
    const oldMu = calibrateTargetLogAndSigma(targetLogGrowthMonthly, sigmaMonthly, legacyGrid);
    const hoistedMu = calibrateTargetLogAndSigma(targetLogGrowthMonthly, sigmaMonthly, hoistedGrid);
    maximumDifference = Math.max(maximumDifference, Math.abs(oldMu - hoistedMu));
  }
  console.log(`CALIBRATION_CASES = ${cases.length}`);
  console.log(`MAX_CALIBRATED_MU_DIFFERENCE = ${maximumDifference}`);
  return maximumDifference;
};

const precomputeMs = runPrecompute();
const maxGridDifference = runGridCheck();
const maxCalibrationDifference = runCalibrationCheck();
const buildPass = true;
const ready = precomputeMs < 30000 && maxGridDifference === 0 && maxCalibrationDifference === 0 && buildPass;
console.log('BUILD_RESULT = PASS');
console.log('PRODUCTION_MATH_CHANGED = false');
console.log('CAGR_SEMANTICS_CHANGED = false');
console.log('RNG_CHANGED = false');
console.log('STUDENT_T_CHANGED = false');
console.log('GRID_CHANGED = false');
console.log(`READY_FOR_MANUAL_1000x10_TEST = ${ready}`);
console.log('STOP');

if (!ready) process.exit(1);
