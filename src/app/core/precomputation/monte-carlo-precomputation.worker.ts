import { MONTE_CARLO_SCENARIOS, type MonteCarloScenario } from '../models/monte-carlo-contracts.model';
import {
  buildMuCalibrationCurve,
  clearCalibrationWorkDiagnostics,
  disableCalibrationWorkDiagnostics,
  enableCalibrationWorkDiagnostics,
  getCalibrationWorkDiagnostics,
  precomputeEtfScenarioParameters
} from './monte-carlo-precomputation';

const workerScope = globalThis as typeof globalThis & {
  postMessage: (message: any) => void;
};

workerScope.onmessage = (event: MessageEvent) => {
  const message = event.data as {
    type?: 'PING' | 'GENERAL_TASK' | 'SCENARIO_TASK';
    requestId?: string;
    etfIndex?: number;
    scenario?: MonteCarloScenario;
    etf?: { statistics?: Record<string, any> };
    shockGrid?: number[];
    generalParameters?: ReturnType<typeof precomputeEtfScenarioParameters>;
    diagnosticsEnabled?: boolean;
  } | undefined;

  if (!message) {
    return;
  }

  if (message.type === 'PING') {
    workerScope.postMessage({ type: 'READY' });
    return;
  }

  if (!message.requestId || !message.type || !message.etf || !message.shockGrid) {
    return;
  }

  const diagnosticsEnabled = Boolean(message.diagnosticsEnabled);

  try {
    if (diagnosticsEnabled) {
      clearCalibrationWorkDiagnostics();
      enableCalibrationWorkDiagnostics();
    }

    const result = message.etf.statistics ?? {};
    const generalParameters = precomputeEtfScenarioParameters(result.general, 'GENERAL');

    if (message.type === 'GENERAL_TASK') {
      const diagnostics = diagnosticsEnabled ? getCalibrationWorkDiagnostics() : undefined;
      workerScope.postMessage({
        type: 'TASK_RESULT',
        requestId: message.requestId,
        result: {
          taskId: message.requestId,
          etfIndex: message.etfIndex ?? 0,
          generalParameters,
          ...(diagnostics ? { diagnostics } : {})
        }
      });
      return;
    }

    if (!message.scenario) {
      throw new Error('SCENARIO_TASK requires a scenario');
    }
    if (!message.generalParameters) {
      throw new Error('SCENARIO_TASK requires the already-computed general parameters');
    }

    const scenarioParameters = precomputeEtfScenarioParameters(result[message.scenario], 'SCENARIO');
    const curve = buildMuCalibrationCurve(message.generalParameters, scenarioParameters, 0.01, message.shockGrid);
    const diagnostics = diagnosticsEnabled ? getCalibrationWorkDiagnostics() : undefined;
    workerScope.postMessage({
      type: 'TASK_RESULT',
      requestId: message.requestId,
      result: {
        taskId: message.requestId,
        etfIndex: message.etfIndex ?? 0,
        scenario: message.scenario,
        scenarioParameters: {
          ...scenarioParameters,
          generalMonthlyExpectedReturn: message.generalParameters.monthlyExpectedReturn,
          generalMonthlyVolatility: message.generalParameters.monthlyVolatility,
          muCalibrationByIntensity: curve
        },
        curve,
        ...(diagnostics ? { diagnostics } : {})
      }
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    workerScope.postMessage({
      type: 'TASK_ERROR',
      requestId: message.requestId,
      error: {
        code: 'PRECOMPUTE_WORKER_TASK_FAILED',
        message: err.message,
        details: err instanceof Error && 'details' in err ? (err as any).details : {}
      }
    });
  } finally {
    if (diagnosticsEnabled) {
      disableCalibrationWorkDiagnostics();
    }
  }
};
