import { MONTE_CARLO_SCENARIOS } from '../models/monte-carlo-contracts.model';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../probability/monte-carlo-probability';
export const PSD_EPSILON = 1e-6;
export const CORRELATION_EPSILON = 1e-6;
export const MAX_CORRELATION_CELL_DELTA = 0.02;
export const NEAREST_CORRELATION_TOLERANCE = 1e-10;
export const NEAREST_CORRELATION_MAX_ITERATIONS = 100;
export class MonteCarloPrecomputationError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MonteCarloPrecomputationError';
    }
}
const fail = (code, message, details = {}) => {
    throw new MonteCarloPrecomputationError(code, message, details);
};
const cloneMatrix = (matrix) => matrix.map((row) => [...row]);
const createMatrix = (size, value = 0) => Array.from({ length: size }, () => Array(size).fill(value));
const assertFiniteNumber = (value, field, details) => {
    if (!Number.isFinite(value)) {
        fail('INVALID_NUMERIC_VALUE', `${field} must be finite`, details);
    }
};
const buildDeterministicStudentTShockGrid = (sampleSize) => {
    const shocks = [];
    for (let index = 0; index < sampleSize; index += 1) {
        const probability = (index + 0.5) / (sampleSize + 1);
        shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
    }
    return shocks;
};
const conditionalLogGrowthExpectation = (muMonthly, sigmaMonthly, shockGrid = buildDeterministicStudentTShockGrid(8193)) => {
    let accepted = 0;
    let total = 0;
    for (const shock of shockGrid) {
        const grossReturn = 1 + muMonthly + sigmaMonthly * shock;
        if (grossReturn <= 0)
            continue;
        total += Math.log(grossReturn);
        accepted += 1;
    }
    if (accepted === 0) {
        fail('UNACHIEVABLE_TARGET_LOG_GROWTH', 'no admissible Student-t shock produced a positive gross return under the floor rule', { muMonthly, sigmaMonthly });
    }
    return total / accepted;
};
export const calibrateTargetLogAndSigma = (targetLogGrowthMonthly, sigmaMonthly, shockGrid = buildDeterministicStudentTShockGrid(8193)) => {
    if (!Number.isFinite(targetLogGrowthMonthly) || !Number.isFinite(sigmaMonthly)) {
        throw new Error('CALIBRATION_INVALID_INPUT');
    }
    let lower = -0.9999;
    let lowerValue = conditionalLogGrowthExpectation(lower, sigmaMonthly, shockGrid);
    while (Number.isFinite(lowerValue) && lowerValue > targetLogGrowthMonthly) {
        lower -= 0.5;
        lowerValue = conditionalLogGrowthExpectation(lower, sigmaMonthly, shockGrid);
        if (!Number.isFinite(lowerValue)) {
            throw new Error('CALIBRATION_LOW_BRACKET_FAILED');
        }
    }
    let upper = 0.25;
    let upperValue = conditionalLogGrowthExpectation(upper, sigmaMonthly, shockGrid);
    while (upperValue < targetLogGrowthMonthly) {
        upper *= 2;
        upperValue = conditionalLogGrowthExpectation(upper, sigmaMonthly, shockGrid);
        if (!Number.isFinite(upperValue) || upper > 10) {
            throw new Error('CALIBRATION_HIGH_BRACKET_FAILED');
        }
    }
    for (let iteration = 0; iteration < 100; iteration += 1) {
        const midpoint = (lower + upper) / 2;
        const midpointValue = conditionalLogGrowthExpectation(midpoint, sigmaMonthly, shockGrid);
        if (Math.abs(midpointValue - targetLogGrowthMonthly) <= 1e-10) {
            return midpoint;
        }
        if (midpointValue < targetLogGrowthMonthly) {
            lower = midpoint;
        }
        else {
            upper = midpoint;
        }
        if (Math.abs(upper - lower) <= 1e-10) {
            return (lower + upper) / 2;
        }
    }
    throw new Error('CALIBRATION_DID_NOT_CONVERGE');
};
export const calibrateMonthlyLocation = (targetAnnualCagr, annualVolatility) => {
    if (!Number.isFinite(targetAnnualCagr) || !Number.isFinite(annualVolatility) || targetAnnualCagr <= -1 || annualVolatility < 0) {
        throw new Error('CALIBRATION_INVALID_TARGET_OR_VOLATILITY');
    }
    const targetLogGrowthMonthly = Math.log(1 + targetAnnualCagr) / 12;
    const sigmaMonthly = annualVolatility / Math.sqrt(12);
    return calibrateTargetLogAndSigma(targetLogGrowthMonthly, sigmaMonthly);
};
const multiplyMatrices = (left, right) => {
    const rows = left.length;
    const columns = right[0]?.length ?? 0;
    const shared = right.length;
    const result = createMatrix(rows, 0);
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            for (let index = 0; index < shared; index += 1) {
                result[row][column] += left[row][index] * right[index][column];
            }
        }
    }
    return result;
};
const transpose = (matrix) => matrix[0].map((_, column) => matrix.map((row) => row[column]));
const subtractMatrices = (left, right) => left.map((row, rowIndex) => row.map((value, columnIndex) => value - right[rowIndex][columnIndex]));
const frobeniusNorm = (matrix) => Math.sqrt(matrix.reduce((total, row) => total + row.reduce((rowTotal, value) => rowTotal + value * value, 0), 0));
const maximumAbsoluteDifference = (left, right) => {
    let maximum = 0;
    for (let row = 0; row < left.length; row += 1) {
        for (let column = 0; column < left.length; column += 1) {
            maximum = Math.max(maximum, Math.abs(left[row][column] - right[row][column]));
        }
    }
    return maximum;
};
const assertCorrelationMatrixStructure = (matrix, scenario) => {
    if (matrix.length === 0) {
        fail('EMPTY_CORRELATION_MATRIX', 'correlation matrix must not be empty', { scenario });
    }
    for (let row = 0; row < matrix.length; row += 1) {
        if (matrix[row].length !== matrix.length) {
            fail('INVALID_CORRELATION_MATRIX_DIMENSION', 'correlation matrix must be square', { scenario, row });
        }
        for (let column = 0; column < matrix.length; column += 1) {
            const value = matrix[row][column];
            assertFiniteNumber(value, 'correlation', { scenario, row, column });
            if (value < -1 - CORRELATION_EPSILON || value > 1 + CORRELATION_EPSILON) {
                fail('INVALID_ETF_CORRELATION_VALUE', 'correlation must be in [-1, 1]', { scenario, row, column, value });
            }
            if (Math.abs(value - matrix[column][row]) > CORRELATION_EPSILON) {
                fail('ASYMMETRIC_CORRELATION_MATRIX', 'correlation matrix must be symmetric', { scenario, row, column });
            }
        }
        if (Math.abs(matrix[row][row] - 1) > CORRELATION_EPSILON) {
            fail('INVALID_CORRELATION_DIAGONAL', 'correlation matrix diagonal must equal 1', { scenario, row, value: matrix[row][row] });
        }
    }
};
/** Jacobi eigendecomposition for finite symmetric matrices. */
const symmetricEigenDecomposition = (matrix, scenario) => {
    const size = matrix.length;
    const working = cloneMatrix(matrix);
    const eigenvectors = createMatrix(size, 0);
    for (let index = 0; index < size; index += 1)
        eigenvectors[index][index] = 1;
    const maximumIterations = Math.max(1, size * size * NEAREST_CORRELATION_MAX_ITERATIONS);
    for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
        let pivotRow = 0;
        let pivotColumn = 1;
        let maximumOffDiagonal = 0;
        for (let row = 0; row < size; row += 1) {
            for (let column = row + 1; column < size; column += 1) {
                const magnitude = Math.abs(working[row][column]);
                if (magnitude > maximumOffDiagonal) {
                    maximumOffDiagonal = magnitude;
                    pivotRow = row;
                    pivotColumn = column;
                }
            }
        }
        if (maximumOffDiagonal <= NEAREST_CORRELATION_TOLERANCE || size === 1) {
            const eigenvalues = working.map((row, index) => row[index]);
            eigenvalues.forEach((value, index) => assertFiniteNumber(value, 'eigenvalue', { scenario, index }));
            return { eigenvalues, eigenvectors };
        }
        const app = working[pivotRow][pivotRow];
        const aqq = working[pivotColumn][pivotColumn];
        const apq = working[pivotRow][pivotColumn];
        const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        for (let index = 0; index < size; index += 1) {
            if (index === pivotRow || index === pivotColumn)
                continue;
            const aip = working[index][pivotRow];
            const aiq = working[index][pivotColumn];
            working[index][pivotRow] = cosine * aip - sine * aiq;
            working[pivotRow][index] = working[index][pivotRow];
            working[index][pivotColumn] = sine * aip + cosine * aiq;
            working[pivotColumn][index] = working[index][pivotColumn];
        }
        working[pivotRow][pivotRow] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
        working[pivotColumn][pivotColumn] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
        working[pivotRow][pivotColumn] = 0;
        working[pivotColumn][pivotRow] = 0;
        for (let index = 0; index < size; index += 1) {
            const vip = eigenvectors[index][pivotRow];
            const viq = eigenvectors[index][pivotColumn];
            eigenvectors[index][pivotRow] = cosine * vip - sine * viq;
            eigenvectors[index][pivotColumn] = sine * vip + cosine * viq;
        }
    }
    return fail('EIGENDECOMPOSITION_FAILED', 'symmetric eigendecomposition did not converge', { scenario });
};
const reconstructSymmetricMatrix = (eigenvectors, eigenvalues) => {
    const size = eigenvalues.length;
    const result = createMatrix(size, 0);
    for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
            let value = 0;
            for (let index = 0; index < size; index += 1) {
                value += eigenvectors[row][index] * eigenvalues[index] * eigenvectors[column][index];
            }
            result[row][column] = value;
        }
    }
    return result;
};
const projectToPsd = (matrix, scenario) => {
    const { eigenvalues, eigenvectors } = symmetricEigenDecomposition(matrix, scenario);
    return reconstructSymmetricMatrix(eigenvectors, eigenvalues.map((value) => Math.max(0, value)));
};
const projectToUnitDiagonal = (matrix) => matrix.map((row, rowIndex) => row.map((value, columnIndex) => rowIndex === columnIndex ? 1 : value));
const nearestCorrelationMatrix = (matrix, scenario) => {
    let current = cloneMatrix(matrix);
    let dykstraCorrection = createMatrix(matrix.length, 0);
    for (let iteration = 1; iteration <= NEAREST_CORRELATION_MAX_ITERATIONS; iteration += 1) {
        const previous = current;
        const residual = subtractMatrices(previous, dykstraCorrection);
        const projectedPsd = projectToPsd(residual, scenario);
        dykstraCorrection = subtractMatrices(projectedPsd, residual);
        current = projectToUnitDiagonal(projectedPsd);
        if (maximumAbsoluteDifference(current, previous) <= NEAREST_CORRELATION_TOLERANCE) {
            return { matrix: current, iterations: iteration };
        }
    }
    return fail('CORRELATION_MATRIX_CORRECTION_FAILED', 'nearest correlation matrix algorithm did not converge', { scenario });
};
const getMinimumEigenvalue = (matrix, scenario) => Math.min(...symmetricEigenDecomposition(matrix, scenario).eigenvalues);
const getConditionNumber = (matrix, scenario) => {
    const eigenvalues = symmetricEigenDecomposition(matrix, scenario).eigenvalues.map(Math.abs);
    const positive = eigenvalues.filter((value) => value > CORRELATION_EPSILON);
    return positive.length === eigenvalues.length ? Math.max(...positive) / Math.min(...positive) : null;
};
const calculateMaxCellDelta = (original, corrected) => {
    let maximum = 0;
    for (let row = 0; row < original.length; row += 1) {
        for (let column = row + 1; column < original.length; column += 1) {
            maximum = Math.max(maximum, Math.abs(corrected[row][column] - original[row][column]));
        }
    }
    return maximum;
};
const buildFactor = (matrix, scenario) => {
    const { eigenvalues, eigenvectors } = symmetricEigenDecomposition(matrix, scenario);
    const hasNegativeEigenvalue = eigenvalues.some((eigenvalue) => eigenvalue < 0);
    const roots = eigenvalues.map((eigenvalue, index) => {
        if (eigenvalue < -PSD_EPSILON) {
            fail('CORRELATION_MATRIX_NOT_PSD', 'operational correlation matrix is not PSD', { scenario, eigenvalue, index, epsilon: PSD_EPSILON });
        }
        return Math.sqrt(Math.max(0, eigenvalue));
    });
    const factor = eigenvectors.map((row) => row.map((value, index) => value * roots[index]));
    if (hasNegativeEigenvalue) {
        for (let row = 0; row < factor.length; row += 1) {
            const rowVariance = factor[row].reduce((total, value) => total + value * value, 0);
            if (!Number.isFinite(rowVariance) || rowVariance <= 0) {
                fail('CORRELATION_FACTOR_RECONSTRUCTION_FAILED', 'factor cannot be normalized to a correlation matrix', { scenario, row, rowVariance });
            }
            const scale = Math.sqrt(rowVariance);
            factor[row] = factor[row].map((value) => value / scale);
        }
    }
    for (const row of factor) {
        for (const value of row)
            assertFiniteNumber(value, 'correlation factor', { scenario });
    }
    const factorProduct = multiplyMatrices(factor, transpose(factor));
    const operationalMatrix = hasNegativeEigenvalue ? factorProduct : matrix;
    const reconstructionError = maximumAbsoluteDifference(factorProduct, operationalMatrix);
    if (reconstructionError > CORRELATION_EPSILON) {
        fail('CORRELATION_FACTOR_RECONSTRUCTION_FAILED', 'correlation factor reconstruction error exceeds epsilon', {
            scenario,
            reconstructionError,
            epsilon: CORRELATION_EPSILON
        });
    }
    return { factor, eigenvalues, operationalMatrix, reconstructionError, rebuiltOperationalMatrix: hasNegativeEigenvalue };
};
export const precomputeEtfScenarioParameters = (statistics) => {
    const { expectedReturn, volatility, returnRange } = statistics;
    assertFiniteNumber(expectedReturn, 'expectedReturn', {});
    assertFiniteNumber(volatility, 'volatility', {});
    assertFiniteNumber(returnRange.min, 'returnRange.min', {});
    assertFiniteNumber(returnRange.max, 'returnRange.max', {});
    if (expectedReturn <= -1 || volatility < 0 || returnRange.min < -1 || returnRange.min > expectedReturn || expectedReturn > returnRange.max) {
        fail('INVALID_ETF_SCENARIO_PARAMETERS', 'ETF annual parameters violate the precomputation contract');
    }
    const targetLogGrowthMonthly = Math.log(1 + expectedReturn) / 12;
    const calibratedMonthlyLocation = calibrateMonthlyLocation(expectedReturn, volatility);
    const monthlyExpectedReturn = calibratedMonthlyLocation;
    const monthlyVolatility = volatility / Math.sqrt(12);
    if (volatility === 0) {
        if (returnRange.min !== expectedReturn || returnRange.max !== expectedReturn) {
            fail('INVALID_ZERO_VOLATILITY_RANGE', 'zero volatility requires a deterministic return range');
        }
        return {
            monthlyExpectedReturn,
            calibratedMonthlyLocation,
            targetLogGrowthMonthly,
            generalMonthlyExpectedReturn: undefined,
            generalMonthlyVolatility: undefined,
            muCalibrationByIntensity: [{ intensity: 0, targetLogGrowthMonthly, sigmaMonthly: monthlyVolatility, muMonthly: monthlyExpectedReturn, impliedAnnualCagr: expectedReturn }],
            monthlyVolatility,
            zMin: null,
            zMax: null,
            monthlyRangeMin: monthlyExpectedReturn,
            monthlyRangeMax: monthlyExpectedReturn
        };
    }
    const zMin = (returnRange.min - expectedReturn) / volatility;
    const zMax = (returnRange.max - expectedReturn) / volatility;
    return {
        monthlyExpectedReturn,
        calibratedMonthlyLocation,
        targetLogGrowthMonthly,
        generalMonthlyExpectedReturn: undefined,
        generalMonthlyVolatility: undefined,
        muCalibrationByIntensity: [{ intensity: 0, targetLogGrowthMonthly, sigmaMonthly: monthlyVolatility, muMonthly: monthlyExpectedReturn, impliedAnnualCagr: expectedReturn }],
        monthlyVolatility,
        zMin,
        zMax,
        monthlyRangeMin: monthlyExpectedReturn + zMin * monthlyVolatility,
        monthlyRangeMax: monthlyExpectedReturn + zMax * monthlyVolatility
    };
};
export const prepareCorrelationMatrix = (snapshot, scenario) => {
    const assetIsins = snapshot.etfs.map((etf) => etf.isin);
    const indexByIsin = new Map(assetIsins.map((isin, index) => [isin, index]));
    const originalMatrix = createMatrix(assetIsins.length, 0);
    for (let index = 0; index < assetIsins.length; index += 1)
        originalMatrix[index][index] = 1;
    for (const correlation of snapshot.correlations) {
        const left = indexByIsin.get(correlation.isin1);
        const right = indexByIsin.get(correlation.isin2);
        if (left === undefined || right === undefined) {
            fail('INVALID_ETF_CORRELATION', 'correlation cannot be mapped to snapshot ETFs', { scenario, correlation });
        }
        if (left === right) {
            fail('INVALID_ETF_CORRELATION', 'correlation cannot be mapped to distinct snapshot ETFs', { scenario, correlation });
        }
        const leftIndex = left;
        const rightIndex = right;
        const value = correlation[scenario];
        assertFiniteNumber(value, 'correlation', { scenario, isin1: correlation.isin1, isin2: correlation.isin2 });
        if (value < -1 || value > 1) {
            fail('INVALID_ETF_CORRELATION_VALUE', 'correlation must be in [-1, 1]', { scenario, isin1: correlation.isin1, isin2: correlation.isin2, value });
        }
        originalMatrix[leftIndex][rightIndex] = value;
        originalMatrix[rightIndex][leftIndex] = value;
    }
    assertCorrelationMatrixStructure(originalMatrix, scenario);
    const minimumEigenvalueBefore = getMinimumEigenvalue(originalMatrix, scenario);
    const conditionNumberBefore = getConditionNumber(originalMatrix, scenario);
    let candidateMatrix = originalMatrix;
    let correctionApplied = false;
    let operationalMatrix = originalMatrix;
    let correctionIterations = 0;
    let maxCellDelta = 0;
    let frobeniusDelta = 0;
    if (minimumEigenvalueBefore < -PSD_EPSILON) {
        const correction = nearestCorrelationMatrix(originalMatrix, scenario);
        candidateMatrix = correction.matrix;
        correctionIterations = correction.iterations;
        correctionApplied = true;
    }
    assertCorrelationMatrixStructure(candidateMatrix, scenario);
    const factorResult = buildFactor(candidateMatrix, scenario);
    operationalMatrix = factorResult.operationalMatrix;
    correctionApplied ||= factorResult.rebuiltOperationalMatrix;
    if (correctionApplied) {
        assertCorrelationMatrixStructure(operationalMatrix, scenario);
        maxCellDelta = calculateMaxCellDelta(originalMatrix, operationalMatrix);
        frobeniusDelta = frobeniusNorm(subtractMatrices(operationalMatrix, originalMatrix));
        if (maxCellDelta > MAX_CORRELATION_CELL_DELTA) {
            fail('CORRELATION_MATRIX_CORRECTION_TOO_LARGE', 'nearest correlation matrix correction exceeds maximum cell delta', {
                scenario,
                maxCellDelta,
                maximum: MAX_CORRELATION_CELL_DELTA
            });
        }
    }
    const minimumEigenvalueAfter = getMinimumEigenvalue(operationalMatrix, scenario);
    if (minimumEigenvalueAfter < -PSD_EPSILON) {
        fail('CORRELATION_MATRIX_NOT_PSD', 'operational correlation matrix is not PSD', { scenario, minimumEigenvalueAfter, epsilon: PSD_EPSILON });
    }
    return {
        scenario,
        assetIsins,
        originalMatrix,
        correctedMatrix: correctionApplied ? operationalMatrix : null,
        operationalMatrix,
        correctionApplied,
        minimumEigenvalueBefore,
        minimumEigenvalueAfter,
        eigenvalues: factorResult.eigenvalues,
        maxCellDelta,
        frobeniusDelta,
        conditionNumberBefore,
        conditionNumberAfter: getConditionNumber(operationalMatrix, scenario),
        correctionIterations,
        factor: factorResult.factor,
        factorReconstructionError: factorResult.reconstructionError
    };
};
const buildMuCalibrationCurve = (generalParameters, scenarioParameters, step, shockGrid) => {
    const generalTargetLogGrowthMonthly = generalParameters.targetLogGrowthMonthly;
    const scenarioTargetLogGrowthMonthly = scenarioParameters.targetLogGrowthMonthly;
    const curve = [];
    for (let intensity = 0; intensity <= 1 + 1e-12; intensity += step) {
        const clampedIntensity = Math.min(1, Math.max(0, intensity));
        const targetLogGrowthMonthly = generalTargetLogGrowthMonthly + clampedIntensity * (scenarioTargetLogGrowthMonthly - generalTargetLogGrowthMonthly);
        const sigmaMonthly = generalParameters.monthlyVolatility + clampedIntensity * (scenarioParameters.monthlyVolatility - generalParameters.monthlyVolatility);
        const muMonthly = calibrateTargetLogAndSigma(targetLogGrowthMonthly, sigmaMonthly, shockGrid);
        const impliedAnnualCagr = Math.exp(12 * targetLogGrowthMonthly) - 1;
        if (curve.length > 0 && Math.abs(curve[curve.length - 1].intensity - clampedIntensity) <= 1e-12) {
            curve[curve.length - 1] = { intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr };
            continue;
        }
        curve.push({ intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr });
    }
    return curve;
};
export const prepareMonteCarloPrecomputation = (snapshot) => {
    const shockGrid = buildDeterministicStudentTShockGrid(8193);
    const etfParameters = Object.fromEntries(snapshot.etfs.map((etf) => {
        const generalStatistics = etf.statistics.general;
        if (!generalStatistics) {
            fail('MISSING_GENERAL_ETF_STATISTICS', 'general.expectedReturn is required and must be finite for every ETF', { isin: etf.isin });
        }
        const generalParameters = precomputeEtfScenarioParameters(generalStatistics);
        const scenarioParameters = Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => {
            const scenarioStatistics = etf.statistics[scenario];
            if (!scenarioStatistics) {
                fail('MISSING_SCENARIO_ETF_STATISTICS', 'scenario expectedReturn is required for all macro scenarios', { isin: etf.isin, scenario });
            }
            const scenarioBaseParameters = precomputeEtfScenarioParameters(scenarioStatistics);
            const calibrationCurve = buildMuCalibrationCurve(generalParameters, scenarioBaseParameters, 0.01, shockGrid);
            return [
                scenario,
                {
                    ...scenarioBaseParameters,
                    generalMonthlyExpectedReturn: generalParameters.monthlyExpectedReturn,
                    generalMonthlyVolatility: generalParameters.monthlyVolatility,
                    muCalibrationByIntensity: calibrationCurve
                }
            ];
        }));
        return [etf.isin, scenarioParameters];
    }));
    const correlationMatrices = Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [
        scenario,
        prepareCorrelationMatrix(snapshot, scenario)
    ]));
    return { etfParameters, correlationMatrices };
};
