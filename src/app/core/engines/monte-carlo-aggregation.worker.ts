import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';
import { decodeTransportBatch } from './monte-carlo-worker';
import { MonteCarloResult, MonteCarloUserInput, MonteCarloSnapshot } from '../models/monte-carlo-contracts.model';
import { aggregationState as sharedAggregationState, processAddBatchMessage as processSharedAddBatchMessage } from './monte-carlo-aggregation-handler';

interface AggregationWorkerRequest {
  executionId: string;
  workerId: number;
  type: 'INIT' | 'REGISTER_SIMULATION_PORT' | 'ADD_BATCH' | 'FINALIZE' | 'AGGREGATE' | 'RESULT' | 'ERROR' | 'AGG_ALL_PATHS_RECEIVED' | 'MC_PORT_TEST_PING' | 'MC_PORT_TEST_PONG' | 'MC_PORT_TEST_ADD_BATCH' | 'MC_PORT_TEST_ADD_BATCH_ACK' | 'MC_PORT_TEST_READY';
  batchId?: string;
  paths?: any[];
  batch?: any[];
  arrays?: Record<string, unknown>;
  input?: MonteCarloUserInput;
  snapshot?: MonteCarloSnapshot;
  expectedPathCount?: number;
  simulationPort?: MessagePort;
  testId?: string;
  value?: number;
  advancedStatistics?: boolean;
  generalBenchmark?: {
    generalBenchmarkCAGR: number;
    generalBenchmarkVolatility: number;
  };
}

export const aggregationState = sharedAggregationState as {
  executionId: string | null;
  input: MonteCarloUserInput | null;
  snapshot: MonteCarloSnapshot | null;
  paths: any[];
  expectedPathCount: number;
  receivedPathCount: number;
  readyToFinalize: boolean;
  registeredPorts: MessagePort[];
  pendingFinalize: AggregationWorkerRequest | null;
};

export const processAddBatchMessage = processSharedAddBatchMessage;

const asWorkerScope = (typeof self !== 'undefined' ? self : globalThis) as typeof globalThis & {
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

const deriveModelCorrelationMatrices = (snapshot: MonteCarloSnapshot): Partial<Record<'expansion' | 'recession' | 'stagflation' | 'soft_landing', { target: number[][]; operational: number[][]; latent: number[][] }>> => {
  const scenarios = ['expansion', 'recession', 'stagflation', 'soft_landing'] as const;
  const indexByIsin = new Map(snapshot.etfs.map((etf, index) => [etf.isin, index]));
  const matrixForScenario = (scenario: typeof scenarios[number]): number[][] => {
    const matrix = Array.from({ length: snapshot.etfs.length }, () => Array<number>(snapshot.etfs.length).fill(0));
    for (let row = 0; row < snapshot.etfs.length; row += 1) {
      matrix[row][row] = 1;
    }
    for (const pair of snapshot.correlations) {
      const rowIndex = indexByIsin.get(pair.isin1);
      const columnIndex = indexByIsin.get(pair.isin2);
      if (rowIndex === undefined || columnIndex === undefined) continue;
      const value = Number(pair[scenario] ?? 0);
      matrix[rowIndex][columnIndex] = value;
      matrix[columnIndex][rowIndex] = value;
    }
    return matrix;
  };

  return Object.fromEntries(scenarios.map((scenario) => [scenario, {
    target: matrixForScenario(scenario),
    operational: matrixForScenario(scenario),
    latent: matrixForScenario(scenario)
  }])) as Partial<Record<'expansion' | 'recession' | 'stagflation' | 'soft_landing', { target: number[][]; operational: number[][]; latent: number[][] }>>;
};

const emitLifecycleEvent = (executionId: string | null, workerId: number, event: string, details: Record<string, unknown> = {}, runStartMs?: number): void => {
  if (!executionId) return;
  const relativeMs = Number.isFinite(runStartMs) ? Number((performance.now() - Number(runStartMs)).toFixed(2)) : Number(performance.now().toFixed(2));
  asWorkerScope.postMessage({
    type: 'LIFECYCLE_EVENT',
    executionId,
    workerId,
    event,
    relativeMs,
    ...details
  });
};

const emitDiagnosticLifecycleEvent = (executionId: string | null, workerId: number, event: string, details: Record<string, unknown> = {}): void => {
  if (!executionId) return;
  const payload: Record<string, unknown> = {
    type: 'LIFECYCLE_EVENT',
    executionId,
    workerId,
    event,
    ...details
  };
  if (typeof payload.mcChannelId === 'undefined') {
    payload.mcChannelId = `${executionId}:${workerId}`;
  }
  asWorkerScope.postMessage(payload);
};

const emitFinalizationStageEvent = (event: string, additional: Record<string, unknown> = {}): void => {
  const details = {
    pathsLength: aggregationState.paths.length,
    ...additional
  };
  emitLifecycleEvent(aggregationState.executionId, 0, event, details, (globalThis as any).__mcLifecycleTrace?.runStartMs ?? undefined);
};

const finalizeIfReady = (message: AggregationWorkerRequest, state: typeof aggregationState = aggregationState): void => {
  const finalizeStartedAt = performance.now();
  if (state.receivedPathCount !== state.expectedPathCount) {
    state.readyToFinalize = false;
    state.pendingFinalize = message;
    return;
  }

  state.readyToFinalize = true;
  state.pendingFinalize = null;
  try {
    emitLifecycleEvent(state.executionId, 0, 'AGG_FINALIZATION_START', {
      receivedPathCount: state.receivedPathCount,
      expectedPathCount: state.expectedPathCount
    }, (globalThis as any).__mcLifecycleTrace?.runStartMs ?? undefined);
    emitFinalizationStageEvent('PREBUILD_STATE_READ_START');
    const paths = state.paths;
    const input = message.input ?? state.input;
    const snapshot = message.snapshot ?? state.snapshot;

    if (!input || !snapshot) {
      throw new Error('Aggregation worker requires input and snapshot');
    }
    emitFinalizationStageEvent('PREBUILD_STATE_READ_END');

    emitFinalizationStageEvent('PREBUILD_DECORRELATION_START');
    emitFinalizationStageEvent('PREBUILD_DECORRELATION_END');

    emitFinalizationStageEvent('PREBUILD_MODEL_MATRICES_START');
    emitFinalizationStageEvent('PREBUILD_MODEL_MATRICES_END');

    emitFinalizationStageEvent('PREBUILD_GENERAL_BENCHMARK_START');
    emitFinalizationStageEvent('PREBUILD_GENERAL_BENCHMARK_END');

    const statisticsStartedAt = performance.now();
    const profileEvent = (event: string, _timestamp?: number, details: Record<string, unknown> = {}) => {
      emitFinalizationStageEvent(event, details);
    };
    emitFinalizationStageEvent('PREBUILD_CALL_START');
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
        matricesCoherent: true,
        advancedStatisticsEnabled: message.advancedStatistics ?? true,
        modelMatrices: deriveModelCorrelationMatrices(snapshot),
        generalBenchmark: message.generalBenchmark ? {
          expectedReturn: deriveLongTermExpectedReturn(snapshot),
          volatility: deriveWeightedAverageCorrelation(snapshot) > 0 ? Math.max(0.05, deriveWeightedAverageCorrelation(snapshot)) : 0.15,
          simulatedLongTermReturn: message.generalBenchmark.generalBenchmarkCAGR,
          simulatedVolatility: message.generalBenchmark.generalBenchmarkVolatility
        } : undefined,
        profileEvent
      }
    ) as MonteCarloResult;
    const statisticsMs = performance.now() - statisticsStartedAt;

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

    emitLifecycleEvent(state.executionId, 0, 'AGG_FINALIZATION_END', {
      receivedPathCount: state.receivedPathCount,
      expectedPathCount: state.expectedPathCount
    }, (globalThis as any).__mcLifecycleTrace?.runStartMs ?? undefined);
    asWorkerScope.postMessage({
      type: 'RESULT',
      executionId: message.executionId,
      workerId: message.workerId,
      result
    });
  } catch (error) {
    emitFinalizationStageEvent('AGG_FINALIZATION_EXCEPTION', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
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
    const registeredMcChannelId = typeof message.mcChannelId === 'string' ? message.mcChannelId : `${message.executionId}:${message.workerId}`;
    emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_REGISTER_RECEIVED', {
      mcChannelId: registeredMcChannelId,
      workerId: message.workerId,
      executionId: message.executionId
    });
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
        const receivedExecutionId = portMessage && typeof portMessage === 'object' ? portMessage.executionId ?? null : null;
        const receivedWorkerId = portMessage && typeof portMessage === 'object' ? portMessage.workerId ?? null : null;
        const receivedType = portMessage && typeof portMessage === 'object' ? portMessage.type ?? null : null;

        emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_CALLBACK_RAW', {
          registeredExecutionId: message.executionId,
          registeredWorkerId: message.workerId,
          registeredMcChannelId,
          receivedExecutionId,
          receivedWorkerId,
          receivedType
        });

        if (!portMessage || !portMessage.executionId) {
          emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_GUARD_REJECT', {
            registeredExecutionId: message.executionId,
            registeredWorkerId: message.workerId,
            registeredMcChannelId,
            receivedExecutionId,
            receivedWorkerId,
            receivedType,
            reason: 'MISSING_MESSAGE'
          });
          return;
        }

        if (!portMessage.executionId) {
          emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_GUARD_REJECT', {
            registeredExecutionId: message.executionId,
            registeredWorkerId: message.workerId,
            registeredMcChannelId,
            receivedExecutionId,
            receivedWorkerId,
            receivedType,
            reason: 'MISSING_EXECUTION_ID'
          });
          return;
        }

        if (portMessage.executionId !== message.executionId) {
          emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_GUARD_REJECT', {
            registeredExecutionId: message.executionId,
            registeredWorkerId: message.workerId,
            registeredMcChannelId,
            receivedExecutionId,
            receivedWorkerId,
            receivedType,
            reason: 'EXECUTION_ID_MISMATCH'
          });
          return;
        }

        if (typeof portMessage.type !== 'string') {
          emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_GUARD_REJECT', {
            registeredExecutionId: message.executionId,
            registeredWorkerId: message.workerId,
            registeredMcChannelId,
            receivedExecutionId,
            receivedWorkerId,
            receivedType,
            reason: 'MISSING_TYPE'
          });
          return;
        }

        if (portMessage.type.startsWith('MC_PORT_TEST_')) {
          emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_GUARD_REJECT', {
            registeredExecutionId: message.executionId,
            registeredWorkerId: message.workerId,
            registeredMcChannelId,
            receivedExecutionId,
            receivedWorkerId,
            receivedType,
            reason: 'MC_PORT_TEST_BRANCH'
          });
          return;
        }

        if (portMessage.type !== 'ADD_BATCH') {
          emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_GUARD_REJECT', {
            registeredExecutionId: message.executionId,
            registeredWorkerId: message.workerId,
            registeredMcChannelId,
            receivedExecutionId,
            receivedWorkerId,
            receivedType,
            reason: 'UNEXPECTED_TYPE'
          });
          return;
        }

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
          processAddBatchMessage(
            { ...portMessage, batch },
            aggregationState,
            asWorkerScope.postMessage.bind(asWorkerScope),
            emitLifecycleEvent,
            finalizeIfReady,
            (globalThis as any).__mcLifecycleTrace?.runStartMs ?? undefined
          );
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
      emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_LISTENER_INSTALLED', {
        mcChannelId: typeof message.mcChannelId === 'string' ? message.mcChannelId : `${message.executionId}:${message.workerId}`
      });
      port.start();
      emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'AGG_PORT_STARTED', {
        mcChannelId: typeof message.mcChannelId === 'string' ? message.mcChannelId : `${message.executionId}:${message.workerId}`
      });
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
    processAddBatchMessage(message, aggregationState, asWorkerScope.postMessage.bind(asWorkerScope), emitLifecycleEvent, finalizeIfReady, (globalThis as any).__mcLifecycleTrace?.runStartMs ?? undefined);
    return;
  }

  if (message.type === 'FINALIZE') {
    emitLifecycleEvent(message.executionId, message.workerId ?? 0, 'AGG_FINALIZE_ENTER', {
      receivedPathCount: aggregationState.receivedPathCount,
      expectedPathCount: aggregationState.expectedPathCount,
      hasPendingFinalize: aggregationState.pendingFinalize !== null
    }, (globalThis as any).__mcLifecycleTrace?.runStartMs ?? undefined);
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
