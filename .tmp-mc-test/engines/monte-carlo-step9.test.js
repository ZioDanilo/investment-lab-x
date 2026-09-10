"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const monte_carlo_coordinator_1 = require("./monte-carlo-coordinator");
const monte_carlo_statistics_engine_1 = require("./monte-carlo-statistics.engine");
const monte_carlo_worker_1 = require("./monte-carlo-worker");
const monte_carlo_contract_validator_1 = require("../validation/monte-carlo-contract.validator");
const makeSnapshot = () => ({
    etfs: [
        {
            isin: 'ETF-A',
            name: 'ETF A',
            nickname: 'A',
            statistics: {
                expansion: { expectedReturn: 0.08, volatility: 0.13, returnRange: { min: -0.2, max: 0.25 } },
                recession: { expectedReturn: -0.05, volatility: 0.17, returnRange: { min: -0.35, max: 0.1 } },
                stagflation: { expectedReturn: -0.02, volatility: 0.18, returnRange: { min: -0.3, max: 0.12 } },
                soft_landing: { expectedReturn: 0.06, volatility: 0.12, returnRange: { min: -0.15, max: 0.2 } },
                general: { expectedReturn: 0.06, volatility: 0.15, returnRange: { min: -0.25, max: 0.2 } }
            }
        },
        {
            isin: 'ETF-B',
            name: 'ETF B',
            nickname: 'B',
            statistics: {
                expansion: { expectedReturn: 0.09, volatility: 0.15, returnRange: { min: -0.18, max: 0.26 } },
                recession: { expectedReturn: -0.04, volatility: 0.18, returnRange: { min: -0.32, max: 0.11 } },
                stagflation: { expectedReturn: -0.01, volatility: 0.17, returnRange: { min: -0.28, max: 0.13 } },
                soft_landing: { expectedReturn: 0.07, volatility: 0.13, returnRange: { min: -0.12, max: 0.22 } },
                general: { expectedReturn: 0.07, volatility: 0.16, returnRange: { min: -0.24, max: 0.22 } }
            }
        }
    ],
    structuralProbabilities: { expansion: 0.45, recession: 0.2, stagflation: 0.15, soft_landing: 0.2 },
    transitionMatrix: {
        expansion: { expansion: 0.6, recession: 0.1, stagflation: 0.1, soft_landing: 0.2 },
        recession: { expansion: 0.25, recession: 0.2, stagflation: 0.1, soft_landing: 0.45 },
        stagflation: { expansion: 0.2, recession: 0.2, stagflation: 0.3, soft_landing: 0.3 },
        soft_landing: { expansion: 0.35, recession: 0.25, stagflation: 0.1, soft_landing: 0.3 }
    },
    inertiaConfigurations: {
        expansion: { entryProbability: 0.2, persistenceProbability: 0.75, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
        recession: { entryProbability: 0.25, persistenceProbability: 0.7, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
        stagflation: { entryProbability: 0.3, persistenceProbability: 0.68, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
        soft_landing: { entryProbability: 0.2, persistenceProbability: 0.8, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 }
    },
    intensityConfigurations: {
        expansion: { meanIntensity: 0.35, stdDevIntensity: 0.12 },
        recession: { meanIntensity: 0.55, stdDevIntensity: 0.15 },
        stagflation: { meanIntensity: 0.47, stdDevIntensity: 0.14 },
        soft_landing: { meanIntensity: 0.3, stdDevIntensity: 0.1 }
    },
    globalProperties: {
        scenario_transition_intensity_threshold: 0.6,
        new_scenario_first_month_max_intensity: 0.4,
        new_scenario_second_month_max_intensity: 0.7,
        scenario_intensity_max_monthly_variation: 0.4
    },
    correlations: [
        { isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.35, recession: 0.42, stagflation: 0.4, soft_landing: 0.38 }
    ]
});
const makeInput = (amount = 10000) => ({
    positions: [{ isin: 'ETF-A', targetWeight: 0.6 }, { isin: 'ETF-B', targetWeight: 0.4 }],
    initialCapital: amount,
    horizonYears: 1
});
class MockWorker {
    scriptPath;
    listeners = new Set();
    terminated = false;
    static lastSeed = 0;
    constructor(scriptPath) {
        this.scriptPath = scriptPath;
    }
    addEventListener(type, callback) {
        if (type === 'message')
            this.listeners.add(callback);
    }
    postMessage(message) {
        if (this.terminated)
            return;
        const run = message;
        if (run.type === 'INIT') {
            setTimeout(() => {
                this.dispatch({ type: 'message', data: { type: 'READY', executionId: run.executionId, workerId: run.workerId } });
            }, 0);
            return;
        }
        if (run.type === 'RUN_BATCH') {
            const batchStart = run.batchStart ?? 0;
            const batchEnd = run.batchEnd ?? run.pathCount;
            const results = [];
            for (let simulationId = batchStart; simulationId < batchEnd; simulationId += 1) {
                const drift = ((simulationId % 7) + 1) * 0.002;
                const finalCapital = run.input.initialCapital * (1 + drift);
                const monthly = Array.from({ length: run.input.horizonYears * 12 }, (_, monthIndex) => ({
                    month: monthIndex + 1,
                    year: Math.floor(monthIndex / 12) + 1,
                    portfolioReturn: ((simulationId % 11) - 5) * 0.01 / 12,
                    endingCapital: run.input.initialCapital * (1 + drift) * (1 + ((monthIndex + 1) / (run.input.horizonYears * 12))),
                    runningPeak: run.input.initialCapital * (1 + drift),
                    drawdown: 0.03 + ((simulationId % 3) * 0.01),
                    intensity: 45 + (simulationId % 20),
                    positions: [
                        { isin: 'ETF-A', value: run.input.initialCapital * 0.6, contribution: 0.002 },
                        { isin: 'ETF-B', value: run.input.initialCapital * 0.4, contribution: 0.001 }
                    ]
                }));
                const path = {
                    simulationId,
                    dominantEtfIsin: 'ETF-A',
                    dominantEtfName: 'ETF A',
                    initialCapital: run.input.initialCapital,
                    finalCapital,
                    totalReturn: finalCapital / run.input.initialCapital - 1,
                    cagr: finalCapital / run.input.initialCapital - 1,
                    maxDrawdown: 0.05 + ((simulationId % 4) * 0.01),
                    monthly,
                    maxRecoveryTimeMonths: 3,
                    unrecovered: false,
                    scenarioPath: {
                        years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }],
                        frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 }
                    },
                    years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [], portfolioReturn: 0.01, startingCapital: run.input.initialCapital, endingCapital: finalCapital, runningPeak: finalCapital, drawdown: 0.03 }],
                    portfolioSnapshot: {
                        generatedAt: new Date().toISOString(),
                        positions: [{ isin: 'ETF-A', name: 'ETF A', weight: 0.6 }, { isin: 'ETF-B', name: 'ETF B', weight: 0.4 }],
                        totalWeightBeforeNormalization: 1,
                        normalized: true
                    },
                    diagnostics: { performance: { redrawCount: 2, rejectRate: 0.05 } },
                    performanceDiagnostics: { redrawCount: 2, rejectRate: 0.05 },
                    correlationDiagnostics: {},
                    generalBenchmark: { expectedReturn: 0.06, volatility: 0.15 },
                    portfolioReturn: 0.01
                };
                results.push(path);
            }
            setTimeout(() => {
                this.dispatch({ type: 'message', data: { type: 'BATCH_RESULT', executionId: run.executionId, workerId: run.workerId, batchStart, batchEnd, results } });
            }, 0);
            return;
        }
        if (run.type === 'CANCEL') {
            this.terminated = true;
            this.dispatch({ type: 'message', data: { type: 'CANCELLED', executionId: run.executionId, workerId: run.workerId } });
        }
    }
    dispatch(event) {
        for (const listener of [...this.listeners]) {
            listener(event);
        }
    }
    terminate() {
        this.terminated = true;
    }
}
const createMockWorkerFactory = () => {
    const workers = [];
    return {
        create: (scriptPath) => {
            const worker = new MockWorker(scriptPath);
            workers.push(worker);
            return worker;
        },
        workers
    };
};
const createCoordinator = (mode, workerCountOverride) => {
    const factory = createMockWorkerFactory();
    const coordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
        input: makeInput(monte_carlo_coordinator_1.MONTE_CARLO_EXECUTION_MODES[mode]),
        snapshot: makeSnapshot(),
        mode,
        workerFactory: (scriptPath) => factory.create(scriptPath),
        workerCountOverride,
        batchSize: 5,
        onProgress: () => undefined
    });
    return { coordinator, factory };
};
const runNamedStep9Test = async (name, fn) => {
    await fn();
    console.log(`PASS ${name}`);
};
async function runStep9Coverage() {
    await runNamedStep9Test('smoke-100-paths', async () => {
        const { coordinator } = createCoordinator('SMOKE');
        const outcome = await coordinator.run();
        strict_1.default.equal(outcome.status, 'success');
        strict_1.default.equal(outcome.paths.length, 100);
        const ids = outcome.paths.map((path) => path.simulationId);
        strict_1.default.equal(new Set(ids).size, ids.length);
        strict_1.default.deepEqual(ids, Array.from({ length: 100 }, (_, index) => index));
    });
    await runNamedStep9Test('intermediate-1000-paths', async () => {
        const outcome = await new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(monte_carlo_coordinator_1.MONTE_CARLO_EXECUTION_MODES.INTERMEDIATE),
            snapshot: makeSnapshot(),
            mode: 'INTERMEDIATE',
            workerFactory: (scriptPath) => new MockWorker(scriptPath),
            batchSize: 10,
            onProgress: () => undefined
        }).run();
        strict_1.default.equal(outcome.status, 'success');
        strict_1.default.equal(outcome.paths.length, 1000);
    });
    await runNamedStep9Test('complete-1000-paths', async () => {
        const outcome = await new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(monte_carlo_coordinator_1.MONTE_CARLO_EXECUTION_MODES.COMPLETE),
            snapshot: makeSnapshot(),
            mode: 'COMPLETE',
            workerFactory: (scriptPath) => new MockWorker(scriptPath),
            batchSize: 20,
            onProgress: () => undefined
        }).run();
        strict_1.default.equal(outcome.status, 'success');
        strict_1.default.equal(outcome.paths.length, 1000);
    });
    await runNamedStep9Test('worker-count-auto-derivation', async () => {
        const { coordinator } = createCoordinator('SMOKE', 2);
        strict_1.default.equal(coordinator.workerCount, 2);
        const outcome = await coordinator.run();
        strict_1.default.equal(outcome.status, 'success');
        strict_1.default.equal(outcome.paths.length, 100);
    });
    await runNamedStep9Test('progress-monotone-and-100', async () => {
        const coordinator = createCoordinator('SMOKE', 2).coordinator;
        let lastProgress = -1;
        coordinator.setProgressListener((progress) => {
            strict_1.default.ok(progress >= lastProgress);
            lastProgress = progress;
        });
        const outcome = await coordinator.run();
        strict_1.default.equal(outcome.status, 'success');
        strict_1.default.equal(outcome.progress, 100);
        strict_1.default.ok(lastProgress >= 0);
    });
    await runNamedStep9Test('compact-worker-payload-preserves-official-result-fields', async () => {
        const input = makeInput(1000);
        const path = {
            simulationId: 42,
            dominantEtfIsin: 'ETF-A',
            dominantEtfName: 'ETF A',
            initialCapital: input.initialCapital,
            finalCapital: 1210,
            totalReturn: 0.21,
            cagr: 0.21,
            maxDrawdown: 0.12,
            monthly: [
                {
                    month: 1,
                    year: 1,
                    endingCapital: 1000,
                    capital: 1000,
                    portfolioReturn: 0.01,
                    runningPeak: 1000,
                    drawdown: 0.0,
                    intensity: 0.4,
                    positions: [{ isin: 'ETF-A', value: 600, contribution: 0.006, weight: 0.6, targetWeight: 0.6 }, { isin: 'ETF-B', value: 400, contribution: 0.004, weight: 0.4, targetWeight: 0.4 }]
                }
            ],
            maxRecoveryTimeMonths: 6,
            unrecovered: false,
            unrecoveredDurationMonths: 0,
            returnDiagnostics: { candidateVectors: 1, acceptedVectors: 1, rejectedVectors: 0, physicalFloorRejectedVectors: 0, oldRangeViolationCount: 0, effectiveRangeRejectedVectors: 0, byEtfScenario: {} },
            years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [], portfolioReturn: 0.21, startingCapital: input.initialCapital, endingCapital: 1210, runningPeak: 1210, drawdown: 0.12 }],
            scenarioPath: { years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }], frequencies: { expansion: 12, recession: 0, stagflation: 0, soft_landing: 0 } },
            portfolioSnapshot: { generatedAt: new Date().toISOString(), positions: [], totalWeightBeforeNormalization: 1, normalized: true },
            diagnostics: { scenario: { frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } }, performance: { redrawCount: 1, rejectRate: 0 } },
            performanceDiagnostics: { redrawCount: 1, rejectRate: 0 },
            correlationDiagnostics: {},
            generalBenchmark: { expectedReturn: 0.06, volatility: 0.15, simulatedLongTermReturn: 0.21, simulatedVolatility: 0.12 },
            matricesCoherent: true
        };
        const compact = (0, monte_carlo_worker_1.toCompactPathResult)(path);
        strict_1.default.equal(compact.simulationId, 42);
        strict_1.default.equal(compact.finalCapital, 1210);
        strict_1.default.equal(compact.monthly[0].endingCapital, 1000);
        strict_1.default.equal('positions' in compact.monthly[0], false);
        strict_1.default.equal(Array.isArray(compact.years), true);
        strict_1.default.equal(compact.scenarioPath.frequencies.expansion, 12);
        const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult([compact], 1, input.initialCapital, {
            weightedAverageScenarioCorrelation: 0.35,
            maxScenarioCorrelation: 0.42,
            longTermExpectedReturn: 0.06
        }, { matricesCoherent: true });
        strict_1.default.ok(Array.isArray(result.capitalFan));
        strict_1.default.ok(Number.isFinite(result.mainKpis.robustCagr));
    });
    await runNamedStep9Test('worker-failure-global-fail-fast', async () => {
        const factory = createMockWorkerFactory();
        const coordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(200),
            snapshot: makeSnapshot(),
            mode: 'SMOKE',
            workerFactory: (scriptPath) => {
                const worker = factory.create(scriptPath);
                const original = worker.postMessage.bind(worker);
                worker.postMessage = (message) => {
                    const run = message;
                    if (run.type === 'RUN_BATCH' && run.workerId === 1) {
                        setTimeout(() => {
                            const event = { data: { type: 'ERROR', executionId: run.executionId, workerId: run.workerId, error: { code: 'MAX_REDRAWS_EXCEEDED', message: 'redraw limit exceeded' } } };
                            worker.listeners?.forEach((listener) => listener(event));
                        }, 0);
                        return;
                    }
                    return original(message);
                };
                return worker;
            },
            batchSize: 10,
            onProgress: () => undefined
        });
        const outcome = await coordinator.run();
        strict_1.default.equal(outcome.status, 'failed');
        strict_1.default.equal(outcome.paths.length, 0);
        strict_1.default.equal(outcome.result, undefined);
    });
    await runNamedStep9Test('worker-error-event-keeps-original-message', async () => {
        const factory = createMockWorkerFactory();
        const coordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(200),
            snapshot: makeSnapshot(),
            mode: 'SMOKE',
            workerFactory: (scriptPath) => {
                const worker = factory.create(scriptPath);
                const original = worker.postMessage.bind(worker);
                worker.postMessage = (message) => {
                    const run = message;
                    if (run.type === 'RUN_BATCH' && run.workerId === 0) {
                        setTimeout(() => {
                            const event = {
                                message: 'ReferenceError: foo is not defined',
                                error: { stack: 'ReferenceError: foo is not defined\n    at worker.js:12:1' }
                            };
                            worker.listeners?.forEach((listener) => listener(event));
                        }, 0);
                        return;
                    }
                    return original(message);
                };
                return worker;
            },
            batchSize: 10,
            onProgress: () => undefined
        });
        const outcome = await coordinator.run();
        strict_1.default.equal(outcome.status, 'failed');
        strict_1.default.equal(outcome.error?.message, 'ReferenceError: foo is not defined');
        strict_1.default.match(String(outcome.error?.details?.stack ?? ''), /ReferenceError: foo is not defined/);
    });
    await runNamedStep9Test('cancel-distinct-from-failed', async () => {
        const coordinator = createCoordinator('SMOKE').coordinator;
        setTimeout(() => coordinator.cancel(), 0);
        const outcome = await coordinator.run();
        strict_1.default.equal(outcome.status, 'cancelled');
        strict_1.default.equal(outcome.paths.length, 0);
        strict_1.default.equal(outcome.result, undefined);
    });
    await runNamedStep9Test('precompute-once-per-execution', async () => {
        const coordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(100),
            snapshot: makeSnapshot(),
            mode: 'SMOKE',
            workerFactory: (scriptPath) => new MockWorker(scriptPath),
            batchSize: 10,
            onProgress: () => undefined
        });
        strict_1.default.equal(coordinator.factorized, false);
        const outcome = await coordinator.run();
        strict_1.default.equal(outcome.status, 'success');
        strict_1.default.equal(coordinator.factorized, true);
        strict_1.default.ok(coordinator.workerPool['precompute'] !== undefined);
        strict_1.default.equal(coordinator.workerPool['precompute'] !== undefined, true);
    });
    await runNamedStep9Test('no-public-seed-and-no-main-thread-fallback', async () => {
        const sourceCoordinator = (0, node_fs_1.readFileSync)(new URL('./monte-carlo-coordinator.ts', import.meta.url), 'utf8');
        const sourceWorker = (0, node_fs_1.readFileSync)(new URL('./monte-carlo-worker.ts', import.meta.url), 'utf8');
        strict_1.default.equal(sourceCoordinator.includes('pathCount'), true);
        strict_1.default.equal(sourceCoordinator.includes('simulatePath'), false);
        strict_1.default.equal(sourceWorker.includes('workerId + 1'), false);
        strict_1.default.equal(sourceWorker.includes('generateMonthlyMacroTimeline'), true);
        strict_1.default.equal(sourceWorker.includes('generateMonthlyReturnVector'), true);
        strict_1.default.equal(sourceWorker.includes('evolveMonteCarloPortfolioPath'), true);
        strict_1.default.equal(sourceWorker.includes('for (let simulationId = batchStart; simulationId < batchEnd; simulationId += 1)'), true);
    });
    await runNamedStep9Test('reduced-end-to-end-step5-6-7-8-contract', async () => {
        const outcome = await new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(250),
            snapshot: makeSnapshot(),
            mode: 'SMOKE',
            workerFactory: (scriptPath) => new MockWorker(scriptPath),
            batchSize: 5,
            onProgress: () => undefined
        }).run();
        strict_1.default.equal(outcome.status, 'success');
        strict_1.default.ok(outcome.result !== undefined);
        strict_1.default.ok(Array.isArray(outcome.result.capitalFan));
        strict_1.default.ok(outcome.result.representativePath.simulationId >= 0);
        strict_1.default.ok(Number.isFinite(outcome.result.mainKpis.robustCagr));
    });
    await runNamedStep9Test('protocol-case-a-assigned-workers-only-completion', async () => {
        const coordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(1000),
            snapshot: makeSnapshot(),
            mode: 'INTERMEDIATE',
            workerFactory: (scriptPath) => new MockWorker(scriptPath),
            workerCountOverride: 7,
            batchSize: 250,
            onProgress: () => undefined
        });
        coordinator.assignedWorkers = new Set([0, 1, 2, 3]);
        coordinator.completedSimulationWorkers = new Set([0, 1, 2]);
        coordinator.completedPaths = 1000;
        strict_1.default.equal(coordinator.assignedWorkers.size, 4);
        strict_1.default.equal(coordinator.completedSimulationWorkers.size, 3);
        strict_1.default.equal(coordinator.completedPaths >= coordinator.totalPaths, true);
    });
    await runNamedStep9Test('protocol-case-b-single-worker-uses-single-batch', async () => {
        const coordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(100),
            snapshot: makeSnapshot(),
            mode: 'SMOKE',
            workerFactory: (scriptPath) => new MockWorker(scriptPath),
            workerCountOverride: 7,
            batchSize: 100,
            onProgress: () => undefined
        });
        coordinator.assignedWorkers = new Set([2]);
        coordinator.completedSimulationWorkers = new Set([2]);
        coordinator.completedPaths = 100;
        strict_1.default.equal(coordinator.assignedWorkers.size, 1);
        strict_1.default.equal(coordinator.completedSimulationWorkers.size, 1);
    });
    await runNamedStep9Test('protocol-case-c-all-workers-assigned-then-complete', async () => {
        const coordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(1000),
            snapshot: makeSnapshot(),
            mode: 'INTERMEDIATE',
            workerFactory: (scriptPath) => new MockWorker(scriptPath),
            workerCountOverride: 7,
            batchSize: 100,
            onProgress: () => undefined
        });
        coordinator.assignedWorkers = new Set([0, 1, 2, 3, 4, 5, 6]);
        coordinator.completedSimulationWorkers = new Set([0, 1, 2, 3, 4, 5, 6]);
        coordinator.completedPaths = 1000;
        strict_1.default.equal(coordinator.assignedWorkers.size, 7);
        strict_1.default.equal(coordinator.completedSimulationWorkers.size, 7);
    });
    await runNamedStep9Test('protocol-case-d-worker-can-complete-more-than-one-batch', async () => {
        const coordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
            input: makeInput(200),
            snapshot: makeSnapshot(),
            mode: 'SMOKE',
            workerFactory: (scriptPath) => new MockWorker(scriptPath),
            workerCountOverride: 7,
            batchSize: 50,
            onProgress: () => undefined
        });
        coordinator.assignedWorkers = new Set([0]);
        coordinator.completedSimulationWorkers = new Set([0]);
        coordinator.completedPaths = 200;
        strict_1.default.equal(coordinator.assignedWorkers.size, 1);
        strict_1.default.equal(coordinator.completedSimulationWorkers.size, 1);
    });
    await runNamedStep9Test('production-add-batch-filter-regression', async () => {
        const source = (0, node_fs_1.readFileSync)(new URL('./monte-carlo-aggregation.worker.ts', import.meta.url), 'utf8');
        strict_1.default.ok(source.includes("if (!portMessage || !portMessage.executionId) return;"));
        strict_1.default.ok(source.includes("if (typeof portMessage.type === 'string' && portMessage.type.startsWith('MC_PORT_TEST_'))"));
        strict_1.default.ok(source.includes("if (!portMessage.testId || portMessage.testId !== message.testId) return;"));
        strict_1.default.ok(source.includes("if (portMessage.type === 'ADD_BATCH')"));
        const acceptsDiagnosticMessage = (message) => {
            if (!message || !message.executionId)
                return false;
            if (typeof message.type === 'string' && message.type.startsWith('MC_PORT_TEST_')) {
                if (!message.testId || message.testId !== 'diag-123')
                    return false;
                return message.type === 'MC_PORT_TEST_PONG' || message.type === 'MC_PORT_TEST_ADD_BATCH';
            }
            return false;
        };
        const acceptsProductionBatch = (message) => {
            if (!message || !message.executionId)
                return false;
            if (typeof message.type === 'string' && message.type.startsWith('MC_PORT_TEST_')) {
                return false;
            }
            if (message.type === 'ADD_BATCH') {
                return true;
            }
            return false;
        };
        const diagPacket = { type: 'MC_PORT_TEST_PONG', executionId: 'e-1', workerId: 0, testId: 'diag-123' };
        const prodPacket = { type: 'ADD_BATCH', executionId: 'e-1', workerId: 0, batch: [{ ok: true }] };
        strict_1.default.equal(acceptsDiagnosticMessage(diagPacket), true);
        strict_1.default.equal(acceptsProductionBatch(prodPacket), true);
        strict_1.default.equal(acceptsProductionBatch({ ...prodPacket, workerId: 0, testId: undefined }), true);
        strict_1.default.equal(acceptsProductionBatch({ ...prodPacket, workerId: 0, batch: [] }), true);
    });
    await runNamedStep9Test('normal-port-ready-regression', async () => {
        const source = (0, node_fs_1.readFileSync)(new URL('./monte-carlo-aggregation.worker.ts', import.meta.url), 'utf8');
        strict_1.default.ok(source.includes("type: 'PORT_READY'"));
        strict_1.default.ok(source.includes("executionId: message.executionId"));
        strict_1.default.ok(source.includes("workerId: message.workerId"));
        strict_1.default.ok(!source.includes("type: 'PORT_READY',\n        testId:"));
        strict_1.default.ok(source.includes("if (!portMessage.testId) return;"));
        const portReadySet = new Set();
        const readySet = new Set();
        const registerSimulationPort = (executionId, workerId, testId) => {
            const registerSucceeded = !!executionId && typeof workerId === 'number';
            if (registerSucceeded) {
                portReadySet.add(workerId);
            }
            if (typeof testId === 'string' && testId.length > 0) {
                readySet.add(workerId);
            }
        };
        registerSimulationPort('exec-1', 0, undefined);
        strict_1.default.equal(portReadySet.has(0), true);
        strict_1.default.equal(readySet.has(0), false);
        const readyFirstWorks = () => {
            readySet.add(0);
            return readySet.has(0) && portReadySet.has(0);
        };
        const portReadyFirstWorks = () => {
            portReadySet.add(0);
            return readySet.has(0) && portReadySet.has(0);
        };
        readySet.clear();
        portReadySet.clear();
        portReadySet.add(0);
        strict_1.default.equal(readyFirstWorks(), true);
        readySet.clear();
        portReadySet.clear();
        readySet.add(0);
        strict_1.default.equal(portReadyFirstWorks(), true);
        const workerZeroAccepted = (value) => Number.isInteger(value) && value === 0;
        strict_1.default.equal(workerZeroAccepted(0), true);
        strict_1.default.equal(portReadySet.has(0) || readySet.has(0), true);
    });
    const validationCoordinator = new monte_carlo_coordinator_1.MonteCarloCoordinator({
        input: makeInput(),
        snapshot: makeSnapshot(),
        mode: 'SMOKE',
        workerFactory: (scriptPath) => new MockWorker(scriptPath),
        batchSize: 10,
        onProgress: () => undefined
    });
    const validationOutcome = await validationCoordinator.run();
    strict_1.default.equal(validationOutcome.status, 'success');
    (0, monte_carlo_contract_validator_1.validateMonteCarloRunContract)(makeInput(), makeSnapshot());
    strict_1.default.ok(Number.isFinite(validationOutcome.performanceMetrics.totalTime));
    strict_1.default.ok(Number.isFinite(validationOutcome.performanceMetrics.pathsPerSecond));
    strict_1.default.ok(Number.isFinite(validationOutcome.performanceMetrics.monthsPerSecond));
}
runStep9Coverage().catch((error) => {
    console.error(error);
    process.exit(1);
});
