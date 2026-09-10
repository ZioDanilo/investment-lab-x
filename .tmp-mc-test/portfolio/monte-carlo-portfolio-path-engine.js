"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evolveMonteCarloPortfolioPath = exports.MonteCarloPortfolioPathError = void 0;
const WEIGHT_EPSILON = 1e-6;
const NUMERICAL_EPSILON = 1e-9;
class MonteCarloPortfolioPathError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MonteCarloPortfolioPathError';
    }
}
exports.MonteCarloPortfolioPathError = MonteCarloPortfolioPathError;
const fail = (code, message, details = {}) => {
    throw new MonteCarloPortfolioPathError(code, message, details);
};
const assertFiniteNonNegative = (value, field, details = {}) => {
    if (!Number.isFinite(value) || value < 0) {
        fail('INVALID_CAPITAL_VALUE', `${field} must be finite and non-negative`, { ...details, value });
    }
};
const validateInput = (input) => {
    if (!Number.isFinite(input.initialCapital) || input.initialCapital <= 0) {
        fail('INVALID_INITIAL_CAPITAL', 'initialCapital must be finite and greater than zero', { initialCapital: input.initialCapital });
    }
    if (!Number.isInteger(input.horizonYears) || input.horizonYears <= 0) {
        fail('INVALID_HORIZON_YEARS', 'horizonYears must be a positive integer', { horizonYears: input.horizonYears });
    }
    if (input.positions.length === 0)
        fail('EMPTY_PORTFOLIO', 'at least one target position is required');
    const isins = new Set();
    const totalWeight = input.positions.reduce((sum, position) => {
        if (!position.isin || isins.has(position.isin))
            fail('INVALID_TARGET_POSITIONS', 'target positions must have unique ISINs', { isin: position.isin });
        isins.add(position.isin);
        if (!Number.isFinite(position.targetWeight) || position.targetWeight < 0 || position.targetWeight > 1) {
            fail('INVALID_TARGET_WEIGHT', 'target weights must be finite and in [0, 1]', { isin: position.isin, targetWeight: position.targetWeight });
        }
        return sum + position.targetWeight;
    }, 0);
    if (Math.abs(totalWeight - 1) > WEIGHT_EPSILON) {
        fail('INVALID_TARGET_WEIGHT_SUM', 'target weights must sum to 1', { totalWeight, epsilon: WEIGHT_EPSILON });
    }
};
const calculateWeights = (positions, capital) => {
    const weights = new Map();
    if (capital === 0) {
        for (const position of positions)
            weights.set(position.isin, null);
        return weights;
    }
    let sum = 0;
    for (const position of positions) {
        const weight = position.value / capital;
        weights.set(position.isin, weight);
        sum += weight;
    }
    if (Math.abs(sum - 1) > WEIGHT_EPSILON) {
        fail('INVALID_CURRENT_WEIGHT_SUM', 'current weights must sum to 1', { sum, epsilon: WEIGHT_EPSILON });
    }
    return weights;
};
const validateMonthlyReturnVector = (vector, positions, month) => {
    const returns = new Map();
    for (const result of vector.etfReturns) {
        if (returns.has(result.isin))
            fail('DUPLICATE_MONTHLY_ETF_RETURN', 'monthly return vector contains duplicate ETF', { month, isin: result.isin });
        if (!Number.isFinite(result.monthlyReturn) || result.monthlyReturn < -1) {
            fail('INVALID_ETF_RETURN', 'ETF monthly return must be finite and at least -1', { month, isin: result.isin, monthlyReturn: result.monthlyReturn });
        }
        returns.set(result.isin, result.monthlyReturn);
    }
    if (returns.size !== positions.length || positions.some((position) => !returns.has(position.isin))) {
        fail('MONTHLY_RETURN_PORTFOLIO_MISMATCH', 'monthly return vector must contain exactly the target ETFs', { month });
    }
    return returns;
};
const calculateAnnualReturn = (monthlyReturns, startingCapital, endingCapital) => {
    const annualPortfolioReturn = monthlyReturns.reduce((result, monthlyReturn) => result * (1 + monthlyReturn), 1) - 1;
    if (startingCapital === 0) {
        return { annualPortfolioReturn, capitalDerivedAnnualReturn: null, difference: 0 };
    }
    const capitalDerivedAnnualReturn = endingCapital / startingCapital - 1;
    const difference = Math.abs(annualPortfolioReturn - capitalDerivedAnnualReturn);
    if (difference > NUMERICAL_EPSILON) {
        fail('ANNUAL_COMPOUNDING_MISMATCH', 'annual return from monthly compounding differs from capital result', { annualPortfolioReturn, capitalDerivedAnnualReturn, difference });
    }
    return { annualPortfolioReturn, capitalDerivedAnnualReturn, difference };
};
const rebalance = (year, positions, portfolioValue) => {
    if (portfolioValue === 0) {
        return {
            year,
            performed: true,
            portfolioValueBefore: 0,
            portfolioValueAfter: 0,
            turnover: null,
            etfs: positions.map((position) => ({
                isin: position.isin,
                targetWeight: position.targetWeight,
                currentWeightBefore: null,
                weightReallocation: null,
                positionValueBefore: position.value,
                positionValueAfter: 0
            }))
        };
    }
    const weightsBefore = calculateWeights(positions, portfolioValue);
    const etfs = positions.map((position) => {
        const currentWeightBefore = weightsBefore.get(position.isin) ?? null;
        const positionValueBefore = position.value;
        const positionValueAfter = portfolioValue * position.targetWeight;
        position.value = positionValueAfter;
        return {
            isin: position.isin,
            targetWeight: position.targetWeight,
            currentWeightBefore,
            weightReallocation: Math.abs(position.targetWeight - (currentWeightBefore ?? 0)),
            positionValueBefore,
            positionValueAfter
        };
    });
    const portfolioValueAfter = positions.reduce((sum, position) => sum + position.value, 0);
    if (Math.abs(portfolioValueAfter - portfolioValue) > NUMERICAL_EPSILON) {
        fail('REBALANCE_CAPITAL_MISMATCH', 'rebalance must preserve total portfolio value', { year, portfolioValue, portfolioValueAfter });
    }
    const weightsAfter = calculateWeights(positions, portfolioValueAfter);
    for (const position of positions) {
        if (Math.abs((weightsAfter.get(position.isin) ?? NaN) - position.targetWeight) > WEIGHT_EPSILON) {
            fail('REBALANCE_WEIGHT_MISMATCH', 'rebalance must restore target weights', { year, isin: position.isin });
        }
    }
    return {
        year,
        performed: true,
        portfolioValueBefore: portfolioValue,
        portfolioValueAfter,
        turnover: 0.5 * etfs.reduce((sum, etf) => sum + (etf.weightReallocation ?? 0), 0),
        etfs
    };
};
const evolveMonteCarloPortfolioPath = (input, monthlyReturnVectors) => {
    validateInput(input);
    const expectedMonths = input.horizonYears * 12;
    if (monthlyReturnVectors.length !== expectedMonths) {
        fail('INVALID_MONTHLY_RETURN_COUNT', 'monthly return vectors must match the simulation horizon', { expectedMonths, actualMonths: monthlyReturnVectors.length });
    }
    const positions = input.positions.map((position) => ({
        isin: position.isin,
        targetWeight: position.targetWeight,
        value: input.initialCapital * position.targetWeight
    }));
    const initialPositionTotal = positions.reduce((sum, position) => sum + position.value, 0);
    if (Math.abs(initialPositionTotal - input.initialCapital) > NUMERICAL_EPSILON) {
        fail('INITIAL_CAPITAL_MISMATCH', 'initial positions must sum to initial capital', { initialPositionTotal, initialCapital: input.initialCapital });
    }
    let capital = input.initialCapital;
    let runningPeak = input.initialCapital;
    let minimumDrawdown = 0;
    let recoveryStartMonth = null;
    let maxRecoveryTimeMonths = null;
    let yearStartingCapital = capital;
    let annualPortfolioMonthlyReturns = [];
    let annualEtfReturnFactors = new Map(positions.map((position) => [position.isin, 1]));
    const monthly = [];
    const annual = [];
    const rebalances = [];
    for (let monthIndex = 0; monthIndex < monthlyReturnVectors.length; monthIndex += 1) {
        const month = monthIndex + 1;
        const vector = monthlyReturnVectors[monthIndex];
        const etfReturns = validateMonthlyReturnVector(vector, positions, month);
        const startingCapital = capital;
        const weightsStart = calculateWeights(positions, startingCapital);
        const positionResults = [];
        let portfolioReturn = 0;
        if (startingCapital === 0) {
            for (const position of positions) {
                position.value = 0;
                positionResults.push({
                    isin: position.isin,
                    targetWeight: position.targetWeight,
                    currentWeightStart: null,
                    currentWeightEnd: null,
                    monthlyReturn: 0,
                    contribution: 0,
                    startingValue: 0,
                    endingValue: 0
                });
            }
        }
        else {
            for (const position of positions) {
                const monthlyReturn = etfReturns.get(position.isin);
                const currentWeightStart = weightsStart.get(position.isin);
                const contribution = currentWeightStart * monthlyReturn;
                const startingValue = position.value;
                position.value *= 1 + monthlyReturn;
                assertFiniteNonNegative(position.value, 'position value', { month, isin: position.isin });
                portfolioReturn += contribution;
                positionResults.push({
                    isin: position.isin,
                    targetWeight: position.targetWeight,
                    currentWeightStart,
                    currentWeightEnd: null,
                    monthlyReturn,
                    contribution,
                    startingValue,
                    endingValue: position.value
                });
            }
        }
        capital = positions.reduce((sum, position) => sum + position.value, 0);
        assertFiniteNonNegative(capital, 'portfolio capital', { month });
        const capitalDerivedReturn = startingCapital === 0 ? null : capital / startingCapital - 1;
        const portfolioReturnDifference = startingCapital === 0 ? 0 : Math.abs(portfolioReturn - capitalDerivedReturn);
        if (portfolioReturnDifference > NUMERICAL_EPSILON) {
            fail('PORTFOLIO_RETURN_MISMATCH', 'weighted return differs from capital-derived return', { month, portfolioReturn, capitalDerivedReturn, portfolioReturnDifference });
        }
        if (startingCapital === 0)
            portfolioReturn = 0;
        const weightsEnd = calculateWeights(positions, capital);
        for (const positionResult of positionResults)
            positionResult.currentWeightEnd = weightsEnd.get(positionResult.isin) ?? null;
        const previousPeak = runningPeak;
        if (capital > runningPeak)
            runningPeak = capital;
        const drawdown = capital / runningPeak - 1;
        if (!Number.isFinite(drawdown) || drawdown > NUMERICAL_EPSILON) {
            fail('INVALID_DRAWDOWN', 'drawdown must be finite and non-positive', { month, drawdown });
        }
        minimumDrawdown = Math.min(minimumDrawdown, drawdown);
        if (capital < previousPeak) {
            if (recoveryStartMonth === null)
                recoveryStartMonth = month;
        }
        else if (recoveryStartMonth !== null) {
            const recoveryDuration = month - recoveryStartMonth + 1;
            maxRecoveryTimeMonths = Math.max(maxRecoveryTimeMonths ?? 0, recoveryDuration);
            recoveryStartMonth = null;
        }
        monthly.push({
            month,
            year: Math.ceil(month / 12),
            scenario: vector.scenario,
            intensity: vector.intensity,
            startingCapital,
            endingCapital: capital,
            portfolioReturn,
            capitalDerivedReturn,
            portfolioReturnDifference,
            positions: positionResults,
            runningPeak,
            drawdown
        });
        annualPortfolioMonthlyReturns.push(portfolioReturn);
        for (const position of positions) {
            const annualEtfMonthlyReturn = startingCapital === 0 ? 0 : etfReturns.get(position.isin);
            annualEtfReturnFactors.set(position.isin, annualEtfReturnFactors.get(position.isin) * (1 + annualEtfMonthlyReturn));
        }
        if (month % 12 === 0) {
            const annualReturns = calculateAnnualReturn(annualPortfolioMonthlyReturns, yearStartingCapital, capital);
            annual.push({
                year: month / 12,
                startingCapital: yearStartingCapital,
                endingCapital: capital,
                annualPortfolioReturn: annualReturns.annualPortfolioReturn,
                capitalDerivedAnnualReturn: annualReturns.capitalDerivedAnnualReturn,
                annualReturnDifference: annualReturns.difference,
                etfs: positions.map((position) => {
                    const annualReturn = annualEtfReturnFactors.get(position.isin) - 1;
                    return {
                        isin: position.isin,
                        annualReturn,
                        annualContributionAtTargetWeight: annualReturn * position.targetWeight
                    };
                })
            });
            if (month < expectedMonths)
                rebalances.push(rebalance(month / 12, positions, capital));
            yearStartingCapital = capital;
            annualPortfolioMonthlyReturns = [];
            annualEtfReturnFactors = new Map(positions.map((position) => [position.isin, 1]));
        }
    }
    const totalReturnFromMonthlyCompounding = monthly.reduce((result, entry) => result * (1 + entry.portfolioReturn), 1) - 1;
    const totalReturn = capital / input.initialCapital - 1;
    if (Math.abs(totalReturnFromMonthlyCompounding - totalReturn) > NUMERICAL_EPSILON) {
        fail('TOTAL_COMPOUNDING_MISMATCH', 'total return from monthly compounding differs from final capital', { totalReturnFromMonthlyCompounding, totalReturn });
    }
    const unrecoveredDurationMonths = recoveryStartMonth === null ? null : monthly.length - recoveryStartMonth + 1;
    const maxDrawdown = Math.abs(minimumDrawdown);
    if (maxDrawdown < 0 || maxDrawdown > 1 || !Number.isFinite(maxDrawdown)) {
        fail('INVALID_MAX_DRAWDOWN', 'max drawdown must be finite and in [0, 1]', { maxDrawdown });
    }
    return {
        initialCapital: input.initialCapital,
        finalCapital: capital,
        totalReturn,
        monthly,
        annual,
        rebalances,
        minimumDrawdown,
        maxDrawdown,
        maxRecoveryTimeMonths,
        unrecovered: recoveryStartMonth !== null,
        unrecoveredDurationMonths
    };
};
exports.evolveMonteCarloPortfolioPath = evolveMonteCarloPortfolioPath;
