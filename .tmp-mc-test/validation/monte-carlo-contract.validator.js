"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMonteCarloRunContract = exports.validateMonteCarloSnapshot = exports.validateMonteCarloUserInput = exports.MonteCarloContractValidationError = void 0;
const monte_carlo_contracts_model_1 = require("../models/monte-carlo-contracts.model");
const WEIGHT_EPSILON = 1e-6;
const CONFIGURATION_EPSILON = 1e-9;
class MonteCarloContractValidationError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MonteCarloContractValidationError';
    }
}
exports.MonteCarloContractValidationError = MonteCarloContractValidationError;
const fail = (code, message, details = {}) => {
    throw new MonteCarloContractValidationError(code, message, details);
};
const assertFiniteNumber = (value, field, details = {}) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail('INVALID_NUMERIC_VALUE', `${field} must be a finite number`, details);
    }
    return value;
};
const assertRange = (value, minimum, maximum, field, details = {}) => {
    if (value < minimum || value > maximum) {
        fail('INVALID_VALUE_RANGE', `${field} must be in [${minimum}, ${maximum}]`, details);
    }
};
const assertScenarioKeys = (value, field) => {
    for (const scenario of monte_carlo_contracts_model_1.MONTE_CARLO_SCENARIOS) {
        if (!(scenario in value)) {
            fail('MISSING_SCENARIO_CONFIGURATION', `${field} is missing ${scenario}`, { field, scenario });
        }
    }
};
const validateMonteCarloUserInput = (input) => {
    if (!Array.isArray(input.positions) || input.positions.length === 0) {
        fail('EMPTY_PORTFOLIO', 'at least one target position is required');
    }
    const isins = new Set();
    let totalWeight = 0;
    for (const position of input.positions) {
        if (typeof position.isin !== 'string' || position.isin.trim() === '') {
            fail('INVALID_ETF_ISIN', 'target position ISIN must be a non-empty string');
        }
        if (isins.has(position.isin)) {
            fail('DUPLICATE_ETF', 'target positions must not contain duplicate ISINs', { isin: position.isin });
        }
        isins.add(position.isin);
        const targetWeight = assertFiniteNumber(position.targetWeight, 'targetWeight', { isin: position.isin });
        assertRange(targetWeight, 0, 1, 'targetWeight', { isin: position.isin, targetWeight });
        totalWeight += targetWeight;
    }
    if (Math.abs(totalWeight - 1) > WEIGHT_EPSILON) {
        fail('INVALID_TARGET_WEIGHT_SUM', 'target weights must sum to 1', { totalWeight, epsilon: WEIGHT_EPSILON });
    }
    const initialCapital = assertFiniteNumber(input.initialCapital, 'initialCapital');
    if (initialCapital <= 0) {
        fail('INVALID_INITIAL_CAPITAL', 'initialCapital must be greater than zero', { initialCapital });
    }
    const horizonYears = assertFiniteNumber(input.horizonYears, 'horizonYears');
    if (!Number.isInteger(horizonYears) || horizonYears <= 0) {
        fail('INVALID_HORIZON_YEARS', 'horizonYears must be a positive integer', { horizonYears });
    }
};
exports.validateMonteCarloUserInput = validateMonteCarloUserInput;
const validateMonteCarloSnapshot = (snapshot) => {
    if (!Array.isArray(snapshot.etfs) || snapshot.etfs.length === 0) {
        fail('EMPTY_SNAPSHOT', 'snapshot must contain at least one ETF');
    }
    const etfIsins = new Set();
    for (const etf of snapshot.etfs) {
        if (typeof etf.isin !== 'string' || etf.isin.trim() === '' || etfIsins.has(etf.isin)) {
            fail('INVALID_SNAPSHOT_ETF', 'snapshot ETF ISINs must be non-empty and unique', { isin: etf.isin });
        }
        etfIsins.add(etf.isin);
        for (const scenario of [...monte_carlo_contracts_model_1.MONTE_CARLO_SCENARIOS, 'general']) {
            const statistics = etf.statistics?.[scenario];
            if (!statistics) {
                fail('MISSING_ETF_MACRO_STATISTICS', 'snapshot ETF is missing scenario statistics', { isin: etf.isin, scenario });
            }
            const expectedReturn = assertFiniteNumber(statistics.expectedReturn, 'expectedReturn', { isin: etf.isin, scenario });
            const volatility = assertFiniteNumber(statistics.volatility, 'volatility', { isin: etf.isin, scenario });
            const rangeMin = assertFiniteNumber(statistics.returnRange?.min, 'returnRange.min', { isin: etf.isin, scenario });
            const rangeMax = assertFiniteNumber(statistics.returnRange?.max, 'returnRange.max', { isin: etf.isin, scenario });
            if (expectedReturn <= -1 || volatility < 0 || rangeMin < -1 || rangeMin > expectedReturn || expectedReturn > rangeMax) {
                fail('INVALID_ETF_MACRO_STATISTICS', 'snapshot ETF statistics violate the Monte Carlo contract', {
                    isin: etf.isin,
                    scenario,
                    expectedReturn,
                    volatility,
                    rangeMin,
                    rangeMax
                });
            }
            if (statistics.maxDrawdown !== undefined) {
                const maxDrawdown = assertFiniteNumber(statistics.maxDrawdown, 'maxDrawdown', { isin: etf.isin, scenario });
                if (maxDrawdown > 0) {
                    fail('INVALID_MAX_DRAWDOWN', 'maxDrawdown must be negative or zero when supplied', { isin: etf.isin, scenario, maxDrawdown });
                }
            }
        }
    }
    assertScenarioKeys(snapshot.structuralProbabilities, 'structuralProbabilities');
    let structuralTotal = 0;
    for (const scenario of monte_carlo_contracts_model_1.MONTE_CARLO_SCENARIOS) {
        const probability = assertFiniteNumber(snapshot.structuralProbabilities[scenario], 'structural probability', { scenario });
        assertRange(probability, 0, 1, 'structural probability', { scenario, probability });
        structuralTotal += probability;
    }
    if (Math.abs(structuralTotal - 1) > CONFIGURATION_EPSILON) {
        fail('INVALID_STRUCTURAL_PROBABILITY_SUM', 'structural probabilities must sum to 1', { structuralTotal, epsilon: CONFIGURATION_EPSILON });
    }
    assertScenarioKeys(snapshot.transitionMatrix, 'transitionMatrix');
    for (const fromScenario of monte_carlo_contracts_model_1.MONTE_CARLO_SCENARIOS) {
        const row = snapshot.transitionMatrix[fromScenario];
        assertScenarioKeys(row, `transitionMatrix.${fromScenario}`);
        let rowTotal = 0;
        for (const toScenario of monte_carlo_contracts_model_1.MONTE_CARLO_SCENARIOS) {
            const probability = assertFiniteNumber(row[toScenario], 'transition probability', { fromScenario, toScenario });
            assertRange(probability, 0, 1, 'transition probability', { fromScenario, toScenario, probability });
            rowTotal += probability;
        }
        if (Math.abs(rowTotal - 1) > CONFIGURATION_EPSILON) {
            fail('INVALID_TRANSITION_SUM', 'transition probabilities must sum to 1 for each source scenario', { fromScenario, rowTotal, epsilon: CONFIGURATION_EPSILON });
        }
    }
    validateInertiaConfigurations(snapshot);
    validateIntensityConfigurations(snapshot);
    validateGlobalProperties(snapshot);
    validateCorrelations(snapshot, etfIsins);
};
exports.validateMonteCarloSnapshot = validateMonteCarloSnapshot;
const validateMonteCarloRunContract = (input, snapshot) => {
    (0, exports.validateMonteCarloUserInput)(input);
    (0, exports.validateMonteCarloSnapshot)(snapshot);
    const snapshotIsins = new Set(snapshot.etfs.map((etf) => etf.isin));
    for (const position of input.positions) {
        if (!snapshotIsins.has(position.isin)) {
            fail('SNAPSHOT_INPUT_MISMATCH', 'target position is missing from snapshot', { isin: position.isin });
        }
    }
    if (snapshotIsins.size !== input.positions.length) {
        fail('SNAPSHOT_INPUT_MISMATCH', 'snapshot contains ETF data outside the user target positions');
    }
};
exports.validateMonteCarloRunContract = validateMonteCarloRunContract;
const validateInertiaConfigurations = (snapshot) => {
    assertScenarioKeys(snapshot.inertiaConfigurations, 'inertiaConfigurations');
    for (const scenario of monte_carlo_contracts_model_1.MONTE_CARLO_SCENARIOS) {
        const configuration = snapshot.inertiaConfigurations[scenario];
        const details = { scenario };
        const entryProbability = assertFiniteNumber(configuration.entryProbability, 'entryProbability', details);
        const persistenceProbability = assertFiniteNumber(configuration.persistenceProbability, 'persistenceProbability', details);
        const entryMonths = assertFiniteNumber(configuration.entryMonths, 'entryMonths', details);
        const exitStartMonth = assertFiniteNumber(configuration.exitStartMonth, 'exitStartMonth', details);
        const exitDecay = assertFiniteNumber(configuration.exitDecay, 'exitDecay', details);
        assertRange(entryProbability, 0, 1, 'entryProbability', details);
        assertRange(persistenceProbability, 0, 1, 'persistenceProbability', details);
        assertRange(exitDecay, 0, 1, 'exitDecay', details);
        if (!Number.isInteger(entryMonths) || entryMonths < 1 || !Number.isInteger(exitStartMonth) || exitStartMonth <= entryMonths) {
            fail('INVALID_INERTIA_CONFIGURATION', 'inertia months must be integers and exitStartMonth must exceed entryMonths', details);
        }
    }
};
const validateIntensityConfigurations = (snapshot) => {
    assertScenarioKeys(snapshot.intensityConfigurations, 'intensityConfigurations');
    for (const scenario of monte_carlo_contracts_model_1.MONTE_CARLO_SCENARIOS) {
        const configuration = snapshot.intensityConfigurations[scenario];
        const details = { scenario };
        const meanIntensity = assertFiniteNumber(configuration.meanIntensity, 'meanIntensity', details);
        const stdDevIntensity = assertFiniteNumber(configuration.stdDevIntensity, 'stdDevIntensity', details);
        assertRange(meanIntensity, 0, 1, 'meanIntensity', details);
        if (stdDevIntensity <= 0) {
            fail('INVALID_INTENSITY_CONFIGURATION', 'stdDevIntensity must be greater than zero', details);
        }
    }
};
const validateGlobalProperties = (snapshot) => {
    for (const propertyKey of monte_carlo_contracts_model_1.MONTE_CARLO_GLOBAL_PROPERTY_KEYS) {
        const value = assertFiniteNumber(snapshot.globalProperties[propertyKey], 'global property value', { propertyKey });
        assertRange(value, 0, 1, 'global property value', { propertyKey, value });
    }
};
const validateCorrelations = (snapshot, etfIsins) => {
    const correlations = new Map();
    for (const correlation of snapshot.correlations) {
        if (!etfIsins.has(correlation.isin1) || !etfIsins.has(correlation.isin2) || correlation.isin1 === correlation.isin2) {
            fail('INVALID_ETF_CORRELATION', 'correlation must join two distinct snapshot ETFs', { isin1: correlation.isin1, isin2: correlation.isin2 });
        }
        const pairKey = [correlation.isin1, correlation.isin2].sort().join(':');
        if (correlations.has(pairKey)) {
            fail('DUPLICATE_ETF_CORRELATION', 'snapshot contains duplicate ETF correlations', { isin1: correlation.isin1, isin2: correlation.isin2 });
        }
        for (const scenario of monte_carlo_contracts_model_1.MONTE_CARLO_SCENARIOS) {
            const value = assertFiniteNumber(correlation[scenario], 'correlation', { isin1: correlation.isin1, isin2: correlation.isin2, scenario });
            assertRange(value, -1, 1, 'correlation', { isin1: correlation.isin1, isin2: correlation.isin2, scenario, value });
        }
        correlations.set(pairKey, correlation);
    }
    const isins = [...etfIsins];
    for (let left = 0; left < isins.length; left += 1) {
        for (let right = left + 1; right < isins.length; right += 1) {
            const pairKey = [isins[left], isins[right]].sort().join(':');
            if (!correlations.has(pairKey)) {
                fail('MISSING_ETF_CORRELATION', 'snapshot is missing an ETF correlation', { isin1: isins[left], isin2: isins[right] });
            }
        }
    }
};
