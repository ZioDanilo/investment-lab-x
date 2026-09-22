import {
  clearCalibrationWorkDiagnostics,
  clearMonteCarloPrecomputationCache,
  disableCalibrationWorkDiagnostics,
  enableCalibrationWorkDiagnostics,
  getCalibrationWorkDiagnostics,
  getLastMonteCarloPrecomputationDiagnostics,
  prepareMonteCarloPrecomputation,
} from '../src/app/core/precomputation/monte-carlo-precomputation';

const snapshot = {
  etfs: ['A', 'B', 'C', 'D', 'E'].map((tag, index) => {
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
  }),
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
  correlations: [
    { isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.12, recession: 0.16, stagflation: 0.10, soft_landing: 0.14 },
    { isin1: 'ETF-A', isin2: 'ETF-C', expansion: 0.16, recession: 0.20, stagflation: 0.14, soft_landing: 0.18 },
    { isin1: 'ETF-A', isin2: 'ETF-D', expansion: 0.20, recession: 0.24, stagflation: 0.18, soft_landing: 0.22 },
    { isin1: 'ETF-A', isin2: 'ETF-E', expansion: 0.24, recession: 0.28, stagflation: 0.22, soft_landing: 0.26 },
    { isin1: 'ETF-B', isin2: 'ETF-C', expansion: 0.16, recession: 0.20, stagflation: 0.14, soft_landing: 0.18 },
    { isin1: 'ETF-B', isin2: 'ETF-D', expansion: 0.20, recession: 0.24, stagflation: 0.18, soft_landing: 0.22 },
    { isin1: 'ETF-B', isin2: 'ETF-E', expansion: 0.24, recession: 0.28, stagflation: 0.22, soft_landing: 0.26 },
    { isin1: 'ETF-C', isin2: 'ETF-D', expansion: 0.20, recession: 0.24, stagflation: 0.18, soft_landing: 0.22 },
    { isin1: 'ETF-C', isin2: 'ETF-E', expansion: 0.24, recession: 0.28, stagflation: 0.22, soft_landing: 0.26 },
    { isin1: 'ETF-D', isin2: 'ETF-E', expansion: 0.24, recession: 0.28, stagflation: 0.22, soft_landing: 0.26 }
  ]
} as any;

clearCalibrationWorkDiagnostics();
enableCalibrationWorkDiagnostics();
try {
  clearMonteCarloPrecomputationCache();
  const start = performance.now();
  prepareMonteCarloPrecomputation(snapshot);
  const elapsed = performance.now() - start;
  const diagnostics = getLastMonteCarloPrecomputationDiagnostics();
  const work = getCalibrationWorkDiagnostics();
  console.log(JSON.stringify({
    elapsedMs: elapsed,
    totalMs: diagnostics.totalMs,
    generalParamsMs: diagnostics.generalParamsMs,
    scenarioParamsMs: diagnostics.scenarioParamsMs,
    muCurvesMs: diagnostics.muCurvesMs,
    correlationsMs: diagnostics.correlationsMs,
    assemblyMs: diagnostics.assemblyMs,
    calibrationDiagnostics: work,
    categoryBreakdown: work.byCategory
  }, null, 2));
} finally {
  disableCalibrationWorkDiagnostics();
}
