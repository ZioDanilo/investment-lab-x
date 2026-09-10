import { COPULA_EPSILON, sampleChiSquare5, sampleStandardNormal, studentTCdf, studentTQuantile, STUDENT_T_STANDARDIZATION } from '../probability/monte-carlo-probability';
export const MAX_REDRAWS = 1000;
export class MonteCarloReturnEngineError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MonteCarloReturnEngineError';
    }
}
export const __debugRejectTrace = [];
export const __debugAcceptTrace = [];
export const __debugAllAttemptTrace = [];
const fail = (code, message, details = {}) => {
    throw new MonteCarloReturnEngineError(code, message, details);
};
const cloneMatrix = (matrix) => matrix.map((row) => [...row]);
const multiplyMatrixVector = (matrix, vector) => matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
const clampCopulaProbability = (probability) => {
    if (!Number.isFinite(probability)) {
        fail('INVALID_COPULA_PROBABILITY', 'Student-t CDF returned a non-finite probability', { probability });
    }
    return Math.min(1 - COPULA_EPSILON, Math.max(COPULA_EPSILON, probability));
};
const lookupCalibratedMuFromIntensity = (parameters, intensity) => {
    const calibrationCurve = parameters.muCalibrationByIntensity;
    if (!Array.isArray(calibrationCurve) || calibrationCurve.length === 0) {
        const baselineMonthlyExpectedReturn = parameters.generalMonthlyExpectedReturn ?? parameters.monthlyExpectedReturn;
        return baselineMonthlyExpectedReturn + intensity * (parameters.monthlyExpectedReturn - baselineMonthlyExpectedReturn);
    }
    const clampedIntensity = Math.min(1, Math.max(0, intensity));
    if (clampedIntensity === 0)
        return calibrationCurve[0].muMonthly;
    if (clampedIntensity === 1)
        return calibrationCurve[calibrationCurve.length - 1].muMonthly;
    let left = calibrationCurve[0];
    let right = calibrationCurve[calibrationCurve.length - 1];
    for (let index = 1; index < calibrationCurve.length; index += 1) {
        const current = calibrationCurve[index];
        if (current.intensity >= clampedIntensity) {
            left = calibrationCurve[index - 1];
            right = current;
            break;
        }
    }
    const span = right.intensity - left.intensity || 1;
    const weight = (clampedIntensity - left.intensity) / span;
    return left.muMonthly + weight * (right.muMonthly - left.muMonthly);
};
export const calculateEffectiveMonthlyParameters = (parameters, intensity, isin) => {
    const { monthlyExpectedReturn, monthlyVolatility, monthlyRangeMin, monthlyRangeMax, zMin, zMax } = parameters;
    const baselineMonthlyExpectedReturn = parameters.generalMonthlyExpectedReturn ?? monthlyExpectedReturn;
    const baselineMonthlyVolatility = parameters.generalMonthlyVolatility ?? monthlyVolatility;
    const effectiveMu = lookupCalibratedMuFromIntensity(parameters, intensity);
    const effectiveSigma = baselineMonthlyVolatility + intensity * (monthlyVolatility - baselineMonthlyVolatility);
    const reconstructedReturnRange = zMin === null || zMax === null
        ? { min: effectiveMu, max: effectiveMu }
        : {
            min: effectiveMu + zMin * effectiveSigma,
            max: effectiveMu + zMax * effectiveSigma
        };
    const scenarioMonthlyReturnRange = { min: monthlyRangeMin, max: monthlyRangeMax };
    const effectiveReturnRange = {
        min: Math.max(reconstructedReturnRange.min, scenarioMonthlyReturnRange.min),
        max: Math.min(reconstructedReturnRange.max, scenarioMonthlyReturnRange.max)
    };
    if (!Number.isFinite(effectiveMu) || !Number.isFinite(effectiveSigma) || !Number.isFinite(reconstructedReturnRange.min) || !Number.isFinite(reconstructedReturnRange.max) || !Number.isFinite(scenarioMonthlyReturnRange.min) || !Number.isFinite(scenarioMonthlyReturnRange.max)) {
        fail('INVALID_EFFECTIVE_PARAMETERS', 'effective return parameters must be finite', { isin, intensity });
    }
    if (effectiveSigma < 0 || scenarioMonthlyReturnRange.min > scenarioMonthlyReturnRange.max || effectiveReturnRange.min > effectiveReturnRange.max) {
        fail('INVALID_EFFECTIVE_RETURN_RANGE', 'effective return range violates the Monte Carlo constraints', {
            isin,
            effectiveSigma,
            scenarioMonthlyReturnRange,
            reconstructedReturnRange,
            effectiveReturnRange
        });
    }
    return { effectiveMu, effectiveSigma, scenarioMonthlyReturnRange, reconstructedReturnRange, effectiveReturnRange };
};
export const isMonthlyReturnAccepted = (monthlyReturn, effectiveReturnRange) => Number.isFinite(monthlyReturn) && monthlyReturn >= -1;
const calculateCorrelation = (samples) => {
    if (samples.length < 2)
        return null;
    const dimension = samples[0].length;
    const means = Array(dimension).fill(0);
    for (const sample of samples) {
        for (let index = 0; index < dimension; index += 1)
            means[index] += sample[index];
    }
    for (let index = 0; index < dimension; index += 1)
        means[index] /= samples.length;
    const covariance = Array.from({ length: dimension }, () => Array(dimension).fill(0));
    for (const sample of samples) {
        for (let row = 0; row < dimension; row += 1) {
            for (let column = 0; column < dimension; column += 1) {
                covariance[row][column] += (sample[row] - means[row]) * (sample[column] - means[column]);
            }
        }
    }
    for (let row = 0; row < dimension; row += 1) {
        for (let column = 0; column < dimension; column += 1)
            covariance[row][column] /= samples.length - 1;
    }
    return covariance.map((row, rowIndex) => row.map((value, columnIndex) => {
        const denominator = Math.sqrt(covariance[rowIndex][rowIndex] * covariance[columnIndex][columnIndex]);
        return denominator === 0 ? NaN : value / denominator;
    }));
};
const calculateTailDependence = (samples, upper) => {
    if (samples.length < 2)
        return null;
    const dimension = samples[0].length;
    const thresholds = Array.from({ length: dimension }, (_, index) => {
        const sorted = samples.map((sample) => sample[index]).sort((left, right) => left - right);
        const percentileIndex = upper ? Math.ceil(sorted.length * 0.95) - 1 : Math.floor(sorted.length * 0.05);
        return sorted[percentileIndex];
    });
    return Array.from({ length: dimension }, (_, row) => Array.from({ length: dimension }, (_, column) => {
        if (row === column)
            return 1;
        let conditioningCount = 0;
        let jointCount = 0;
        for (const sample of samples) {
            const rowInTail = upper ? sample[row] >= thresholds[row] : sample[row] <= thresholds[row];
            const columnInTail = upper ? sample[column] >= thresholds[column] : sample[column] <= thresholds[column];
            if (rowInTail) {
                conditioningCount += 1;
                if (columnInTail)
                    jointCount += 1;
            }
        }
        return conditioningCount === 0 ? NaN : jointCount / conditioningCount;
    }));
};
export class ReturnCorrelationDiagnosticsAccumulator {
    targetCorrelation;
    operationalCorrelation;
    shocks = [];
    returns = [];
    constructor(targetCorrelation, operationalCorrelation) {
        this.targetCorrelation = targetCorrelation;
        this.operationalCorrelation = operationalCorrelation;
    }
    record(vector) {
        this.shocks.push(vector.etfReturns.map((result) => result.standardizedShock));
        this.returns.push(vector.etfReturns.map((result) => result.monthlyReturn));
    }
    toDiagnostics() {
        return {
            sampleSize: this.shocks.length,
            targetCorrelation: cloneMatrix(this.targetCorrelation),
            operationalCorrelation: cloneMatrix(this.operationalCorrelation),
            latentCorrelation: cloneMatrix(this.operationalCorrelation),
            empiricalShockCorrelation: calculateCorrelation(this.shocks),
            empiricalReturnCorrelation: calculateCorrelation(this.returns),
            lowerTailDependence: calculateTailDependence(this.shocks, false),
            upperTailDependence: calculateTailDependence(this.shocks, true)
        };
    }
}
let debugVectorCounter = 0;
export const generateMonthlyReturnVector = (snapshot, precomputation, scenario, intensity, random) => {
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
        fail('INVALID_INTENSITY', 'intensity must be finite and in [0, 1]', { intensity });
    }
    const matrixPreparation = precomputation.correlationMatrices[scenario];
    if (!matrixPreparation)
        fail('MISSING_CORRELATION_MATRIX', 'precomputed scenario matrix is required', { scenario });
    const { assetIsins, factor, originalMatrix, operationalMatrix } = matrixPreparation;
    if (assetIsins.length !== factor.length || factor.some((row) => row.length !== assetIsins.length)) {
        fail('CORRELATION_FACTOR_DIMENSION_MISMATCH', 'correlation factor dimensions must match active ETFs', { scenario });
    }
    if (assetIsins.length !== snapshot.etfs.length) {
        fail('SNAPSHOT_PRECOMPUTATION_MISMATCH', 'precomputed asset order does not match snapshot', { scenario });
    }
    const effectiveParameters = assetIsins.map((isin) => {
        const parameters = precomputation.etfParameters[isin]?.[scenario];
        if (!parameters)
            fail('MISSING_PRECOMPUTED_ETF_PARAMETERS', 'missing precomputed ETF parameters', { isin, scenario });
        return calculateEffectiveMonthlyParameters(parameters, intensity, isin);
    });
    const rangeBucketState = {};
    const recordRangeCandidate = (isin, value, parameters) => {
        const key = `${isin}|${scenario}`;
        if (!rangeBucketState[key]) {
            rangeBucketState[key] = {
                candidateReturnCount: 0,
                belowEffectiveMinCount: 0,
                aboveEffectiveMaxCount: 0,
                lowerDistanceSigmaSum: 0,
                upperDistanceSigmaSum: 0
            };
        }
        const bucket = rangeBucketState[key];
        bucket.candidateReturnCount += 1;
        const sigmaEff = parameters.effectiveSigma;
        if (value < parameters.effectiveReturnRange.min) {
            bucket.belowEffectiveMinCount += 1;
            if (sigmaEff > 0) {
                bucket.lowerDistanceSigmaSum += (parameters.effectiveMu - parameters.effectiveReturnRange.min) / sigmaEff;
            }
        }
        else if (value > parameters.effectiveReturnRange.max) {
            bucket.aboveEffectiveMaxCount += 1;
            if (sigmaEff > 0) {
                bucket.upperDistanceSigmaSum += (parameters.effectiveReturnRange.max - parameters.effectiveMu) / sigmaEff;
            }
        }
    };
    const finalizeRangeDiagnostics = () => {
        const byEtfScenario = {};
        for (const [key, bucket] of Object.entries(rangeBucketState)) {
            const lowerRejectRate = bucket.candidateReturnCount > 0 ? bucket.belowEffectiveMinCount / bucket.candidateReturnCount : 0;
            const upperRejectRate = bucket.candidateReturnCount > 0 ? bucket.aboveEffectiveMaxCount / bucket.candidateReturnCount : 0;
            const totalOutOfRangeRate = bucket.candidateReturnCount > 0 ? (bucket.belowEffectiveMinCount + bucket.aboveEffectiveMaxCount) / bucket.candidateReturnCount : 0;
            byEtfScenario[key] = {
                candidateReturnCount: bucket.candidateReturnCount,
                belowEffectiveMinCount: bucket.belowEffectiveMinCount,
                aboveEffectiveMaxCount: bucket.aboveEffectiveMaxCount,
                lowerRejectRate,
                upperRejectRate,
                totalOutOfRangeRate,
                meanLowerDistanceSigma: bucket.belowEffectiveMinCount > 0 && bucket.lowerDistanceSigmaSum !== 0 ? bucket.lowerDistanceSigmaSum / bucket.belowEffectiveMinCount : null,
                meanUpperDistanceSigma: bucket.aboveEffectiveMaxCount > 0 && bucket.upperDistanceSigmaSum !== 0 ? bucket.upperDistanceSigmaSum / bucket.aboveEffectiveMaxCount : null,
            };
        }
        return byEtfScenario;
    };
    const rejectedChiSquares = [];
    let candidateVectors = 0;
    let acceptedVectors = 0;
    let rejectedVectors = 0;
    let physicalFloorRejectedVectors = 0;
    let oldRangeViolationCount = 0;
    let effectiveRangeRejectedVectors = 0;
    let rejectVectorNumber = 0;
    const debugRejectEnabled = typeof process !== 'undefined' && process.env && process.env.DEBUG_REJECT === '1';
    for (let attempt = 1; attempt <= MAX_REDRAWS; attempt += 1) {
        const independentNormals = assetIsins.map(() => sampleStandardNormal(random));
        const correlatedNormals = multiplyMatrixVector(factor, independentNormals);
        const commonChiSquare = sampleChiSquare5(random);
        const standardizedShocks = correlatedNormals.map((normal) => {
            const correlatedT = normal / Math.sqrt(commonChiSquare / 5);
            const probability = clampCopulaProbability(studentTCdf(correlatedT));
            const shock = studentTQuantile(probability) * STUDENT_T_STANDARDIZATION;
            if (!Number.isFinite(shock))
                fail('INVALID_STUDENT_T_SHOCK', 't-copula produced a non-finite standardized shock', { scenario, attempt });
            return shock;
        });
        const monthlyReturns = effectiveParameters.map((parameters, index) => parameters.effectiveMu + parameters.effectiveSigma * standardizedShocks[index]);
        candidateVectors += 1;
        const perEtfStatus = assetIsins.map((isin, index) => {
            const parameters = effectiveParameters[index];
            const candidateReturn = monthlyReturns[index];
            const oldRangeViolation = candidateReturn < parameters.effectiveReturnRange.min || candidateReturn > parameters.effectiveReturnRange.max;
            const physicalFloorViolation = candidateReturn < -1;
            const accepted = isMonthlyReturnAccepted(candidateReturn, parameters.effectiveReturnRange);
            recordRangeCandidate(isin, candidateReturn, parameters);
            if (oldRangeViolation) {
                oldRangeViolationCount += 1;
            }
            return {
                isin,
                index,
                shock: standardizedShocks[index],
                candidateReturn,
                effectiveMin: parameters.effectiveReturnRange.min,
                effectiveMax: parameters.effectiveReturnRange.max,
                accepted,
                oldRangeViolation,
                physicalFloorViolation,
            };
        });
        const vectorRejected = perEtfStatus.some((entry) => entry.physicalFloorViolation);
        const vectorAccepted = !vectorRejected;
        for (const entry of perEtfStatus) {
            const attemptRecord = {
                scenario,
                intensity,
                attemptNumber: attempt,
                index: entry.index,
                isin: entry.isin,
                muEff: effectiveParameters[entry.index].effectiveMu,
                sigmaEff: effectiveParameters[entry.index].effectiveSigma,
                effectiveMin: entry.effectiveMin,
                effectiveMax: entry.effectiveMax,
                standardizedShock: entry.shock,
                monthlyReturn: entry.candidateReturn,
                acceptedForThisEtf: entry.accepted,
                vectorAccepted,
            };
            __debugAllAttemptTrace.push(attemptRecord);
        }
        if (debugRejectEnabled) {
            rejectVectorNumber += 1;
        }
        const invalid = vectorRejected;
        if (invalid) {
            rejectedChiSquares.push(commonChiSquare);
            rejectedVectors += 1;
            physicalFloorRejectedVectors += 1;
            continue;
        }
        acceptedVectors += 1;
        if (debugRejectEnabled) {
            for (const entry of perEtfStatus) {
                __debugAcceptTrace.push({
                    scenario,
                    vectorNumber: rejectVectorNumber,
                    attemptNumber: attempt,
                    isin: entry.isin,
                    index: entry.index,
                    shock: entry.shock,
                    monthlyReturn: monthlyReturns[entry.index],
                    muEff: effectiveParameters[entry.index].effectiveMu,
                    sigmaEff: effectiveParameters[entry.index].effectiveSigma,
                    effectiveMin: entry.effectiveMin,
                    effectiveMax: entry.effectiveMax,
                });
            }
        }
        const debugEnabled = typeof process !== 'undefined' && process.env && process.env.DEBUG_SHOCK === '1';
        const debugVectorNumber = debugEnabled ? (++debugVectorCounter) : 0;
        if (debugEnabled && debugVectorNumber <= 20) {
            assetIsins.forEach((isin, index) => {
                const diagnosticShock = standardizedShocks[index];
                const arrayShock = standardizedShocks[index];
                const expectedMatch = Object.is(diagnosticShock, arrayShock) || diagnosticShock === arrayShock;
                if (!expectedMatch) {
                    throw new Error(`DEBUG_ASSERT_SHOCK_IDENTITY_FAILED: scenario=${scenario} vector=${debugVectorNumber} index=${index} isin=${isin} left=${diagnosticShock} right=${arrayShock}`);
                }
                const monthlyReturn = monthlyReturns[index];
                const muEff = effectiveParameters[index].effectiveMu;
                const sigmaEff = effectiveParameters[index].effectiveSigma;
                const returnFromDiagnostic = muEff + sigmaEff * diagnosticShock;
                const returnFromArray = muEff + sigmaEff * arrayShock;
                const errorDiagnostic = monthlyReturn - returnFromDiagnostic;
                const errorArray = monthlyReturn - returnFromArray;
                console.log(JSON.stringify({
                    vectorNumber: debugVectorNumber,
                    scenario,
                    index,
                    isin,
                    diagnosticShock,
                    arrayShock,
                    deltaDiagnosticVsArray: diagnosticShock - arrayShock,
                    monthlyReturn,
                    muEff,
                    sigmaEff,
                    returnFromDiagnostic,
                    returnFromArray,
                    errorDiagnostic,
                    errorArray
                }, null, 2));
            });
        }
        const etfReturns = assetIsins.map((isin, index) => {
            const diagnosticShock = standardizedShocks[index];
            const expectedMatch = Object.is(diagnosticShock, standardizedShocks[index]) || diagnosticShock === standardizedShocks[index];
            if (!expectedMatch) {
                throw new Error(`DEBUG_ASSERT_ARRAY_IDENTITY_FAILED: scenario=${scenario} vector=${debugVectorNumber} index=${index} isin=${isin} left=${diagnosticShock} right=${standardizedShocks[index]}`);
            }
            const result = {
                isin,
                effectiveParameters: effectiveParameters[index],
                standardizedShock: standardizedShocks[index],
                monthlyReturn: monthlyReturns[index]
            };
            if (debugEnabled && debugVectorNumber <= 20) {
                const returnedShock = result.standardizedShock;
                const deltaArrayVsReturned = standardizedShocks[index] - returnedShock;
                const monthlyReturn = result.monthlyReturn;
                const muEff = effectiveParameters[index].effectiveMu;
                const sigmaEff = effectiveParameters[index].effectiveSigma;
                const returnFromReturned = muEff + sigmaEff * returnedShock;
                const errorReturned = monthlyReturn - returnFromReturned;
                console.log(JSON.stringify({
                    vectorNumber: debugVectorNumber,
                    scenario,
                    index,
                    isin,
                    returnedShock,
                    deltaArrayVsReturned,
                    monthlyReturn,
                    muEff,
                    sigmaEff,
                    returnFromReturned,
                    errorReturned,
                    objectAssignmentMatchesArray: returnedShock === standardizedShocks[index]
                }, null, 2));
            }
            return result;
        });
        const finalResult = {
            scenario,
            intensity,
            etfReturns,
            diagnostics: {
                attempts: attempt,
                rejectedAttempts: rejectedChiSquares.length,
                acceptedChiSquare: commonChiSquare,
                rejectedChiSquares,
                targetCorrelation: cloneMatrix(originalMatrix),
                operationalCorrelation: cloneMatrix(operationalMatrix),
                latentCorrelation: cloneMatrix(operationalMatrix),
                rangeDiagnostics: {
                    candidateVectors,
                    acceptedVectors,
                    rejectedVectors,
                    physicalFloorRejectedVectors,
                    oldRangeViolationCount,
                    effectiveRangeRejectedVectors,
                    byEtfScenario: finalizeRangeDiagnostics()
                }
            }
        };
        return finalResult;
    }
    return fail('MAX_REDRAWS_EXCEEDED', 'no valid monthly return vector was generated within MAX_REDRAWS', {
        scenario,
        intensity,
        maxRedraws: MAX_REDRAWS,
        assetIsins
    });
};
