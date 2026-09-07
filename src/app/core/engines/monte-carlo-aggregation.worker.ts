import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';
import { MonteCarloResult, MonteCarloUserInput, MonteCarloSnapshot } from '../models/monte-carlo-contracts.model';

interface AggregationWorkerRequest {
  executionId: string;
  workerId: number;
  type: 'INIT' | 'REGISTER_SIMULATION_PORT' | 'ADD_BATCH' | 'FINALIZE' | 'AGGREGATE' | 'RESULT' | 'ERROR';
  paths?: any[];
  batch?: any[];
  input?: MonteCarloUserInput;
  snapshot?: MonteCarloSnapshot;
  expectedPathCount?: number;
  simulationPort?: MessagePort;
}

const aggregationState: {
  executionId: string | null;
  input: MonteCarloUserInput | null;
  snapshot: MonteCarloSnapshot | null;
  paths: any[];
  expectedPathCount: number;
  receivedPathCount: number;
  readyToFinalize: boolean;
  registeredPorts: MessagePort[];
  pendingFinalize: AggregationWorkerRequest | null;
} = {
  executionId: null,
  input: null,
  snapshot: null,
  paths: [],
  expectedPathCount: 0,
  receivedPathCount: 0,
  readyToFinalize: false,
  registeredPorts: [],
  pendingFinalize: null
};

const asWorkerScope = self as typeof globalThis & {
  postMessage: (message: any) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

const deriveWeightedAverageCorrelation = (snapshot: MonteCarloSnapshot): number => {
  const pairValues = snapshot.correlations.flatMap((entry) => [entry.expansion, entry.recession, entry.stagflation, entry.soft_landing]);
  if (pairValues.length === 0) return 0.25;
  const average = pairValues.reduce((sum, value) => sum + value, 0) / pairValues.length;
  return Number.isFinite(average) ? Math.max(0, Math.min(1, average)) : 0.25;
};

const deriveMaxCorrelation = (snapshot: MonteCarloSnapshot): number => {
  const pairValues = snapshot.correlations.flatMap((entry) => [entry.expansion, entry.recession, entry.stagflation, entry.soft_landing]);
  if (pairValues.length === 0) return 0.25;
  const max = Math.max(...pairValues);
  return Number.isFinite(max) ? Math.max(0, Math.min(1, max)) : 0.25;
};

const deriveLongTermExpectedReturn = (snapshot: MonteCarloSnapshot): number => {
  if (snapshot.etfs.length === 0) return 0.06;
  const average = snapshot.etfs.reduce((sum, etf) => sum + (etf.statistics.general?.expectedReturn ?? 0), 0) / snapshot.etfs.length;
  return Number.isFinite(average) ? average : 0.06;
};

const handleBatchMessage = (batch: any[]): void => {
  const nextPaths = Array.isArray(batch) ? batch : [];
  aggregationState.paths.push(...nextPaths);
  aggregationState.receivedPathCount += nextPaths.length;
  asWorkerScope.postMessage({
    type: 'AGGREGATION_COUNTS',
    executionId: aggregationState.executionId,
    workerId: 0,
    receivedPathCount: aggregationState.receivedPathCount,
    expectedPathCount: aggregationState.expectedPathCount
  });

  if (aggregationState.pendingFinalize && aggregationState.receivedPathCount === aggregationState.expectedPathCount) {
    const pendingMessage = aggregationState.pendingFinalize;
    aggregationState.pendingFinalize = null;
    finalizeIfReady(pendingMessage);
  }
};

const finalizeIfReady = (message: AggregationWorkerRequest): void => {
  if (aggregationState.receivedPathCount !== aggregationState.expectedPathCount) {
    aggregationState.readyToFinalize = false;
    aggregationState.pendingFinalize = message;
    return;
  }

  aggregationState.readyToFinalize = true;
  aggregationState.pendingFinalize = null;
  try {
    const paths = aggregationState.paths;
    const input = message.input ?? aggregationState.input;
    const snapshot = message.snapshot ?? aggregationState.snapshot;

    if (!input || !snapshot) {
      throw new Error('Aggregation worker requires input and snapshot');
    }

    const result = MonteCarloStatisticsEngine.buildOfficialResult(
      paths,
      input.horizonYears,
      input.initialCapital,
      {
        weightedAverageScenarioCorrelation: deriveWeightedAverageCorrelation(snapshot),
        maxScenarioCorrelation: deriveMaxCorrelation(snapshot),
        longTermExpectedReturn: deriveLongTermExpectedReturn(snapshot)
      },
      {
        performanceDiagnostics: {
          redrawCount: 0,
          rejectRate: 0
        },
        matricesCoherent: true
      }
    ) as MonteCarloResult;

    asWorkerScope.postMessage({
      type: 'RESULT',
      executionId: message.executionId,
      workerId: message.workerId,
      result
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Aggregation worker failed';
    const details = error instanceof Error && 'details' in error ? (error as any).details : {};
    asWorkerScope.postMessage({
      type: 'ERROR',
      executionId: message.executionId,
      workerId: message.workerId,
      error: {
        code: 'AGGREGATION_WORKER_ERROR',
        message: messageText,
        details
      }
    });
  }
};

asWorkerScope.onmessage = (event: MessageEvent) => {
  const message = event.data as AggregationWorkerRequest;
  if (!message || !message.executionId) {
    return;
  }

  if (message.type === 'INIT') {
    aggregationState.executionId = message.executionId;
    aggregationState.input = null;
    aggregationState.snapshot = null;
    aggregationState.paths = [];
    aggregationState.expectedPathCount = 0;
    aggregationState.receivedPathCount = 0;
    aggregationState.readyToFinalize = false;
    asWorkerScope.postMessage({
      type: 'READY',
      executionId: message.executionId,
      workerId: message.workerId
    });
    return;
  }

  if (message.type === 'REGISTER_SIMULATION_PORT') {
    if (message.simulationPort) {
      aggregationState.registeredPorts.push(message.simulationPort);
      message.simulationPort.onmessage = (portEvent: MessageEvent) => {
        const portMessage = portEvent.data as AggregationWorkerRequest;
        if (!portMessage || !portMessage.executionId) return;
        if (portMessage.type === 'ADD_BATCH') {
          handleBatchMessage(Array.isArray(portMessage.batch) ? portMessage.batch : []);
        }
      };
    }
    return;
  }

  if (message.type === 'ADD_BATCH') {
    handleBatchMessage(Array.isArray(message.batch) ? message.batch : []);
    return;
  }

  if (message.type === 'FINALIZE') {
    aggregationState.expectedPathCount = typeof message.expectedPathCount === 'number' ? message.expectedPathCount : aggregationState.expectedPathCount;
    aggregationState.input = message.input ?? aggregationState.input;
    aggregationState.snapshot = message.snapshot ?? aggregationState.snapshot;
    aggregationState.pendingFinalize = message;
    if (aggregationState.receivedPathCount === aggregationState.expectedPathCount) {
      const pendingMessage = aggregationState.pendingFinalize;
      aggregationState.pendingFinalize = null;
      finalizeIfReady(pendingMessage ?? message);
      return;
    }
    return;
  }

  if (message.type === 'AGGREGATE') {
    finalizeIfReady(message);
  }
};
