import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  MonteCarloSnapshot,
  MonteCarloUserInput
} from '../models/monte-carlo-contracts.model';
import {
  MonteCarloContractValidationError,
  validateMonteCarloRunContract,
  validateMonteCarloSnapshot,
  validateMonteCarloUserInput
} from './monte-carlo-contract.validator';

const userInput: MonteCarloUserInput = {
  positions: [
    { isin: 'ETF-A', targetWeight: 0.5 },
    { isin: 'ETF-B', targetWeight: 0.5 }
  ],
  initialCapital: 10_000,
  horizonYears: 50
};

const snapshot: MonteCarloSnapshot = {
  etfs: ['ETF-A', 'ETF-B'].map((isin) => ({
    isin,
    name: isin,
    nickname: null,
    statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
      expectedReturn: 0.08,
      volatility: 0.12,
      returnRange: { min: -0.2, max: 0.3 }
    }])) as MonteCarloSnapshot['etfs'][number]['statistics']
  })),
  structuralProbabilities: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, 0.25])) as MonteCarloSnapshot['structuralProbabilities'],
  transitionMatrix: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((fromScenario) => [
    fromScenario,
    Object.fromEntries(MONTE_CARLO_SCENARIOS.map((toScenario) => [toScenario, 0.25]))
  ])) as MonteCarloSnapshot['transitionMatrix'],
  inertiaConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, {
    entryProbability: 0.6,
    persistenceProbability: 0.7,
    entryMonths: 2,
    exitStartMonth: 3,
    exitDecay: 0.1
  }])) as MonteCarloSnapshot['inertiaConfigurations'],
  intensityConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, {
    meanIntensity: 0.5,
    stdDevIntensity: 0.1
  }])) as MonteCarloSnapshot['intensityConfigurations'],
  globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [key, 0.4])) as MonteCarloSnapshot['globalProperties'],
  correlations: [{
    isin1: 'ETF-A',
    isin2: 'ETF-B',
    expansion: 0.2,
    recession: 0.3,
    stagflation: 0.4,
    soft_landing: 0.5
  }]
};

const expectError = (action: () => void, code: string): void => {
  try {
    action();
  } catch (error) {
    if (error instanceof MonteCarloContractValidationError && error.code === code) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected ${code}`);
};

validateMonteCarloRunContract(userInput, snapshot);
expectError(() => validateMonteCarloUserInput({ ...userInput, initialCapital: 0 }), 'INVALID_INITIAL_CAPITAL');
expectError(() => validateMonteCarloUserInput({ ...userInput, horizonYears: 1.5 }), 'INVALID_HORIZON_YEARS');
expectError(() => validateMonteCarloUserInput({ ...userInput, positions: [{ isin: 'ETF-A', targetWeight: 0.9 }] }), 'INVALID_TARGET_WEIGHT_SUM');
expectError(() => validateMonteCarloSnapshot({ ...snapshot, structuralProbabilities: { ...snapshot.structuralProbabilities, expansion: 0.5 } }), 'INVALID_STRUCTURAL_PROBABILITY_SUM');
expectError(() => validateMonteCarloSnapshot({ ...snapshot, correlations: [] }), 'MISSING_ETF_CORRELATION');
expectError(() => validateMonteCarloSnapshot({ ...snapshot, intensityConfigurations: { ...snapshot.intensityConfigurations, expansion: { meanIntensity: 0.5, stdDevIntensity: 0 } } }), 'INVALID_INTENSITY_CONFIGURATION');
expectError(() => validateMonteCarloRunContract({ ...userInput, positions: [{ isin: 'ETF-A', targetWeight: 1 }] }, snapshot), 'SNAPSHOT_INPUT_MISMATCH');

console.log('Monte Carlo contract validation tests passed.');