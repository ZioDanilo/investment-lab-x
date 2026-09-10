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
    onBatchAssigned;
    onRegisterSimulationPort;
    onWorkerBatchMetrics;
    onWorkerError;
    onReady;
    onCancelled;
    portReadyWorkers = new Set();
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
        this.onBatchAssigned = options.onBatchAssigned ?? (() => undefined);
        this.onRegisterSimulationPort = options.onRegisterSimulationPort ?? (() => undefined);
        this.onWorkerBatchMetrics = options.onWorkerBatchMetrics ?? (() => undefined);
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
                if (data.type === 'WORKER_BATCH_METRICS') {
                    this.onWorkerBatchMetrics({
                        workerId: data.workerId ?? 0,
                        batchStart: data.batchStart ?? 0,
                        batchEnd: data.batchEnd ?? 0,
                        totalBatchMs: data.totalBatchMs ?? 0,
                        macroMs: data.macroMs ?? 0,
                        returnMs: data.returnMs ?? 0,
                        portfolioMs: data.portfolioMs ?? 0,
                        compactMs: data.compactMs ?? 0,
                        sendMs: data.sendMs ?? 0
                    });
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
    markPortReady(workerId) {
        this.portReadyWorkers.add(workerId);
    }
    sendQueuedWork() {
        if (this.readyWorkers.size === 0 || this.nextBatchStart >= this.totalPaths)
            return;
        const readyWorkerIds = [...this.readyWorkers].filter((workerId) => this.portReadyWorkers.has(workerId));
        if (readyWorkerIds.length === 0) {
            console.info('[MC-PERF] PORT_NOT_READY_YET', {
                readyWorkers: this.readyWorkers.size,
                portReadyWorkers: this.portReadyWorkers.size
            });
            return;
        }
        const workerId = readyWorkerIds[this.nextWorkerIndex % readyWorkerIds.length];
        const worker = this.workerById.get(workerId);
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % readyWorkerIds.length;
        if (!worker)
            return;
        this.onBatchAssigned(workerId);
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
    assignedWorkers = new Set();
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
    phaseTimingsMs = {};
    workerBatchMetrics = [];
    aggregationMetrics = [];
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
            onBatchAssigned: (workerId) => this.assignedWorkers.add(workerId),
            onRegisterSimulationPort: (workerId, port) => this.registerSimulationPort(workerId, port),
            onWorkerBatchMetrics: (payload) => this.handleWorkerMetrics({
                type: 'WORKER_BATCH_METRICS',
                executionId: this.executionId,
                workerId: payload.workerId,
                batchStart: payload.batchStart,
                batchEnd: payload.batchEnd,
                totalBatchMs: payload.totalBatchMs,
                macroMs: payload.macroMs,
                returnMs: payload.returnMs,
                portfolioMs: payload.portfolioMs,
                compactMs: payload.compactMs,
                sendMs: payload.sendMs
            }),
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
        this.phaseTimingsMs = {};
        this.workerBatchMetrics.length = 0;
        this.aggregationMetrics.length = 0;
        const startedAt = performance.now();
        this.logPhase('T0_RUN_START');
        this.startHeartbeat();
        this.factorizationTimeMs = 0;
        if (!this.factorized) {
            this.logPhase('T1_PRECOMPUTE_START');
            const precompute = (0, monte_carlo_precomputation_1.prepareMonteCarloPrecomputation)(this.snapshot);
            this.factorizationTimeMs = performance.now() - startedAt;
            this.logPhase('T2_PRECOMPUTE_DONE');
            this.factorized = true;
            this.workerPool['precompute'] = precompute;
        }
        if (this.completedPaths > 0 || this.cancelled || this.failed) {
            return this.buildOutcome(this.lightweightPathMetadata, this.cancelled ? 'cancelled' : this.failed ? 'failed' : 'success');
        }
        this.logPhase('T3_START_AGGREGATION_WORKER');
        this.startAggregationWorker();
        this.logPhase('T4_START_WORKERS');
        this.workerPool.start(this.workerCount);
        this.logPhase('T5_WORKERS_READY');
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
                const expectedAssignedWorkers = this.assignedWorkers.size > 0 ? this.assignedWorkers.size : this.workerCount;
                const requiredAggregationPaths = this.expectedAggregationPaths ?? this.totalPaths;
                if (this.completedPaths >= this.totalPaths
                    && this.completedSimulationWorkers.size >= expectedAssignedWorkers
                    && this.aggregationReceivedPaths >= requiredAggregationPaths
                    && !this.finalizing) {
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
    logPhase(tag, at = performance.now()) {
        this.phaseTimingsMs[tag] = at - this.startedAt;
        console.info('[MONTE_CARLO_DIAGNOSTIC]', {
            executionId: this.executionId,
            tag,
            elapsedMs: this.phaseTimingsMs[tag],
            phase: Object.keys(this.phaseTimingsMs).length
        });
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
            primaryCause,
            phaseTimingsMs: { ...this.phaseTimingsMs },
            latestWorkerBatchMetrics: [...this.workerBatchMetrics].slice(-20),
            latestAggregationMetrics: [...this.aggregationMetrics].slice(-20)
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
    recordWorkerBatchMetrics(payload) {
        if (!Number.isFinite(payload.totalBatchMs))
            return;
        this.workerBatchMetrics.push(payload);
        console.info('[MONTE_CARLO_DIAGNOSTIC]', {
            executionId: this.executionId,
            message: 'WORKER_BATCH_METRICS',
            workerId: payload.workerId,
            batchStart: payload.batchStart,
            batchEnd: payload.batchEnd,
            totalBatchMs: payload.totalBatchMs,
            macroMs: payload.macroMs,
            returnMs: payload.returnMs,
            portfolioMs: payload.portfolioMs,
            compactMs: payload.compactMs,
            sendMs: payload.sendMs,
            elapsedMs: payload.totalBatchMs
        });
    }
    recordAggregationMetrics(payload) {
        this.aggregationMetrics.push(payload);
        console.info('[MONTE_CARLO_DIAGNOSTIC]', {
            executionId: this.executionId,
            message: 'AGGREGATION_METRICS',
            receivedPathCount: payload.receivedPathCount,
            expectedPathCount: payload.expectedPathCount,
            handleBatchMs: payload.handleBatchMs,
            finalizeMs: payload.finalizeMs,
            statisticsMs: payload.statisticsMs,
            buildMs: payload.buildMs
        });
    }
    handleWorkerProgress(payload) {
        const completedPaths = Math.min(payload.completedPaths ?? 0, this.totalPaths);
        this.completedPaths = Math.max(this.completedPaths, completedPaths);
        this.emitProgress();
        this.workerPool.sendQueuedWork();
    }
    handleSimulationComplete(workerId) {
        if (!this.assignedWorkers.has(workerId)) {
            return;
        }
        this.completedSimulationWorkers.add(workerId);
        const expectedAssignedWorkers = this.assignedWorkers.size > 0 ? this.assignedWorkers.size : this.workerCount;
        console.info('[MC-PERF] WORKER_DONE', {
            workerId,
            completedWorkers: this.completedSimulationWorkers.size,
            expectedWorkers: expectedAssignedWorkers
        });
        if (this.completedSimulationWorkers.size >= expectedAssignedWorkers && this.completedPaths >= this.totalPaths) {
            console.info('[MC-PERF] COORDINATOR_FINALIZE_TRIGGER', {
                completedWorkers: this.completedSimulationWorkers.size,
                expectedWorkers: expectedAssignedWorkers,
                completedPaths: this.completedPaths,
                totalPaths: this.totalPaths,
                aggregationReceivedPaths: this.aggregationReceivedPaths,
                expectedAggregationPaths: this.expectedAggregationPaths || this.totalPaths,
                pathQueueDepth: this.workerBatchMetrics.length
            });
            console.info('[MC-PERF] AGG_RECEIVED_PATHS_AT_FINALIZE_TRIGGER', {
                aggregationReceivedPaths: this.aggregationReceivedPaths,
                expectedAggregationPaths: this.expectedAggregationPaths || this.totalPaths,
                completedPaths: this.completedPaths,
                totalPaths: this.totalPaths
            });
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
        console.info('[MC-PERF] COORDINATOR_FINALIZE_SENT', {
            executionId: this.executionId,
            workerId: 0,
            expectedPaths: this.expectedAggregationPaths
        });
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
            if (data.type === 'PORT_READY') {
                this.workerPool.markPortReady(data.workerId ?? 0);
                console.info('[MC-PERF] COORDINATOR_PORT_READY', {
                    executionId: this.executionId,
                    workerId: data.workerId ?? 0
                });
                return;
            }
            if (data.type === 'RESULT') {
                console.info('[MC-PERF] COORDINATOR_RESULT_RECEIVED', {
                    executionId: this.executionId,
                    receivedPaths: this.aggregationReceivedPaths,
                    expectedPaths: this.expectedAggregationPaths || this.totalPaths
                });
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
            if (data.type === 'AGG_ALL_PATHS_RECEIVED') {
                const expected = data.expectedPathCount ?? this.expectedAggregationPaths ?? this.totalPaths;
                this.expectedAggregationPaths = expected;
                this.aggregationReceivedPaths = data.receivedPathCount ?? 0;
                console.info('[MC-PERF] AGG_ALL_PATHS_RECEIVED_FROM_WORKER', {
                    receivedPathCount: this.aggregationReceivedPaths,
                    expectedPathCount: this.expectedAggregationPaths
                });
            }
            if (data.type === 'AGGREGATION_COUNTS') {
                this.aggregationReceivedPaths = data.receivedPathCount ?? 0;
            }
            if (data.type === 'AGGREGATION_METRICS') {
                this.recordAggregationMetrics({
                    receivedPathCount: data.receivedPathCount ?? 0,
                    expectedPathCount: data.expectedPathCount ?? 0,
                    handleBatchMs: data.handleBatchMs ?? 0,
                    finalizeMs: data.finalizeMs ?? 0,
                    statisticsMs: data.statisticsMs ?? 0,
                    buildMs: data.buildMs ?? 0
                });
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
            workerId: 0,
            expectedPathCount: this.totalPaths
        });
    }
    handleWorkerMetrics(message) {
        if (!message || message.type !== 'WORKER_BATCH_METRICS' || message.executionId !== this.executionId)
            return;
        this.recordWorkerBatchMetrics({
            workerId: message.workerId ?? 0,
            batchStart: message.batchStart ?? 0,
            batchEnd: message.batchEnd ?? 0,
            totalBatchMs: message.totalBatchMs ?? 0,
            macroMs: message.macroMs ?? 0,
            returnMs: message.returnMs ?? 0,
            portfolioMs: message.portfolioMs ?? 0,
            compactMs: message.compactMs ?? 0,
            sendMs: message.sendMs ?? 0
        });
    }
    async finalizeSuccess() {
        if (this.cancelled || this.failed) {
            return this.buildOutcome([], this.cancelled ? 'cancelled' : 'failed', this.currentError);
        }
        try {
            const requiredAggregationPaths = this.expectedAggregationPaths || this.totalPaths;
            if (this.aggregationReceivedPaths < requiredAggregationPaths) {
                throw new Error(`Aggregation worker did not confirm all paths were received before finalization: ${this.aggregationReceivedPaths}/${requiredAggregationPaths}`);
            }
            console.info('[MC-PERF] FINALIZE_STEP_1_BEFORE', { at: performance.now() });
            console.info('[MC-PERF] TERMINATE_SIM_WORKERS_BEFORE', { at: performance.now() });
            this.workerPool.terminate();
            console.info('[MC-PERF] TERMINATE_SIM_WORKERS_AFTER', { at: performance.now(), workersTerminated: true });
            console.info('[MC-PERF] FINALIZE_STEP_1_AFTER', { at: performance.now(), workersTerminated: true });
            console.info('[MC-PERF] FINALIZE_STEP_2_BEFORE', { at: performance.now(), hasAggregationWorker: !!this.aggregationWorker });
            if (!this.aggregationWorker) {
                console.info('[MC-PERF] FINALIZE_STEP_2_AFTER', { at: performance.now(), path: 'NO_AGGREGATION_WORKER' });
                return this.buildOutcome(this.lightweightPathMetadata, 'success', undefined, undefined);
            }
            console.info('[MC-PERF] FINALIZE_STEP_2_AFTER', { at: performance.now(), path: 'HAS_AGGREGATION_WORKER' });
            this.aggregationStartedAt = performance.now();
            console.info('[MC-PERF] FINALIZE_STEP_3_BEFORE', { at: performance.now(), aggregationReceivedPaths: this.aggregationReceivedPaths, expectedAggregationPaths: this.expectedAggregationPaths || this.totalPaths });
            const officialResult = await new Promise((resolve, reject) => {
                this.aggregationResultResolver = resolve;
                this.aggregationResultRejecter = reject;
                console.info('[MC-PERF] FINALIZE_STEP_4_BEFORE', { at: performance.now() });
                try {
                    this.aggregationWorker?.postMessage({
                        type: 'FINALIZE',
                        executionId: this.executionId,
                        workerId: 0,
                        input: this.input,
                        snapshot: this.snapshot
                    });
                    console.info('[MC-PERF] COORDINATOR_FINALIZE_SENT', {
                        executionId: this.executionId,
                        workerId: 0,
                        expectedPaths: this.expectedAggregationPaths || this.totalPaths,
                        at: performance.now()
                    });
                }
                catch (error) {
                    console.error('[MC-PERF] FINALIZE_ERROR', error);
                    reject(error instanceof Error ? error : new Error(String(error)));
                    return;
                }
                console.info('[MC-PERF] FINALIZE_STEP_4_AFTER', { at: performance.now() });
            });
            console.info('[MC-PERF] FINALIZE_STEP_5_AFTER', { at: performance.now(), resultReceived: !!officialResult });
            this.aggregationCompletedAt = performance.now();
            this.stopHeartbeat();
            const outcome = this.buildOutcome(this.lightweightPathMetadata, 'success', undefined, officialResult);
            console.info('[MC-PERF] COORDINATOR_RESOLVE', {
                executionId: this.executionId,
                status: outcome.status,
                completedPaths: outcome.completedPaths,
                totalPaths: outcome.totalPaths
            });
            console.info('[MONTE_CARLO_DIAGNOSTIC]', outcome.diagnostics);
            return outcome;
        }
        catch (error) {
            console.error('[MC-PERF] FINALIZE_ERROR', error);
            const failure = {
                code: 'AGGREGATION_WORKER_ERROR',
                message: error instanceof Error ? error.message : 'Finalize path failed',
                details: error instanceof Error && 'details' in error ? error.details : {}
            };
            this.fail(failure);
            return this.buildOutcome([], 'failed', failure);
        }
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
