export { MACRO_SCENARIOS, SCENARIO_LABELS, DEFAULT_STRUCTURAL_PROBABILITIES, DEFAULT_TRANSITION_MATRIX, DEFAULT_DISTRIBUTION_SETTINGS, DEFAULT_REBALANCE_SETTINGS } from './models/monte-carlo.model.js';
export { SeededRandom } from './engines/seeded-random.js';
export { evolveMonteCarloPortfolioPath, MonteCarloPortfolioPathError } from './portfolio/monte-carlo-portfolio-path-engine.js';
export { derivePathSeed, toCompactPathResult } from './engines/monte-carlo-worker.js';
export { normalCdf, normalQuantile, sampleStandardNormal, studentTCdf, studentTQuantile, sampleTruncatedNormal, solveTruncatedNormalMeanForQuantile, truncatedNormalQuantile } from './probability/monte-carlo-probability.js';
export { INTENSITY_AR_RHO, ENTRY_SOFT_QUANTILE, MonteCarloMacroEngineError, getStayProbability, generateMonthlyMacroTimeline, macroEngineConstants } from './macro/monte-carlo-macro-engine.js';
export { MAX_REDRAWS, MonteCarloReturnEngineError, __debugRejectTrace, __debugAcceptTrace, __debugAllAttemptTrace, returnVectorProfilerState, beginReturnVectorBatchProfile, endReturnVectorBatchProfile, calculateEffectiveMonthlyParameters, isMonthlyReturnAccepted, generateMonthlyReturnVector, ReturnCorrelationDiagnosticsAccumulator } from './returns/monte-carlo-return-engine.js';
export { PSD_EPSILON, CORRELATION_EPSILON, MAX_CORRELATION_CELL_DELTA, MAX_CORRELATION_P95_DELTA, MAX_CORRELATION_RMS_DELTA, NEAREST_CORRELATION_TOLERANCE, NEAREST_CORRELATION_MAX_ITERATIONS, MonteCarloPrecomputationError, calibrateTargetLogAndSigma, calibrateMonthlyLocation, assessCorrelationMatrixDistortion, precomputeEtfScenarioParameters, prepareCorrelationMatrix, buildMuCalibrationCurve, prepareMonteCarloPrecomputation } from './precomputation/monte-carlo-precomputation.js';

export const createDeterministicRandom = (simulationId, runSeed) => {
  const baseSeed = derivePathSeed(runSeed, simulationId);
  return new SeededRandom(baseSeed);
};
