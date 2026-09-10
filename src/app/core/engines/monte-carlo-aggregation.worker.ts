import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';
import { MonteCarloResult, MonteCarloUserInput, MonteCarloSnapshot } from '../models/monte-carlo-contracts.model';

interface AggregationWorkerRequest {
  executionId: string;
  workerId: number;
  type: 'INIT' | 'REGISTER_SIMULATION_PORT' | 'ADD_BATCH' | 'FINALIZE' | 'AGGREGATE' | 'RESULT' | 'ERROR' | 'AGG_ALL_PATHS_RECEIVED' | 'MC_PORT_TEST_PING' | 'MC_PORT_TEST_PONG' | 'MC_PORT_TEST_ADD_BATCH' | 'MC_PORT_TEST_ADD_BATCH_ACK' | 'MC_PORT_TEST_READY';
  paths?: any[];
  batch?: any[];
  input?: MonteCarloUserInput;
  snapshot?: MonteCarloSnapshot;
  expectedPathCount?: number;
  simulationPort?: MessagePort;
  testId?: string;
  value?: number;
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
  const handleBatchStartedAt = performance.now();
  const nextPaths = Array.isArray(batch) ? batch : [];
  aggregationState.paths.push(...nextPaths);
  aggregationState.receivedPathCount += nextPaths.length;
  console.info('[MC-PERF] AGG_BATCH', {
    workerId: 0,
    batchStart: 0,
    batchEnd: nextPaths.length,
    batchPathCount: nextPaths.length,
    receivedPaths: aggregationState.receivedPathCount,
    expectedPaths: aggregationState.expectedPathCount
  });
  asWorkerScope.postMessage({
    type: 'AGGREGATION_COUNTS',
    executionId: aggregationState.executionId,
    workerId: 0,
    receivedPathCount: aggregationState.receivedPathCount,
    expectedPathCount: aggregationState.expectedPathCount,
    handleBatchMs: performance.now() - handleBatchStartedAt
  });

  if (aggregationState.receivedPathCount === aggregationState.expectedPathCount && aggregationState.expectedPathCount > 0) {
    console.info('[MC-PERF] AGG_ALL_PATHS_RECEIVED', {
      receivedPaths: aggregationState.receivedPathCount,
      expectedPaths: aggregationState.expectedPathCount
    });
    asWorkerScope.postMessage({
      type: 'AGG_ALL_PATHS_RECEIVED',
      executionId: aggregationState.executionId,
      workerId: 0,
      receivedPathCount: aggregationState.receivedPathCount,
      expectedPathCount: aggregationState.expectedPathCount
    });
  }

  if (aggregationState.pendingFinalize && aggregationState.receivedPathCount === aggregationState.expectedPathCount) {
    const pendingMessage = aggregationState.pendingFinalize;
    aggregationState.pendingFinalize = null;
    finalizeIfReady(pendingMessage);
  }
};

const finalizeIfReady = (message: AggregationWorkerRequest): void => {
  const finalizeStartedAt = performance.now();
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

    console.info('[MC-PERF] AGG_FINALIZE_RECEIVED', {
      expectedPaths: aggregationState.expectedPathCount,
      receivedPaths: aggregationState.receivedPathCount
    });
    console.info('[MC-PERF] STATISTICS_START', {
      expectedPaths: aggregationState.expectedPathCount,
      receivedPaths: aggregationState.receivedPathCount
    });
    const statisticsStartedAt = performance.now();
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
    const statisticsMs = performance.now() - statisticsStartedAt;
    console.info('[MC-PERF] STATISTICS_DONE', { elapsedMs: statisticsMs });

    asWorkerScope.postMessage({
      type: 'AGGREGATION_METRICS',
      executionId: message.executionId,
      workerId: message.workerId,
      receivedPathCount: aggregationState.receivedPathCount,
      expectedPathCount: aggregationState.expectedPathCount,
      handleBatchMs: 0,
      finalizeMs: performance.now() - finalizeStartedAt,
      statisticsMs,
      buildMs: 0
    });

    console.info('[MC-PERF] AGG_RESULT_SENT', {
      executionId: message.executionId,
      workerId: message.workerId,
      resultCount: Array.isArray(result?.pathStats) ? result.pathStats.length : 0
    });
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
  if (message && typeof message.type === 'string' && (message.type === 'REGISTER_SIMULATION_PORT' || message.type === 'INIT')) {
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'AGG_MAIN_ONMESSAGE_ENTER',
      originalType: message.type ?? null,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null
    });
  }
  if (!message || !message.executionId) {
    return;
  }

  if (message.type === 'INIT') {
    aggregationState.executionId = message.executionId;
    aggregationState.input = null;
    aggregationState.snapshot = null;
    aggregationState.paths = [];
    aggregationState.expectedPathCount = typeof message.expectedPathCount === 'number' ? message.expectedPathCount : 0;
    aggregationState.receivedPathCount = 0;
    aggregationState.readyToFinalize = false;
    console.info('[MC-PERF] AGG_INIT', { expectedPaths: aggregationState.expectedPathCount });
    asWorkerScope.postMessage({
      type: 'READY',
      executionId: message.executionId,
      workerId: message.workerId
    });
    return;
  }

  if (message.type === 'REGISTER_SIMULATION_PORT') {
    console.info('[MC-PORT-TEST] AGG_REGISTER_BRANCH_ENTER', {
      testId: message.testId,
      executionId: message.executionId,
      workerId: message.workerId,
      hasSimulationPort: !!message.simulationPort,
      simulationPortType: typeof message.simulationPort
    });
    if (message.simulationPort) {
      const port = message.simulationPort;
      aggregationState.registeredPorts.push(port);
      console.info('[MC-PORT-TEST] PORT_REGISTER', {
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId,
        channelId: `${message.executionId}-sim-${message.workerId}`
      });
      port.onmessage = (portEvent: MessageEvent) => {
        const portMessage = portEvent.data as AggregationWorkerRequest;

        if (!portMessage || !portMessage.executionId) return;

        if (typeof portMessage.type === 'string' && portMessage.type.startsWith('MC_PORT_TEST_')) {
          asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'AGG_PORT_MESSAGE_ENTER',
            originalType: portMessage.type,
            testId: portMessage.testId ?? null,
            executionId: portMessage.executionId ?? null,
            workerId: portMessage.workerId ?? null
          });

          if (portMessage.testId === message.testId) {
            console.info('[MC-PORT-TEST] AGG_PORT_RAW_MESSAGE', {
              type: portMessage.type,
              testId: portMessage.testId,
              workerId: portMessage.workerId,
              executionId: portMessage.executionId,
              value: portMessage.value ?? null
            });
          }

          if (!portMessage.testId || portMessage.testId !== message.testId) return;

          if (portMessage.type === 'MC_PORT_TEST_PONG') {
            console.info('[MC-PORT-TEST] PONG_RECEIVED', {
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId
            });
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_PONG_RECEIVED',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId
            });
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_READY',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId
            });
            console.info('[MC-PORT-TEST] TEST_READY_RECEIVED', {
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId
            });
            return;
          }

          if (portMessage.type === 'MC_PORT_TEST_ADD_BATCH') {
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_CHECKPOINT',
              checkpoint: 'AGG_ADD_BATCH_BRANCH_ENTER',
              originalType: portMessage.type,
              testId: portMessage.testId ?? null,
              executionId: portMessage.executionId ?? null,
              workerId: portMessage.workerId ?? null
            });
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_CHECKPOINT',
              checkpoint: 'AGG_RECEIVED_NOTIFY_BEGIN',
              originalType: 'MC_PORT_TEST_ADD_BATCH_RECEIVED',
              testId: portMessage.testId ?? null,
              executionId: portMessage.executionId ?? null,
              workerId: portMessage.workerId ?? null
            });
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_ADD_BATCH_RECEIVED',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId,
              value: portMessage.value ?? null
            });
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_CHECKPOINT',
              checkpoint: 'AGG_RECEIVED_NOTIFY_DONE',
              originalType: 'MC_PORT_TEST_ADD_BATCH_RECEIVED',
              testId: portMessage.testId ?? null,
              executionId: portMessage.executionId ?? null,
              workerId: portMessage.workerId ?? null
            });
            try {
              const ackTestId = portMessage.testId;
              const ackExecutionId = portMessage.executionId;
              const ackWorkerId = message.workerId;
              const ackValue = portMessage.value ?? null;
              asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'AGG_ACK_PORT_POST_BEGIN',
                originalType: 'MC_PORT_TEST_ADD_BATCH_ACK',
                testId: ackTestId ?? null,
                executionId: ackExecutionId ?? null,
                workerId: ackWorkerId ?? null,
                ackTestId,
                ackExecutionId,
                ackWorkerId,
                ackValue
              });
              port.postMessage({
                type: 'MC_PORT_TEST_ADD_BATCH_ACK',
                testId: ackTestId,
                executionId: ackExecutionId,
                workerId: ackWorkerId,
                value: ackValue
              });
              asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'AGG_ACK_PORT_POST_DONE',
                originalType: 'MC_PORT_TEST_ADD_BATCH_ACK',
                testId: ackTestId ?? null,
                executionId: ackExecutionId ?? null,
                workerId: ackWorkerId ?? null,
                ackTestId,
                ackExecutionId,
                ackWorkerId,
                ackValue
              });
            } catch (error) {
              const messageText = error instanceof Error ? error.message : 'Unknown error';
              const errorName = error instanceof Error ? error.name : 'UnknownError';
              asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'AGG_ACK_PORT_POST_ERROR',
                originalType: 'MC_PORT_TEST_ADD_BATCH_ACK',
                testId: portMessage.testId ?? null,
                executionId: portMessage.executionId ?? null,
                workerId: message.workerId ?? null,
                errorName,
                errorMessage: messageText
              });
              console.error('[MC-PORT-TEST] ADD_BATCH_ACK_SEND_ERROR', { testId: portMessage.testId, executionId: portMessage.executionId, workerId: message.workerId, error });
            }
            return;
          }

          return;
        }

        if (portMessage.type === 'ADD_BATCH') {
          const batch = Array.isArray(portMessage.batch) ? portMessage.batch : [];
          const receivedBefore = aggregationState.receivedPathCount;
          asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_ADD_BATCH_RECEIVE_ENTER',
            originalType: portMessage.type,
            executionId: portMessage.executionId ?? null,
            workerId: portMessage.workerId ?? null,
            pathCountInBatch: batch.length,
            receivedTopLevelKeys: Object.keys(portMessage)
          });
          handleBatchMessage(batch);
          const receivedAfter = aggregationState.receivedPathCount;
          asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_ADD_BATCH_ACCOUNTED',
            originalType: portMessage.type,
            executionId: portMessage.executionId ?? null,
            workerId: portMessage.workerId ?? null,
            pathsReceivedBefore: receivedBefore,
            pathsReceivedAfter: receivedAfter,
            deltaPaths: receivedAfter - receivedBefore
          });
        }
      };
      console.info('[MC-PORT-TEST] AGG_REGISTER_HANDLER_INSTALLED', {
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId,
        channelId: `${message.executionId}-sim-${message.workerId}`
      });
      port.start();
      console.info('[MC-PORT-TEST] AGG_REGISTER_PORT_STARTED', {
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId,
        channelId: `${message.executionId}-sim-${message.workerId}`
      });
      asWorkerScope.postMessage({
        type: 'PORT_READY',
        executionId: message.executionId,
        workerId: message.workerId
      });
      console.info('[MC-PORT-TEST] PING_SENT', {
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId,
        channelId: `${message.executionId}-sim-${message.workerId}`
      });
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_PING',
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId
      });
      try {
        port.postMessage({
          type: 'MC_PORT_TEST_PING',
          testId: message.testId,
          executionId: message.executionId,
          workerId: message.workerId
        });
      } catch (error) {
        console.error('[MC-PORT-TEST] PING_SEND_ERROR', {
          testId: message.testId,
          executionId: message.executionId,
          workerId: message.workerId,
          error
        });
      }
    }
    return;
  }

  if (message.type === 'ADD_BATCH') {
    const batch = Array.isArray(message.batch) ? message.batch : [];
    const receivedBefore = aggregationState.receivedPathCount;
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_ADD_BATCH_RECEIVE_ENTER',
      originalType: message.type,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null,
      pathCountInBatch: batch.length,
      receivedTopLevelKeys: Object.keys(message)
    });
    handleBatchMessage(batch);
    const receivedAfter = aggregationState.receivedPathCount;
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_ADD_BATCH_ACCOUNTED',
      originalType: message.type,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null,
      pathsReceivedBefore: receivedBefore,
      pathsReceivedAfter: receivedAfter,
      deltaPaths: receivedAfter - receivedBefore
    });
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
