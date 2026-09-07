"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonteCarloCoordinator = exports.MonteCarloWorkerPool = exports.MONTE_CARLO_EXECUTION_MODES = void 0;
const monte_carlo_precomputation_1 = require("../precomputation/monte-carlo-precomputation");
exports.MONTE_CARLO_EXECUTION_MODES = {
    SMOKE: 100,
    INTERMEDIATE: 1_000,
    COMPLETE: 1_000
};
const DEFAULT_BATCH_SIZE = 250;
const createExecutionId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `mc-exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};
const computeWorkerCount = (pathCount, override) => {
    if (override && Number.isFinite(override)) {
        return Math.max(1, Math.min(pathCount, Math.floor(override)));
    }
    const runtimeConcurrency = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    return Math.max(1, Math.min(pathCount, runtimeConcurrency - 1 || 1));
};
const clampPercent = (value) => Math.max(0, Math.min(100, value));
class MonteCarloWorkerPool {
    workers = [];
    readyWorkers = new Set();
    workerById = new Map();
    executionId;
    workerFactory;
    totalPaths;
    batchSize;
    input;
    snapshot;
    onBatchResult;
    onProgress;
    onSimulationComplete;
    onRegisterSimulationPort;
    onWorkerError;
    onReady;
    onCancelled;
    precompute;
    nextBatchStart = 0;
    nextWorkerIndex = 0;
    constructor(options) {
        this.executionId = options.executionId;
        this.workerFactory = options.workerFactory;
        this.totalPaths = options.totalPaths;
        this.batchSize = options.batchSize;
        this.input = options.input;
        this.snapshot = options.snapshot;
        this.precompute = options.precompute;
        this.onBatchResult = options.onBatchResult;
        this.onProgress = options.onProgress ?? (() => undefined);
        this.onSimulationComplete = options.onSimulationComplete ?? (() => undefined);
        this.onRegisterSimulationPort = options.onRegisterSimulationPort ?? (() => undefined);
        this.onWorkerError = options.onWorkerError;
        this.onReady = options.onReady;
        this.onCancelled = options.onCancelled;
    }
    start(workerCount) {
        for (let workerId = 0; workerId < workerCount; workerId += 1) {
            const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
            const worker = this.workerFactory(`monte-carlo-worker-${workerId}.ts`);
            const listener = (event) => {
                const data = event.data;
                if (!data || data.executionId !== this.executionId)
                    return;
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
                const anyEvent = event;
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
                worker.postMessage({
                    type: 'INIT',
                    executionId: this.executionId,
                    workerId,
                    precompute: this.precompute,
                    input: this.input,
                    snapshot: this.snapshot,
                    aggregationPort: channel.port1
                }, [channel.port1]);
            }
            else {
                worker.postMessage({
                    type: 'INIT',
                    executionId: this.executionId,
                    workerId,
                    precompute: this.precompute,
                    input: this.input,
                    snapshot: this.snapshot
                });
            }
        }
    }
    sendQueuedWork() {
        if (this.readyWorkers.size === 0 || this.nextBatchStart >= this.totalPaths)
            return;
        const readyWorkerIds = [...this.readyWorkers];
        const workerId = readyWorkerIds[this.nextWorkerIndex % readyWorkerIds.length];
        const worker = this.workerById.get(workerId);
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % readyWorkerIds.length;
        if (!worker)
            return;
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
            precompute: this.precompute
        });
        this.nextBatchStart = batchEnd;
    }
    terminate() {
        for (const worker of this.workers) {
            try {
                worker.terminate();
            }
            catch {
                // ignore termination errors during shutdown
            }
        }
        this.workers.length = 0;
        this.readyWorkers.clear();
        this.workerById.clear();
    }
}
exports.MonteCarloWorkerPool = MonteCarloWorkerPool;
class MonteCarloCoordinator {
    input;
    snapshot;
    executionId;
    mode;
    workerFactory;
    aggregationWorkerFactory;
    workerCount;
    batchSize;
    totalPaths;
    startedAt = Date.now();
    lightweightPathMetadata = [];
    workerPool;
    progressHandler;
    resolveRun;
    rejectRun;
    diagnosticWorkerMode;
    completedSimulationWorkers = new Set();
    aggregationWorker = null;
    aggregationWorkerReady = false;
    aggregationResultResolver;
    aggregationResultRejecter;
    finalizing = false;
    lastProgressUpdateAt = 0;
    mainThreadFullPathCount = 0;
    fullPathMainThreadMessageCount = 0;
    aggregationReceivedPaths = 0;
    expectedAggregationPaths = 0;
    completedPaths = 0;
    cancelled = false;
    failed = false;
    totalRedraw = 0;
    totalRejects = 0;
    totalObservedPaths = 0;
    factorizationTimeMs = 0;
    factorized = false;
    maxBatchRoutingMs = 0;
    heartbeatTimer;
    heartbeatIntervalMs = 250;
    heartbeatLastTick = 0;
    heartbeatTotalLagMs = 0;
    heartbeatSamples = 0;
    eventLoopMaxLagMs = 0;
    batchHandlerMaxMs = 0;
    batchHandlerTotalMs = 0;
    batchHandlerAvgMs = 0;
    batchCount = 0;
    totalBatchPaths = 0;
    maxPathsPerBatch = 0;
    avgPathsPerBatch = 0;
    simulationFinishedAt = 0;
    aggregationStartedAt = 0;
    aggregationCompletedAt = 0;
    angularUpdatePerBatch = true;
    changeDetectionTriggerPerBatch = true;
    residualMainThreadHeavyWork = [
        'allPaths.push(...batchResults)',
        'emitProgress()',
        'progress signal update',
        'workerPool.sendQueuedWork()',
        'Angular state update via progress.set(progress)'
    ];
    constructor(options) {
        this.input = options.input;
        this.snapshot = options.snapshot;
        this.mode = options.mode ?? 'COMPLETE';
        this.executionId = createExecutionId();
        this.workerFactory = options.workerFactory ?? this.defaultWorkerFactory;
        this.aggregationWorkerFactory = options.aggregationWorkerFactory ?? this.defaultAggregationWorkerFactory;
        this.diagnosticWorkerMode = options.diagnosticWorkerMode;
        this.totalPaths = exports.MONTE_CARLO_EXECUTION_MODES[this.mode];
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
            onBatchResult: (payload) => this.handleBatchResult(payload),
            onProgress: (payload) => this.handleWorkerProgress(payload),
            onSimulationComplete: (workerId) => this.handleSimulationComplete(workerId),
            onRegisterSimulationPort: (workerId, port) => this.registerSimulationPort(workerId, port),
            onWorkerError: (error) => this.fail(error),
            onReady: () => this.workerPool.sendQueuedWork(),
            onCancelled: () => this.cancel()
        });
    }
    get defaultWorkerFactory() {
        return (scriptPath) => {
            if (typeof Worker === 'undefined') {
                throw new Error('Web Worker support is unavailable in this runtime');
            }
            return new Worker(new URL('./monte-carlo-worker.ts', import.meta.url), { type: 'module' });
        };
    }
    get defaultAggregationWorkerFactory() {
        return (scriptPath) => {
            if (typeof Worker === 'undefined') {
                throw new Error('Web Worker support is unavailable in this runtime');
            }
            return new Worker(new URL('./monte-carlo-aggregation.worker.ts', import.meta.url), { type: 'module' });
        };
    }
    async run() {
        const startedAt = performance.now();
        this.startHeartbeat();
        this.factorizationTimeMs = 0;
        if (!this.factorized) {
            const precompute = (0, monte_carlo_precomputation_1.prepareMonteCarloPrecomputation)(this.snapshot);
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
        return new Promise((resolve, reject) => {
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
                            details: error instanceof Error && 'details' in error ? error.details : {}
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
    setProgressListener(listener) {
        this.progressHandler = listener;
    }
    cancel() {
        if (this.cancelled || this.failed)
            return;
        this.cancelled = true;
        this.workerPool.terminate();
        this.emitProgress();
    }
    currentError;
    resolveWorkerCount(override) {
        if (this.diagnosticWorkerMode === 'B') {
            return 2;
        }
        return computeWorkerCount(this.totalPaths, override);
    }
    startHeartbeat() {
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
    stopHeartbeat() {
        if (this.heartbeatTimer !== undefined) {
            window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }
    getDiagnosticReport() {
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
    estimateApproxPayloadMb() {
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
    handleBatchResult(payload) {
        // Main thread intentionally does not receive or retain full path payloads.
        this.fullPathMainThreadMessageCount += 1;
        this.mainThreadFullPathCount += Array.isArray(payload.results) ? payload.results.length : 0;
        this.totalObservedPaths += Array.isArray(payload.results) ? payload.results.length : 0;
        this.emitProgress();
    }
    handleWorkerProgress(payload) {
        const completedPaths = Math.min(payload.completedPaths ?? 0, this.totalPaths);
        this.completedPaths = Math.max(this.completedPaths, completedPaths);
        this.emitProgress();
        this.workerPool.sendQueuedWork();
    }
    handleSimulationComplete(workerId) {
        this.completedSimulationWorkers.add(workerId);
        if (this.completedSimulationWorkers.size === this.workerCount) {
            this.sendFinalizeToAggregationWorker();
        }
    }
    registerSimulationPort(workerId, port) {
        if (!this.aggregationWorker || !port)
            return;
        this.aggregationWorker.postMessage({
            type: 'REGISTER_SIMULATION_PORT',
            executionId: this.executionId,
            workerId,
            simulationPort: port
        }, [port]);
    }
    sendFinalizeToAggregationWorker() {
        if (!this.aggregationWorker || this.finalizing)
            return;
        this.expectedAggregationPaths = this.totalPaths;
        this.aggregationWorker.postMessage({
            type: 'FINALIZE',
            executionId: this.executionId,
            workerId: 0,
            expectedPathCount: this.expectedAggregationPaths,
            input: this.input,
            snapshot: this.snapshot
        });
    }
    emitProgress() {
        const progress = clampPercent(Math.round((this.completedPaths / this.totalPaths) * 100));
        const now = performance.now();
        if (this.progressHandler && (progress >= 100 || now - this.lastProgressUpdateAt >= 250)) {
            this.progressHandler(progress);
            this.lastProgressUpdateAt = now;
        }
    }
    fail(error) {
        if (this.failed || this.cancelled)
            return;
        this.failed = true;
        this.currentError = error;
        this.workerPool.terminate();
        this.emitProgress();
    }
    startAggregationWorker() {
        if (this.aggregationWorker || this.finalizing)
            return;
        const worker = this.aggregationWorkerFactory('monte-carlo-aggregation.worker.ts');
        const listener = (event) => {
            const data = event.data;
            if (!data || data.executionId !== this.executionId)
                return;
            if (data.type === 'READY') {
                this.aggregationWorkerReady = true;
                return;
            }
            if (data.type === 'RESULT') {
                this.aggregationWorkerReady = false;
                this.aggregationResultResolver?.(data.result);
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
        worker.addEventListener('error', (event) => {
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
        });
    }
    async finalizeSuccess() {
        if (this.cancelled || this.failed) {
            return this.buildOutcome([], this.cancelled ? 'cancelled' : 'failed', this.currentError);
        }
        this.workerPool.terminate();
        if (!this.aggregationWorker) {
            return this.buildOutcome(this.lightweightPathMetadata, 'success', undefined, undefined);
        }
        this.aggregationStartedAt = performance.now();
        const officialResult = await new Promise((resolve, reject) => {
            this.aggregationResultResolver = resolve;
            this.aggregationResultRejecter = reject;
            this.aggregationWorker?.postMessage({
                type: 'FINALIZE',
                executionId: this.executionId,
                workerId: 0,
                input: this.input,
                snapshot: this.snapshot
            });
        });
        this.aggregationCompletedAt = performance.now();
        this.stopHeartbeat();
        const outcome = this.buildOutcome(this.lightweightPathMetadata, 'success', undefined, officialResult);
        console.info('[MONTE_CARLO_DIAGNOSTIC]', outcome.diagnostics);
        return outcome;
    }
    deriveWeightedAverageCorrelation() {
        const pairValues = this.snapshot.correlations.flatMap((entry) => [entry.expansion, entry.recession, entry.stagflation, entry.soft_landing]);
        if (pairValues.length === 0)
            return 0.25;
        const average = pairValues.reduce((sum, value) => sum + value, 0) / pairValues.length;
        return Number.isFinite(average) ? Math.max(0, Math.min(1, average)) : 0.25;
    }
    deriveMaxCorrelation() {
        const pairValues = this.snapshot.correlations.flatMap((entry) => [entry.expansion, entry.recession, entry.stagflation, entry.soft_landing]);
        if (pairValues.length === 0)
            return 0.25;
        const max = Math.max(...pairValues);
        return Number.isFinite(max) ? Math.max(0, Math.min(1, max)) : 0.25;
    }
    deriveLongTermExpectedReturn() {
        if (this.snapshot.etfs.length === 0)
            return 0.06;
        const average = this.snapshot.etfs.reduce((sum, etf) => sum + (etf.statistics.general?.expectedReturn ?? 0), 0) / this.snapshot.etfs.length;
        return Number.isFinite(average) ? average : 0.06;
    }
    buildOutcome(paths, status, error, result) {
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
exports.MonteCarloCoordinator = MonteCarloCoordinator;
