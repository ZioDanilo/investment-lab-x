import { INTENSITY_MEAN_SOLVER_MAX_ITERATIONS, INTENSITY_MEAN_SOLVER_TOLERANCE, sampleTruncatedNormal, solveTruncatedNormalMeanForQuantile, truncatedNormalQuantile } from '../probability/monte-carlo-probability';
export const INTENSITY_AR_RHO = 0.85;
export const ENTRY_SOFT_QUANTILE = 0.95;
export class MonteCarloMacroEngineError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MonteCarloMacroEngineError';
    }
}
const fail = (code, message, details = {}) => {
    throw new MonteCarloMacroEngineError(code, message, details);
};
const drawScenario = (probabilities, random) => {
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
        fail('INVALID_UNIFORM_RANDOM_VALUE', 'uniform random source must return a value in [0, 1)', { draw });
    }
    let cumulativeProbability = 0;
    for (const scenario of ['expansion', 'recession', 'stagflation', 'soft_landing']) {
        cumulativeProbability += probabilities[scenario];
        if (draw < cumulativeProbability)
            return scenario;
    }
    return fail('SCENARIO_DRAW_FAILED', 'scenario probabilities did not select a scenario', { draw, cumulativeProbability });
};
const getStayDecision = (scenario, intensity, monthsInCurrentScenario, snapshot, random) => {
    const threshold = snapshot.globalProperties.scenario_transition_intensity_threshold;
    if (intensity > threshold) {
        return { nextScenario: scenario, cause: 'intensity_lock' };
    }
    const configuration = snapshot.inertiaConfigurations[scenario];
    const { probability, cause } = getStayProbability(configuration, monthsInCurrentScenario);
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
        fail('INVALID_UNIFORM_RANDOM_VALUE', 'uniform random source must return a value in [0, 1)', { draw });
    }
    if (draw < probability) {
        return { nextScenario: scenario, cause };
    }
    const nextScenario = drawScenario(snapshot.transitionMatrix[scenario], random);
    return {
        nextScenario,
        cause: nextScenario === scenario ? 'markov_self' : 'markov_transition'
    };
};
export const getStayProbability = (configuration, monthsInCurrentScenario) => {
    if (monthsInCurrentScenario <= configuration.entryMonths) {
        return { probability: configuration.entryProbability, cause: 'entry_protection' };
    }
    if (monthsInCurrentScenario < configuration.exitStartMonth) {
        return { probability: configuration.persistenceProbability, cause: 'persistence_protection' };
    }
    const exitSteps = monthsInCurrentScenario - configuration.exitStartMonth + 1;
    return {
        probability: Math.max(0, configuration.persistenceProbability - configuration.exitDecay * exitSteps),
        cause: 'exit_protection'
    };
};
const createBaseIntensityParameters = (configuration) => ({
    mean: configuration.meanIntensity,
    standardDeviation: configuration.stdDevIntensity,
    lower: 0,
    upper: 1
});
const createAr1IntensityParameters = (configuration, previousIntensity, maxMonthlyVariation) => ({
    mean: configuration.meanIntensity + INTENSITY_AR_RHO * (previousIntensity - configuration.meanIntensity),
    standardDeviation: configuration.stdDevIntensity * Math.sqrt(1 - INTENSITY_AR_RHO ** 2),
    lower: Math.max(0, previousIntensity - maxMonthlyVariation),
    upper: Math.min(1, previousIntensity + maxMonthlyVariation)
});
const applySoftThreshold = (parameters, threshold) => {
    if (truncatedNormalQuantile(ENTRY_SOFT_QUANTILE, parameters) <= threshold)
        return parameters;
    const mean = solveTruncatedNormalMeanForQuantile({
        ...parameters,
        quantile: ENTRY_SOFT_QUANTILE,
        targetValue: threshold
    });
    return { ...parameters, mean };
};
const sampleIntensity = (parameters, kind, softThreshold, random) => {
    const intensity = sampleTruncatedNormal(parameters, random);
    if (intensity < 0 || intensity > 1 || !Number.isFinite(intensity)) {
        fail('INVALID_INTENSITY', 'sampled intensity must be finite and in [0, 1]', { intensity, parameters });
    }
    return {
        intensity,
        diagnostics: { kind, ...parameters, softThreshold }
    };
};
const createInitialIntensity = (snapshot, scenario, random) => {
    const parameters = createBaseIntensityParameters(snapshot.intensityConfigurations[scenario]);
    return sampleIntensity(parameters, 'initial_base', null, random);
};
const createNextIntensity = (snapshot, scenario, monthsInCurrentScenario, previousIntensity, scenarioChanged, random) => {
    const configuration = snapshot.intensityConfigurations[scenario];
    if (scenarioChanged) {
        const threshold = snapshot.globalProperties.new_scenario_first_month_max_intensity;
        const parameters = applySoftThreshold(createBaseIntensityParameters(configuration), threshold);
        return sampleIntensity(parameters, 'entry', threshold, random);
    }
    const parameters = createAr1IntensityParameters(configuration, previousIntensity, snapshot.globalProperties.scenario_intensity_max_monthly_variation);
    if (monthsInCurrentScenario === 2) {
        const threshold = snapshot.globalProperties.new_scenario_second_month_max_intensity;
        return sampleIntensity(applySoftThreshold(parameters, threshold), 'ar1_second_month', threshold, random);
    }
    return sampleIntensity(parameters, 'ar1', null, random);
};
export const generateMonthlyMacroTimeline = (snapshot, numberOfMonths, random) => {
    if (!Number.isInteger(numberOfMonths) || numberOfMonths <= 0) {
        fail('INVALID_MONTH_COUNT', 'numberOfMonths must be a positive integer', { numberOfMonths });
    }
    const initialScenario = drawScenario(snapshot.structuralProbabilities, random);
    const initialIntensity = createInitialIntensity(snapshot, initialScenario, random);
    const months = [{
            month: 1,
            scenario: initialScenario,
            intensity: initialIntensity.intensity,
            monthsInCurrentScenario: 1,
            transitionCause: 'initial',
            intensityDiagnostics: initialIntensity.diagnostics
        }];
    for (let month = 2; month <= numberOfMonths; month += 1) {
        const previous = months[months.length - 1];
        const transition = getStayDecision(previous.scenario, previous.intensity, previous.monthsInCurrentScenario, snapshot, random);
        const scenarioChanged = transition.nextScenario !== previous.scenario;
        const monthsInCurrentScenario = scenarioChanged ? 1 : previous.monthsInCurrentScenario + 1;
        const intensity = createNextIntensity(snapshot, transition.nextScenario, monthsInCurrentScenario, previous.intensity, scenarioChanged, random);
        months.push({
            month,
            scenario: transition.nextScenario,
            intensity: intensity.intensity,
            monthsInCurrentScenario,
            transitionCause: transition.cause,
            intensityDiagnostics: intensity.diagnostics
        });
    }
    return { months };
};
export const macroEngineConstants = {
    INTENSITY_AR_RHO,
    ENTRY_SOFT_QUANTILE,
    INTENSITY_MEAN_SOLVER_TOLERANCE,
    INTENSITY_MEAN_SOLVER_MAX_ITERATIONS
};
