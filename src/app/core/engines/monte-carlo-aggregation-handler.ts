import { decodeTransportBatch } from './monte-carlo-worker';

export interface AggregationWorkerRequest {
  executionId: string;
  workerId: number;
  type: 'INIT' | 'REGISTER_SIMULATION_PORT' | 'ADD_BATCH' | 'FINALIZE' | 'AGGREGATE' | 'RESULT' | 'ERROR' | 'AGG_ALL_PATHS_RECEIVED' | 'MC_PORT_TEST_PING' | 'MC_PORT_TEST_PONG' | 'MC_PORT_TEST_ADD_BATCH' | 'MC_PORT_TEST_ADD_BATCH_ACK' | 'MC_PORT_TEST_READY';
  batchId?: string;
  paths?: any[];
  batch?: any[];
  arrays?: Record<string, unknown>;
  input?: any;
  snapshot?: any;
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

export const aggregationState: {
  executionId: string | null;
  input: any;
  snapshot: any;
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

export const handleBatchMessage = (
  batch: any[],
  state = aggregationState,
  sink: (message: any) => void = () => undefined,
  emitLifecycleEvent: (executionId: string | null, workerId: number, event: string, details?: Record<string, unknown>, runStartMs?: number) => void = () => undefined,
  finalizeIfReady: ((message: AggregationWorkerRequest, state: typeof aggregationState) => void) | null = null,
  runStartMs?: number
): void => {
  const handleBatchStartedAt = performance.now();
  const nextPaths = Array.isArray(batch) ? batch : [];
  state.paths.push(...nextPaths);
  state.receivedPathCount += nextPaths.length;
  sink({
    type: 'AGGREGATION_COUNTS',
    executionId: state.executionId,
    workerId: 0,
    receivedPathCount: state.receivedPathCount,
    expectedPathCount: state.expectedPathCount,
    batchPathCount: nextPaths.length,
    handleBatchMs: performance.now() - handleBatchStartedAt
  });
  emitLifecycleEvent(state.executionId, 0, 'AGG_BATCH_RECEIVED', {
    batchPathCount: nextPaths.length,
    receivedPathCount: state.receivedPathCount,
    expectedPathCount: state.expectedPathCount
  }, runStartMs);

  if (state.receivedPathCount === state.expectedPathCount && state.expectedPathCount > 0) {
    sink({
      type: 'AGG_ALL_PATHS_RECEIVED',
      executionId: state.executionId,
      workerId: 0,
      receivedPathCount: state.receivedPathCount,
      expectedPathCount: state.expectedPathCount
    });
    emitLifecycleEvent(state.executionId, 0, 'AGG_ALL_PATHS_RECEIVED', {
      receivedPathCount: state.receivedPathCount,
      expectedPathCount: state.expectedPathCount
    }, runStartMs);
  }

  if (state.pendingFinalize && state.receivedPathCount === state.expectedPathCount) {
    const pendingMessage = state.pendingFinalize;
    state.pendingFinalize = null;
    if (finalizeIfReady) {
      finalizeIfReady(pendingMessage, state);
    }
  }
};

export const processAddBatchMessage = (
  message: AggregationWorkerRequest,
  state = aggregationState,
  sink: (message: any) => void = () => undefined,
  emitLifecycleEvent: (executionId: string | null, workerId: number, event: string, details?: Record<string, unknown>, runStartMs?: number) => void = () => undefined,
  finalizeIfReady: ((message: AggregationWorkerRequest, state: typeof aggregationState) => void) | null = null,
  runStartMs?: number
): void => {
  const batchId = typeof message.batchId === 'string' ? message.batchId : typeof (message as any).batchProfilingId === 'string' ? (message as any).batchProfilingId : undefined;
  const hasArrays = !!message.arrays;
  const hasBatch = Array.isArray(message.batch);
  const receivedPathCount = state.receivedPathCount;
  const expectedPathCount = state.expectedPathCount;
  emitLifecycleEvent(message.executionId, message.workerId ?? 0, 'AGG_ADD_BATCH_ENTER', {
    batchId,
    hasArrays,
    hasBatch,
    receivedPathCount,
    expectedPathCount
  }, runStartMs);

  try {
    const batch = message.arrays ? decodeTransportBatch(message) : Array.isArray(message.batch) ? message.batch : [];
    emitLifecycleEvent(message.executionId, message.workerId ?? 0, 'AGG_DECODE_STATUS', {
      batchId,
      decodedCount: batch.length,
      receivedPathCount,
      expectedPathCount
    }, runStartMs);

    const receivedBefore = state.receivedPathCount;
    sink({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_ADD_BATCH_RECEIVE_ENTER',
      originalType: message.type,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null,
      pathCountInBatch: batch.length,
      receivedTopLevelKeys: Object.keys(message)
    });
    handleBatchMessage(batch, state, sink, emitLifecycleEvent, finalizeIfReady, runStartMs);
    const receivedAfter = state.receivedPathCount;
    sink({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_ADD_BATCH_ACCOUNTED',
      originalType: message.type,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null,
      pathsReceivedBefore: receivedBefore,
      pathsReceivedAfter: receivedAfter,
      deltaPaths: receivedAfter - receivedBefore
    });
    emitLifecycleEvent(message.executionId, message.workerId ?? 0, 'AGG_BATCH_ACCEPTED', {
      batchId,
      batchPathCount: batch.length,
      receivedPathCount: state.receivedPathCount,
      expectedPathCount: state.expectedPathCount
    }, runStartMs);
    return;
  } catch (error) {
    const errorInstance = error instanceof Error ? error : new Error(String(error));
    emitLifecycleEvent(message.executionId, message.workerId ?? 0, 'AGG_HANDLER_EXCEPTION', {
      batchId: typeof message.batchId === 'string' ? message.batchId : typeof (message as any).batchProfilingId === 'string' ? (message as any).batchProfilingId : undefined,
      stage: 'DECODE',
      errorName: errorInstance.name,
      errorMessage: errorInstance.message
    }, runStartMs);
    throw error;
  }
};
