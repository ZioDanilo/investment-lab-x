"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonteCarloStatisticsEngine = void 0;
const monte_carlo_model_1 = require("../models/monte-carlo.model");
/**
 * Computes aggregate statistics from multiple Monte Carlo simulation paths.
 */
class MonteCarloStatisticsEngine {
    static assertFiniteNumber(value, field) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`${field} must be a finite number`);
        }
        return value;
    }
    static assertValidMaxDrawdown(path) {
        const maxDrawdown = path.maxDrawdown;
        if (typeof maxDrawdown !== 'number' || !Number.isFinite(maxDrawdown) || maxDrawdown < 0 || maxDrawdown > 1) {
            throw new Error(`path ${path.simulationId} has invalid maxDrawdown: ${maxDrawdown}`);
        }
        return maxDrawdown;
    }
    static coerceGeneralBenchmark(generalBenchmark) {
        if (!generalBenchmark)
            return undefined;
        if (!Number.isFinite(generalBenchmark.expectedReturn)) {
            throw new Error('generalBenchmark.expectedReturn must be a finite number');
        }
        if (!Number.isFinite(generalBenchmark.volatility)) {
            throw new Error('generalBenchmark.volatility must be a finite number');
        }
        return generalBenchmark;
    }
    static coerceCorrelationInput(decorrelationInput) {
        if (!decorrelationInput) {
            throw new Error('decorrelationInput is required for official Step 8 result');
        }
        const weightedAverageScenarioCorrelation = this.assertFiniteNumber(decorrelationInput.weightedAverageScenarioCorrelation, 'weightedAverageScenarioCorrelation');
        const maxScenarioCorrelation = this.assertFiniteNumber(decorrelationInput.maxScenarioCorrelation, 'maxScenarioCorrelation');
        const longTermExpectedReturn = this.assertFiniteNumber(decorrelationInput.longTermExpectedReturn, 'longTermExpectedReturn');
        if (weightedAverageScenarioCorrelation < 0 || weightedAverageScenarioCorrelation > 1) {
            throw new Error(`weightedAverageScenarioCorrelation must be in [0,1], got ${weightedAverageScenarioCorrelation}`);
        }
        if (maxScenarioCorrelation < 0 || maxScenarioCorrelation > 1) {
            throw new Error(`maxScenarioCorrelation must be in [0,1], got ${maxScenarioCorrelation}`);
        }
        return {
            weightedAverageScenarioCorrelation,
            maxScenarioCorrelation,
            longTermExpectedReturn
        };
    }
    /**
     * Calculate CAGR for a single path.
     * Per spec, finalCapital = 0 leads to exact -1.0 (not NaN/Infinity).
     */
    static calculatePathCagr(initialCapital, finalCapital, horizonYears) {
        if (initialCapital <= 0)
            throw new Error(`initialCapital must be > 0, got ${initialCapital}`);
        if (horizonYears <= 0)
            throw new Error(`horizonYears must be > 0, got ${horizonYears}`);
        if (!isFinite(initialCapital) || isNaN(initialCapital))
            throw new Error(`initialCapital is not finite: ${initialCapital}`);
        if (!isFinite(finalCapital) || isNaN(finalCapital))
            throw new Error(`finalCapital is not finite: ${finalCapital}`);
        if (finalCapital === 0)
            return -1;
        return Math.pow(finalCapital / initialCapital, 1 / horizonYears) - 1;
    }
    static calculateTrimmedMean5Percent(values) {
        if (values.length === 0)
            return 0;
        if (values.length === 1)
            return values[0];
        const sorted = [...values].sort((a, b) => a - b);
        const trimCount = Math.floor(sorted.length * 0.05);
        if (trimCount === 0) {
            return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
        }
        const start = trimCount;
        const end = sorted.length - trimCount;
        if (end <= start)
            return this.calculateMedian(sorted);
        const trimmed = sorted.slice(start, end);
        return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
    }
    /**
     * Calculate the median of an array of numbers.
     * Does NOT modify the original array.
     */
    static calculateMedian(values) {
        if (values.length === 0)
            throw new Error('Cannot calculate median of empty array');
        const sorted = [...values].sort((a, b) => a - b);
        if (sorted.length % 2 === 1) {
            return sorted[Math.floor(sorted.length / 2)];
        }
        const upperIndex = sorted.length / 2;
        const lowerIndex = upperIndex - 1;
        return (sorted[lowerIndex] + sorted[upperIndex]) / 2;
    }
    static calculateLinearPercentile(values, percentile) {
        if (values.length === 0)
            return 0;
        const sorted = [...values].sort((a, b) => a - b);
        if (sorted.length === 1)
            return sorted[0];
        const position = (sorted.length - 1) * (percentile / 100);
        const lowerIndex = Math.floor(position);
        const upperIndex = Math.ceil(position);
        if (lowerIndex === upperIndex)
            return sorted[lowerIndex];
        const lower = sorted[lowerIndex];
        const upper = sorted[upperIndex];
        const weight = position - lowerIndex;
        return lower + (upper - lower) * weight;
    }
    /**
     * Calculate percentile (0–100) from a numeric array.
     * Does NOT modify the original array.
     */
    static calculatePercentile(values, p) {
        return this.calculateLinearPercentile(values, p);
    }
    static computeMin(values, fallback = 0) {
        if (values.length === 0)
            return fallback;
        let min = Number.POSITIVE_INFINITY;
        for (const value of values) {
            if (typeof value !== 'number' || !Number.isFinite(value))
                continue;
            if (value < min)
                min = value;
        }
        return min === Number.POSITIVE_INFINITY ? fallback : min;
    }
    static computeMax(values, fallback = 0) {
        if (values.length === 0)
            return fallback;
        let max = Number.NEGATIVE_INFINITY;
        for (const value of values) {
            if (typeof value !== 'number' || !Number.isFinite(value))
                continue;
            if (value > max)
                max = value;
        }
        return max === Number.NEGATIVE_INFINITY ? fallback : max;
    }
    static calculateSampleStandardDeviation(values) {
        if (values.length <= 1)
            return 0;
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
        return Math.sqrt(variance);
    }
    static calculatePathVolatility(monthlyPortfolioReturns, annualizationFactor = 12) {
        if (monthlyPortfolioReturns.length === 0)
            return 0;
        const sampleStdDev = this.calculateSampleStandardDeviation(monthlyPortfolioReturns);
        return sampleStdDev * Math.sqrt(annualizationFactor);
    }
    static calculatePathCagrFromPath(path, horizonYears) {
        return this.calculatePathCagr(path.initialCapital, path.finalCapital, horizonYears);
    }
    static buildPercentileSet(values) {
        return {
            p5: this.calculateLinearPercentile(values, 5),
            p25: this.calculateLinearPercentile(values, 25),
            p50: this.calculateLinearPercentile(values, 50),
            p75: this.calculateLinearPercentile(values, 75),
            p95: this.calculateLinearPercentile(values, 95)
        };
    }
    static buildCapitalFan(paths, horizonYears) {
        const fan = [];
        for (let year = 1; year <= horizonYears; year += 1) {
            const yearlyCapitals = paths.flatMap((path) => {
                const monthlySeries = Array.isArray(path.monthly) ? path.monthly : [];
                const endOfYearEntry = monthlySeries.filter((monthEntry) => monthEntry.year === year).sort((a, b) => (a.month ?? 0) - (b.month ?? 0)).at(-1);
                if (endOfYearEntry) {
                    const capitalValue = endOfYearEntry.endingCapital ?? endOfYearEntry.capital ?? path.finalCapital;
                    return [capitalValue];
                }
                const annualValue = path.years.find((entry) => entry.year === year)?.endingCapital;
                return annualValue !== undefined ? [annualValue] : [path.finalCapital];
            });
            fan.push({
                year,
                capitalP5: this.calculateLinearPercentile(yearlyCapitals, 5),
                capitalP25: this.calculateLinearPercentile(yearlyCapitals, 25),
                capitalP50: this.calculateLinearPercentile(yearlyCapitals, 50),
                capitalP75: this.calculateLinearPercentile(yearlyCapitals, 75),
                capitalP95: this.calculateLinearPercentile(yearlyCapitals, 95)
            });
        }
        return fan;
    }
    static selectRepresentativePath(paths, medianCagr) {
        if (paths.length === 0) {
            return { simulationId: -1, cagr: 0, maxDrawdown: 0, capital: [] };
        }
        const sortedByMaxDrawdown = [...paths].sort((a, b) => b.maxDrawdown - a.maxDrawdown);
        const bucketSize = Math.max(1, Math.ceil(sortedByMaxDrawdown.length * 0.05));
        const candidatePool = sortedByMaxDrawdown.slice(0, bucketSize);
        const selectedPath = candidatePool.reduce((best, current) => {
            const bestDistance = Math.abs(best.cagr - medianCagr);
            const currentDistance = Math.abs(current.cagr - medianCagr);
            if (currentDistance < bestDistance)
                return current;
            if (currentDistance === bestDistance && current.simulationId < best.simulationId)
                return current;
            return best;
        }, candidatePool[0]);
        const capital = Array.isArray(selectedPath.monthly)
            ? selectedPath.monthly
                .map((entry) => ({ month: entry.month, capital: entry.endingCapital ?? entry.capital ?? 0 }))
                .filter((entry) => Number.isFinite(entry.capital))
            : selectedPath.years.map((entry) => ({ month: entry.year * 12, capital: entry.endingCapital }));
        return {
            simulationId: selectedPath.simulationId,
            cagr: selectedPath.cagr,
            maxDrawdown: selectedPath.maxDrawdown,
            capital
        };
    }
    static buildOfficialResult(paths, horizonYears, initialCapital, decorrelationInput, statisticsInput) {
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error('buildOfficialResult requires at least one path');
        }
        for (const path of paths) {
            this.assertValidMaxDrawdown(path);
        }
        const correlation = this.coerceCorrelationInput(decorrelationInput);
        const cagrValues = paths.map((path) => {
            if (path.finalCapital === 0)
                return -1;
            return this.calculatePathCagr(path.initialCapital, path.finalCapital, horizonYears);
        });
        const maxDrawdownValues = paths.map((path) => path.maxDrawdown);
        const completedRecoveryTimes = paths.flatMap((path) => {
            const value = path.maxRecoveryTimeMonths;
            if (value === null || value === undefined || !Number.isFinite(value) || value < 0)
                return [];
            if (path.unrecovered === true)
                return [];
            return [value];
        });
        const pathVolatilities = paths.map((path) => {
            const monthlyReturns = Array.isArray(path.monthly)
                ? path.monthly
                    .map((entry) => entry.portfolioReturn)
                    .filter((value) => typeof value === 'number' && Number.isFinite(value))
                : [];
            return this.calculatePathVolatility(monthlyReturns);
        });
        const robustCagr = this.calculateTrimmedMean5Percent(cagrValues);
        const robustMaxDrawdown = this.calculateTrimmedMean5Percent(maxDrawdownValues);
        const volatilityKpi = this.calculateTrimmedMean5Percent(pathVolatilities);
        const medianCagr = this.calculateMedian(cagrValues.length > 0 ? cagrValues : [0]);
        const recoveryTimeKpi = completedRecoveryTimes.length > 0 ? this.calculateTrimmedMean5Percent(completedRecoveryTimes) : null;
        const rhoStar = 0.60 * correlation.weightedAverageScenarioCorrelation + 0.40 * correlation.maxScenarioCorrelation;
        const decorrelationIndex = Math.max(0, Math.min(100, 100 * (0.90 - rhoStar) / 0.80));
        const lantieriDenominator = robustMaxDrawdown > 0 ? robustMaxDrawdown : 0;
        const lantieriIndex = lantieriDenominator > 0 ? correlation.longTermExpectedReturn / lantieriDenominator : 0;
        const finalCapitalPercentiles = this.buildPercentileSet(paths.map((path) => path.finalCapital));
        const cagrPercentiles = this.buildPercentileSet(cagrValues);
        const maxDrawdownPercentiles = this.buildPercentileSet(maxDrawdownValues);
        const recoveryPercentiles = completedRecoveryTimes.length > 0 ? this.buildPercentileSet(completedRecoveryTimes) : null;
        const capitalFan = this.buildCapitalFan(paths, horizonYears);
        const representativePath = this.selectRepresentativePath(paths, medianCagr);
        const flatDiagnostics = statisticsInput && !statisticsInput.diagnostics && (('correlations' in statisticsInput) || ('generalBenchmark' in statisticsInput) || ('performance' in statisticsInput) || ('matricesCoherent' in statisticsInput)) ? statisticsInput : statisticsInput?.diagnostics;
        const generalBenchmark = this.coerceGeneralBenchmark(statisticsInput?.generalBenchmark ?? flatDiagnostics?.generalBenchmark ?? undefined);
        return {
            mainKpis: {
                robustCagr,
                robustMaxDrawdown,
                volatility: volatilityKpi,
                decorrelationIndex,
                lantieriIndex,
                recoveryTimeMonths: recoveryTimeKpi
            },
            percentiles: {
                finalCapital: finalCapitalPercentiles,
                cagr: cagrPercentiles,
                maxDrawdown: maxDrawdownPercentiles,
                recoveryTimeMonths: recoveryPercentiles
            },
            capitalFan,
            representativePath,
            statistics: this.buildScenarioStatistics(paths, horizonYears, {
                diagnostics: flatDiagnostics,
                generalBenchmark,
                correlationDiagnostics: statisticsInput?.correlationDiagnostics ?? flatDiagnostics?.correlations,
                performanceDiagnostics: statisticsInput?.performanceDiagnostics ?? flatDiagnostics?.performance,
                matricesCoherent: statisticsInput?.matricesCoherent ?? flatDiagnostics?.matricesCoherent
            }),
            technicalChecks: this.buildTechnicalChecks(paths, horizonYears, initialCapital, cagrValues, maxDrawdownValues, statisticsInput?.matricesCoherent ?? flatDiagnostics?.matricesCoherent),
            performanceMetrics: {
                totalTime: null,
                pathsPerSecond: null,
                monthsPerSecond: null,
                factorizationTime: null,
                totalRedraw: statisticsInput?.performanceDiagnostics?.redrawCount ?? flatDiagnostics?.performance?.redrawCount ?? null,
                rejectRate: statisticsInput?.performanceDiagnostics?.rejectRate ?? flatDiagnostics?.performance?.rejectRate ?? null
            }
        };
    }
    static buildScenarioStatistics(paths, horizonYears, statisticsInput) {
        const scenarioFrequencies = {
            expansion: 0,
            recession: 0,
            stagflation: 0,
            soft_landing: 0
        };
        for (const path of paths) {
            const frequencies = path.scenarioPath?.frequencies ?? {};
            for (const scenario of monte_carlo_model_1.MACRO_SCENARIOS) {
                scenarioFrequencies[scenario] += frequencies[scenario] ?? 0;
            }
        }
        const totalScenarioCount = Object.values(scenarioFrequencies).reduce((sum, value) => sum + value, 0) || 1;
        for (const scenario of monte_carlo_model_1.MACRO_SCENARIOS) {
            scenarioFrequencies[scenario] /= totalScenarioCount;
        }
        const observedDuration = {
            expansion: 0,
            recession: 0,
            stagflation: 0,
            soft_landing: 0
        };
        for (const path of paths) {
            for (const year of path.scenarioPath?.years ?? []) {
                observedDuration[year.scenario] += year.durationInCurrentScenario;
            }
        }
        const empiricalMatrix = {
            expansion: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 },
            recession: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 },
            stagflation: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 },
            soft_landing: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 }
        };
        for (const path of paths) {
            const years = path.scenarioPath?.years ?? [];
            for (let index = 0; index < years.length - 1; index += 1) {
                const current = years[index];
                const next = years[index + 1];
                if (current && next) {
                    empiricalMatrix[current.scenario][next.scenario] += 1;
                }
            }
        }
        for (const scenario of monte_carlo_model_1.MACRO_SCENARIOS) {
            const rowTotal = Object.values(empiricalMatrix[scenario]).reduce((sum, value) => sum + value, 0) || 1;
            for (const target of monte_carlo_model_1.MACRO_SCENARIOS) {
                empiricalMatrix[scenario][target] /= rowTotal;
            }
        }
        const intensityValues = [];
        const intensityBands = {
            '0-20': 0,
            '20-40': 0,
            '40-60': 0,
            '60-80': 0,
            '80-100': 0
        };
        for (const path of paths) {
            for (const month of path.monthly ?? []) {
                const intensity = typeof month?.intensity === 'number' && Number.isFinite(month.intensity) ? month.intensity : 0;
                intensityValues.push(intensity);
                if (intensity >= 0 && intensity < 0.2)
                    intensityBands['0-20'] += 1;
                else if (intensity >= 0.2 && intensity < 0.4)
                    intensityBands['20-40'] += 1;
                else if (intensity >= 0.4 && intensity < 0.6)
                    intensityBands['40-60'] += 1;
                else if (intensity >= 0.6 && intensity < 0.8)
                    intensityBands['60-80'] += 1;
                else if (intensity >= 0.8 && intensity <= 1.0)
                    intensityBands['80-100'] += 1;
            }
        }
        const pathReturns = (paths.flatMap((path) => path.monthly ?? []).map((entry) => entry.portfolioReturn ?? 0)).filter((value) => Number.isFinite(value));
        const meanReturn = pathReturns.length > 0 ? pathReturns.reduce((sum, value) => sum + value, 0) / pathReturns.length : 0;
        const returnVolatility = this.calculateSampleStandardDeviation(pathReturns);
        const intensityMean = intensityValues.length > 0 ? intensityValues.reduce((sum, value) => sum + value, 0) / intensityValues.length : 0;
        const intensityVolatility = this.calculateSampleStandardDeviation(intensityValues);
        const flatDiagnostics = statisticsInput && !statisticsInput.diagnostics && (('correlations' in statisticsInput) || ('generalBenchmark' in statisticsInput) || ('performance' in statisticsInput) || ('matricesCoherent' in statisticsInput)) ? statisticsInput : statisticsInput?.diagnostics;
        const correlationDiagnostics = statisticsInput?.correlationDiagnostics ?? flatDiagnostics?.correlations ?? {};
        const generalBenchmark = statisticsInput?.generalBenchmark ?? flatDiagnostics?.generalBenchmark;
        const performance = statisticsInput?.performanceDiagnostics ?? flatDiagnostics?.performance;
        const indicatorMatrix = {
            target: correlationDiagnostics.target ?? null,
            operational: correlationDiagnostics.operational ?? null,
            latent: correlationDiagnostics.latent ?? null,
            empiricalLatentShock: correlationDiagnostics.empiricalLatentShock ?? null,
            empiricalReturn: correlationDiagnostics.empiricalReturn ?? null,
            pearsonPrimary: correlationDiagnostics.pearsonPrimary ?? null,
            spearmanDiagnostic: correlationDiagnostics.spearmanDiagnostic ?? null,
            lowerTailDependence5: correlationDiagnostics.lowerTailDependence5 ?? null,
            upperTailDependence5: correlationDiagnostics.upperTailDependence5 ?? null,
            deltas: correlationDiagnostics.deltas ?? null,
            absoluteDeltas: correlationDiagnostics.absoluteDeltas ?? null,
            maeByScenario: correlationDiagnostics.maeByScenario ?? {},
            rmseByScenario: correlationDiagnostics.rmseByScenario ?? {},
            maxAbsoluteErrorByScenario: correlationDiagnostics.maxAbsoluteErrorByScenario ?? {}
        };
        const maxDrawdownValues = paths.map((path) => path.maxDrawdown);
        const drawdownPercentiles = this.buildPercentileSet(maxDrawdownValues);
        const returnGenerationAggregate = paths.reduce((aggregate, path) => {
            const range = path.returnDiagnostics ?? null;
            if (!range)
                return aggregate;
            aggregate.candidateVectors += range.candidateVectors ?? 0;
            aggregate.acceptedVectors += range.acceptedVectors ?? 0;
            aggregate.rejectedVectors += range.rejectedVectors ?? 0;
            aggregate.physicalFloorRejectedVectors += range.physicalFloorRejectedVectors ?? 0;
            aggregate.oldRangeViolationCount += range.oldRangeViolationCount ?? 0;
            aggregate.effectiveRangeRejectedVectors += range.effectiveRangeRejectedVectors ?? 0;
            for (const [key, rawValue] of Object.entries(range.byEtfScenario ?? {})) {
                const value = rawValue;
                const current = aggregate.byEtfScenario[key] ?? {
                    candidateReturnCount: 0,
                    belowEffectiveMinCount: 0,
                    aboveEffectiveMaxCount: 0,
                    lowerRejectRate: 0,
                    upperRejectRate: 0,
                    totalOutOfRangeRate: 0,
                    meanLowerDistanceSigma: null,
                    meanUpperDistanceSigma: null
                };
                current.candidateReturnCount += value?.candidateReturnCount ?? 0;
                current.belowEffectiveMinCount += value?.belowEffectiveMinCount ?? 0;
                current.aboveEffectiveMaxCount += value?.aboveEffectiveMaxCount ?? 0;
                current.lowerRejectRate = current.candidateReturnCount > 0 ? current.belowEffectiveMinCount / current.candidateReturnCount : 0;
                current.upperRejectRate = current.candidateReturnCount > 0 ? current.aboveEffectiveMaxCount / current.candidateReturnCount : 0;
                current.totalOutOfRangeRate = current.candidateReturnCount > 0 ? (current.belowEffectiveMinCount + current.aboveEffectiveMaxCount) / current.candidateReturnCount : 0;
                current.meanLowerDistanceSigma = value?.meanLowerDistanceSigma ?? current.meanLowerDistanceSigma;
                current.meanUpperDistanceSigma = value?.meanUpperDistanceSigma ?? current.meanUpperDistanceSigma;
                aggregate.byEtfScenario[key] = current;
            }
            return aggregate;
        }, {
            candidateVectors: 0,
            acceptedVectors: 0,
            rejectedVectors: 0,
            physicalFloorRejectedVectors: 0,
            oldRangeViolationCount: 0,
            effectiveRangeRejectedVectors: 0,
            byEtfScenario: {}
        });
        const macroSummary = {};
        for (const scenario of monte_carlo_model_1.MACRO_SCENARIOS) {
            const episodes = paths.flatMap((path) => path.scenarioPath?.years ?? []).filter((entry) => entry.scenario === scenario);
            const intensities = paths.flatMap((path) => path.monthly ?? []).filter((entry) => entry?.intensity !== undefined && Number.isFinite(entry?.intensity)).map((entry) => entry.intensity);
            const episodeDurations = episodes.map((entry) => entry.durationInCurrentScenario);
            macroSummary[scenario] = {
                frequency: scenarioFrequencies[scenario],
                numberOfEpisodes: episodes.length,
                averageEpisodeDuration: episodes.length > 0 ? (episodes.reduce((sum, entry) => sum + entry.durationInCurrentScenario, 0) / episodes.length) : 0,
                p50Duration: episodes.length > 0 ? this.calculateLinearPercentile(episodeDurations, 50) : 0,
                p95Duration: episodes.length > 0 ? this.calculateLinearPercentile(episodeDurations, 95) : 0,
                maxDuration: episodes.length > 0 ? this.computeMax(episodeDurations, 0) : 0,
                meanIntensity: intensities.length > 0 ? intensities.reduce((sum, value) => sum + value, 0) / intensities.length : 0,
                p95Intensity: intensities.length > 0 ? this.calculateLinearPercentile(intensities, 95) : 0,
            };
        }
        return {
            returnGeneration: {
                totalCandidateVectors: returnGenerationAggregate.candidateVectors,
                totalAcceptedVectors: returnGenerationAggregate.acceptedVectors,
                totalRejectedVectors: returnGenerationAggregate.rejectedVectors,
                totalPhysicalFloorRejectedVectors: returnGenerationAggregate.physicalFloorRejectedVectors,
                totalOldRangeViolationCount: returnGenerationAggregate.oldRangeViolationCount,
                totalEffectiveRangeRejectedVectors: returnGenerationAggregate.effectiveRangeRejectedVectors,
                totalRedrawCount: statisticsInput?.performanceDiagnostics?.redrawCount ?? flatDiagnostics?.performance?.redrawCount ?? paths.reduce((sum, path) => sum + (path.performanceDiagnostics?.redrawCount ?? 0), 0),
                rejectRate: statisticsInput?.performanceDiagnostics?.rejectRate ?? flatDiagnostics?.performance?.rejectRate ?? (returnGenerationAggregate.candidateVectors > 0 ? returnGenerationAggregate.rejectedVectors / returnGenerationAggregate.candidateVectors : 0),
                physicalFloorRejectRate: returnGenerationAggregate.candidateVectors > 0 ? returnGenerationAggregate.physicalFloorRejectedVectors / returnGenerationAggregate.candidateVectors : 0,
                oldRangeViolationRate: returnGenerationAggregate.candidateVectors > 0 ? returnGenerationAggregate.oldRangeViolationCount / returnGenerationAggregate.candidateVectors : 0,
            },
            scenario: {
                frequencies: scenarioFrequencies,
                duration: {
                    averageMonthsPerScenario: (horizonYears * 12) / Math.max(1, monte_carlo_model_1.MACRO_SCENARIOS.length),
                    observed: observedDuration
                },
                transitions: {
                    empiricalMatrix,
                    source: 'path-level-observed-transition-summary'
                },
                persistence: {
                    expansion: empiricalMatrix.expansion.expansion,
                    recession: empiricalMatrix.recession.recession,
                    stagflation: empiricalMatrix.stagflation.stagflation,
                    soft_landing: empiricalMatrix.soft_landing.soft_landing
                }
            },
            intensity: {
                distribution: {
                    mean: statisticsInput?.diagnostics?.intensity?.distribution?.mean ?? intensityMean,
                    volatility: statisticsInput?.diagnostics?.intensity?.distribution?.volatility ?? intensityVolatility,
                    bands: intensityBands
                },
                persistence: statisticsInput?.diagnostics?.intensity?.persistence ?? { observed: true }
            },
            returns: {
                sampleCount: pathReturns.length,
                meanMonthlyReturn: meanReturn,
                monthlyVolatility: returnVolatility,
                annualizedVolatility: returnVolatility * Math.sqrt(12),
                minimumMonthlyReturn: pathReturns.length > 0 ? this.computeMin(pathReturns) : 0,
                p1: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 1) : 0,
                p5: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 5) : 0,
                p50: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 50) : 0,
                p95: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 95) : 0,
                p99: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 99) : 0,
                maximumMonthlyReturn: pathReturns.length > 0 ? this.computeMax(pathReturns) : 0,
            },
            drawdown: {
                robustTrimmedMean: this.calculateTrimmedMean5Percent(maxDrawdownValues),
                p5: drawdownPercentiles.p5,
                p25: drawdownPercentiles.p25,
                p50: drawdownPercentiles.p50,
                p75: drawdownPercentiles.p75,
                p95: drawdownPercentiles.p95,
                p99: this.calculateLinearPercentile(maxDrawdownValues, 99),
                max: this.computeMax(maxDrawdownValues, 0),
            },
            macro: macroSummary,
            rangeDiagnostics: {
                candidateVectors: returnGenerationAggregate.candidateVectors,
                acceptedVectors: returnGenerationAggregate.acceptedVectors,
                rejectedVectors: returnGenerationAggregate.rejectedVectors,
                physicalFloorRejectedVectors: returnGenerationAggregate.physicalFloorRejectedVectors,
                oldRangeViolationCount: returnGenerationAggregate.oldRangeViolationCount,
                effectiveRangeRejectedVectors: returnGenerationAggregate.effectiveRangeRejectedVectors,
                byEtfScenario: returnGenerationAggregate.byEtfScenario
            },
            correlations: indicatorMatrix,
            generalComparison: {
                targetExpectedReturnDelta: generalBenchmark ? (generalBenchmark.simulatedLongTermReturn ?? meanReturn) - generalBenchmark.expectedReturn : null,
                targetVolatilityDelta: generalBenchmark ? (generalBenchmark.simulatedVolatility ?? returnVolatility) - generalBenchmark.volatility : null
            },
            performance: performance ?? { redrawCount: null, rejectRate: null }
        };
    }
    static buildTechnicalChecks(paths, horizonYears, initialCapital, cagrValues, maxDrawdownValues, matricesCoherent = true) {
        const capitalMatches = paths.every((path) => {
            const monthlyEntries = Array.isArray(path.monthly) ? path.monthly : [];
            if (monthlyEntries.length === 0) {
                return Number.isFinite(path.finalCapital) && path.finalCapital >= 0;
            }
            return monthlyEntries.every((entry) => {
                const positions = Array.isArray(entry.positions) ? entry.positions : [];
                const sumPositions = positions.length > 0
                    ? positions.reduce((sum, position) => sum + (Number.isFinite(position.value) ? position.value : 0), 0)
                    : null;
                const endingCapital = entry.endingCapital ?? path.finalCapital;
                if (sumPositions !== null) {
                    return Math.abs(sumPositions - endingCapital) <= 1e-6;
                }
                return Number.isFinite(endingCapital) && endingCapital >= 0;
            });
        });
        const returnMatches = paths.every((path) => {
            const monthlyEntries = Array.isArray(path.monthly) ? path.monthly : [];
            if (monthlyEntries.length === 0) {
                return Number.isFinite(path.totalReturn);
            }
            return monthlyEntries.every((entry) => {
                const positions = Array.isArray(entry.positions) ? entry.positions : [];
                const sumContributions = positions.length > 0
                    ? positions.reduce((sum, position) => sum + (Number.isFinite(position.contribution) ? position.contribution : 0), 0)
                    : null;
                const portfolioReturn = entry.portfolioReturn ?? path.totalReturn;
                if (sumContributions !== null) {
                    return Math.abs(sumContributions - portfolioReturn) <= 1e-6;
                }
                return Number.isFinite(portfolioReturn);
            });
        });
        const cagrChecks = paths.map((path) => {
            if (path.finalCapital <= 0)
                return { simulationId: path.simulationId, ok: true };
            const identityCheck = Math.abs((1 + this.calculatePathCagr(path.initialCapital, path.finalCapital, horizonYears)) - Math.pow(1 + path.totalReturn, 1 / horizonYears)) <= 1e-6;
            return { simulationId: path.simulationId, ok: identityCheck };
        });
        const orderedPercentiles = this.buildPercentileSet(cagrValues);
        const percentileOrdered = [orderedPercentiles.p5, orderedPercentiles.p25, orderedPercentiles.p50, orderedPercentiles.p75, orderedPercentiles.p95].every((value, index, arr) => index === 0 || arr[index - 1] <= value);
        const fanOrdered = this.buildCapitalFan(paths, horizonYears).every((point) => point.capitalP5 <= point.capitalP25 && point.capitalP25 <= point.capitalP50 && point.capitalP50 <= point.capitalP75 && point.capitalP75 <= point.capitalP95);
        const finiteValues = paths.every((path) => Number.isFinite(path.finalCapital) && Number.isFinite(path.maxDrawdown) && Number.isFinite(path.totalReturn) && Number.isFinite(path.cagr)) && maxDrawdownValues.every((value) => Number.isFinite(value));
        return {
            passed: capitalMatches && returnMatches && percentileOrdered && fanOrdered && finiteValues && cagrChecks.every((check) => check.ok) && matricesCoherent,
            percentilesOrdered: percentileOrdered,
            fanOrdered,
            finiteValues,
            matricesCoherent,
            diagnostics: { pathCount: paths.length, horizonYears, initialCapital }
        };
    }
    static calculateSummaryInternal(paths, initialCapital, targetCagr, horizonYears, portfolio, portfolioSnapshot, missingMacroStatistics, missingCorrelationPairs) {
        if (paths.length === 0) {
            return this.createEmptySummary(initialCapital, horizonYears, targetCagr, portfolio, portfolioSnapshot, missingMacroStatistics, missingCorrelationPairs);
        }
        const finalCapitals = paths.map((path) => path.finalCapital);
        const cagrValues = paths.map((path) => (path.finalCapital === 0 ? -1 : (path.cagr ?? this.calculatePathCagr(path.initialCapital, path.finalCapital, horizonYears))));
        const maxDrawdowns = paths.map((path) => path.maxDrawdown ?? 0);
        const validPaths = paths.filter((path) => Number.isFinite(path.cagr) && Number.isFinite(path.finalCapital));
        const failedPathCount = paths.length - validPaths.length;
        const medianCagr = this.calculateMedian(cagrValues.length > 0 ? cagrValues : [0]);
        const averageCagr = cagrValues.reduce((sum, value) => sum + value, 0) / Math.max(1, cagrValues.length);
        const annualizedVolatilities = paths.map((path) => {
            const monthlyReturns = (path.monthly ?? []).map((entry) => entry.portfolioReturn ?? 0).filter((value) => Number.isFinite(value));
            return this.calculatePathVolatility(monthlyReturns);
        });
        const medianAnnualizedVolatility = this.calculateMedian(annualizedVolatilities.length > 0 ? annualizedVolatilities : [0]);
        const medianMaxDrawdown = this.calculateMedian(maxDrawdowns.length > 0 ? maxDrawdowns : [0]);
        return {
            simulationCount: paths.length,
            validSimulationCount: validPaths.length,
            failedPathCount,
            horizonYears,
            initialCapital,
            averageFinalCapital: finalCapitals.reduce((sum, value) => sum + value, 0) / finalCapitals.length,
            medianFinalCapital: this.calculateMedian(finalCapitals.length > 0 ? finalCapitals : [initialCapital]),
            percentile5FinalCapital: this.calculateLinearPercentile(finalCapitals, 5),
            percentile25FinalCapital: this.calculateLinearPercentile(finalCapitals, 25),
            percentile75FinalCapital: this.calculateLinearPercentile(finalCapitals, 75),
            percentile95FinalCapital: this.calculateLinearPercentile(finalCapitals, 95),
            averageCagr,
            medianCagr,
            percentile5Cagr: this.calculateLinearPercentile(cagrValues, 5),
            percentile25Cagr: this.calculateLinearPercentile(cagrValues, 25),
            percentile75Cagr: this.calculateLinearPercentile(cagrValues, 75),
            percentile95Cagr: this.calculateLinearPercentile(cagrValues, 95),
            medianConsistencyDifference: 0,
            averageMaxDrawdown: maxDrawdowns.reduce((sum, value) => sum + value, 0) / Math.max(1, maxDrawdowns.length),
            averageWorst5PercentMaxDrawdown: 0,
            worstMaxDrawdown: this.computeMax(maxDrawdowns, 0),
            probabilityOfLoss: paths.filter((path) => path.totalReturn < 0).length / Math.max(1, paths.length),
            probabilityCagrAboveTarget: validPaths.filter((path) => (path.cagr ?? 0) >= targetCagr).length / Math.max(1, validPaths.length),
            scenarioFrequencies: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 },
            averageEtfContribution: [],
            missingMacroStatistics,
            missingCorrelationPairs,
            portfolioSnapshot,
            medianAnnualizedVolatility,
            medianMaxDrawdown,
            etfsMissingGeneralStats: []
        };
    }
    /**
     * Calculate summary statistics from all paths
     */
    static calculateSummary(paths, initialCapital, targetCagr, horizonYears, portfolio, portfolioSnapshot, missingMacroStatistics = [], missingCorrelationPairs = []) {
        if (paths.length === 0) {
            return this.createEmptySummary(initialCapital, horizonYears, targetCagr, portfolio, portfolioSnapshot, missingMacroStatistics, missingCorrelationPairs);
        }
        // =========================================================================
        // SEPARATE VALID vs FAILED PATHS
        // A path is failed if finalCapital <= 0 (total loss)
        // =========================================================================
        const failedPaths = paths.filter(p => p.finalCapital <= 0 || !isFinite(p.cagr) || isNaN(p.cagr));
        const validPaths = paths.filter(p => p.finalCapital > 0 && isFinite(p.cagr) && !isNaN(p.cagr));
        const failedPathCount = failedPaths.length;
        const validSimulationCount = validPaths.length;
        if (validPaths.length === 0) {
            return { ...this.createEmptySummary(initialCapital, horizonYears, targetCagr, portfolio, portfolioSnapshot, missingMacroStatistics, missingCorrelationPairs), simulationCount: paths.length, failedPathCount };
        }
        // Extract metrics from VALID paths only
        const finalCapitals = validPaths.map(p => p.finalCapital);
        const cagrs = validPaths.map(p => p.cagr);
        const maxDrawdowns = paths.map(p => p.maxDrawdown); // all paths for drawdown
        // Compute per-path annualized volatility = std dev of annual portfolio returns
        const annualizedVolatilities = validPaths.map(path => {
            const returns = path.years.map((y) => y.portfolioReturn);
            if (returns.length === 0)
                return 0;
            const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
            const variance = returns.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / returns.length;
            return Math.sqrt(variance); // already annual, no sqrt(T) needed
        });
        const sortedVolatilities = [...annualizedVolatilities].sort((a, b) => a - b);
        const medianAnnualizedVolatility = this.calculateMedian(annualizedVolatilities.length > 0 ? annualizedVolatilities : [0]);
        const sortedMaxDrawdowns = [...maxDrawdowns].sort((a, b) => a - b); // ascending (most negative first)
        const medianMaxDrawdown = this.calculateMedian(maxDrawdowns.length > 0 ? maxDrawdowns : [0]);
        const worst5Count = Math.max(1, Math.ceil(maxDrawdowns.length * 0.05));
        const worst5MaxDrawdowns = [...maxDrawdowns].sort((a, b) => b - a).slice(0, worst5Count);
        const averageWorst5PercentMaxDrawdown = worst5MaxDrawdowns.reduce((sum, value) => sum + value, 0) / worst5MaxDrawdowns.length;
        void sortedVolatilities; // suppress unused warning
        // =========================================================================
        // PRIMARY METRIC: medianCagr — true statistical median of valid CAGRs
        // =========================================================================
        const medianCagr = this.calculateMedian(cagrs);
        const medianFinalCapital = this.calculateMedian(finalCapitals);
        // Consistency check: medianFinalCapital should be close to reconstructed from medianCagr
        const reconstructedMedianCapital = initialCapital * Math.pow(1 + medianCagr, horizonYears);
        const medianConsistencyDifference = Math.abs(medianFinalCapital - reconstructedMedianCapital);
        // CAGR percentiles
        const percentile5Cagr = this.calculatePercentile(cagrs, 5);
        const percentile25Cagr = this.calculatePercentile(cagrs, 25);
        const percentile75Cagr = this.calculatePercentile(cagrs, 75);
        const percentile95Cagr = this.calculatePercentile(cagrs, 95);
        // Capital percentiles
        const percentile5FinalCapital = this.calculatePercentile(finalCapitals, 5);
        const percentile25FinalCapital = this.calculatePercentile(finalCapitals, 25);
        const percentile75FinalCapital = this.calculatePercentile(finalCapitals, 75);
        const percentile95FinalCapital = this.calculatePercentile(finalCapitals, 95);
        // Average CAGR kept for debug/comparison only (not primary)
        const averageCagr = cagrs.reduce((sum, v) => sum + v, 0) / cagrs.length;
        // Calculate probabilities (use validPaths for CAGR, all paths for loss)
        const probabilityOfLoss = paths.filter(p => p.totalReturn < 0).length / paths.length;
        const probabilityCagrAboveTarget = validPaths.filter(p => p.cagr >= targetCagr // >= as per spec
        ).length / validSimulationCount;
        // Calculate scenario frequencies
        const scenarioFrequencies = {
            expansion: 0,
            recession: 0,
            stagflation: 0,
            soft_landing: 0
        };
        for (const path of paths) {
            for (const freq of Object.entries(path.scenarioPath.frequencies)) {
                scenarioFrequencies[freq[0]] += freq[1];
            }
        }
        // Normalize by total samples
        const totalScenarioCount = Object.values(scenarioFrequencies).reduce((sum, v) => sum + v, 0);
        for (const scenario of monte_carlo_model_1.MACRO_SCENARIOS) {
            scenarioFrequencies[scenario] =
                totalScenarioCount > 0
                    ? scenarioFrequencies[scenario] / totalScenarioCount
                    : 0;
        }
        // Calculate ETF contributions
        const etfContributions = this.calculateEtfContributions(validPaths, portfolio);
        if (validSimulationCount > 0 && medianConsistencyDifference > initialCapital * 0.01) {
            console.warn(`[MonteCarloStatistics] medianConsistencyDifference = ${medianConsistencyDifference.toFixed(0)} (>1% of initial capital)`);
        }
        return {
            simulationCount: paths.length,
            validSimulationCount,
            failedPathCount,
            horizonYears,
            initialCapital,
            averageFinalCapital: finalCapitals.reduce((sum, v) => sum + v, 0) / finalCapitals.length,
            medianFinalCapital,
            percentile5FinalCapital,
            percentile25FinalCapital,
            percentile75FinalCapital,
            percentile95FinalCapital,
            averageCagr, // kept for debug, not primary
            medianCagr, // PRIMARY METRIC
            percentile5Cagr,
            percentile25Cagr,
            percentile75Cagr,
            percentile95Cagr,
            medianConsistencyDifference,
            averageMaxDrawdown: maxDrawdowns.reduce((sum, v) => sum + v, 0) /
                maxDrawdowns.length,
            averageWorst5PercentMaxDrawdown,
            worstMaxDrawdown: this.computeMax(maxDrawdowns, 0),
            medianAnnualizedVolatility,
            medianMaxDrawdown,
            probabilityOfLoss,
            probabilityCagrAboveTarget,
            scenarioFrequencies,
            averageEtfContribution: etfContributions,
            missingMacroStatistics,
            missingCorrelationPairs,
            portfolioSnapshot,
            etfsMissingGeneralStats: []
        };
    }
    /**
     * Calculate average contributions by ETF
     */
    static calculateEtfContributions(paths, portfolio) {
        const contributionMap = {};
        // Initialize
        for (const pos of portfolio) {
            contributionMap[pos.isin] = {
                name: pos.name,
                annualContributions: [],
                totalContribution: 0
            };
        }
        // Accumulate contributions from all paths
        for (const path of paths) {
            for (const year of path.years) {
                for (const etfReturn of year.etfReturns) {
                    if (!contributionMap[etfReturn.isin]) {
                        contributionMap[etfReturn.isin] = {
                            name: etfReturn.name,
                            annualContributions: [],
                            totalContribution: 0
                        };
                    }
                    contributionMap[etfReturn.isin].annualContributions.push(etfReturn.contribution);
                    contributionMap[etfReturn.isin].totalContribution +=
                        etfReturn.contribution;
                }
            }
        }
        // Calculate statistics
        return Object.entries(contributionMap)
            .map(([isin, data]) => ({
            isin,
            name: data.name,
            averageAnnualContribution: data.annualContributions.length > 0
                ? data.annualContributions.reduce((sum, v) => sum + v, 0) /
                    data.annualContributions.length
                : 0,
            cumulativeContribution: data.totalContribution
        }))
            .sort((a, b) => b.cumulativeContribution - a.cumulativeContribution);
    }
    /**
     * Create empty summary for zero paths
     */
    static createEmptySummary(initialCapital, horizonYears, targetCagr, portfolio, portfolioSnapshot, missingMacroStatistics, missingCorrelationPairs) {
        return {
            simulationCount: 0,
            validSimulationCount: 0,
            failedPathCount: 0,
            horizonYears,
            initialCapital,
            averageFinalCapital: initialCapital,
            medianFinalCapital: initialCapital,
            percentile5FinalCapital: initialCapital,
            percentile25FinalCapital: initialCapital,
            percentile75FinalCapital: initialCapital,
            percentile95FinalCapital: initialCapital,
            averageCagr: 0,
            medianCagr: 0,
            percentile5Cagr: 0,
            percentile25Cagr: 0,
            percentile75Cagr: 0,
            percentile95Cagr: 0,
            medianConsistencyDifference: 0,
            averageMaxDrawdown: 0,
            averageWorst5PercentMaxDrawdown: 0,
            worstMaxDrawdown: 0,
            probabilityOfLoss: 0,
            probabilityCagrAboveTarget: 0,
            scenarioFrequencies: {
                expansion: 0,
                recession: 0,
                stagflation: 0,
                soft_landing: 0
            },
            averageEtfContribution: portfolio.map(p => ({
                isin: p.isin,
                name: p.name,
                averageAnnualContribution: 0,
                cumulativeContribution: 0
            })),
            missingMacroStatistics,
            missingCorrelationPairs,
            portfolioSnapshot,
            medianAnnualizedVolatility: 0,
            medianMaxDrawdown: 0,
            etfsMissingGeneralStats: []
        };
    }
}
exports.MonteCarloStatisticsEngine = MonteCarloStatisticsEngine;
