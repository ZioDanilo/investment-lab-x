"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const monte_carlo_statistics_engine_1 = require("./monte-carlo-statistics.engine");
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
    strict_1.default.equal(monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.calculateTrimmedMean5Percent(values), expected);
};
const testPercentiles = () => {
    const values = [0, 10, 20, 30, 40];
    strict_1.default.equal(monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.calculateLinearPercentile(values, 25), 10);
    strict_1.default.equal(monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.calculateLinearPercentile(values, 50), 20);
    strict_1.default.equal(monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.calculateLinearPercentile([0, 10, 20, 30], 50), 15);
};
const testCagrZero = () => {
    const cagr = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.calculatePathCagr(100, 0, 5);
    strict_1.default.equal(cagr, -1);
};
const testCagrTotalReturnIdentity = () => {
    const initialCapital = 100;
    const finalCapital = 180;
    const horizonYears = 3;
    const cagr = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.calculatePathCagr(initialCapital, finalCapital, horizonYears);
    const totalReturn = finalCapital / initialCapital - 1;
    strict_1.default.ok(Math.abs((1 + cagr) - Math.pow(1 + totalReturn, 1 / horizonYears)) < 1e-9);
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
    const vol = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.calculatePathVolatility(monthly.map((entry) => entry.portfolioReturn));
    strict_1.default.ok(Number.isFinite(vol));
    strict_1.default.ok(vol > 0);
};
const testRecoveryOnlyCompleted = () => {
    const paths = [
        makePath(1, 90, 0.10, -0.10, 2, [{ month: 1, year: 1, portfolioReturn: -0.2, endingCapital: 80 }, { month: 2, year: 1, portfolioReturn: 0.25, endingCapital: 100 }]),
        makePath(2, 110, 0.20, 0.10, null, [{ month: 1, year: 1, portfolioReturn: -0.2, endingCapital: 80 }, { month: 2, year: 1, portfolioReturn: 0.1, endingCapital: 88 }]),
        makePath(3, 130, 0.30, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: -0.5, endingCapital: 50 }, { month: 2, year: 1, portfolioReturn: 0.4, endingCapital: 70 }, { month: 3, year: 1, portfolioReturn: 0.3, endingCapital: 91 }, { month: 4, year: 1, portfolioReturn: 0.4, endingCapital: 127.4 }])
    ];
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    strict_1.default.equal(result.mainKpis.recoveryTimeMonths, trimMean([2, 3]));
    strict_1.default.equal(result.percentiles.recoveryTimeMonths?.p50, percentile([2, 3], 50));
};
const testP50EqualsMedianCagr = () => {
    const values = [-1, -0.2, 0.1, 0.3, 0.4];
    const median = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.calculateMedian(values);
    const set = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildPercentileSet(values);
    strict_1.default.equal(set.p50, median);
};
const testZeroAndMinus100Percentiles = () => {
    const values = [-1, 0, 0.2, 0.5];
    const set = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildPercentileSet(values);
    strict_1.default.equal(set.p5, percentile(values, 5));
    strict_1.default.equal(set.p95, percentile(values, 95));
};
const testCapitalFanAndRepresentativePath = () => {
    const worstA = makePath(1, 70, 0.70, -0.20, 6, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: -0.05, endingCapital: 95 - i * 2 })));
    const worstB = makePath(2, 75, 0.75, -0.10, 4, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: -0.04, endingCapital: 96 - i * 2 })));
    const best = makePath(3, 140, 0.10, 0.40, 1, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: 0.02, endingCapital: 100 + i * 2 })));
    const median = makePath(4, 110, 0.20, 0.10, 2, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 1, portfolioReturn: 0.01, endingCapital: 100 + i })));
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult([worstA, worstB, best, median], 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    strict_1.default.ok(result.capitalFan.length === 1);
    strict_1.default.ok(result.capitalFan[0].capitalP5 <= result.capitalFan[0].capitalP50);
    strict_1.default.equal(result.representativePath.simulationId, 2);
};
const testStatisticsAndTechnicalChecks = () => {
    const paths = [
        makePath(1, 100, 0.15, 0.00, 2, [{ month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 10 }, { month: 2, year: 1, portfolioReturn: -0.01, endingCapital: 100, intensity: 30 }]),
        makePath(2, 120, 0.20, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: 0.02, endingCapital: 102, intensity: 40 }, { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 104, intensity: 50 }]),
        makePath(3, 0, 1.00, -1, null, [{ month: 1, year: 1, portfolioReturn: -1, endingCapital: 0, intensity: 90 }, { month: 2, year: 1, portfolioReturn: 0.00, endingCapital: 0, intensity: 95 }])
    ];
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    strict_1.default.ok('scenario' in result.statistics && 'intensity' in result.statistics && 'correlations' in result.statistics);
    strict_1.default.equal(result.technicalChecks.passed, true);
};
const testIntensityStatsUseDecimalBandsAndMean = () => {
    const paths = [
        makePath(1, 100, 0.15, 0.0, 2, [{ month: 1, year: 1, portfolioReturn: 0.01, endingCapital: 101, intensity: 0.1 }, { month: 2, year: 1, portfolioReturn: -0.01, endingCapital: 100, intensity: 0.3 }]),
        makePath(2, 120, 0.20, 0.20, 3, [{ month: 1, year: 1, portfolioReturn: 0.02, endingCapital: 102, intensity: 0.5 }, { month: 2, year: 1, portfolioReturn: 0.02, endingCapital: 104, intensity: 0.7 }]),
        makePath(3, 0, 1.00, -1, null, [{ month: 1, year: 1, portfolioReturn: -1, endingCapital: 0, intensity: 0.9 }, { month: 2, year: 1, portfolioReturn: 0.00, endingCapital: 0, intensity: 1.0 }])
    ];
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    const distribution = result.statistics.intensity.distribution;
    const expectedMean = (0.1 + 0.3 + 0.5 + 0.7 + 0.9 + 1.0) / 6;
    strict_1.default.ok(Math.abs(distribution.mean - expectedMean) < 1e-9, `expected decimal mean ${expectedMean}, got ${distribution.mean}`);
    strict_1.default.equal(distribution.bands['0-20'], 1);
    strict_1.default.equal(distribution.bands['20-40'], 1);
    strict_1.default.equal(distribution.bands['40-60'], 1);
    strict_1.default.equal(distribution.bands['60-80'], 1);
    strict_1.default.equal(distribution.bands['80-100'], 2);
    const bandTotal = Object.values(distribution.bands).reduce((sum, value) => sum + value, 0);
    strict_1.default.equal(bandTotal, 6);
};
const testMissingKpiInputAndInvalidMaxDrawdownFailFast = () => {
    const paths = [makePath(1, 110, 0.10, 0.10, 2)];
    strict_1.default.throws(() => monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4 }), /longTermExpectedReturn/i);
    const badPath = makePath(1, 110, 2.0, 0.10, 2);
    strict_1.default.throws(() => monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult([badPath], 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }), /invalid maxDrawdown/i);
};
const testRecoveryZeroIsAllowedOnlyForCompletedRecovery = () => {
    const paths = [
        makePath(1, 100, 0.10, 0.00, null),
        makePath(2, 100, 0.20, 0.00, 0)
    ];
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    strict_1.default.equal(result.mainKpis.recoveryTimeMonths, 0);
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
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }, diagnostics);
    strict_1.default.ok(Math.abs(result.statistics.correlations.pearsonPrimary[0][1] - 0.75) < 1e-9);
    strict_1.default.ok(Math.abs(result.statistics.correlations.lowerTailDependence5[0][1] - 0.2) < 1e-9);
    strict_1.default.ok(Math.abs(result.statistics.generalComparison.targetExpectedReturnDelta - 0.01) < 1e-9);
    strict_1.default.ok(Math.abs(result.statistics.generalComparison.targetVolatilityDelta + 0.01) < 1e-9);
};
const testMatricesCoherentFalseIsFalsifiable = () => {
    const paths = [makePath(1, 110, 0.10, 0.10, 2), makePath(2, 120, 0.20, 0.20, 3)];
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult(paths, 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 }, { matricesCoherent: false });
    strict_1.default.equal(result.technicalChecks.matricesCoherent, false);
    strict_1.default.equal(result.technicalChecks.passed, false);
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
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    strict_1.default.ok(Math.abs(result.statistics.returnGeneration.oldRangeViolationRate - (3 / 9)) < 1e-9);
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
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult([path], 8, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    strict_1.default.ok(Math.abs(result.statistics.scenario.duration.averageMonthsPerScenario - 11.5) < 1e-9);
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
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    strict_1.default.ok(Math.abs(result.statistics.correlations.pearsonPrimary[0][1] - 0.5) < 1e-9);
    strict_1.default.ok(Math.abs(result.statistics.generalComparison.targetExpectedReturnDelta - 0.01) < 1e-9);
    strict_1.default.ok(Math.abs(result.statistics.generalComparison.targetVolatilityDelta + 0.01) < 1e-9);
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
    const result = monte_carlo_statistics_engine_1.MonteCarloStatisticsEngine.buildOfficialResult([path], 1, 100, { weightedAverageScenarioCorrelation: 0.2, maxScenarioCorrelation: 0.4, longTermExpectedReturn: 0.08 });
    strict_1.default.ok(Number.isFinite(result.mainKpis.robustCagr));
    strict_1.default.ok(Number.isFinite(result.statistics.returns.minimumMonthlyReturn));
    strict_1.default.ok(Number.isFinite(result.statistics.returns.maximumMonthlyReturn));
};
const tests = [
    testTrimmedMean,
    testPercentiles,
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
    testCorrelationDiagnosticsAndGeneralBenchmark,
    testMatricesCoherentFalseIsFalsifiable,
    testOldRangeViolationRateUsesCandidateReturnCount,
    testAverageMonthsPerScenarioUsesObservedDurations,
    testCorrelationDiagnosticsAndGeneralBenchmarkCanBeDerivedFromPathFallback
];
for (const test of tests) {
    test();
}
console.log('Step 8 Monte Carlo aggregation tests passed.');
