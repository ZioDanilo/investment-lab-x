import {
  MonteCarloIntensityConfiguration,
  MonteCarloInertiaConfiguration,
  MonteCarloScenario,
  MonteCarloSnapshot
} from '../models/monte-carlo-contracts.model';
import {
  INTENSITY_MEAN_SOLVER_MAX_ITERATIONS,
  INTENSITY_MEAN_SOLVER_TOLERANCE,
  sampleTruncatedNormal,
  solveTruncatedNormalMeanForQuantile,
  truncatedNormalQuantile,
  TruncatedNormalParameters,
  UniformRandomSource
} from '../probability/monte-carlo-probability';

export const INTENSITY_AR_RHO = 0.85;
export const ENTRY_SOFT_QUANTILE = 0.95;

export type MacroTransitionCause =
  | 'initial'
  | 'intensity_lock'
  | 'entry_protection'
  | 'persistence_protection'
  | 'exit_protection'
  | 'markov_self'
  | 'markov_transition';

export type MacroIntensityKind = 'initial_base' | 'entry' | 'ar1_second_month' | 'ar1';

export interface MacroIntensityDiagnostics {
  kind: MacroIntensityKind;
  mean: number;
  standardDeviation: number;
  lower: number;
  upper: number;
  softThreshold: number | null;
}

export interface MonthlyMacroState {
  month: number;
  scenario: MonteCarloScenario;
  intensity: number;
  monthsInCurrentScenario: number;
  transitionCause: MacroTransitionCause;
  intensityDiagnostics: MacroIntensityDiagnostics;
}

export interface MacroTimeline {
  months: MonthlyMacroState[];
}

export class MonteCarloMacroEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'MonteCarloMacroEngineError';
  }
}

const fail = (code: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new MonteCarloMacroEngineError(code, message, details);
};

const drawScenario = (probabilities: Record<MonteCarloScenario, number>, random: UniformRandomSource): MonteCarloScenario => {
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    fail('INVALID_UNIFORM_RANDOM_VALUE', 'uniform random source must return a value in [0, 1)', { draw });
  }
  let cumulativeProbability = 0;
  for (const scenario of ['expansion', 'recession', 'stagflation', 'soft_landing'] as const) {
    cumulativeProbability += probabilities[scenario];
    if (draw < cumulativeProbability) return scenario;
  }
  return fail('SCENARIO_DRAW_FAILED', 'scenario probabilities did not select a scenario', { draw, cumulativeProbability });
};

const getStayDecision = (
  scenario: MonteCarloScenario,
  intensity: number,
  monthsInCurrentScenario: number,
  snapshot: MonteCarloSnapshot,
  random: UniformRandomSource
): { nextScenario: MonteCarloScenario; cause: MacroTransitionCause } => {
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

export const getStayProbability = (
  configuration: MonteCarloInertiaConfiguration,
  monthsInCurrentScenario: number
): { probability: number; cause: Extract<MacroTransitionCause, 'entry_protection' | 'persistence_protection' | 'exit_protection'> } => {
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

const createBaseIntensityParameters = (configuration: MonteCarloIntensityConfiguration): TruncatedNormalParameters => ({
  mean: configuration.meanIntensity,
  standardDeviation: configuration.stdDevIntensity,
  lower: 0,
  upper: 1
});

const createAr1IntensityParameters = (
  configuration: MonteCarloIntensityConfiguration,
  previousIntensity: number,
  maxMonthlyVariation: number
): TruncatedNormalParameters => ({
  mean: configuration.meanIntensity + INTENSITY_AR_RHO * (previousIntensity - configuration.meanIntensity),
  standardDeviation: configuration.stdDevIntensity * Math.sqrt(1 - INTENSITY_AR_RHO ** 2),
  lower: Math.max(0, previousIntensity - maxMonthlyVariation),
  upper: Math.min(1, previousIntensity + maxMonthlyVariation)
});

const applySoftThreshold = (
  parameters: TruncatedNormalParameters,
  threshold: number
): TruncatedNormalParameters => {
  if (truncatedNormalQuantile(ENTRY_SOFT_QUANTILE, parameters) <= threshold) return parameters;
  const mean = solveTruncatedNormalMeanForQuantile({
    ...parameters,
    quantile: ENTRY_SOFT_QUANTILE,
    targetValue: threshold
  });
  return { ...parameters, mean };
};

const sampleIntensity = (
  parameters: TruncatedNormalParameters,
  kind: MacroIntensityKind,
  softThreshold: number | null,
  random: UniformRandomSource
): { intensity: number; diagnostics: MacroIntensityDiagnostics } => {
  const intensity = sampleTruncatedNormal(parameters, random);
  if (intensity < 0 || intensity > 1 || !Number.isFinite(intensity)) {
    fail('INVALID_INTENSITY', 'sampled intensity must be finite and in [0, 1]', { intensity, parameters });
  }
  return {
    intensity,
    diagnostics: { kind, ...parameters, softThreshold }
  };
};

const createInitialIntensity = (snapshot: MonteCarloSnapshot, scenario: MonteCarloScenario, random: UniformRandomSource) => {
  const parameters = createBaseIntensityParameters(snapshot.intensityConfigurations[scenario]);
  return sampleIntensity(parameters, 'initial_base', null, random);
};

const createNextIntensity = (
  snapshot: MonteCarloSnapshot,
  scenario: MonteCarloScenario,
  monthsInCurrentScenario: number,
  previousIntensity: number,
  scenarioChanged: boolean,
  random: UniformRandomSource
) => {
  const configuration = snapshot.intensityConfigurations[scenario];
  if (scenarioChanged) {
    const threshold = snapshot.globalProperties.new_scenario_first_month_max_intensity;
    const parameters = applySoftThreshold(createBaseIntensityParameters(configuration), threshold);
    return sampleIntensity(parameters, 'entry', threshold, random);
  }

  const parameters = createAr1IntensityParameters(
    configuration,
    previousIntensity,
    snapshot.globalProperties.scenario_intensity_max_monthly_variation
  );
  if (monthsInCurrentScenario === 2) {
    const threshold = snapshot.globalProperties.new_scenario_second_month_max_intensity;
    return sampleIntensity(applySoftThreshold(parameters, threshold), 'ar1_second_month', threshold, random);
  }
  return sampleIntensity(parameters, 'ar1', null, random);
};

export const generateMonthlyMacroTimeline = (
  snapshot: MonteCarloSnapshot,
  numberOfMonths: number,
  random: UniformRandomSource
): MacroTimeline => {
  if (!Number.isInteger(numberOfMonths) || numberOfMonths <= 0) {
    fail('INVALID_MONTH_COUNT', 'numberOfMonths must be a positive integer', { numberOfMonths });
  }

  const initialScenario = drawScenario(snapshot.structuralProbabilities, random);
  const initialIntensity = createInitialIntensity(snapshot, initialScenario, random);
  const months: MonthlyMacroState[] = [{
    month: 1,
    scenario: initialScenario,
    intensity: initialIntensity.intensity,
    monthsInCurrentScenario: 1,
    transitionCause: 'initial',
    intensityDiagnostics: initialIntensity.diagnostics
  }];

  for (let month = 2; month <= numberOfMonths; month += 1) {
    const previous = months[months.length - 1];
    const transition = getStayDecision(
      previous.scenario,
      previous.intensity,
      previous.monthsInCurrentScenario,
      snapshot,
      random
    );
    const scenarioChanged = transition.nextScenario !== previous.scenario;
    const monthsInCurrentScenario = scenarioChanged ? 1 : previous.monthsInCurrentScenario + 1;
    const intensity = createNextIntensity(
      snapshot,
      transition.nextScenario,
      monthsInCurrentScenario,
      previous.intensity,
      scenarioChanged,
      random
    );
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
} as const;