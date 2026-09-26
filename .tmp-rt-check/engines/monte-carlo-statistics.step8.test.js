import assert from 'node:assert/strict';
import { buildDeltaMatrix, buildScenarioErrorSummary } from './monte-carlo-worker';
import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';
const makePath = (simulationId, finalCapital, maxDrawdown, cagr, maxRecoveryTimeMonths, monthly = []) => ({
    simulationId,
    dominantEtfIsin: 'A',
    dominantEtfName: 'A',
    initialCapital: 100,
    finalCapital,
    totalReturn: finalCapital / 100 - 1,
    cagr,
    maxDrawdown,
    maxRecoveryTimeMonths,
    unrecovered: false,
    unrecoveredDurationMonths: null,
    monthly,
    years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [], portfolioReturn: finalCapital / 100 - 1, startingCapital: 100, endingCapital: finalCapital, runningPeak: 100, drawdown: finalCapital / 100 - 1 }],
    scenarioPath: { years: [], frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } },
    portfolioSnapshot: { generatedAt: new Date().toISOString(), positions: [], totalWeightBeforeNormalization: 1, normalized: true }
});
const trimMean = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const k = Math.floor(sorted.length * 0.05);
    if (k === 0)
        return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const trimmed = sorted.slice(k, sorted.length - k);
    return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
};
const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1)
        return sorted[0];
    const pos = (sorted.length - 1) * (p / 100);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi)
        return sorted[lo];
    const fraction = pos - lo;
    return sorted[lo] + (sorted[hi] - sorted[lo]) * fraction;
};
const testTrimmedMean = () => {
    const values = [-0.5, -0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
    const expected = trimMean(values);
    assert.equal(MonteCarloStatisticsEngine.calculateTrimmedMean5Percent(values), expected);
};
const testPercentiles = () => {
    const values = [0, 10, 20, 30, 40];
    assert.equal(MonteCarloStatisticsEngine.calculateLinearPercentile(values, 25), 10);
    assert.equal(MonteCarloStatisticsEngine.calculateLinearPercentile(values, 50), 20);
    assert.equal(MonteCarloStatisticsEngine.calculateLinearPercentile([0, 10, 20, 30], 50), 15);
};
const testCagrZero = () => {
    const cagr = MonteCarloStatisticsEngine.calculatePathCagr(100, 0, 5);
    assert.equal(cagr, -1);
};
const testCagrTotalReturnIdentity = () => {
    const initialCapital = 100;
    const finalCapital = 180;
    const horizonYears = 3;
    const cagr = MonteCarloStatisticsEngine.calculatePathCagr(initialCapital, finalCapital, horizonYears);
    const totalReturn = finalCapital / initialCapital - 1;
    assert.ok(Math.abs((1 + cagr) - Math.pow(1 + totalReturn, 1 / horizonYears)) < 1e-9);
};
const testRobustMaxDrawdownAndVolatility = () => {
    const monthly = [
        { month: 1, year: 1, portfolioReturn: 0.02, endingCapital: 102 },
        { month: 2, year: 1, portfolioReturn: -0.10, endingCapital: 91.8 },
        { month: 3, year: 1, portfolioReturn: 0.05, endingCapital: 96.39 },
        { month: 4, year: 1, portfolioReturn: 0.03, endingCapital: 99.30 },
        { month: 5, year: 1, portfolioReturn: 0.04, endingCapital: 103.27 },
        { month: 6, year: 1, portfolioReturn: 0.06, endingCapital: 109.47 },
    ];
    const vol = MonteCarloStatisticsEngine.calculatePathVolatility(monthly.map((entry) => entry.portfolioReturn));
    assert.ok(Number.isFinite(vol));
    assert.ok(vol > 0);
};
const testRecoveryOnlyCompleted = () => {
    const paths = [
        makePath(1, 90, 0.10, -0.10, 2, [{ month: 1, year: 1, portfolioReturn: -0.2, endingCapital: 80 }, { month: 2, year: 1, portfolioReturn: 0.25, endingCapital: 100 }]),
        makePath(2, 110, 0.20, 0.10, null, [{ month: 1, year: 1, portfolioReturn: -0.2, endingCapital: 80 }, { month: 2, year: 1, portfolioReturn: 0.1, endingCapital: 88 }]),
        makePath(3, 130, 0.30, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: -0.5, endingCapital: 50 }, { month: 2, year: 1, portfolioReturn: 0.4, endingCapital: 70 }, { month: 3, year: 1, portfolioReturn: 0.3, endingCapital: 91 }, { month: 4, year: 1, portfolioReturn: 0.4, endingCapital: 127.4 }])
    ];
    const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { advancedStatisticsEnabled: true });
    assert.equal(result.mainKpis.recoveryTimeMonths, trimMean([2, 3]));
    assert.equal(result.percentiles.recoveryTimeMonths?.p50, percentile([2, 3], 50));
};
const testRecoveryIncludesPreviousCompletedRecoveryBeforeOpenFinalDrawdown = () => {
    const previousCompletedRecovery = makePath(1, 100, 0.20, 0.00, 41, [{ month: 1, year: 1, portfolioReturn: -0.2, endingCapital: 80 }, { month: 2, year: 1, portfolioReturn: 0.15, endingCapital: 92 }, { month: 3, year: 1, portfolioReturn: 0.10, endingCapital: 101 }]);
    previousCompletedRecovery.unrecovered = true;
    previousCompletedRecovery.unrecoveredDurationMonths = 14;
    const noCompletedRecovery = makePath(2, 90, 0.25, -0.10, null, [{ month: 1, year: 1, portfolioReturn: -0.4, endingCapital: 60 }, { month: 2, year: 1, portfolioReturn: -0.1, endingCapital: 54 }]);
    noCompletedRecovery.unrecovered = true;
    noCompletedRecovery.unrecoveredDurationMonths = 18;
    const result = MonteCarloStatisticsEngine.buildOfficialResult([previousCompletedRecovery, noCompletedRecovery], 1, 100, { advancedStatisticsEnabled: true });
    assert.equal(result.mainKpis.recoveryTimeMonths, 41);
    assert.equal(result.percentiles.recoveryTimeMonths?.p50, 41);
};
const testRecoveryExcludesPathsWithZeroCompletedRecovery = () => {
    const paths = [
        makePath(1, 90, 0.25, -0.10, null, [{ month: 1, year: 1, portfolioReturn: -0.25, endingCapital: 75 }, { month: 2, year: 1, portfolioReturn: -0.05, endingCapital: 71 }]),
        makePath(2, 115, 0.20, 0.15, 12, [{ month: 1, year: 1, portfolioReturn: -0.2, endingCapital: 80 }, { month: 2, year: 1, portfolioReturn: 0.25, endingCapital: 100 }, { month: 3, year: 1, portfolioReturn: 0.15, endingCapital: 115 }])
    ];
    const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { advancedStatisticsEnabled: true });
    assert.equal(result.mainKpis.recoveryTimeMonths, 12);
};
const testNormalizeDrawdownTo30Years = () => {
    const representativeValues = [0, 0.10, 0.25, 0.50, 0.80, 0.99, 1.00];
    for (const dd of representativeValues) {
        assert.ok(Math.abs(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(dd, 30) - dd) < 1e-12, `30Y identity failed for ${dd}`);
    }
    for (const horizon of [10, 20, 30, 40, 50, 75, 100]) {
        for (const dd of [0, 0.1, 0.25, 0.5, 0.8, 0.99, 1]) {
            const normalized = MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(dd, horizon);
            assert.ok(Number.isFinite(normalized));
            assert.ok(normalized >= 0 && normalized <= 1, `boundedness failed for dd=${dd} horizon=${horizon} value=${normalized}`);
            assert.ok(Math.abs(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(0, horizon)) < 1e-12, `zero boundary failed for ${horizon}`);
            assert.ok(Math.abs(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(1, horizon) - 1) < 1e-12, `one boundary failed for ${horizon}`);
        }
    }
    const dd = 0.25;
    assert.ok(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(dd, 10) > dd);
    assert.ok(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(dd, 20) > dd);
    assert.ok(Math.abs(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(dd, 30) - dd) < 1e-12);
    assert.ok(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(dd, 40) < dd);
    assert.ok(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(dd, 50) < dd);
    assert.ok(MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(dd, 100) < dd);
};
const testQ95AndWorstCaseUseSevereTailForPositiveMagnitude = () => {
    const drawdowns = [0.05, 0.08, 0.12, 0.17, 0.23, 0.31, 0.42, 0.64];
    const q95 = MonteCarloStatisticsEngine.calculateLinearPercentile(drawdowns, 95);
    const worst = Math.max(...drawdowns);
    assert.ok(q95 < worst);
    for (const horizon of [10, 20, 30, 40, 50, 75, 100]) {
        const qNormalized = MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(q95, horizon);
        const wNormalized = MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(worst, horizon);
        assert.ok(wNormalized >= qNormalized, `ordering not preserved for horizon=${horizon}`);
    }
};
const testPreviousLinearScalingWouldExceedOne = () => {
    const rawWorst = 0.90;
    const horizon = 10;
    const oldResult = rawWorst * Math.pow(30 / horizon, 0.20);
    const newResult = MonteCarloStatisticsEngine.normalizeDrawdownTo30Years(rawWorst, horizon);
    assert.ok(oldResult > 1, `old scaling should exceed 1, got ${oldResult}`);
    assert.ok(newResult < 1, `new bounded normalization should stay below 1, got ${newResult}`);
    assert.ok(Math.abs(newResult - (1 - Math.pow(1 - rawWorst, Math.pow(30 / horizon, 0.20)))) < 1e-12);
    console.log(`Regression rawWorst=${rawWorst} horizon=${horizon} old=${oldResult.toFixed(6)} new=${newResult.toFixed(6)}`);
};
const testP50EqualsMedianCagr = () => {
    const values = [-1, -0.2, 0.1, 0.3, 0.4];
    const median = MonteCarloStatisticsEngine.calculateMedian(values);
    const set = MonteCarloStatisticsEngine.buildPercentileSet(values);
    assert.equal(set.p50, median);
};
const testZeroAndMinus100Percentiles = () => {
    const values = [-1, 0, 0.2, 0.5];
    const set = MonteCarloStatisticsEngine.buildPercentileSet(values);
    assert.equal(set.p5, percentile(values, 5));
    assert.equal(set.p95, percentile(values, 95));
};
const testCapitalFanAndRepresentativePath = () => {
    const worstA = makePath(1, 70, 0.70, -0.20, 6, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: -0.05, endingCapital: 95 - i * 2 })));
    const worstB = makePath(2, 75, 0.75, -0.10, 4, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: -0.04, endingCapital: 96 - i * 2 })));
    const best = makePath(3, 140, 0.10, 0.40, 1, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: 0.02, endingCapital: 100 + i * 2 })));
    const median = makePath(4, 110, 0.20, 0.10, 2, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: 0.01, endingCapital: 100 + i })));
    const result = MonteCarloStatisticsEngine.buildOfficialResult([worstA, worstB, best, median], 1, 100, { advancedStatisticsEnabled: true });
    assert.ok(result.capitalFan.length === 1);
    assert.ok(result.capitalFan[0].capitalP5 <= result.capitalFan[0].capitalP50);
    assert.equal(result.representativePath.simulationId, 2);
};
const testStatisticsAndTechnicalChecks = () => {
    const paths = [
        makePath(1, 100, 0.15, 0.00, 2, [{ month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 10 }, { month: 2, year: 1, portfolioReturn: -0.01, endingCapital: 100, intensity: 30 }]),
        makePath(2, 120, 0.20, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: 0.02, endingCapital: 102, intensity: 40 }, { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 104, intensity: 50 }]),
        makePath(3, 0, 1.00, -1, null, [{ month: 1, year: 1, portfolioReturn: -1, endingCapital: 0, intensity: 90 }, { month: 2, year: 1, portfolioReturn: 0.00, endingCapital: 0, intensity: 95 }])
    ];
    const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { advancedStatisticsEnabled: true });
    assert.ok('scenario' in result.statistics && 'intensity' in result.statistics && 'correlations' in result.statistics);
    assert.equal(result.technicalChecks.passed, true);
};
const testIntensityStatsUseDecimalBandsAndMean = () => {
    const paths = [
        makePath(1, 100, 0.15, 0.0, 2, [{ month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 0.1 }, { month: 2, year: 1, portfolioReturn: -0.01, endingCapital: 100, intensity: 0.3 }]),
        makePath(2, 120, 0.20, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: 0.02, endingCapital: 102, intensity: 0.5 }, { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 104, intensity: 0.7 }]),
        makePath(3, 0, 1.00, -1, null, [{ month: 1, year: 1, portfolioReturn: -1, endingCapital: 0, intensity: 0.9 }, { month: 2, year: 1, portfolioReturn: 0.00, endingCapital: 0, intensity: 1.0 }])
    ];
    const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { advancedStatisticsEnabled: true });
    const distribution = result.statistics.intensity.distribution;
    const expectedMean = (0.1 + 0.3 + 0.5 + 0.7 + 0.9 + 1.0) / 6;
    assert.ok(Math.abs(distribution.mean - expectedMean) < 1e-9, `expected decimal mean ${expectedMean}, got ${distribution.mean}`);
    assert.equal(distribution.bands['0-20'], 1);
    assert.equal(distribution.bands['20-40'], 1);
    assert.equal(distribution.bands['40-60'], 1);
    assert.equal(distribution.bands['60-80'], 1);
    assert.equal(distribution.bands['80-100'], 2);
    const bandTotal = Object.values(distribution.bands).reduce((sum, value) => sum + value, 0);
    assert.equal(bandTotal, 6);
};
const testMissingKpiInputAndInvalidMaxDrawdownFailFast = () => {
    const paths = [makePath(1, 110, 0.10, 0.10, 2)];
    assert.doesNotThrow(() => MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { advancedStatisticsEnabled: true }));
    const badPath = makePath(1, 110, 2.0, 0.10, 2);
    assert.throws(() => MonteCarloStatisticsEngine.buildOfficialResult([badPath], 1, 100, { advancedStatisticsEnabled: true }), /invalid maxDrawdown/i);
};
const testRecoveryZeroIsAllowedOnlyForCompletedRecovery = () => {
    const paths = [
        makePath(1, 100, 0.10, 0.00, null),
        makePath(2, 100, 0.20, 0.00, 0)
    ];
    const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { advancedStatisticsEnabled: true });
    assert.equal(result.mainKpis.recoveryTimeMonths, 0);
};
const testDeltaMatrix = () => {
    const empirical = [[1, 0.8, 0.2], [0.8, 1, 0.6], [0.2, 0.6, 1]];
    const target = [[1, 0.5, 0.1], [0.5, 1, 0.3], [0.1, 0.3, 1]];
    const deltas = buildDeltaMatrix(empirical, target);
    assert.ok(Math.abs(deltas[0][1] - 0.3) < 1e-9);
    assert.ok(Math.abs(deltas[1][0] - 0.3) < 1e-9);
    assert.ok(Math.abs(deltas[0][0]) < 1e-9);
    assert.ok(Math.abs(deltas[2][1] - 0.3) < 1e-9);
};
const testAbsoluteDeltaMatrix = () => {
    const empirical = [[1, -0.2], [-0.2, 1]];
    const target = [[1, 0.5], [0.5, 1]];
    const absolute = buildDeltaMatrix(empirical, target, true);
    assert.ok(Math.abs(absolute[0][1] - 0.7) < 1e-9);
    assert.ok(Math.abs(absolute[1][0] - 0.7) < 1e-9);
};
const testScenarioErrorSummary = () => {
    const target = [[1, 0.5, 0.2], [0.5, 1, 0.4], [0.2, 0.4, 1]];
    const empirical = [[1, 0.8, 0.3], [0.8, 1, 0.1], [0.3, 0.1, 1]];
    const summary = buildScenarioErrorSummary(target, empirical);
    assert.ok(Math.abs(summary.mae - (0.3 + 0.1 + 0.3) / 3 / 1) < 1e-9);
    assert.ok(Math.abs(summary.rmse - Math.sqrt((0.09 + 0.01 + 0.09) / 3)) < 1e-9);
    assert.ok(Math.abs(summary.maxAbsoluteError - 0.3) < 1e-9);
};
const testUniqueOffDiagonalPairs = () => {
    const target = [[1, 0.7, 0.4], [0.7, 1, 0.6], [0.4, 0.6, 1]];
    const empirical = [[1, 0.9, 0.3], [0.9, 1, 0.2], [0.3, 0.2, 1]];
    const summary = buildScenarioErrorSummary(target, empirical);
    assert.ok(Math.abs(summary.maxAbsoluteError - 0.4) <= 1e-12);
    assert.ok(summary.mae > 0);
    assert.ok(summary.rmse > 0);
};
const testScenarioSeparation = () => {
    const expansionTarget = [[1, 0.5, 0.2], [0.5, 1, 0.4], [0.2, 0.4, 1]];
    const expansionEmpirical = [[1, 0.8, 0.3], [0.8, 1, 0.1], [0.3, 0.1, 1]];
    const recessionTarget = [[1, 0.1, 0.2], [0.1, 1, 0.3], [0.2, 0.3, 1]];
    const recessionEmpirical = [[1, 0.3, 0.1], [0.3, 1, 0.2], [0.1, 0.2, 1]];
    const expansionSummary = buildScenarioErrorSummary(expansionTarget, expansionEmpirical);
    const recessionSummary = buildScenarioErrorSummary(recessionTarget, recessionEmpirical);
    assert.ok(expansionSummary.maxAbsoluteError > recessionSummary.maxAbsoluteError);
};
const testDiagnosticRngIsolation = () => {
    const originalRandom = Math.random;
    Math.random = () => {
        throw new Error('random should not be consumed by diagnostics');
    };
    try {
        const target = [[1, 0.5], [0.5, 1]];
        const empirical = [[1, 0.8], [0.8, 1]];
        const deltas = buildDeltaMatrix(empirical, target, false);
        const absolute = buildDeltaMatrix(empirical, target, true);
        const summary = buildScenarioErrorSummary(target, empirical);
        assert.ok(Math.abs(deltas[0][1] - 0.3) < 1e-9);
        assert.ok(Math.abs(absolute[0][1] - 0.3) < 1e-9);
        assert.ok(summary.mae > 0);
    }
    finally {
        Math.random = originalRandom;
    }
};
const testCorrelationDiagnosticsAndGeneralBenchmark = () => {
    const paths = [
        makePath(1, 110, 0.10, 0.10, 2),
        makePath(2, 120, 0.20, 0.20, 3),
        makePath(3, 90, 0.30, -0.10, 4)
    ];
    const diagnostics = {
        correlations: {
            target: [[1, 0.5], [0.5, 1]],
            operational: [[1, 0.6], [0.6, 1]],
            latent: [[1, 0.4], [0.4, 1]],
            empiricalLatentShock: [[1, 0.7], [0.7, 1]],
            empiricalReturn: [[1, 0.8], [0.8, 1]],
            pearsonPrimary: [[1, 0.75], [0.75, 1]],
            spearmanDiagnostic: [[1, 0.65], [0.65, 1]],
            lowerTailDependence5: [[1, 0.2], [0.2, 1]],
            upperTailDependence5: [[1, 0.3], [0.3, 1]],
            deltas: [[0, 0.1], [0.1, 0]],
            absoluteDeltas: [[0, 0.1], [0.1, 0]],
            maeByScenario: { expansion: 0.01, recession: 0.02 },
            rmseByScenario: { expansion: 0.02, recession: 0.03 },
            maxAbsoluteErrorByScenario: { expansion: 0.04, recession: 0.05 }
        },
        generalBenchmark: {
            expectedReturn: 0.08,
            volatility: 0.12,
            simulatedLongTermReturn: 0.09,
            simulatedVolatility: 0.11
        }
    };
    const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { advancedStatisticsEnabled: true, correlationDiagnostics: diagnostics.correlations, generalBenchmark: diagnostics.generalBenchmark }, undefined);
    assert.ok(Math.abs(result.statistics.correlations.pearsonPrimary[0][1] - 0.75) < 1e-9);
    assert.ok(Math.abs(result.statistics.correlations.lowerTailDependence5[0][1] - 0.2) < 1e-9);
    assert.ok(Math.abs(result.statistics.generalComparison.targetExpectedReturnDelta - 0.01) < 1e-9);
    assert.ok(Math.abs(result.statistics.generalComparison.targetVolatilityDelta + 0.01) < 1e-9);
};
const testMatricesCoherentFalseIsFalsifiable = () => {
    const paths = [makePath(1, 110, 0.10, 0.10, 2), makePath(2, 120, 0.20, 0.20, 3)];
    const result = MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { advancedStatisticsEnabled: true, matricesCoherent: false });
    assert.equal(result.technicalChecks.matricesCoherent, false);
    assert.equal(result.technicalChecks.passed, false);
};
const testOldRangeViolationRateUsesCandidateReturnCount = () => {
    const path = makePath(1, 110, 0.10, 0.10, 2, [{ month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 0.5 }]);
    path.returnDiagnostics = {
        candidateVectors: 1,
        acceptedVectors: 1,
        rejectedVectors: 0,
        physicalFloorRejectedVectors: 0,
        oldRangeViolationCount: 3,
        effectiveRangeRejectedVectors: 0,
        byEtfScenario: {
            'ETF-A|expansion': {
                candidateReturnCount: 9,
                belowEffectiveMinCount: 3,
                aboveEffectiveMaxCount: 0,
                lowerRejectRate: 0.3333333333333333,
                upperRejectRate: 0,
                totalOutOfRangeRate: 0.3333333333333333,
                meanLowerDistanceSigma: 1,
                meanUpperDistanceSigma: null
            }
        }
    };
    const result = MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { advancedStatisticsEnabled: true });
    assert.ok(Math.abs(result.statistics.returnGeneration.oldRangeViolationRate - (3 / 9)) < 1e-9);
};
const testAverageMonthsPerScenarioUsesObservedDurations = () => {
    const path = makePath(1, 110, 0.10, 0.10, 2, [{ month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 0.5 }]);
    path.scenarioPath = {
        years: [
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 12 },
            { year: 2, scenario: 'expansion', durationInCurrentScenario: 18 },
            { year: 3, scenario: 'recession', durationInCurrentScenario: 8 },
            { year: 4, scenario: 'recession', durationInCurrentScenario: 10 },
            { year: 5, scenario: 'stagflation', durationInCurrentScenario: 6 },
            { year: 6, scenario: 'stagflation', durationInCurrentScenario: 14 },
            { year: 7, scenario: 'soft_landing', durationInCurrentScenario: 20 },
            { year: 8, scenario: 'soft_landing', durationInCurrentScenario: 4 }
        ],
        frequencies: { expansion: 2, recession: 2, stagflation: 2, soft_landing: 2 }
    };
    const result = MonteCarloStatisticsEngine.buildOfficialResult([path], 8, 100, { advancedStatisticsEnabled: true });
    assert.ok(Math.abs(result.statistics.scenario.duration.averageMonthsPerScenario - 11.5) < 1e-9);
};
const testCorrelationDiagnosticsAndGeneralBenchmarkCanBeDerivedFromPathFallback = () => {
    const path = makePath(1, 110, 0.10, 0.10, 2);
    path.correlationDiagnostics = {
        pearsonPrimary: [[1, 0.5], [0.5, 1]],
        lowerTailDependence5: [[1, 0.2], [0.2, 1]],
        upperTailDependence5: [[1, 0.3], [0.3, 1]]
    };
    path.generalBenchmark = {
        expectedReturn: 0.08,
        volatility: 0.12,
        simulatedLongTermReturn: 0.09,
        simulatedVolatility: 0.11
    };
    const result = MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { advancedStatisticsEnabled: true, correlationDiagnostics: path.correlationDiagnostics, generalBenchmark: path.generalBenchmark });
    assert.ok(Math.abs(result.statistics.correlations.pearsonPrimary[0][1] - 0.5) < 1e-9);
    assert.ok(Math.abs(result.statistics.generalComparison.targetExpectedReturnDelta - 0.01) < 1e-9);
    assert.ok(Math.abs(result.statistics.generalComparison.targetVolatilityDelta + 0.01) < 1e-9);
};
const testLargeMonthlyArrayDoesNotOverflow = () => {
    const hugeMonthly = Array.from({ length: 500_000 }, (_, index) => ({
        month: index + 1,
        year: 1,
        portfolioReturn: index % 2 === 0 ? 0.02 : -0.01,
        endingCapital: 100 + (index * 0.01),
        capital: 100 + (index * 0.01),
        intensity: 0.5
    }));
    const path = makePath(1, 100 + (hugeMonthly.length * 0.01), 0.2, 0.08, 2, hugeMonthly);
    const result = MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { advancedStatisticsEnabled: true });
    assert.ok(Number.isFinite(result.mainKpis.robustCagr));
    assert.ok(Number.isFinite(result.statistics.returns.minimumMonthlyReturn));
    assert.ok(Number.isFinite(result.statistics.returns.maximumMonthlyReturn));
};
const testMacroEpisodeReconstruction = () => {
    const path = makePath(1, 100, 0.2, 0.0, 2, [
        { month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 0.2 },
        { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 103, intensity: 0.3 },
        { month: 3, year: 1, portfolioReturn: -0.01, endingCapital: 102, intensity: 0.8 },
        { month: 4, year: 1, portfolioReturn: 0.01, endingCapital: 103, intensity: 0.9 },
        { month: 5, year: 1, portfolioReturn: 0.03, endingCapital: 106, intensity: 0.1 }
    ]);
    path.scenarioPath = {
        years: [
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 99 },
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 99 },
            { year: 1, scenario: 'recession', durationInCurrentScenario: 99 },
            { year: 1, scenario: 'recession', durationInCurrentScenario: 99 },
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 99 }
        ],
        frequencies: { expansion: 3, recession: 2, stagflation: 0, soft_landing: 0 }
    };
    const result = MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { advancedStatisticsEnabled: true });
    const macro = result.statistics.macro;
    assert.equal(macro.expansion.numberOfEpisodes, 2);
    assert.equal(macro.expansion.totalScenarioMonths, 3);
    assert.equal(macro.expansion.averageEpisodeDuration, 1.5);
    assert.equal(macro.expansion.p50Duration, 1.5);
    assert.ok(Math.abs(macro.expansion.p95Duration - 1.95) < 1e-9);
    assert.equal(macro.expansion.maxDuration, 2);
    assert.equal(macro.recession.numberOfEpisodes, 1);
    assert.equal(macro.recession.totalScenarioMonths, 2);
    assert.equal(macro.recession.averageEpisodeDuration, 2);
    assert.equal(macro.recession.p50Duration, 2);
    assert.equal(macro.recession.p95Duration, 2);
    assert.equal(macro.recession.maxDuration, 2);
};
const testMacroIntensityIsScenarioConditioned = () => {
    const path = makePath(1, 100, 0.2, 0.0, 2, [
        { month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 0.1 },
        { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 103, intensity: 0.2 },
        { month: 3, year: 1, portfolioReturn: 0.00, endingCapital: 103, intensity: 0.7 },
        { month: 4, year: 1, portfolioReturn: 0.02, endingCapital: 105, intensity: 0.8 },
        { month: 5, year: 1, portfolioReturn: 0.01, endingCapital: 106, intensity: 0.3 }
    ]);
    path.scenarioPath = {
        years: [
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 1 },
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 2 },
            { year: 1, scenario: 'recession', durationInCurrentScenario: 1 },
            { year: 1, scenario: 'recession', durationInCurrentScenario: 2 },
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 1 }
        ],
        frequencies: { expansion: 3, recession: 2, stagflation: 0, soft_landing: 0 }
    };
    const result = MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { advancedStatisticsEnabled: true });
    const macro = result.statistics.macro;
    assert.ok(Math.abs(macro.expansion.meanIntensity - 0.2) < 1e-9);
    assert.ok(Math.abs(macro.recession.meanIntensity - 0.75) < 1e-9);
    assert.ok(macro.expansion.p95Intensity !== macro.recession.p95Intensity);
};
const testMacroInvariantSumEpisodeDurationsEqualsScenarioMonths = () => {
    const path = makePath(1, 100, 0.2, 0.0, 2, [
        { month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 0.1 },
        { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 103, intensity: 0.2 },
        { month: 3, year: 1, portfolioReturn: 0.00, endingCapital: 103, intensity: 0.7 },
        { month: 4, year: 1, portfolioReturn: 0.02, endingCapital: 105, intensity: 0.8 },
        { month: 5, year: 1, portfolioReturn: 0.01, endingCapital: 106, intensity: 0.3 }
    ]);
    path.scenarioPath = {
        years: [
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 1 },
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 2 },
            { year: 1, scenario: 'recession', durationInCurrentScenario: 1 },
            { year: 1, scenario: 'recession', durationInCurrentScenario: 2 },
            { year: 1, scenario: 'expansion', durationInCurrentScenario: 1 }
        ],
        frequencies: { expansion: 3, recession: 2, stagflation: 0, soft_landing: 0 }
    };
    const result = MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { advancedStatisticsEnabled: true });
    const macro = result.statistics.macro;
    const totalScenarioMonths = Object.keys(macro).reduce((sum, scenario) => sum + macro[scenario].totalScenarioMonths, 0);
    assert.equal(totalScenarioMonths, 5);
    assert.equal(macro.expansion.totalScenarioMonths, 3);
    assert.equal(macro.recession.totalScenarioMonths, 2);
};
const tests = [
    testTrimmedMean,
    testPercentiles,
    testNormalizeDrawdownTo30Years,
    testQ95AndWorstCaseUseSevereTailForPositiveMagnitude,
    testCagrZero,
    testCagrTotalReturnIdentity,
    testRobustMaxDrawdownAndVolatility,
    testRecoveryOnlyCompleted,
    testP50EqualsMedianCagr,
    testZeroAndMinus100Percentiles,
    testCapitalFanAndRepresentativePath,
    testStatisticsAndTechnicalChecks,
    testIntensityStatsUseDecimalBandsAndMean,
    testMissingKpiInputAndInvalidMaxDrawdownFailFast,
    testRecoveryZeroIsAllowedOnlyForCompletedRecovery,
    testDeltaMatrix,
    testAbsoluteDeltaMatrix,
    testScenarioErrorSummary,
    testUniqueOffDiagonalPairs,
    testScenarioSeparation,
    testDiagnosticRngIsolation,
    testCorrelationDiagnosticsAndGeneralBenchmark,
    testMatricesCoherentFalseIsFalsifiable,
    testOldRangeViolationRateUsesCandidateReturnCount,
    testAverageMonthsPerScenarioUsesObservedDurations,
    testCorrelationDiagnosticsAndGeneralBenchmarkCanBeDerivedFromPathFallback,
    testMacroEpisodeReconstruction,
    testMacroIntensityIsScenarioConditioned,
    testMacroInvariantSumEpisodeDurationsEqualsScenarioMonths
];
for (const test of tests) {
    test();
}
console.log('Step 8 Monte Carlo aggregation tests passed.');
