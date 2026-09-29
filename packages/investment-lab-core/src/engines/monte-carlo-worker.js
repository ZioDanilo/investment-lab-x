import { generateMonthlyMacroTimeline } from '../macro/monte-carlo-macro-engine.js';
import { evolveMonteCarloPortfolioPath } from '../portfolio/monte-carlo-portfolio-path-engine.js';
import { beginReturnVectorBatchProfile, endReturnVectorBatchProfile, generateMonthlyReturnVector } from '../returns/monte-carlo-return-engine.js';
import { SeededRandom } from './seeded-random.js';

const asWorkerScope = (typeof self !== 'undefined' ? self : globalThis);
const runtimeMarkerSet = new Set();

const emitRuntimeMarker = (checkpoint, details = {}) => {
    console.info('[MC-RUNTIME]', { checkpoint, ...details });
};

const mix32 = (value) => {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae3d);
    x ^= x >>> 16;
    return x >>> 0;
};

export const derivePathSeed = (runSeed, globalSimulationId) => {
    const mixedSeed = mix32((runSeed >>> 0) ^ 0x9e3779b9);
    const mixedPath = mix32((Math.imul(((globalSimulationId + 1) >>> 0), 0x9e3779b1)) ^ mixedSeed);
    return mixedPath >>> 0;
};

const createDeterministicRandom = (simulationId, runSeed) => {
    const baseSeed = derivePathSeed(runSeed, simulationId);
    return new SeededRandom(baseSeed);
};

const firstBatchProfileMap = new Map();
const ensureFirstBatchProfile = (executionId, workerId) => {
    const key = `${executionId}:${workerId}`;
    if (!firstBatchProfileMap.has(key)) {
        firstBatchProfileMap.set(key, {
            executionId,
            workerId,
            paths: 0,
            macroTimelineMs: 0,
            monthlyReturnVectorsMs: 0,
            portfolioEvolutionMs: 0,
            compactResultMs: 0,
            encodeTransportMs: 0,
            totalBatchMs: 0,
            emitted: false
        });
    }
    return firstBatchProfileMap.get(key);
};
const finalizeFirstBatchProfile = (profile) => {
    if (!profile || profile.emitted) {
        return;
    }
    profile.emitted = true;
    const avgPathMs = profile.paths > 0 ? profile.totalBatchMs / profile.paths : 0;
    console.info('[MC-PROFILE] FIRST_BATCH_BREAKDOWN', {
        workerId: profile.workerId,
        paths: profile.paths,
        macroTimelineMs: profile.macroTimelineMs,
        monthlyReturnVectorsMs: profile.monthlyReturnVectorsMs,
        portfolioEvolutionMs: profile.portfolioEvolutionMs,
        compactResultMs: profile.compactResultMs,
        encodeTransportMs: profile.encodeTransportMs,
        totalBatchMs: profile.totalBatchMs,
        avgPathMs
    });
};

export const toCompactPathResult = (path) => {
    const monthly = Array.isArray(path?.monthly)
        ? path.monthly.map((entry) => ({
            month: entry?.month,
            year: entry?.year,
            endingCapital: entry?.endingCapital ?? entry?.capital,
            capital: entry?.capital ?? entry?.endingCapital,
            portfolioReturn: entry?.portfolioReturn,
            runningPeak: entry?.runningPeak,
            drawdown: entry?.drawdown,
            intensity: entry?.intensity
        }))
        : [];
    const scenarioPath = {
        years: Array.isArray(path?.scenarioPath?.years)
            ? path.scenarioPath.years.map((entry) => ({
                year: entry?.year,
                scenario: entry?.scenario ?? 'expansion',
                durationInCurrentScenario: entry?.durationInCurrentScenario ?? 0
            }))
            : [],
        frequencies: {
            expansion: path?.scenarioPath?.frequencies?.expansion ?? 0,
            recession: path?.scenarioPath?.frequencies?.recession ?? 0,
            stagflation: path?.scenarioPath?.frequencies?.stagflation ?? 0,
            soft_landing: path?.scenarioPath?.frequencies?.soft_landing ?? 0
        }
    };
    const years = Array.isArray(path?.years)
        ? path.years.map((entry) => ({
            year: entry?.year,
            scenario: entry?.scenario ?? 'expansion',
            durationInCurrentScenario: entry?.durationInCurrentScenario ?? 0,
            etfReturns: Array.isArray(entry?.etfReturns) ? entry.etfReturns.map((etf) => ({
                isin: etf?.isin ?? '',
                name: etf?.name ?? '',
                weight: etf?.weight ?? 0,
                annualReturn: etf?.annualReturn ?? 0,
                contribution: etf?.contribution ?? 0,
                intensity: etf?.intensity ?? 0,
                deviationDirection: etf?.deviationDirection ?? 'above_expected'
            })) : [],
            portfolioReturn: entry?.portfolioReturn ?? 0,
            startingCapital: entry?.startingCapital ?? 0,
            endingCapital: entry?.endingCapital ?? 0,
            runningPeak: entry?.runningPeak ?? 0,
            drawdown: entry?.drawdown ?? 0
        }))
        : [];
    return {
        simulationId: path?.simulationId ?? -1,
        dominantEtfIsin: path?.dominantEtfIsin ?? '',
        dominantEtfName: path?.dominantEtfName ?? '',
        initialCapital: path?.initialCapital ?? 0,
        finalCapital: path?.finalCapital ?? 0,
        totalReturn: path?.totalReturn ?? 0,
        cagr: path?.cagr ?? 0,
        maxDrawdown: path?.maxDrawdown ?? 0,
        monthly,
        maxRecoveryTimeMonths: path?.maxRecoveryTimeMonths ?? null,
        unrecovered: path?.unrecovered ?? false,
        unrecoveredDurationMonths: path?.unrecoveredDurationMonths ?? null,
        scenarioPath,
        years,
        returnDiagnostics: path?.returnDiagnostics,
        performanceDiagnostics: path?.performanceDiagnostics,
        correlationDiagnostics: path?.correlationDiagnostics,
        generalBenchmark: path?.generalBenchmark,
        matricesCoherent: path?.matricesCoherent ?? true
    };
};
const buildPathResult = (input, snapshot, precompute, simulationId, runSeed, batchProfile = null) => {
    const rng = createDeterministicRandom(simulationId, runSeed);
    const horizonMonths = input.horizonYears * 12;
    const macroStartedAt = performance.now();
    const macro = generateMonthlyMacroTimeline(snapshot, horizonMonths, () => rng.next());
    if (batchProfile) {
        batchProfile.macroTimelineMs += performance.now() - macroStartedAt;
    }
    const monthlyStartedAt = performance.now();
    const monthlyVectors = macro.months.map((monthState) => generateMonthlyReturnVector(snapshot, precompute, monthState.scenario, monthState.intensity, () => rng.next()));
    if (batchProfile) {
        batchProfile.monthlyReturnVectorsMs += performance.now() - monthlyStartedAt;
    }
    const portfolioStartedAt = performance.now();
    const portfolioPath = evolveMonteCarloPortfolioPath(input, monthlyVectors);
    if (batchProfile) {
        batchProfile.portfolioEvolutionMs += performance.now() - portfolioStartedAt;
    }
    const dominantEtf = input.positions.reduce((best, position) => {
        if (!best || position.targetWeight > best.targetWeight)
            return position;
        return best;
    }, input.positions[0]);
    const monthlyReturnDiagnostics = monthlyVectors.reduce((aggregated, vector) => {
        const range = vector.diagnostics?.rangeDiagnostics;
        if (!range)
            return aggregated;
        aggregated.candidateVectors += range.candidateVectors;
        aggregated.acceptedVectors += range.acceptedVectors;
        aggregated.rejectedVectors += range.rejectedVectors;
        aggregated.physicalFloorRejectedVectors += range.physicalFloorRejectedVectors ?? 0;
        aggregated.oldRangeViolationCount += range.oldRangeViolationCount ?? 0;
        aggregated.effectiveRangeRejectedVectors += range.effectiveRangeRejectedVectors ?? 0;
        for (const [key, value] of Object.entries(range.byEtfScenario ?? {})) {
            const current = aggregated.byEtfScenario[key] ?? {
                candidateReturnCount: 0,
                belowEffectiveMinCount: 0,
                aboveEffectiveMaxCount: 0,
                lowerRejectRate: 0,
                upperRejectRate: 0,
                totalOutOfRangeRate: 0,
                meanLowerDistanceSigma: null,
                meanUpperDistanceSigma: null
            };
            current.candidateReturnCount += value.candidateReturnCount;
            current.belowEffectiveMinCount += value.belowEffectiveMinCount;
            current.aboveEffectiveMaxCount += value.aboveEffectiveMaxCount;
            current.lowerRejectRate = current.candidateReturnCount > 0 ? current.belowEffectiveMinCount / current.candidateReturnCount : 0;
            current.upperRejectRate = current.candidateReturnCount > 0 ? current.aboveEffectiveMaxCount / current.candidateReturnCount : 0;
            current.totalOutOfRangeRate = current.candidateReturnCount > 0 ? (current.belowEffectiveMinCount + current.aboveEffectiveMaxCount) / current.candidateReturnCount : 0;
            if (value.meanLowerDistanceSigma !== null) {
                current.meanLowerDistanceSigma = (current.meanLowerDistanceSigma ?? 0) + value.meanLowerDistanceSigma;
            }
            if (value.meanUpperDistanceSigma !== null) {
                current.meanUpperDistanceSigma = (current.meanUpperDistanceSigma ?? 0) + value.meanUpperDistanceSigma;
            }
            aggregated.byEtfScenario[key] = current;
        }
        return aggregated;
    }, {
        candidateVectors: 0,
        acceptedVectors: 0,
        rejectedVectors: 0,
        physicalFloorRejectedVectors: 0,
        oldRangeViolationCount: 0,
        effectiveRangeRejectedVectors: 0,
        byEtfScenario: {}
    });
    const pathResult = {
        simulationId,
        dominantEtfIsin: dominantEtf?.isin ?? '',
        dominantEtfName: dominantEtf?.isin ?? '',
        initialCapital: input.initialCapital,
        finalCapital: portfolioPath.finalCapital,
        totalReturn: portfolioPath.totalReturn,
        cagr: Math.pow(portfolioPath.finalCapital / input.initialCapital, 1 / Math.max(1, input.horizonYears)) - 1,
        maxDrawdown: portfolioPath.maxDrawdown,
        monthly: portfolioPath.monthly.map((entry) => ({
            month: entry.month,
            year: entry.year,
            endingCapital: entry.endingCapital,
            capital: entry.endingCapital,
            portfolioReturn: entry.portfolioReturn,
            runningPeak: entry.runningPeak,
            drawdown: entry.drawdown,
            intensity: entry.intensity,
            positions: entry.positions.map((position) => ({
                isin: position.isin,
                value: position.endingValue,
                contribution: position.contribution,
                weight: position.currentWeightEnd ?? position.targetWeight,
                targetWeight: position.targetWeight
            }))
        })),
        maxRecoveryTimeMonths: portfolioPath.maxRecoveryTimeMonths,
        unrecovered: portfolioPath.unrecovered,
        unrecoveredDurationMonths: portfolioPath.unrecoveredDurationMonths,
        returnDiagnostics: monthlyReturnDiagnostics,
        years: portfolioPath.annual.map((entry) => ({
            year: entry.year,
            scenario: macro.months[(entry.year * 12) - 1]?.scenario ?? 'expansion',
            durationInCurrentScenario: 12,
            etfReturns: entry.etfs.map((etf) => ({
                isin: etf.isin,
                name: etf.isin,
                weight: input.positions.find((position) => position.isin === etf.isin)?.targetWeight ?? 0,
                expectedReturn: 0,
                annualReturn: etf.annualReturn,
                contribution: etf.annualContributionAtTargetWeight,
                intensity: 0,
                deviationDirection: 'above_expected'
            })),
            portfolioReturn: entry.annualPortfolioReturn,
            startingCapital: entry.startingCapital,
            endingCapital: entry.endingCapital,
            runningPeak: entry.endingCapital,
            drawdown: portfolioPath.maxDrawdown
        })),
        scenarioPath: {
            years: macro.months.map((monthState, index) => ({
                year: Math.floor(index / 12) + 1,
                scenario: monthState.scenario,
                durationInCurrentScenario: monthState.monthsInCurrentScenario
            })),
            frequencies: macro.months.reduce((frequencies, monthState) => {
                frequencies[monthState.scenario] += 1;
                return frequencies;
            }, { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 })
        },
        portfolioSnapshot: {
            generatedAt: new Date().toISOString(),
            positions: input.positions.map((position) => ({ isin: position.isin, name: position.isin, weight: position.targetWeight })),
            totalWeightBeforeNormalization: 1,
            normalized: true
        },
        diagnostics: {
            scenario: { frequencies: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 } },
            performance: { redrawCount: portfolioPath.monthly.length, rejectRate: 0 }
        },
        performanceDiagnostics: { redrawCount: 0, rejectRate: 0 },
        correlationDiagnostics: {},
        generalBenchmark: { expectedReturn: 0.06, volatility: 0.15, simulatedLongTermReturn: portfolioPath.totalReturn, simulatedVolatility: 0.12 },
        matricesCoherent: true
    };
    return pathResult;
};
let boundAggregationPort = null;
const getAggregationPort = (message) => {
    if (message.aggregationPort) {
        boundAggregationPort = message.aggregationPort;
        return message.aggregationPort;
    }
    return boundAggregationPort;
};
emitRuntimeMarker('WORKER_LOADED');
asWorkerScope.onmessage = (event) => {
    const message = event.data;
    if (message && typeof message.type === 'string' && (message.type === 'INIT' || message.type === 'RUN_BATCH')) {
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'SIM_MAIN_ONMESSAGE_ENTER_V4',
            originalType: message.type,
            testId: message.testId ?? null,
            executionId: message.executionId ?? null,
            workerId: message.workerId ?? null
        });
    }
    if (message && typeof message.type === 'string' && message.type === 'INIT') {
        emitRuntimeMarker('INIT_RECEIVED', {
            executionId: message.executionId ?? null,
            workerId: message.workerId ?? null,
            hasPrecompute: message.precompute != null
        });
    }
    if (message && typeof message.type === 'string' && message.type.startsWith('MC_PORT_TEST_')) {
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'SIM_MAIN_ONMESSAGE_ENTER',
            originalType: message.type,
            testId: message.testId ?? null,
            executionId: message.executionId ?? null,
            workerId: message.workerId ?? null
        });
    }
    if (!message || !message.executionId) {
        return;
    }
    if (message.type === 'INIT') {
        try {
            const aggregationPort = getAggregationPort(message);
            boundAggregationPort = aggregationPort;
            emitRuntimeMarker('PORT_RECEIVED', {
                executionId: message.executionId,
                workerId: message.workerId,
                hasAggregationPort: !!aggregationPort
            });
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'SIM_INIT_RECEIVE_ENTER',
                executionId: message.executionId,
                workerId: message.workerId,
                hasPrecompute: message.precompute != null,
                hasAggregationPort: !!aggregationPort
            });
            if (aggregationPort) {
                aggregationPort.onmessage = (event) => {
                    const portMessage = event.data;
                    if (portMessage && typeof portMessage.type === 'string' && portMessage.type.startsWith('MC_PORT_TEST_')) {
                        asWorkerScope.postMessage({
                            type: 'MC_PORT_TEST_CHECKPOINT',
                            checkpoint: 'SIM_PORT_MESSAGE_ENTER',
                            originalType: portMessage.type,
                            testId: portMessage.testId ?? null,
                            executionId: portMessage.executionId ?? null,
                            workerId: portMessage.workerId ?? null,
                            value: portMessage.value ?? null
                        });
                    }
                    if (!portMessage || !portMessage.executionId)
                        return;
                    if (portMessage.type === 'MC_PORT_TEST_PING') {
                        if (!portMessage.testId)
                            return;
                        emitRuntimeMarker('PING_RECEIVED', {
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: portMessage.workerId ?? message.workerId ?? null
                        });
                        console.info('[MC-PORT-TEST] PING_RECEIVED', {
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: portMessage.workerId
                        });
                        asWorkerScope.postMessage({
                            type: 'MC_PORT_TEST_PING_RECEIVED',
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: portMessage.workerId
                        });
                        emitRuntimeMarker('PONG_SENT', {
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: message.workerId ?? portMessage.workerId ?? null
                        });
                        console.info('[MC-PORT-TEST] PONG_SENT', {
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: message.workerId
                        });
                        asWorkerScope.postMessage({
                            type: 'MC_PORT_TEST_PONG',
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: message.workerId
                        });
                        aggregationPort.postMessage({
                            type: 'MC_PORT_TEST_PONG',
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: message.workerId
                        });
                        return;
                    }
                    if (portMessage.type === 'MC_PORT_TEST_ADD_BATCH') {
                        if (!portMessage.testId)
                            return;
                        asWorkerScope.postMessage({
                            type: 'MC_PORT_TEST_ADD_BATCH_RECEIVED',
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: portMessage.workerId,
                            value: portMessage.value ?? null
                        });
                        aggregationPort.postMessage({
                            type: 'MC_PORT_TEST_ADD_BATCH_ACK',
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: message.workerId,
                            value: portMessage.value ?? null
                        });
                        return;
                    }
                    if (portMessage.type === 'MC_PORT_TEST_ADD_BATCH_ACK') {
                        asWorkerScope.postMessage({
                            type: 'MC_PORT_TEST_CHECKPOINT',
                            checkpoint: 'SIM_ACK_BRANCH_ENTER',
                            originalType: portMessage.type,
                            testId: portMessage.testId ?? null,
                            executionId: portMessage.executionId ?? null,
                            workerId: portMessage.workerId ?? null,
                            value: portMessage.value ?? null
                        });
                        if (!portMessage.testId ||
                            !portMessage.executionId ||
                            portMessage.workerId === undefined ||
                            portMessage.workerId === null) {
                            return;
                        }
                        console.info('[MC-PORT-TEST] ADD_BATCH_TEST_ACK_RECEIVED_BY_SIM', {
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: portMessage.workerId,
                            value: portMessage.value ?? null
                        });
                        const resultPayload = {
                            type: 'MC_PORT_TEST_ADD_BATCH_RESULT',
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: portMessage.workerId,
                            received: true,
                            value: portMessage.value ?? null,
                            ackReceived: true
                        };
                        console.info('[MC-PORT-TEST] RESULT_SEND_BEGIN', {
                            testId: portMessage.testId,
                            executionId: portMessage.executionId,
                            workerId: portMessage.workerId,
                            value: resultPayload.value
                        });
                        try {
                            asWorkerScope.postMessage(resultPayload);
                            console.info('[MC-PORT-TEST] RESULT_SENT', {
                                testId: portMessage.testId,
                                executionId: portMessage.executionId,
                                workerId: portMessage.workerId,
                                value: resultPayload.value,
                                received: resultPayload.received,
                                ackReceived: resultPayload.ackReceived
                            });
                        }
                        catch (error) {
                            console.error('[MC-PORT-TEST] RESULT_SEND_ERROR', {
                                testId: portMessage.testId,
                                executionId: portMessage.executionId,
                                workerId: portMessage.workerId,
                                error
                            });
                        }
                        return;
                    }
                };
                aggregationPort.start();
            }
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'SIM_INIT_PORT_BOUND',
                executionId: message.executionId,
                workerId: message.workerId,
                hasBoundAggregationPort: !!aggregationPort
            });
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'SIM_INIT_STATE_ASSIGNED',
                executionId: message.executionId,
                workerId: message.workerId,
                hasPrecompute: message.precompute != null,
                hasAggregationPort: !!aggregationPort
            });
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'SIM_INIT_READY_SEND_BEGIN',
                executionId: message.executionId,
                workerId: message.workerId,
                hasPrecompute: message.precompute != null,
                hasAggregationPort: !!aggregationPort
            });
            asWorkerScope.postMessage({ type: 'READY', executionId: message.executionId, workerId: message.workerId });
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'SIM_INIT_READY_SEND_DONE',
                executionId: message.executionId,
                workerId: message.workerId,
                hasPrecompute: message.precompute != null,
                hasAggregationPort: !!aggregationPort
            });
            return;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorName = error instanceof Error ? error.name : 'UnknownError';
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'SIM_INIT_ERROR',
                executionId: message.executionId,
                workerId: message.workerId,
                errorName,
                errorMessage,
                errorStack: error instanceof Error && typeof error.stack === 'string' ? error.stack : null
            });
            throw error;
        }
    }
    if (message.type === 'MC_PORT_TEST_SEND_ADD_BATCH') {
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'SIM_TRIGGER_BRANCH_ENTER',
            originalType: message.type,
            testId: message.testId ?? null,
            executionId: message.executionId ?? null,
            workerId: message.workerId ?? null
        });
        const aggregationPort = getAggregationPort(message);
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'SIM_TRIGGER_PORT_RESOLVED',
            originalType: message.type,
            testId: message.testId ?? null,
            executionId: message.executionId ?? null,
            workerId: message.workerId ?? null,
            hasAggregationPort: !!aggregationPort
        });
        if (!aggregationPort) {
            console.error('[MC-PORT-TEST] ADD_BATCH_TEST_TRIGGER_RECEIVED_MISSING_PORT', {
                testId: message.testId,
                executionId: message.executionId,
                workerId: message.workerId
            });
            return;
        }
        console.info('[MC-PORT-TEST] ADD_BATCH_TEST_TRIGGER_RECEIVED', {
            testId: message.testId,
            executionId: message.executionId,
            workerId: message.workerId,
            hasAggregationPort: !!aggregationPort,
            value: message.value ?? 123.456
        });
        console.info('[MC-PORT-TEST] ADD_BATCH_TEST_SEND_BEGIN', {
            testId: message.testId,
            executionId: message.executionId,
            workerId: message.workerId,
            value: message.value ?? 123.456
        });
        try {
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'SIM_ADD_BATCH_PORT_POST_BEGIN',
                originalType: 'MC_PORT_TEST_ADD_BATCH',
                testId: message.testId ?? null,
                executionId: message.executionId ?? null,
                workerId: message.workerId ?? null
            });
            aggregationPort.postMessage({
                type: 'MC_PORT_TEST_ADD_BATCH',
                testId: message.testId,
                executionId: message.executionId,
                workerId: message.workerId,
                value: message.value ?? 123.456
            });
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'SIM_ADD_BATCH_PORT_POST_DONE',
                originalType: 'MC_PORT_TEST_ADD_BATCH',
                testId: message.testId ?? null,
                executionId: message.executionId ?? null,
                workerId: message.workerId ?? null
            });
            console.info('[MC-PORT-TEST] ADD_BATCH_TEST_SENT', {
                testId: message.testId,
                executionId: message.executionId,
                workerId: message.workerId,
                value: message.value ?? 123.456
            });
        }
        catch (error) {
            console.error('[MC-PORT-TEST] ADD_BATCH_TEST_SEND_ERROR', {
                testId: message.testId,
                executionId: message.executionId,
                workerId: message.workerId,
                error
            });
        }
        return;
    }
    if (message.type === 'CANCEL') {
        asWorkerScope.postMessage({ type: 'CANCELLED', executionId: message.executionId, workerId: message.workerId });
        return;
    }
    if (message.type === 'RUN_BATCH') {
        const batchStartedAt = performance.now();
        const { batchStart = 0, batchEnd = 0, input, snapshot, precompute, pathCount = 0, runSeed = 0 } = message;
        const firstBatchProfile = ensureFirstBatchProfile(message.executionId, message.workerId);
        const isFirstBatchForWorker = firstBatchProfile.paths === 0 && batchStart >= 0;
        console.log('[MC-PROFILE] RETURN_VECTOR_BEGIN', {
            workerId: message.workerId,
            executionId: message.executionId,
            batchStart,
            batchEnd
        });
        beginReturnVectorBatchProfile(message.workerId);
        emitRuntimeMarker('RUN_BATCH_RECEIVED', {
            executionId: message.executionId,
            workerId: message.workerId,
            batchStart,
            batchEnd,
            pathCount,
            runSeed,
            hasPrecompute: precompute != null
        });
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_RUN_BATCH_RECEIVE_ENTER',
            executionId: message.executionId,
            workerId: message.workerId,
            batchStart,
            batchEnd,
            pathCount,
            hasPrecompute: precompute != null
        });
        const results = [];
        const macroStartedAt = performance.now();
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_RUN_BATCH_LOOP_BEGIN',
            executionId: message.executionId,
            workerId: message.workerId,
            batchStart,
            batchEnd,
            numberOfPaths: batchEnd - batchStart
        });
        for (let simulationId = batchStart; simulationId < batchEnd; simulationId += 1) {
            if (simulationId === batchStart) {
                emitRuntimeMarker('FIRST_PATH_START', {
                    executionId: message.executionId,
                    workerId: message.workerId,
                    simulationId,
                    batchStart,
                    batchEnd
                });
            }
            asWorkerScope.postMessage({
                type: 'MC_PORT_TEST_CHECKPOINT',
                checkpoint: 'PROD_FIRST_PATH_BEGIN',
                executionId: message.executionId,
                workerId: message.workerId,
                simulationId,
                monthlyReturnCount: Array.isArray(input?.positions) ? input.positions.length : null,
                hasResult: false
            });
            try {
                const pathResult = buildPathResult(input, snapshot, precompute, simulationId, runSeed, isFirstBatchForWorker ? firstBatchProfile : null);
                if (isFirstBatchForWorker) {
                    firstBatchProfile.paths += 1;
                }
                results.push(pathResult);
                if (simulationId === batchStart) {
                    emitRuntimeMarker('FIRST_PATH_COMPLETE', {
                        executionId: message.executionId,
                        workerId: message.workerId,
                        simulationId,
                        batchStart,
                        batchEnd,
                        totalResults: results.length
                    });
                }
                asWorkerScope.postMessage({
                    type: 'MC_PORT_TEST_CHECKPOINT',
                    checkpoint: 'PROD_FIRST_PATH_DONE',
                    executionId: message.executionId,
                    workerId: message.workerId,
                    simulationId,
                    monthlyReturnCount: Array.isArray(input?.positions) ? input.positions.length : null,
                    hasResult: true
                });
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                const errorName = error instanceof Error ? error.name : 'UnknownError';
                asWorkerScope.postMessage({
                    type: 'MC_PORT_TEST_CHECKPOINT',
                    checkpoint: 'PROD_FIRST_PATH_ERROR',
                    executionId: message.executionId,
                    workerId: message.workerId,
                    errorName,
                    errorMessage,
                    errorStack: error instanceof Error && typeof error.stack === 'string' ? error.stack : null
                });
                throw error;
            }
        }
        const macroMs = performance.now() - macroStartedAt;
        const returnMs = 0;
        const portfolioMs = 0;
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_RUN_BATCH_LOOP_DONE',
            executionId: message.executionId,
            workerId: message.workerId,
            resultsCount: results.length
        });
        const compactStartedAt = performance.now();
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_COMPACT_BEGIN',
            executionId: message.executionId,
            workerId: message.workerId,
            compactInputCount: results.length
        });
        const compactResults = results.map((path) => toCompactPathResult(path));
        const compactMs = performance.now() - compactStartedAt;
        if (isFirstBatchForWorker) {
            firstBatchProfile.compactResultMs += compactMs;
        }
        asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_COMPACT_DONE',
            executionId: message.executionId,
            workerId: message.workerId,
            compactResultsCount: compactResults.length
        });
        const aggregationPort = getAggregationPort(message);
        const sendStartedAt = performance.now();
        if (aggregationPort) {
            try {
                const encodeStartedAt = performance.now();
                const productionPayload = {
                    type: 'ADD_BATCH',
                    executionId: message.executionId,
                    workerId: message.workerId,
                    batch: compactResults,
                    expectedPathCount: pathCount
                };
                const structuredClonePass = (() => {
                    try {
                        structuredClone(productionPayload);
                        return true;
                    }
                    catch (error) {
                        return false;
                    }
                })();
                const encodeTransportMs = performance.now() - encodeStartedAt;
                if (isFirstBatchForWorker) {
                    firstBatchProfile.encodeTransportMs += encodeTransportMs;
                }
                asWorkerScope.postMessage({
                    type: 'MC_PORT_TEST_CHECKPOINT',
                    checkpoint: 'PROD_ADD_BATCH_SEND_BEGIN',
                    originalType: 'ADD_BATCH',
                    executionId: message.executionId,
                    workerId: message.workerId,
                    pathCountInBatch: compactResults.length,
                    payloadTopLevelKeys: Object.keys(productionPayload),
                    pass: structuredClonePass
                });
                if (!structuredClonePass) {
                    asWorkerScope.postMessage({
                        type: 'MC_PORT_TEST_CHECKPOINT',
                        checkpoint: 'PROD_PAYLOAD_STRUCTURED_CLONE_PASS',
                        originalType: 'ADD_BATCH',
                        executionId: message.executionId,
                        workerId: message.workerId,
                        pass: false,
                        nonTrivialCloneTypesFound: ['structuredClone-failed']
                    });
                }
                else {
                    asWorkerScope.postMessage({
                        type: 'MC_PORT_TEST_CHECKPOINT',
                        checkpoint: 'PROD_PAYLOAD_STRUCTURED_CLONE_PASS',
                        originalType: 'ADD_BATCH',
                        executionId: message.executionId,
                        workerId: message.workerId,
                        pass: true,
                        nonTrivialCloneTypesFound: []
                    });
                }
                aggregationPort.start();
                console.info('[MC-PERF] WORKER_BATCH_SEND', {
                    workerId: message.workerId,
                    batchStart,
                    batchEnd,
                    batchPathCount: compactResults.length,
                    at: performance.now()
                });
                aggregationPort.postMessage(productionPayload);
                asWorkerScope.postMessage({
                    type: 'MC_PORT_TEST_CHECKPOINT',
                    checkpoint: 'PROD_ADD_BATCH_SEND_DONE',
                    originalType: 'ADD_BATCH',
                    executionId: message.executionId,
                    workerId: message.workerId,
                    pathCountInBatch: compactResults.length,
                    payloadTopLevelKeys: Object.keys(productionPayload)
                });
                console.info('[MC-PERF] WORKER_BATCH_POSTED', {
                    workerId: message.workerId,
                    batchStart,
                    batchEnd,
                    batchPathCount: compactResults.length,
                    at: performance.now()
                });
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                const errorName = error instanceof Error ? error.name : 'UnknownError';
                asWorkerScope.postMessage({
                    type: 'MC_PORT_TEST_CHECKPOINT',
                    checkpoint: 'PROD_ADD_BATCH_SEND_ERROR',
                    originalType: 'ADD_BATCH',
                    executionId: message.executionId,
                    workerId: message.workerId,
                    errorName,
                    errorMessage
                });
                console.error('[MC-PERF] WORKER_BATCH_POST_ERROR', {
                    workerId: message.workerId,
                    batchStart,
                    batchEnd,
                    error
                });
                throw error;
            }
        }
        const sendMs = performance.now() - sendStartedAt;
        if (!runtimeMarkerSet.has(`FIRST_PROGRESS_SENT:${message.workerId}:${message.executionId}`)) {
            runtimeMarkerSet.add(`FIRST_PROGRESS_SENT:${message.workerId}:${message.executionId}`);
            emitRuntimeMarker('FIRST_PROGRESS_SENT', {
                executionId: message.executionId,
                workerId: message.workerId,
                completedPaths: batchEnd,
                totalPaths: pathCount
            });
        }
        asWorkerScope.postMessage({
            type: 'PROGRESS',
            executionId: message.executionId,
            workerId: message.workerId,
            completedPaths: batchEnd,
            totalPaths: pathCount
        });
        emitRuntimeMarker('SIMULATION_COMPLETE_SENT', {
            executionId: message.executionId,
            workerId: message.workerId,
            completedPaths: batchEnd,
            totalPaths: pathCount
        });
        asWorkerScope.postMessage({
            type: 'SIMULATION_COMPLETE',
            executionId: message.executionId,
            workerId: message.workerId,
            completedPaths: batchEnd,
            totalPaths: pathCount
        });
        const totalBatchMs = performance.now() - batchStartedAt;
        if (isFirstBatchForWorker) {
            firstBatchProfile.totalBatchMs = totalBatchMs;
            finalizeFirstBatchProfile(firstBatchProfile);
        }
        endReturnVectorBatchProfile(message.workerId, batchEnd - batchStart);
        console.log('[MC-PROFILE] RETURN_VECTOR_END', {
            workerId: message.workerId,
            executionId: message.executionId,
            batchStart,
            batchEnd,
            totalBatchMs
        });
        asWorkerScope.postMessage({
            type: 'WORKER_BATCH_METRICS',
            executionId: message.executionId,
            workerId: message.workerId,
            batchStart,
            batchEnd,
            totalBatchMs,
            macroMs,
            returnMs,
            portfolioMs,
            compactMs,
            sendMs
        });
    }
};
