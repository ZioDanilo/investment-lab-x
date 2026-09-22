import { MonteCarloSnapshot, MonteCarloUserInput, MonteCarloResult } from '../models/monte-carlo-contracts.model';
import { prepareMonteCarloPrecomputation, prepareMonteCarloPrecomputationAsync } from '../precomputation/monte-carlo-precomputation';
import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';

export const MONTE_CARLO_EXECUTION_MODES = {
  SMOKE: 100,
  INTERMEDIATE: 1_000,
  COMPLETE: 1_000
} as const;

export type MonteCarloExecutionMode = keyof typeof MONTE_CARLO_EXECUTION_MODES;

export interface MonteCarloWorkerMessageBase {
  executionId: string;
  workerId: number;
  runSeed?: number;
  runStartMs?: number;
}

export type MonteCarloWorkerMessage =
  | ({ type: 'INIT'; precompute: unknown; input: MonteCarloUserInput; snapshot: MonteCarloSnapshot; workerId: number; executionId: string; runSeed?: number; runStartMs?: number; aggregationPort?: MessagePort })
  | ({ type: 'RUN_BATCH'; batchStart: number; batchEnd: number; pathCount: number; input: MonteCarloUserInput; snapshot: MonteCarloSnapshot; precompute: unknown; workerId: number; executionId: string; runSeed?: number; runStartMs?: number; advancedStatistics?: boolean; profileWorkerTiming?: boolean })
  | ({ type: 'CANCEL'; executionId: string; workerId: number })
  | ({ type: 'PROGRESS'; executionId: string; workerId: number; batchStart: number; batchEnd: number; batchId: string; completedPaths: number; totalPaths: number })
  | ({ type: 'SIMULATION_COMPLETE'; executionId: string; workerId: number; completedPaths: number; totalPaths: number })
  | ({ type: 'ERROR'; executionId: string; workerId: number; error: { code: string; message: string; details?: Record<string, unknown> } })
  | ({ type: 'BATCH_RESULT'; executionId: string; workerId: number; batchStart: number; batchEnd: number; results: any[]; redrawCount?: number; rejectRate?: number });

export interface MonteCarloAggregationWorkerMessage {
  executionId: string;
  workerId: number;
  type: 'INIT' | 'REGISTER_SIMULATION_PORT' | 'ADD_BATCH' | 'FINALIZE' | 'RESULT' | 'ERROR';
  runStartMs?: number;
  paths?: any[];
  batch?: any[];
  input?: MonteCarloUserInput;
  snapshot?: MonteCarloSnapshot;
  result?: MonteCarloResult;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  simulationPort?: MessagePort;
  expectedPathCount?: number;
  advancedStatistics?: boolean;
}

export interface WorkerLike {
  addEventListener: (type: 'message' | 'error', listener: (event: { data?: any }) => void) => void;
  postMessage: (message: any) => void;
  terminate: () => void;
}

export type MonteCarloRunStatus = 'success' | 'failed' | 'cancelled';

export type MonteCarloDiagnosticWorkerMode = 'A' | 'B';

export interface MonteCarloBatchDiagnosticSnapshot {
  batchCount: number;
  maxPathsPerBatch: number;
  avgPathsPerBatch: number;
  maxBatchHandlerMs: number;
  avgBatchHandlerMs: number;
}

export interface MonteCarloCoordinatorDiagnosticReport {
  hardwareConcurrency: number;
  currentWorkerCount: number;
  workerMode: MonteCarloDiagnosticWorkerMode | 'DEFAULT';
  modeAWorkers: number;
  modeBWorkers: number;
  totalMs: number;
  simulationMs: number;
  aggregationMs: number;
  eventLoopMaxLagMs: number;
  eventLoopAvgLagMs: number;
  pageUnresponsive: boolean;
  batchCount: number;
  maxPathsPerBatch: number;
  avgPathsPerBatch: number;
  maxBatchHandlerMs: number;
  avgBatchHandlerMs: number;
  approxBatchPayloadMb: number;
  approxTotalWorkerPayloadMb: number;
  maxBatchRoutingMs: number;
  mainThreadFullPathCount: number;
  mainThreadMonthlyRecordCount: number;
  simulationToAggregationDirectPort: boolean;
  mainThreadReceivesFullPaths: boolean;
  fullPathMainThreadMessageCount: number;
  aggregationReceivedPaths: number;
  expectedPaths: number;
  angularUpdatePerBatch: boolean;
  changeDetectionTriggerPerBatch: boolean;
  residualMainThreadHeavyWork: string[];
  primaryCause: 'CPU_SATURATION' | 'WORKER_MESSAGE_PAYLOAD' | 'CPU_SATURATION_AND_PAYLOAD' | 'OTHER';
}

export interface MonteCarloCoordinatorOptions {
  input: MonteCarloUserInput;
  snapshot: MonteCarloSnapshot;
  seed?: number;
  mode?: MonteCarloExecutionMode;
  advancedStatistics?: boolean;
  profilingEnabled?: boolean;
  workerFactory?: (scriptPath: string) => WorkerLike;
  aggregationWorkerFactory?: (scriptPath: string) => WorkerLike;
  generalBenchmarkWorkerFactory?: (scriptPath: string) => WorkerLike;
  workerCountOverride?: number;
  batchSize?: number;
  diagnosticWorkerMode?: MonteCarloDiagnosticWorkerMode;
  onProgress?: (progress: number) => void;
  onWorkerMessage?: (payload: { [key: string]: any }) => void;
}

export interface MonteCarloCoordinatorOutcome {
  status: MonteCarloRunStatus;
  paths: any[];
  runSeed?: number;
  result?: MonteCarloResult;
  progress: number;
  completedPaths: number;
  totalPaths: number;
  performanceMetrics: {
    totalTime: number;
    pathsPerSecond: number;
    monthsPerSecond: number;
    totalRedraw: number;
    rejectRate: number;
    factorizationTime: number;
  };
  diagnostics?: MonteCarloCoordinatorDiagnosticReport;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

const DEFAULT_BATCH_SIZE = 250;

const createExecutionId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mc-exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createDiagnosticChannelId = (executionId: string, workerId: number): string => `${executionId}:${workerId}`;

const mix32 = (value: number): number => {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae3d);
  x ^= x >>> 16;
  return x >>> 0;
};

const deriveGeneralBenchmarkSeed = (runSeed: number): number => mix32((runSeed >>> 0) ^ 0x47454e42);

const computeWorkerCount = (pathCount: number, override?: number): number => {
  if (override && Number.isFinite(override)) {
    return Math.max(1, Math.min(pathCount, Math.floor(override)));
  }
  const runtimeConcurrency = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(pathCount, runtimeConcurrency - 1 || 1));
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

export class MonteCarloWorkerPool {
  private readonly workers: WorkerLike[] = [];
  private readonly readyWorkers = new Set<number>();
  private readonly workerById = new Map<number, WorkerLike>();
  private readonly executionId: string;
  private readonly runSeed: number;
  private readonly workerFactory: (scriptPath: string) => WorkerLike;
  private readonly totalPaths: number;
  private readonly batchSize: number;
  private readonly input: MonteCarloUserInput;
  private readonly snapshot: MonteCarloSnapshot;
  private readonly advancedStatistics: boolean;
  private readonly profilingEnabled: boolean;
  private readonly onBatchResult: (payload: { batchStart: number; batchEnd: number; results: any[]; redrawCount?: number; rejectRate?: number }) => void;
  private readonly onProgress: (payload: { completedPaths: number; totalPaths: number; workerId: number; batchStart?: number; batchEnd?: number; batchId?: string }) => void;
  private readonly onSimulationComplete: (workerId: number) => void;
  private readonly onRegisterSimulationPort: (workerId: number, port: MessagePort) => void;
  private readonly onWorkerMessage: (payload: { [key: string]: any }) => void;
  private readonly onWorkerError: (error: { code: string; message: string; details?: Record<string, unknown> }) => void;
  private readonly onReady: () => void;
  private readonly onCancelled: () => void;
  private readonly runStartMs: number;
  private precompute: unknown;
  private nextBatchStart = 0;
  private nextWorkerIndex = 0;

  constructor(options: {
    executionId: string;
    runSeed: number;
    workerFactory: (scriptPath: string) => WorkerLike;
    totalPaths: number;
    batchSize: number;
    input: MonteCarloUserInput;
    snapshot: MonteCarloSnapshot;
    precompute: unknown;
    advancedStatistics?: boolean;
    profilingEnabled?: boolean;
    onBatchResult: (payload: { batchStart: number; batchEnd: number; results: any[]; redrawCount?: number; rejectRate?: number }) => void;
    onProgress?: (payload: { completedPaths: number; totalPaths: number; workerId: number; batchStart?: number; batchEnd?: number; batchId?: string }) => void;
    onSimulationComplete?: (workerId: number) => void;
    onRegisterSimulationPort?: (workerId: number, port: MessagePort) => void;
    onWorkerMessage?: (payload: { [key: string]: any }) => void;
    onWorkerError: (error: { code: string; message: string; details?: Record<string, unknown> }) => void;
    onReady: () => void;
    onCancelled: () => void;
    runStartMs?: number;
  }) {
    this.executionId = options.executionId;
    this.runSeed = options.runSeed;
    this.workerFactory = options.workerFactory;
    this.totalPaths = options.totalPaths;
    this.batchSize = options.batchSize;
    this.input = options.input;
    this.snapshot = options.snapshot;
    this.precompute = options.precompute;
    this.advancedStatistics = options.advancedStatistics ?? true;
    this.profilingEnabled = options.profilingEnabled ?? false;
    this.onBatchResult = options.onBatchResult;
    this.onProgress = options.onProgress ?? (() => undefined);
    this.onSimulationComplete = options.onSimulationComplete ?? (() => undefined);
    this.onRegisterSimulationPort = options.onRegisterSimulationPort ?? (() => undefined);
    this.onWorkerMessage = options.onWorkerMessage ?? (() => undefined);
    this.onWorkerError = options.onWorkerError;
    this.onReady = options.onReady;
    this.onCancelled = options.onCancelled;
    this.runStartMs = options.runStartMs ?? performance.now();
  }

  start(workerCount: number): void {
    for (let workerId = 0; workerId < workerCount; workerId += 1) {
      const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
      const worker = this.workerFactory(`monte-carlo-worker-${workerId}.ts`);
      const listener = (event: { data?: any }) => {
        const data = event.data;
        if (!data || data.executionId !== this.executionId) return;
        this.onWorkerMessage(data);
        if (data.type === 'READY') {
          this.readyWorkers.add(data.workerId);
          this.onReady();
          return;
        }
        if (data.type === 'PROGRESS') {
          this.onProgress({
            completedPaths: data.completedPaths ?? 0,
            totalPaths: data.totalPaths ?? 0,
            workerId: data.workerId,
            batchStart: typeof data.batchStart === 'number' ? data.batchStart : undefined,
            batchEnd: typeof data.batchEnd === 'number' ? data.batchEnd : undefined,
            batchId: typeof data.batchId === 'string' ? data.batchId : undefined
          });
          return;
        }
        if (data.type === 'SIMULATION_COMPLETE') {
          this.onSimulationComplete(data.workerId);
          return;
        }
        if (data.type === 'BATCH_RESULT') {
          this.onBatchResult({
            batchStart: data.batchStart,
            batchEnd: data.batchEnd,
            results: Array.isArray(data.results) ? data.results : [],
            redrawCount: typeof data.redrawCount === 'number' ? data.redrawCount : 0,
            rejectRate: typeof data.rejectRate === 'number' ? data.rejectRate : 0
          });
          return;
        }
        if (data.type === 'ERROR') {
          this.onWorkerError({
            code: data.error?.code ?? 'WORKER_ERROR',
            message: data.error?.message ?? 'Worker error',
            details: data.error?.details ?? {}
          });
          return;
        }
        if (data.type === 'CANCELLED') {
          this.onCancelled();
        }
      };
      worker.addEventListener('message', listener);
      worker.addEventListener('error', (event) => {
        const anyEvent = event as any;
        const rawError = anyEvent?.error ?? anyEvent?.data ?? {};
        const errorBody = rawError && typeof rawError === 'object' && 'error' in rawError ? rawError.error : rawError;
        const rawMessage = typeof anyEvent?.message === 'string' ? anyEvent.message : '';
        const message = rawMessage.trim().length > 0
          ? rawMessage
          : typeof errorBody?.message === 'string'
            ? errorBody.message
            : typeof rawError?.message === 'string'
              ? rawError.message
              : 'Worker runtime error';
        const details = {
          ...(errorBody && typeof errorBody === 'object' ? errorBody : {}),
          ...(anyEvent?.data ?? {}),
          error: rawError ?? null,
          filename: typeof anyEvent?.filename === 'string' ? anyEvent.filename : undefined,
          lineno: typeof anyEvent?.lineno === 'number' ? anyEvent.lineno : undefined,
          colno: typeof anyEvent?.colno === 'number' ? anyEvent.colno : undefined,
          stack: typeof anyEvent?.error?.stack === 'string' ? anyEvent.error.stack : undefined
        };

        this.onWorkerError({
          code: typeof errorBody?.code === 'string' ? errorBody.code : 'WORKER_ERROR',
          message,
          details
        });
      });
      this.workers.push(worker);
      this.workerById.set(workerId, worker);
      this.onWorkerMessage({
        type: 'LIFECYCLE_EVENT',
        event: 'WORKER_START',
        workerId,
        relativeMs: Number((performance.now() - this.runStartMs).toFixed(2)),
        pathCount: this.totalPaths
      });
      if (channel) {
        const mcChannelId = createDiagnosticChannelId(this.executionId, workerId);
        this.onWorkerMessage({
          type: 'LIFECYCLE_EVENT',
          executionId: this.executionId,
          workerId,
          event: 'COORD_CHANNEL_CREATED',
          mcChannelId,
          pathCount: this.totalPaths
        });
        this.onRegisterSimulationPort(workerId, channel.port2);
        (worker as any).postMessage({
          type: 'INIT',
          executionId: this.executionId,
          workerId,
          runSeed: this.runSeed,
          runStartMs: this.runStartMs,
          precompute: this.precompute,
          input: this.input,
          snapshot: this.snapshot,
          aggregationPort: channel.port1,
          mcChannelId
        }, [channel.port1]);
      } else {
        worker.postMessage({
          type: 'INIT',
          executionId: this.executionId,
          workerId,
          runSeed: this.runSeed,
          runStartMs: this.runStartMs,
          precompute: this.precompute,
          input: this.input,
          snapshot: this.snapshot
        } satisfies MonteCarloWorkerMessage);
      }
    }
  }

  sendQueuedWork(): void {
    if (this.readyWorkers.size === 0 || this.nextBatchStart >= this.totalPaths) return;

    const readyWorkerIds = [...this.readyWorkers];
    const workerId = readyWorkerIds[this.nextWorkerIndex % readyWorkerIds.length];
    const worker = this.workerById.get(workerId);
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % readyWorkerIds.length;

    if (!worker) return;

    const batchStart = this.nextBatchStart;
    const batchEnd = Math.min(this.totalPaths, batchStart + this.batchSize);
    worker.postMessage({
      type: 'RUN_BATCH',
      executionId: this.executionId,
      workerId,
      runSeed: this.runSeed,
      batchStart,
      batchEnd,
      pathCount: this.totalPaths,
      input: this.input,
      snapshot: this.snapshot,
      precompute: this.precompute,
      advancedStatistics: this.advancedStatistics,
      profileWorkerTiming: this.profilingEnabled
    } satisfies MonteCarloWorkerMessage);

    this.nextBatchStart = batchEnd;
  }

  terminate(): void {
    for (const worker of this.workers) {
      try {
        worker.terminate();
      } catch {
        // ignore termination errors during shutdown
      }
    }
    this.workers.length = 0;
    this.readyWorkers.clear();
    this.workerById.clear();
  }
}

export class MonteCarloCoordinator {
  private readonly input: MonteCarloUserInput;
  private readonly snapshot: MonteCarloSnapshot;
  private readonly executionId: string;
  private readonly runSeed: number;
  private readonly mode: MonteCarloExecutionMode;
  private readonly advancedStatistics: boolean;
  private readonly profilingEnabled: boolean;
  private readonly workerFactory: (scriptPath: string) => WorkerLike;
  private readonly aggregationWorkerFactory: (scriptPath: string) => WorkerLike;
  private readonly generalBenchmarkWorkerFactory: (scriptPath: string) => WorkerLike;
  private readonly workerCount: number;
  private readonly batchSize: number;
  private readonly totalPaths: number;
  private readonly startedAt = Date.now();
  private lifecycleRunStartMs = 0;
  private readonly lightweightPathMetadata: Array<{ simulationId: number }> = [];
  private readonly profilingState: {
    timeline: Array<Record<string, unknown>>;
    workerSummaries: Array<Record<string, number>>;
    batchSummaries: Array<Record<string, number>>;
    generalSummary: Record<string, number>;
  } = {
    timeline: [],
    workerSummaries: [],
    batchSummaries: [],
    generalSummary: {}
  };
  private readonly workerPool: MonteCarloWorkerPool;
  private progressHandler?: (progress: number) => void;
  private readonly resolveRun: (value: MonteCarloCoordinatorOutcome) => void;
  private readonly rejectRun: (reason?: unknown) => void;
  private readonly diagnosticWorkerMode?: MonteCarloDiagnosticWorkerMode;
  private readonly completedSimulationWorkers = new Set<number>();
  private readonly completedBatchIds = new Set<string>();
  private readonly completedPathRanges: Array<{ start: number; end: number }> = [];
  private aggregationWorker: WorkerLike | null = null;
  private aggregationWorkerReady = false;
  private aggregationResultResolver?: (value: MonteCarloResult) => void;
  private aggregationResultRejecter?: (reason?: unknown) => void;
  private generalBenchmarkWorker: WorkerLike | null = null;
  private generalBenchmarkResult?: {
    executionId: string;
    generalBenchmarkCAGR: number;
    generalBenchmarkVolatility: number;
    completedPaths: number;
    monthsProcessed: number;
    candidateVectors: number;
    acceptedVectors: number;
    rejectedVectors: number;
    physicalFloorRejectedVectors: number;
    pathMetrics: Array<{ cagr: number; annualizedVolatility: number; candidateVectors: number; acceptedVectors: number; rejectedVectors: number; physicalFloorRejectedVectors: number }>;
  };
  private generalBenchmarkError?: { code: string; message: string; details?: Record<string, unknown> };
  private generalBenchmarkResolver?: (value: typeof this.generalBenchmarkResult) => void;
  private generalBenchmarkRejecter?: (reason?: unknown) => void;
  private generalBenchmarkPromise?: Promise<typeof this.generalBenchmarkResult>;
  private finalizing = false;
  private lastProgressUpdateAt = 0;
  private mainThreadFullPathCount = 0;
  private fullPathMainThreadMessageCount = 0;
  private aggregationReceivedPaths = 0;
  private expectedAggregationPaths = 0;

  private completedPaths = 0;
  private cancelled = false;
  private failed = false;
  private totalRedraw = 0;
  private totalRejects = 0;
  private totalObservedPaths = 0;
  private factorizationTimeMs = 0;
  private factorized = false;
  private maxBatchRoutingMs = 0;
  private heartbeatTimer?: number;
  private heartbeatIntervalMs = 250;
  private heartbeatLastTick = 0;
  private heartbeatTotalLagMs = 0;
  private heartbeatSamples = 0;
  private eventLoopMaxLagMs = 0;
  private batchHandlerMaxMs = 0;
  private batchHandlerTotalMs = 0;
  private batchHandlerAvgMs = 0;
  private batchCount = 0;
  private totalBatchPaths = 0;
  private maxPathsPerBatch = 0;
  private avgPathsPerBatch = 0;
  private simulationFinishedAt = 0;
  private aggregationStartedAt = 0;
  private aggregationCompletedAt = 0;
  private angularUpdatePerBatch = true;
  private changeDetectionTriggerPerBatch = true;
  private readonly residualMainThreadHeavyWork = [
    'allPaths.push(...batchResults)',
    'emitProgress()',
    'progress signal update',
    'workerPool.sendQueuedWork()',
    'Angular state update via progress.set(progress)'
  ];

  constructor(options: MonteCarloCoordinatorOptions) {
    this.input = options.input;
    this.snapshot = options.snapshot;
    this.mode = options.mode ?? 'COMPLETE';
    this.advancedStatistics = options.advancedStatistics ?? true;
    this.profilingEnabled = options.profilingEnabled ?? false;
    this.runSeed = this.resolveRunSeed(options.seed ?? this.input.seed);
    this.executionId = createExecutionId();
    this.lifecycleRunStartMs = performance.now();
    this.workerFactory = options.workerFactory ?? this.defaultWorkerFactory;
    this.aggregationWorkerFactory = options.aggregationWorkerFactory ?? this.defaultAggregationWorkerFactory;
    this.generalBenchmarkWorkerFactory = options.generalBenchmarkWorkerFactory ?? this.defaultGeneralBenchmarkWorkerFactory;
    this.diagnosticWorkerMode = options.diagnosticWorkerMode;
    this.totalPaths = MONTE_CARLO_EXECUTION_MODES[this.mode];
    this.workerCount = this.resolveWorkerCount(options.workerCountOverride);
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.progressHandler = options.onProgress;
    this.resolveRun = () => undefined;
    this.rejectRun = () => undefined;
    this.workerPool = new MonteCarloWorkerPool({
      executionId: this.executionId,
      runSeed: this.runSeed,
      runStartMs: this.lifecycleRunStartMs,
      workerFactory: this.workerFactory,
      totalPaths: this.totalPaths,
      batchSize: this.batchSize,
      input: this.input,
      snapshot: this.snapshot,
      precompute: undefined,
      advancedStatistics: this.advancedStatistics,
      profilingEnabled: this.profilingEnabled,
      onBatchResult: (payload) => this.handleBatchResult(payload),
      onProgress: (payload) => this.handleWorkerProgress(payload),
      onSimulationComplete: (workerId) => this.handleSimulationComplete(workerId),
      onRegisterSimulationPort: (workerId, port) => this.registerSimulationPort(workerId, port),
      onWorkerMessage: (payload) => {
        if (payload.type === 'LIFECYCLE_EVENT') {
          this.recordLifecycleEvent(String(payload.event ?? 'UNKNOWN_EVENT'), {
            workerId: payload.workerId,
            batchId: payload.batchId,
            pathCount: payload.pathCount,
            completedPaths: payload.completedPaths,
            batchPathCount: payload.batchPathCount,
            receivedPathCount: payload.receivedPathCount,
            expectedPathCount: payload.expectedPathCount,
            status: payload.status,
            detail: payload.detail
          });
          return;
        }
        if (payload.type === 'SIMULATION_COMPLETE') {
          this.recordLifecycleEvent('WORKER_COMPLETE', {
            workerId: payload.workerId,
            completedPaths: payload.completedPaths,
            totalPaths: payload.totalPaths
          });
          return;
        }
        if (payload.type === 'WORKER_SUMMARY') {
          const current = payload.summary ?? {};
          this.profilingState.workerSummaries.push({
            workerId: Number(payload.workerId ?? 0),
            ...current
          } as Record<string, number>);
          this.recordProfilingEvent('WORKER_SUMMARY', Number(current.workerTotalMs ?? 0), {
            workerId: payload.workerId,
            summary: current
          });
          return;
        }
        if (payload.type === 'BATCH_PROFILE_SUMMARY') {
          const current = payload.batch ?? {};
          this.profilingState.batchSummaries.push(current as Record<string, number>);
          this.recordProfilingEvent('BATCH_PROFILE_SUMMARY', Number(current.transferToAggMs ?? 0), {
            workerId: payload.workerId,
            batch: current
          });
          return;
        }
        if (payload.type === 'PROFILE_EVENT') {
          this.recordProfilingEvent(String(payload.event ?? 'PROFILE_EVENT'), payload.value, {
            workerId: payload.workerId,
            executionId: payload.executionId,
            details: payload.details ?? {}
          });
        }
      },
      onWorkerError: (error) => this.fail(error),
      onReady: () => this.workerPool.sendQueuedWork(),
      onCancelled: () => this.cancel()
    });
  }

  private get defaultWorkerFactory(): (scriptPath: string) => WorkerLike {
    return (scriptPath: string) => {
      if (typeof Worker === 'undefined') {
        throw new Error('Web Worker support is unavailable in this runtime');
      }
      return new Worker(new URL('./monte-carlo-worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
    };
  }

  private get defaultAggregationWorkerFactory(): (scriptPath: string) => WorkerLike {
    return (scriptPath: string) => {
      if (typeof Worker === 'undefined') {
        throw new Error('Web Worker support is unavailable in this runtime');
      }
      return new Worker(new URL('./monte-carlo-aggregation.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
    };
  }

  private get defaultGeneralBenchmarkWorkerFactory(): (scriptPath: string) => WorkerLike {
    return (scriptPath: string) => {
      if (typeof Worker === 'undefined') {
        throw new Error('Web Worker support is unavailable in this runtime');
      }
      return new Worker(new URL('./monte-carlo-general-benchmark.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
    };
  }

  async run(): Promise<MonteCarloCoordinatorOutcome> {
    this.lifecycleRunStartMs = performance.now();
    this.recordLifecycleEvent('RUN_START', {
      pathCount: this.totalPaths,
      workerCount: this.workerCount,
      advancedStatistics: this.advancedStatistics
    });
    const startedAt = this.lifecycleRunStartMs;
    this.startHeartbeat();
    this.factorizationTimeMs = 0;
    if (!this.factorized) {
      this.recordLifecycleEvent('PRECOMPUTE_START', { pathCount: this.totalPaths });
      const precompute = await prepareMonteCarloPrecomputationAsync(this.snapshot);
      this.factorizationTimeMs = performance.now() - startedAt;
      this.recordLifecycleEvent('PRECOMPUTE_END', { pathCount: this.totalPaths, precomputeMs: this.factorizationTimeMs });
      this.factorized = true;
      this.workerPool['precompute'] = precompute;
    }

    if (this.completedPaths > 0 || this.cancelled || this.failed) {
      return this.buildOutcome(this.lightweightPathMetadata, this.cancelled ? 'cancelled' : this.failed ? 'failed' : 'success');
    }

    if (this.advancedStatistics) {
      this.recordLifecycleEvent('GENERAL_START', { pathCount: this.totalPaths });
      this.startGeneralBenchmarkWorker();
    }
    this.startAggregationWorker();
    this.recordLifecycleEvent('MAIN_START', {
      pathCount: this.totalPaths,
      workerCount: this.workerCount,
      batchSize: this.batchSize
    });
    this.recordProfilingEvent('TOTAL_WALL_START', performance.timeOrigin + performance.now());
    this.workerPool.start(this.workerCount);
    this.emitProgress();
    return new Promise<MonteCarloCoordinatorOutcome>((resolve, reject) => {
      const check = () => {
        if (this.cancelled) {
          resolve(this.buildOutcome([], 'cancelled'));
          return;
        }
        if (this.failed) {
          resolve(this.buildOutcome([], 'failed', this.currentError));
          return;
        }
        if (this.completedPaths >= this.totalPaths && !this.finalizing) {
          this.finalizing = true;
          void this.finalizeSuccess()
            .then((result) => resolve(result))
            .catch((error) => {
              const failure = {
                code: 'AGGREGATION_WORKER_ERROR',
                message: error instanceof Error ? error.message : 'Aggregation worker failed',
                details: error instanceof Error && 'details' in error ? (error as any).details : {}
              };
              this.fail(failure);
              resolve(this.buildOutcome([], 'failed', failure));
            });
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
  }

  setProgressListener(listener: (progress: number) => void): void {
    this.progressHandler = listener;
  }

  cancel(): void {
    if (this.cancelled || this.failed) return;
    this.cancelled = true;
    this.workerPool.terminate();
    this.emitProgress();
  }

  private currentError?: { code: string; message: string; details?: Record<string, unknown> };

  private resolveRunSeed(explicitSeed?: number): number {
    if (typeof explicitSeed === 'number' && Number.isFinite(explicitSeed)) {
      return explicitSeed >>> 0;
    }
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto && typeof crypto.getRandomValues === 'function') {
      return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    }
    return (Math.random() * 0x100000000) >>> 0;
  }

  private resolveWorkerCount(override?: number): number {
    if (this.diagnosticWorkerMode === 'B') {
      return 2;
    }
    return computeWorkerCount(this.totalPaths, override);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatLastTick = performance.now();
    this.heartbeatTimer = globalThis.setInterval(() => {
      const now = performance.now();
      const expectedAt = this.heartbeatLastTick + this.heartbeatIntervalMs;
      const lagMs = Math.max(0, now - expectedAt);
      this.heartbeatTotalLagMs += lagMs;
      this.heartbeatSamples += 1;
      this.eventLoopMaxLagMs = Math.max(this.eventLoopMaxLagMs, lagMs);
      this.heartbeatLastTick = now;
    }, this.heartbeatIntervalMs) as unknown as number;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      globalThis.clearInterval(this.heartbeatTimer as any);
      this.heartbeatTimer = undefined;
    }
  }

  private recordLifecycleEvent(event: string, details: Record<string, unknown> = {}): Record<string, unknown> {
    const trace = ((globalThis as any).__mcLifecycleTrace ??= { runStartMs: this.lifecycleRunStartMs || performance.now(), events: [] });
    if (!trace.runStartMs) {
      trace.runStartMs = this.lifecycleRunStartMs || performance.now();
    }
    const entry = {
      event,
      relativeMs: Number.isFinite(trace.runStartMs) ? Number((performance.now() - trace.runStartMs).toFixed(2)) : null,
      ...details
    };
    trace.events.push(entry);
    if (typeof window !== 'undefined') {
      (window as any).__mcLifecycleTrace = trace;
    }
    return entry;
  }

  private getDiagnosticReport(): MonteCarloCoordinatorDiagnosticReport {
    const hardwareConcurrency = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    const modeAWorkers = computeWorkerCount(this.totalPaths, undefined);
    const modeBWorkers = 2;
    const currentWorkerCount = this.workerCount;
    const avgLagMs = this.heartbeatSamples > 0 ? this.heartbeatTotalLagMs / this.heartbeatSamples : 0;
    const batchCount = this.batchCount;
    const avgPathsPerBatch = batchCount > 0 ? this.totalBatchPaths / batchCount : 0;
    const avgBatchHandlerMs = batchCount > 0 ? this.batchHandlerTotalMs / batchCount : 0;
    const batchPayload = this.estimateApproxPayloadMb();
    const totalMs = Date.now() - this.startedAt;
    const aggregationDurationMs = this.aggregationCompletedAt > 0 && this.aggregationStartedAt > 0 ? this.aggregationCompletedAt - this.aggregationStartedAt : 0;
    const simulationMs = this.simulationFinishedAt > 0 ? Math.max(0, this.simulationFinishedAt - this.startedAt) : Math.max(0, totalMs - aggregationDurationMs);
    const primaryCause = this.eventLoopMaxLagMs > 1500 && this.batchHandlerMaxMs > 1500 ? 'CPU_SATURATION_AND_PAYLOAD' : this.eventLoopMaxLagMs > 1500 ? 'CPU_SATURATION' : this.batchHandlerMaxMs > 1500 ? 'WORKER_MESSAGE_PAYLOAD' : 'OTHER';

    return {
      hardwareConcurrency,
      currentWorkerCount,
      workerMode: this.diagnosticWorkerMode ? this.diagnosticWorkerMode : 'DEFAULT',
      modeAWorkers,
      modeBWorkers,
      totalMs,
      simulationMs,
      aggregationMs: aggregationDurationMs,
      eventLoopMaxLagMs: this.eventLoopMaxLagMs,
      eventLoopAvgLagMs: avgLagMs,
      pageUnresponsive: this.eventLoopMaxLagMs > 1000 || this.batchHandlerMaxMs > 1000,
      batchCount,
      maxPathsPerBatch: this.maxPathsPerBatch,
      avgPathsPerBatch,
      maxBatchHandlerMs: this.batchHandlerMaxMs,
      avgBatchHandlerMs,
      approxBatchPayloadMb: batchPayload.approxBatchPayloadMb,
      approxTotalWorkerPayloadMb: batchPayload.approxTotalWorkerPayloadMb,
      maxBatchRoutingMs: this.maxBatchRoutingMs,
      mainThreadFullPathCount: this.mainThreadFullPathCount,
      mainThreadMonthlyRecordCount: 0,
      simulationToAggregationDirectPort: true,
      mainThreadReceivesFullPaths: false,
      fullPathMainThreadMessageCount: this.fullPathMainThreadMessageCount,
      aggregationReceivedPaths: this.aggregationReceivedPaths,
      expectedPaths: this.expectedAggregationPaths || this.totalPaths,
      angularUpdatePerBatch: this.angularUpdatePerBatch,
      changeDetectionTriggerPerBatch: this.changeDetectionTriggerPerBatch,
      residualMainThreadHeavyWork: [...this.residualMainThreadHeavyWork],
      primaryCause
    };
  }

  private estimateApproxPayloadMb(): { approxBatchPayloadMb: number; approxTotalWorkerPayloadMb: number } {
    const positionsPerMonth = Math.max(1, this.input.positions.length);
    const monthsPerPath = Math.max(1, this.input.horizonYears * 12);
    const pathsPerBatch = Math.max(1, this.batchSize);
    const scenarioEntriesPerPath = monthsPerPath;
    const bytesPerPath = monthsPerPath * (32 + positionsPerMonth * 72) + scenarioEntriesPerPath * 24;
    const approxBatchPayloadMb = ((bytesPerPath * pathsPerBatch) / (1024 * 1024));
    const approxTotalWorkerPayloadMb = ((bytesPerPath * this.totalPaths) / (1024 * 1024));
    return {
      approxBatchPayloadMb,
      approxTotalWorkerPayloadMb
    };
  }

  private handleBatchResult(payload: { batchStart: number; batchEnd: number; results: any[]; redrawCount?: number; rejectRate?: number }): void {
    // Main thread intentionally does not receive or retain full path payloads.
    this.fullPathMainThreadMessageCount += 1;
    this.mainThreadFullPathCount += Array.isArray(payload.results) ? payload.results.length : 0;
    this.totalObservedPaths += Array.isArray(payload.results) ? payload.results.length : 0;
    this.emitProgress();
  }

  private registerCompletedBatch(batchStart: number, batchEnd: number, batchId?: string): void {
    if (!Number.isFinite(batchStart) || !Number.isFinite(batchEnd) || batchEnd <= batchStart) {
      return;
    }
    const normalizedStart = Math.max(0, Math.floor(batchStart));
    const normalizedEnd = Math.min(this.totalPaths, Math.floor(batchEnd));
    if (normalizedEnd <= normalizedStart || normalizedStart >= this.totalPaths) {
      return;
    }
    const resolvedBatchId = batchId ?? `${normalizedStart}-${normalizedEnd}`;
    if (this.completedBatchIds.has(resolvedBatchId)) {
      return;
    }
    this.completedBatchIds.add(resolvedBatchId);
    this.completedPathRanges.push({ start: normalizedStart, end: normalizedEnd });
    this.completedPathRanges.sort((a, b) => a.start - b.start);

    const merged: Array<{ start: number; end: number }> = [];
    for (const range of this.completedPathRanges) {
      const last = merged[merged.length - 1];
      if (!last || range.start > last.end) {
        merged.push({ ...range });
        continue;
      }
      last.end = Math.max(last.end, range.end);
    }

    this.completedPathRanges.length = 0;
    for (const range of merged) {
      this.completedPathRanges.push(range);
    }
    this.completedPaths = Math.min(this.completedPathRanges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0), this.totalPaths);
  }

  private handleWorkerProgress(payload: { completedPaths: number; totalPaths: number; workerId: number; batchStart?: number; batchEnd?: number; batchId?: string }): void {
    if (typeof payload.batchStart === 'number' && typeof payload.batchEnd === 'number') {
      this.registerCompletedBatch(payload.batchStart, payload.batchEnd, payload.batchId);
    } else {
      const completedPaths = Math.min(payload.completedPaths ?? 0, this.totalPaths);
      this.completedPaths = Math.min(Math.max(this.completedPaths, completedPaths), this.totalPaths);
    }
    this.emitProgress();
    this.workerPool.sendQueuedWork();
  }

  private handleSimulationComplete(workerId: number): void {
    this.completedSimulationWorkers.add(workerId);
    if (this.completedSimulationWorkers.size >= this.workerCount) {
      this.recordLifecycleEvent('MAIN_COMPLETE', {
        workerId,
        workersStarted: this.workerCount,
        workersCompleted: this.completedSimulationWorkers.size,
        completedPaths: this.completedPaths,
        totalPaths: this.totalPaths
      });
    }
  }

  private registerSimulationPort(workerId: number, port: MessagePort): void {
    if (!this.aggregationWorker || !port) return;
    const mcChannelId = createDiagnosticChannelId(this.executionId, workerId);
    this.recordLifecycleEvent('COORD_AGG_PORT_REGISTER_POST', {
      executionId: this.executionId,
      workerId,
      mcChannelId,
      pathCount: this.totalPaths
    });
    (this.aggregationWorker as any).postMessage({
      type: 'REGISTER_SIMULATION_PORT',
      executionId: this.executionId,
      workerId,
      simulationPort: port,
      mcChannelId
    }, [port]);
  }

  private sendFinalizeToAggregationWorker(): void {
    if (!this.aggregationWorker || this.finalizing) return;
    this.expectedAggregationPaths = this.totalPaths;
    this.aggregationWorker.postMessage({
      type: 'FINALIZE',
      executionId: this.executionId,
      workerId: 0,
      expectedPathCount: this.expectedAggregationPaths,
      input: this.input,
      snapshot: this.snapshot,
      advancedStatistics: this.advancedStatistics,
      generalBenchmark: this.generalBenchmarkResult
    } as MonteCarloAggregationWorkerMessage);
  }

  private startGeneralBenchmarkWorker(): void {
    if (!this.advancedStatistics) {
      if (this.generalBenchmarkWorker) {
        try {
          this.generalBenchmarkWorker.terminate();
        } catch {
          // ignore termination errors during shutdown
        }
        this.generalBenchmarkWorker = null;
      }
      this.generalBenchmarkResult = undefined;
      this.generalBenchmarkError = undefined;
      this.generalBenchmarkResolver = undefined;
      this.generalBenchmarkRejecter = undefined;
      this.generalBenchmarkPromise = undefined;
      return;
    }
    if (this.generalBenchmarkWorker || this.generalBenchmarkPromise) {
      return;
    }

    const worker = this.generalBenchmarkWorkerFactory('monte-carlo-general-benchmark.worker.ts');
    this.generalBenchmarkPromise = new Promise((resolve, reject) => {
      this.generalBenchmarkResolver = resolve;
      this.generalBenchmarkRejecter = reject;
    });

    const listener = (event: { data?: any }) => {
      const data = event.data;
      if (!data || data.executionId !== this.executionId) return;
      if (data.type === 'GENERAL_BENCHMARK_RESULT') {
        this.profilingState.generalSummary = data.summary ?? {};
        this.generalBenchmarkResult = data.result;
        this.generalBenchmarkResolver?.(data.result);
        this.generalBenchmarkResolver = undefined;
        this.generalBenchmarkRejecter = undefined;
        return;
      }
      if (data.type === 'GENERAL_BENCHMARK_ERROR') {
        this.generalBenchmarkError = {
          code: data.error?.code ?? 'GENERAL_BENCHMARK_ERROR',
          message: data.error?.message ?? 'General benchmark failed',
          details: data.error?.details ?? {}
        };
        this.generalBenchmarkRejecter?.(new Error(this.generalBenchmarkError.message));
        this.generalBenchmarkResolver = undefined;
        this.generalBenchmarkRejecter = undefined;
        this.fail(this.generalBenchmarkError);
      }
    };

    worker.addEventListener('message', listener);
    worker.addEventListener('error', (event: { error?: any; data?: any }) => {
      const error = event?.error ?? event?.data ?? {};
      const message = typeof error?.message === 'string' ? error.message : 'General benchmark worker runtime error';
      const failure = { code: 'GENERAL_BENCHMARK_ERROR', message, details: { raw: error } };
      this.generalBenchmarkError = failure;
      this.generalBenchmarkRejecter?.(new Error(message));
      this.generalBenchmarkResolver = undefined;
      this.generalBenchmarkRejecter = undefined;
      this.fail(failure);
    });

    this.generalBenchmarkWorker = worker;
    worker.postMessage({
      type: 'RUN_GENERAL_BENCHMARK',
      executionId: this.executionId,
      workerId: 0,
      input: this.input,
      snapshot: this.snapshot,
      seed: deriveGeneralBenchmarkSeed(this.runSeed),
      simulationCount: 1000
    });
  }

  private async waitForGeneralBenchmarkCompletion(): Promise<typeof this.generalBenchmarkResult> {
    if (!this.advancedStatistics) {
      this.generalBenchmarkWorker?.terminate();
      this.generalBenchmarkWorker = null;
      return undefined;
    }
    if (this.generalBenchmarkError) {
      throw new Error(this.generalBenchmarkError.message);
    }
    if (this.generalBenchmarkResult) {
      this.generalBenchmarkWorker?.terminate();
      this.generalBenchmarkWorker = null;
      return this.generalBenchmarkResult;
    }
    if (!this.generalBenchmarkPromise) {
      return undefined;
    }
    const result = await this.generalBenchmarkPromise;
    this.generalBenchmarkWorker?.terminate();
    this.generalBenchmarkWorker = null;
    return result;
  }

  private recordProfilingEvent(event: string, value?: number | string, details: Record<string, unknown> = {}): void {
    const entry = {
      event,
      ts: performance.timeOrigin + performance.now(),
      value,
      ...details
    };
    this.profilingState.timeline.push(entry);
    const collector = (globalThis as any).__mcProfiling ?? {};
    collector.executionId = this.executionId;
    collector.timeline = this.profilingState.timeline;
    collector.workerSummaries = this.profilingState.workerSummaries;
    collector.batchSummaries = this.profilingState.batchSummaries;
    collector.generalSummary = this.profilingState.generalSummary;
    (globalThis as any).__mcProfiling = collector;
  }

  public getProfilingSnapshot(): Record<string, unknown> {
    return {
      executionId: this.executionId,
      timeline: [...this.profilingState.timeline],
      workerSummaries: [...this.profilingState.workerSummaries],
      batchSummaries: [...this.profilingState.batchSummaries],
      generalSummary: { ...this.profilingState.generalSummary }
    };
  }

  private emitProgress(): void {
    const progress = clampPercent(Math.round((this.completedPaths / this.totalPaths) * 100));
    const now = performance.now();
    if (this.progressHandler && (progress >= 100 || now - this.lastProgressUpdateAt >= 250)) {
      this.progressHandler(progress);
      this.lastProgressUpdateAt = now;
    }
  }

  private fail(error: { code: string; message: string; details?: Record<string, unknown> }): void {
    if (this.failed || this.cancelled) return;
    this.failed = true;
    this.currentError = error;
    this.workerPool.terminate();
    this.emitProgress();
  }

  private startAggregationWorker(): void {
    if (this.aggregationWorker || this.finalizing) return;

    const worker = this.aggregationWorkerFactory('monte-carlo-aggregation.worker.ts');
    const listener = (event: { data?: any }) => {
      const data = event.data;
      if (!data || data.executionId !== this.executionId) return;
      if (data.type === 'READY') {
        this.aggregationWorkerReady = true;
        this.recordLifecycleEvent('AGG_PORT_READY', { workerId: 0, executionId: this.executionId });
        return;
      }
      if (data.type === 'RESULT') {
        this.aggregationWorkerReady = false;
        this.recordLifecycleEvent('OFFICIAL_RESULT_READY', {
          workerId: data.workerId,
          receivedPathCount: this.aggregationReceivedPaths,
          expectedPathCount: this.totalPaths
        });
        this.recordLifecycleEvent('OFFICIAL_BUILD_END', {
          workerId: data.workerId,
          receivedPathCount: this.aggregationReceivedPaths,
          expectedPathCount: this.totalPaths
        });
        this.aggregationResultResolver?.(data.result as MonteCarloResult);
        this.aggregationResultResolver = undefined;
        this.aggregationResultRejecter = undefined;
        return;
      }
      if (data.type === 'ERROR') {
        const error = new Error(data.error?.message ?? 'Aggregation worker failed');
        this.aggregationResultRejecter?.(error);
        this.aggregationResultResolver = undefined;
        this.aggregationResultRejecter = undefined;
        this.fail({ code: data.error?.code ?? 'AGGREGATION_WORKER_ERROR', message: error.message, details: data.error?.details ?? {} });
      }
      if (data.type === 'AGGREGATION_COUNTS') {
        this.aggregationReceivedPaths = data.receivedPathCount ?? 0;
        this.recordLifecycleEvent('AGG_BATCH_RECEIVED', {
          workerId: data.workerId,
          batchPathCount: data.batchPathCount ?? 0,
          receivedPathCount: data.receivedPathCount ?? 0,
          expectedPathCount: data.expectedPathCount ?? this.totalPaths
        });
      }
      if (data.type === 'AGG_ALL_PATHS_RECEIVED') {
        this.recordLifecycleEvent('AGG_ALL_PATHS_RECEIVED', {
          workerId: data.workerId,
          receivedPathCount: data.receivedPathCount ?? 0,
          expectedPathCount: data.expectedPathCount ?? this.totalPaths
        });
      }
    };

    worker.addEventListener('message', listener);
    worker.addEventListener('error', (event: { error?: any; data?: any }) => {
      const error = event?.error ?? event?.data ?? {};
      const message = typeof error?.message === 'string' ? error.message : 'Aggregation worker runtime error';
      this.aggregationResultRejecter?.(new Error(message));
      this.aggregationResultResolver = undefined;
      this.aggregationResultRejecter = undefined;
      this.fail({ code: 'AGGREGATION_WORKER_ERROR', message, details: { raw: error } });
    });

    this.aggregationWorker = worker;
    this.aggregationWorker.postMessage({
      type: 'INIT',
      executionId: this.executionId,
      workerId: 0,
      expectedPathCount: this.totalPaths,
      runStartMs: this.lifecycleRunStartMs
    } as MonteCarloAggregationWorkerMessage & { runStartMs?: number });
  }

  private async finalizeSuccess(): Promise<MonteCarloCoordinatorOutcome> {
    if (this.cancelled || this.failed) {
      return this.buildOutcome([], this.cancelled ? 'cancelled' : 'failed', this.currentError);
    }

    this.recordLifecycleEvent('JOIN_WAIT_START', {
      expectedPathCount: this.totalPaths,
      aggregationReady: !!this.aggregationWorkerReady,
      generalBenchmarkReady: false
    });
    const generalBenchmarkResult = await this.waitForGeneralBenchmarkCompletion();
    this.recordLifecycleEvent('JOIN_GENERAL_READY', {
      generalBenchmarkReady: !!generalBenchmarkResult,
      completedPaths: this.completedPaths,
      totalPaths: this.totalPaths
    });
    this.workerPool.terminate();
    if (!this.aggregationWorker) {
      return this.buildOutcome(this.lightweightPathMetadata, 'success', undefined, undefined);
    }

    this.aggregationStartedAt = performance.now();
    this.recordProfilingEvent('FINALIZE_REQUEST_SENT', performance.timeOrigin + performance.now());
    this.recordLifecycleEvent('AGG_FINALIZATION_START', {
      receivedPathCount: this.aggregationReceivedPaths,
      expectedPathCount: this.totalPaths
    });
    const officialResult = await new Promise<MonteCarloResult>((resolve, reject) => {
      this.aggregationResultResolver = resolve;
      this.aggregationResultRejecter = reject;
      this.aggregationWorker?.postMessage({
        type: 'FINALIZE',
        executionId: this.executionId,
        workerId: 0,
        input: this.input,
        snapshot: this.snapshot,
        expectedPathCount: this.totalPaths,
        advancedStatistics: this.advancedStatistics,
        generalBenchmark: generalBenchmarkResult,
        runStartMs: this.lifecycleRunStartMs
      } as MonteCarloAggregationWorkerMessage & { runStartMs?: number });
    });
    this.aggregationCompletedAt = performance.now();
    this.recordLifecycleEvent('AGG_FINALIZATION_END', {
      receivedPathCount: this.aggregationReceivedPaths,
      expectedPathCount: this.totalPaths
    });
    this.stopHeartbeat();

    const outcome = this.buildOutcome(this.lightweightPathMetadata, 'success', undefined, officialResult);
    this.recordProfilingEvent('TOTAL_WALL_MS', outcome.performanceMetrics.totalTime);
    this.recordProfilingEvent('SUM_WORKER_CPU_MS', this.computeWorkerCpuMs());
    this.recordProfilingEvent('MAX_WORKER_TOTAL_MS', this.computeMaxWorkerTotalMs());
    this.recordProfilingEvent('MEDIAN_WORKER_TOTAL_MS', this.computeMedianWorkerTotalMs());
    return outcome;
  }

  private computeWorkerCpuMs(): number {
    const list = Array.isArray(this.profilingState.workerSummaries) ? this.profilingState.workerSummaries as Array<Record<string, number>> : [];
    return list.reduce((sum, item) => sum + (Number(item.workerTotalMs) || 0), 0);
  }
  private computeMaxWorkerTotalMs(): number {
    const list = Array.isArray(this.profilingState.workerSummaries) ? this.profilingState.workerSummaries as Array<Record<string, number>> : [];
    return list.length ? Math.max(...list.map((item) => Number(item.workerTotalMs) || 0)) : 0;
  }
  private computeMedianWorkerTotalMs(): number {
    const list = Array.isArray(this.profilingState.workerSummaries) ? this.profilingState.workerSummaries as Array<Record<string, number>> : [];
    if (!list.length) return 0;
    const values = list.map((item) => Number(item.workerTotalMs) || 0).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }

  private deriveWeightedAverageCorrelation(): number {
    const pairValues = this.snapshot.correlations.flatMap((entry) => [entry.expansion, entry.recession, entry.stagflation, entry.soft_landing]);
    if (pairValues.length === 0) return 0.25;
    const average = pairValues.reduce((sum, value) => sum + value, 0) / pairValues.length;
    return Number.isFinite(average) ? Math.max(0, Math.min(1, average)) : 0.25;
  }

  private deriveMaxCorrelation(): number {
    const pairValues = this.snapshot.correlations.flatMap((entry) => [entry.expansion, entry.recession, entry.stagflation, entry.soft_landing]);
    if (pairValues.length === 0) return 0.25;
    const max = Math.max(...pairValues);
    return Number.isFinite(max) ? Math.max(0, Math.min(1, max)) : 0.25;
  }

  private deriveLongTermExpectedReturn(): number {
    if (this.snapshot.etfs.length === 0) return 0.06;
    const average = this.snapshot.etfs.reduce((sum, etf) => sum + (etf.statistics.general?.expectedReturn ?? 0), 0) / this.snapshot.etfs.length;
    return Number.isFinite(average) ? average : 0.06;
  }

  private buildOutcome(paths: any[], status: MonteCarloRunStatus, error?: { code: string; message: string; details?: Record<string, unknown> }, result?: MonteCarloResult): MonteCarloCoordinatorOutcome {
    const finalProgress = status === 'success' ? 100 : 0;
    const totalTimeMs = Date.now() - this.startedAt;
    const throughputSecond = totalTimeMs > 0 ? totalTimeMs / 1000 : 1;
    const diagnostics = this.getDiagnosticReport();
    return {
      status,
      paths,
      runSeed: this.runSeed,
      result,
      progress: finalProgress,
      completedPaths: Math.min(this.completedPaths, this.totalPaths),
      totalPaths: this.totalPaths,
      performanceMetrics: {
        totalTime: totalTimeMs,
        pathsPerSecond: this.totalPaths / Math.max(0.001, throughputSecond),
        monthsPerSecond: (this.totalPaths * this.input.horizonYears * 12) / Math.max(0.001, throughputSecond),
        totalRedraw: this.totalRedraw,
        rejectRate: this.totalObservedPaths > 0 ? this.totalRejects / this.totalObservedPaths : 0,
        factorizationTime: this.factorizationTimeMs
      },
      diagnostics,
      error
    };
  }
}
