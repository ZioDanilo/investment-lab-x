import { parentPort } from 'node:worker_threads';
import { MONTE_CARLO_SCENARIOS, MonteCarloScenario } from '../src/app/core/models/monte-carlo-contracts.model';
import { calibrateTargetLogAndSigma, precomputeEtfScenarioParameters } from '../src/app/core/precomputation/monte-carlo-precomputation';

const buildMuCalibrationCurve = (
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
        : calibrateTargetLogAndSigma(targetLogGrowthMonthly, sigmaMonthly, shockGrid, 'MU_CURVE_INTERIOR');
    const impliedAnnualCagr = Math.exp(12 * targetLogGrowthMonthly) - 1;
    if (curve.length > 0 && Math.abs(curve[curve.length - 1].intensity - clampedIntensity) <= 1e-12) {
      curve[curve.length - 1] = { intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr };
      continue;
    }
    curve.push({ intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr });
  }

  return curve;
};

if (!parentPort) {
  throw new Error('architecture-shootout-worker requires parentPort');
}

parentPort.on('message', (message: any) => {
  if (message?.type === 'PING') {
    parentPort.postMessage({ type: 'PONG', ok: true });
    return;
  }

  const { taskId, kind, etfIndex, scenario, etf, shockGrid, generalParameters } = message as {
    taskId: string;
    kind: 'ETF' | 'GENERAL' | 'SCENARIO';
    etfIndex: number;
    scenario?: MonteCarloScenario;
    etf?: { statistics: Record<string, any> };
    shockGrid?: number[];
    generalParameters?: ReturnType<typeof precomputeEtfScenarioParameters>;
  };

  if (kind === 'ETF') {
    const targetEtf = etf!;
    const generalParameters = precomputeEtfScenarioParameters(targetEtf.statistics.general, 'GENERAL');
    const scenarioResults = Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenarioKey) => {
      const scenarioParameters = precomputeEtfScenarioParameters(targetEtf.statistics[scenarioKey], 'SCENARIO');
      const curve = buildMuCalibrationCurve(generalParameters, scenarioParameters, 0.01, shockGrid!);
      return [scenarioKey, { scenarioParameters: { ...scenarioParameters, generalMonthlyExpectedReturn: generalParameters.monthlyExpectedReturn, generalMonthlyVolatility: generalParameters.monthlyVolatility, muCalibrationByIntensity: curve }, curve }];
    }));

    parentPort.postMessage({
      type: 'TASK_RESULT',
      taskId,
      result: {
        taskId,
        etfIndex,
        kind,
        generalParameters,
        scenarioResults
      }
    });
    return;
  }

  if (kind === 'GENERAL') {
    const targetEtf = etf!;
    const localGeneral = precomputeEtfScenarioParameters(targetEtf.statistics.general, 'GENERAL');
    parentPort.postMessage({
      type: 'TASK_RESULT',
      taskId,
      result: {
        taskId,
        etfIndex,
        kind,
        generalParameters: localGeneral
      }
    });
    return;
  }

  if (kind === 'SCENARIO') {
    const targetEtf = etf!;
    const localGeneral = generalParameters!;
    const scenarioParameters = precomputeEtfScenarioParameters(targetEtf.statistics[scenario!], 'SCENARIO');
    const curve = buildMuCalibrationCurve(localGeneral, scenarioParameters, 0.01, shockGrid!);
    parentPort.postMessage({
      type: 'TASK_RESULT',
      taskId,
      result: {
        taskId,
        etfIndex,
        scenario,
        kind,
        generalParameters: localGeneral,
        scenarioParameters: {
          ...scenarioParameters,
          generalMonthlyExpectedReturn: localGeneral.monthlyExpectedReturn,
          generalMonthlyVolatility: localGeneral.monthlyVolatility,
          muCalibrationByIntensity: curve
        },
        curve
      }
    });
    return;
  }

  throw new Error(`unsupported task kind: ${String(kind)}`);
});
