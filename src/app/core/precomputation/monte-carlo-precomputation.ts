import { prepareMonteCarloPrecomputation } from 'investment-lab-core';

export {
  PSD_EPSILON,
  CORRELATION_EPSILON,
  MAX_CORRELATION_CELL_DELTA,
  MAX_CORRELATION_P95_DELTA,
  MAX_CORRELATION_RMS_DELTA,
  NEAREST_CORRELATION_TOLERANCE,
  NEAREST_CORRELATION_MAX_ITERATIONS,
  MonteCarloPrecomputationError,
  calibrateTargetLogAndSigma,
  calibrateMonthlyLocation,
  assessCorrelationMatrixDistortion,
  precomputeEtfScenarioParameters,
  prepareCorrelationMatrix,
  buildMuCalibrationCurve,
  prepareMonteCarloPrecomputation
} from 'investment-lab-core';

export const prepareMonteCarloPrecomputationAsync = async (
  snapshot: Parameters<typeof prepareMonteCarloPrecomputation>[0],
  workerCount?: number,
  options: Record<string, unknown> = {}
) => prepareMonteCarloPrecomputation(snapshot);
