import { MonteCarloSnapshot, MonteCarloUserInput, MonteCarloResult } from '../models/monte-carlo-contracts.model';
import { prepareMonteCarloPrecomputation } from '../precomputation/monte-carlo-precomputation';
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
}

export type MonteCarloWorkerMessage =
  | ({ type: 'INIT'; precompute: unknown; input: MonteCarloUserInput; snapshot: MonteCarloSnapshot; workerId: number; executionId: string; aggregationPort?: MessagePort })
  | ({ type: 'RUN_BATCH'; batchStart: number; batchEnd: number; pathCount: number; input: MonteCarloUserInput; snapshot: MonteCarloSnapshot; precompute: unknown; workerId: number; executionId: string; advancedStatistics?: boolean })
  | ({ type: 'CANCEL'; executionId: string; workerId: number })
  | ({ type: 'PROGRESS'; executionId: string; workerId: number; completedPaths: number; totalPaths: number })
  | ({ type: 'SIMULATION_COMPLETE'; executionId: string; workerId: number; completedPaths: number; totalPaths: number })
  | ({ type: 'ERROR'; executionId: string; workerId: number; error: { code: string; message: string; details?: Record<string, unknown> } })
  | ({ type: 'BATCH_RESULT'; executionId: string; workerId: number; batchStart: number; batchEnd: number; results: any[]; redrawCount?: number; rejectRate?: number });

export interface MonteCarloAggregationWorkerMessage {
  executionId: string;
  workerId: number;
  type: 'INIT' | 'REGISTER_SIMULATION_PORT' | 'ADD_BATCH' | 'FINALIZE' | 'RESULT' | 'ERROR';
  paths?: any[];
  batch?: any[];
  input?: MonteCarloUserInput;
  snapshot?: MonteCarloSnapshot;
  result?: MonteCarloResult;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  simulationPort?: MessagePort;
  expectedPathCount?: number;
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
  mode?: MonteCarloExecutionMode;
  advancedStatistics?: boolean;
  workerFactory?: (scriptPath: string) => WorkerLike;
  aggregationWorkerFactory?: (scriptPath: string) => WorkerLike;
  workerCountOverride?: number;
  batchSize?: number;
  diagnosticWorkerMode?: MonteCarloDiagnosticWorkerMode;
  onProgress?: (progress: number) => void;
}

export interface MonteCarloCoordinatorOutcome {
  status: MonteCarloRunStatus;
  paths: any[];
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
  private readonly workerFactory: (scriptPath: string) => WorkerLike;
  private readonly totalPaths: number;
  private readonly batchSize: number;
  private readonly input: MonteCarloUserInput;
  private readonly snapshot: MonteCarloSnapshot;
  private readonly advancedStatistics: boolean;
  private readonly onBatchResult: (payload: { batchStart: number; batchEnd: number; results: any[]; redrawCount?: number; rejectRate?: number }) => void;
  private readonly onProgress: (payload: { completedPaths: number; totalPaths: number; workerId: number }) => void;
  private readonly onSimulationComplete: (workerId: number) => void;
  private readonly onRegisterSimulationPort: (workerId: number, port: MessagePort) => void;
  private readonly onWorkerError: (error: { code: string; message: string; details?: Record<string, unknown> }) => void;
  private readonly onReady: () => void;
  private readonly onCancelled: () => void;
  private precompute: unknown;
  private nextBatchStart = 0;
  private nextWorkerIndex = 0;

  constructor(options: {
    executionId: string;
    workerFactory: (scriptPath: string) => WorkerLike;
    totalPaths: number;
    batchSize: number;
    input: MonteCarloUserInput;
    snapshot: MonteCarloSnapshot;
    precompute: unknown;
    advancedStatistics?: boolean;
    onBatchResult: (payload: { batchStart: number; batchEnd: number; results: any[]; redrawCount?: number; rejectRate?: number }) => void;
    onProgress?: (payload: { completedPaths: number; totalPaths: number; workerId: number }) => void;
    onSimulationComplete?: (workerId: number) => void;
    onRegisterSimulationPort?: (workerId: number, port: MessagePort) => void;
    onWorkerError: (error: { code: string; message: string; details?: Record<string, unknown> }) => void;
    onReady: () => void;
    onCancelled: () => void;
  }) {
    this.executionId = options.executionId;
    this.workerFactory = options.workerFactory;
    this.totalPaths = options.totalPaths;
    this.batchSize = options.batchSize;
    this.input = options.input;
    this.snapshot = options.snapshot;
    this.precompute = options.precompute;
    this.advancedStatistics = options.advancedStatistics ?? true;
    this.onBatchResult = options.onBatchResult;
    this.onProgress = options.onProgress ?? (() => undefined);
    this.onSimulationComplete = options.onSimulationComplete ?? (() => undefined);
    this.onRegisterSimulationPort = options.onRegisterSimulationPort ?? (() => undefined);
    this.onWorkerError = options.onWorkerError;
    this.onReady = options.onReady;
    this.onCancelled = options.onCancelled;
  }

  start(workerCount: number): void {
    for (let workerId = 0; workerId < workerCount; workerId += 1) {
      const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
      const worker = this.workerFactory(`monte-carlo-worker-${workerId}.ts`);
      const listener = (event: { data?: any }) => {
        const data = event.data;
        if (!data || data.executionId !== this.executionId) return;
        if (data.type === 'READY') {
          this.readyWorkers.add(data.workerId);
          this.onReady();
          return;
        }
        if (data.type === 'PROGRESS') {
          this.onProgress({
            completedPaths: data.completedPaths ?? 0,
            totalPaths: data.totalPaths ?? 0,
            workerId: data.workerId
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
        const message = typeof errorBody?.message === 'string'
          ? errorBody.message
          : typeof rawError?.message === 'string'
            ? rawError.message
            : 'Worker runtime error';
        const details = errorBody && typeof errorBody === 'object'
          ? { ...errorBody, ...(anyEvent?.data ?? {}) }
          : { ...(anyEvent?.data ?? {}), error: rawError ?? null };

        this.onWorkerError({
          code: typeof errorBody?.code === 'string' ? errorBody.code : 'WORKER_ERROR',
          message,
          details
        });
      });
      this.workers.push(worker);
      this.workerById.set(workerId, worker);
      if (channel) {
        this.onRegisterSimulationPort(workerId, channel.port2);
        (worker as any).postMessage({
          type: 'INIT',
          executionId: this.executionId,
          workerId,
          precompute: this.precompute,
          input: this.input,
          snapshot: this.snapshot,
          aggregationPort: channel.port1
        }, [channel.port1]);
      } else {
        worker.postMessage({
          type: 'INIT',
          executionId: this.executionId,
          workerId,
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
      batchStart,
      batchEnd,
      pathCount: this.totalPaths,
      input: this.input,
      snapshot: this.snapshot,
      precompute: this.precompute,
      advancedStatistics: this.advancedStatistics
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
  private readonly mode: MonteCarloExecutionMode;
  private readonly advancedStatistics: boolean;
  private readonly workerFactory: (scriptPath: string) => WorkerLike;
  private readonly aggregationWorkerFactory: (scriptPath: string) => WorkerLike;
  private readonly workerCount: number;
  private readonly batchSize: number;
  private readonly totalPaths: number;
  private readonly startedAt = Date.now();
  private readonly lightweightPathMetadata: Array<{ simulationId: number }> = [];
  private readonly workerPool: MonteCarloWorkerPool;
  private progressHandler?: (progress: number) => void;
  private readonly resolveRun: (value: MonteCarloCoordinatorOutcome) => void;
  private readonly rejectRun: (reason?: unknown) => void;
  private readonly diagnosticWorkerMode?: MonteCarloDiagnosticWorkerMode;
  private readonly completedSimulationWorkers = new Set<number>();
  private aggregationWorker: WorkerLike | null = null;
  private aggregationWorkerReady = false;
  private aggregationResultResolver?: (value: MonteCarloResult) => void;
  private aggregationResultRejecter?: (reason?: unknown) => void;
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
    this.executionId = createExecutionId();
    this.workerFactory = options.workerFactory ?? this.defaultWorkerFactory;
    this.aggregationWorkerFactory = options.aggregationWorkerFactory ?? this.defaultAggregationWorkerFactory;
    this.diagnosticWorkerMode = options.diagnosticWorkerMode;
    this.totalPaths = MONTE_CARLO_EXECUTION_MODES[this.mode];
    this.workerCount = this.resolveWorkerCount(options.workerCountOverride);
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.progressHandler = options.onProgress;
    this.resolveRun = () => undefined;
    this.rejectRun = () => undefined;
    this.workerPool = new MonteCarloWorkerPool({
      executionId: this.executionId,
      workerFactory: this.workerFactory,
      totalPaths: this.totalPaths,
      batchSize: this.batchSize,
      input: this.input,
      snapshot: this.snapshot,
      precompute: undefined,
      advancedStatistics: this.advancedStatistics,
      onBatchResult: (payload) => this.handleBatchResult(payload),
      onProgress: (payload) => this.handleWorkerProgress(payload),
      onSimulationComplete: (workerId) => this.handleSimulationComplete(workerId),
      onRegisterSimulationPort: (workerId, port) => this.registerSimulationPort(workerId, port),
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

  async run(): Promise<MonteCarloCoordinatorOutcome> {
    const startedAt = performance.now();
    this.startHeartbeat();
    this.factorizationTimeMs = 0;
    if (!this.factorized) {
      const precompute = prepareMonteCarloPrecomputation(this.snapshot);
      this.factorizationTimeMs = performance.now() - startedAt;
      this.factorized = true;
      this.workerPool['precompute'] = precompute;
    }

    if (this.completedPaths > 0 || this.cancelled || this.failed) {
      return this.buildOutcome(this.lightweightPathMetadata, this.cancelled ? 'cancelled' : this.failed ? 'failed' : 'success');
    }

    this.startAggregationWorker();
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
        if (this.completedPaths >= this.totalPaths && this.completedSimulationWorkers.size === this.workerCount && !this.finalizing) {
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

  private resolveWorkerCount(override?: number): number {
    if (this.diagnosticWorkerMode === 'B') {
      return 2;
    }
    return computeWorkerCount(this.totalPaths, override);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatLastTick = performance.now();
    this.heartbeatTimer = window.setInterval(() => {
      const now = performance.now();
      const expectedAt = this.heartbeatLastTick + this.heartbeatIntervalMs;
      const lagMs = Math.max(0, now - expectedAt);
      this.heartbeatTotalLagMs += lagMs;
      this.heartbeatSamples += 1;
      this.eventLoopMaxLagMs = Math.max(this.eventLoopMaxLagMs, lagMs);
      this.heartbeatLastTick = now;
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
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

  private handleWorkerProgress(payload: { completedPaths: number; totalPaths: number; workerId: number }): void {
    const completedPaths = Math.min(payload.completedPaths ?? 0, this.totalPaths);
    this.completedPaths = Math.max(this.completedPaths, completedPaths);
    this.emitProgress();
    this.workerPool.sendQueuedWork();
  }

  private handleSimulationComplete(workerId: number): void {
    this.completedSimulationWorkers.add(workerId);
    if (this.completedSimulationWorkers.size === this.workerCount) {
      this.sendFinalizeToAggregationWorker();
    }
  }

  private registerSimulationPort(workerId: number, port: MessagePort): void {
    if (!this.aggregationWorker || !port) return;
    (this.aggregationWorker as any).postMessage({
      type: 'REGISTER_SIMULATION_PORT',
      executionId: this.executionId,
      workerId,
      simulationPort: port
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
      snapshot: this.snapshot
    } as MonteCarloAggregationWorkerMessage);
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
        return;
      }
      if (data.type === 'RESULT') {
        this.aggregationWorkerReady = false;
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
      workerId: 0
    } as MonteCarloAggregationWorkerMessage);
  }

  private async finalizeSuccess(): Promise<MonteCarloCoordinatorOutcome> {
    if (this.cancelled || this.failed) {
      return this.buildOutcome([], this.cancelled ? 'cancelled' : 'failed', this.currentError);
    }

    this.workerPool.terminate();
    if (!this.aggregationWorker) {
      return this.buildOutcome(this.lightweightPathMetadata, 'success', undefined, undefined);
    }

    this.aggregationStartedAt = performance.now();
    const officialResult = await new Promise<MonteCarloResult>((resolve, reject) => {
      this.aggregationResultResolver = resolve;
      this.aggregationResultRejecter = reject;
      this.aggregationWorker?.postMessage({
        type: 'FINALIZE',
        executionId: this.executionId,
        workerId: 0,
        input: this.input,
        snapshot: this.snapshot
      } as MonteCarloAggregationWorkerMessage);
    });
    this.aggregationCompletedAt = performance.now();
    this.stopHeartbeat();

    const outcome = this.buildOutcome(this.lightweightPathMetadata, 'success', undefined, officialResult);
    console.info('[MONTE_CARLO_DIAGNOSTIC]', outcome.diagnostics);
    return outcome;
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
