import {
  generateMonthlyMacroTimeline,
  getStayProbability,
  INTENSITY_AR_RHO
} from './monte-carlo-macro-engine';
import { truncatedNormalQuantile } from '../probability/monte-carlo-probability';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  MonteCarloSnapshot
} from '../models/monte-carlo-contracts.model';

const assertClose = (actual: number, expected: number, tolerance: number, label: string): void => {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${label}: ${actual} is not within ${tolerance} of ${expected}`);
};

const createSequence = (values: number[]): (() => number) => {
  let index = 0;
  return () => values[index++ % values.length];
};

const createLcg = (): (() => number) => {
  let state = 0x12345678;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const createSnapshot = (): MonteCarloSnapshot => ({
  etfs: [{
    isin: 'ETF-A', name: 'ETF-A', nickname: null,
    statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
      expectedReturn: 0.08, volatility: 0.12, returnRange: { min: -0.2, max: 0.3 }
    }])) as MonteCarloSnapshot['etfs'][number]['statistics']
  }],
  structuralProbabilities: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 },
  transitionMatrix: {
    expansion: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 },
    recession: { expansion: 0, recession: 1, stagflation: 0, soft_landing: 0 },
    stagflation: { expansion: 0, recession: 0, stagflation: 1, soft_landing: 0 },
    soft_landing: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 1 }
  },
  inertiaConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, {
    entryProbability: 0,
    persistenceProbability: 0,
    entryMonths: 3,
    exitStartMonth: 6,
    exitDecay: 0
  }])) as MonteCarloSnapshot['inertiaConfigurations'],
  intensityConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, {
    meanIntensity: 0.1,
    stdDevIntensity: 0.01
  }])) as MonteCarloSnapshot['intensityConfigurations'],
  globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [
    key,
    key === 'scenario_transition_intensity_threshold' ? 0.6 :
    key === 'new_scenario_first_month_max_intensity' ? 0.4 :
    key === 'new_scenario_second_month_max_intensity' ? 0.7 :
    key === 'scenario_intensity_max_monthly_variation' ? 0.4 :
    0.4
  ])) as MonteCarloSnapshot['globalProperties'],
  correlations: []
});

const initialSnapshot = createSnapshot();
initialSnapshot.intensityConfigurations.expansion = { meanIntensity: 0.8, stdDevIntensity: 0.01 };
const initialTimeline = generateMonthlyMacroTimeline(initialSnapshot, 1, createSequence([0.2, 0.5]));
if (initialTimeline.months[0].scenario !== 'expansion' || initialTimeline.months[0].intensity <= 0.4 || initialTimeline.months[0].intensityDiagnostics.kind !== 'initial_base') {
  throw new Error('First absolute month must use the structural scenario and base intensity without entry soft threshold');
}

const lockSnapshot = createSnapshot();
lockSnapshot.intensityConfigurations.expansion = { meanIntensity: 0.9, stdDevIntensity: 0.01 };
const lockTimeline = generateMonthlyMacroTimeline(lockSnapshot, 4, createSequence([0.1, 0.5]));
if (lockTimeline.months.slice(1).some((state) => state.transitionCause !== 'intensity_lock' || state.scenario !== 'expansion')) {
  throw new Error('Intensity above the transition threshold must force permanence');
}

const reachabilityHighIntensitySnapshot = createSnapshot();
reachabilityHighIntensitySnapshot.intensityConfigurations.expansion = { meanIntensity: 0.9, stdDevIntensity: 0.01 };
reachabilityHighIntensitySnapshot.transitionMatrix.expansion = { expansion: 0, recession: 1, stagflation: 0, soft_landing: 0 };
reachabilityHighIntensitySnapshot.inertiaConfigurations.expansion = { entryProbability: 0, persistenceProbability: 0, entryMonths: 1, exitStartMonth: 99, exitDecay: 0 };
const reachabilityHighIntensityTimeline = generateMonthlyMacroTimeline(reachabilityHighIntensitySnapshot, 2, createSequence([0.95, 0.2, 0.8]));
if (reachabilityHighIntensityTimeline.months[1].transitionCause !== 'intensity_lock' || reachabilityHighIntensityTimeline.months[1].scenario !== 'expansion') {
  throw new Error('High intensity must block transition before a new scenario can start');
}

const reachabilityMonthOneSnapshot = createSnapshot();
reachabilityMonthOneSnapshot.intensityConfigurations.expansion = { meanIntensity: 0.5, stdDevIntensity: 0.01 };
reachabilityMonthOneSnapshot.transitionMatrix.expansion = { expansion: 0, recession: 1, stagflation: 0, soft_landing: 0 };
reachabilityMonthOneSnapshot.inertiaConfigurations.expansion = { entryProbability: 0, persistenceProbability: 0, entryMonths: 1, exitStartMonth: 99, exitDecay: 0 };
const reachabilityMonthOneTimeline = generateMonthlyMacroTimeline(reachabilityMonthOneSnapshot, 2, createSequence([0.1, 0.5, 0.5]));
if (reachabilityMonthOneTimeline.months[1].transitionCause !== 'markov_transition' || reachabilityMonthOneTimeline.months[1].monthsInCurrentScenario !== 1) {
  throw new Error('A low-intensity regime must be allowed to transition and start a new scenario month1');
}
if (reachabilityMonthOneTimeline.months[1].intensityDiagnostics.lower > 0.4 + 1e-12) {
  throw new Error('Month1 reachability invariant broken: new scenario month1 support must contain 0.40');
}

const reachabilityMonthTwoSnapshot = createSnapshot();
reachabilityMonthTwoSnapshot.intensityConfigurations.expansion = { meanIntensity: 0.5, stdDevIntensity: 0.1 };
reachabilityMonthTwoSnapshot.inertiaConfigurations.expansion = { entryProbability: 1, persistenceProbability: 1, entryMonths: 9, exitStartMonth: 99, exitDecay: 0 };
const reachabilityMonthTwoTimeline = generateMonthlyMacroTimeline(reachabilityMonthTwoSnapshot, 3, createSequence([0.1, 0.5, 0.2, 0.5]));
if (reachabilityMonthTwoTimeline.months[1].intensityDiagnostics.kind !== 'ar1_second_month') {
  throw new Error('Second month of a retained scenario must use the month2 soft-threshold path');
}
if (reachabilityMonthTwoTimeline.months[1].intensityDiagnostics.lower > 0.7 + 1e-12) {
  throw new Error('Month2 reachability invariant broken: month2 support must contain 0.70');
}

const markovSnapshot = createSnapshot();
markovSnapshot.transitionMatrix.expansion = { expansion: 0, recession: 1, stagflation: 0, soft_landing: 0 };
markovSnapshot.intensityConfigurations.recession = { meanIntensity: 0.9, stdDevIntensity: 0.1 };
const markovTimeline = generateMonthlyMacroTimeline(markovSnapshot, 3, createSequence([0.1, 0.5, 0.9, 0.2, 0.5, 0.5]));
if (markovTimeline.months[1].scenario !== 'recession' || markovTimeline.months[1].monthsInCurrentScenario !== 1 || markovTimeline.months[1].transitionCause !== 'markov_transition') {
  throw new Error('Markov transition must change scenario and reset scenario age');
}
const entryDiagnostics = markovTimeline.months[1].intensityDiagnostics;
if ((entryDiagnostics.softThreshold ?? NaN) !== 0.4 || truncatedNormalQuantile(0.95, entryDiagnostics) > 0.4 + 1e-10) {
  throw new Error('New-scenario first month must use the P95 0.40 soft threshold');
}
const secondDiagnostics = markovTimeline.months[2].intensityDiagnostics;
if (secondDiagnostics.kind !== 'ar1_second_month' || (secondDiagnostics.softThreshold ?? NaN) !== 0.7 || truncatedNormalQuantile(0.95, secondDiagnostics) > 0.7 + 1e-10) {
  throw new Error('New-scenario second month must use the P95 0.70 soft threshold');
}

const inertiaSnapshot = createSnapshot();
inertiaSnapshot.inertiaConfigurations.expansion = { entryProbability: 1, persistenceProbability: 1, entryMonths: 3, exitStartMonth: 6, exitDecay: 0.5 };
inertiaSnapshot.transitionMatrix.expansion = { expansion: 0, recession: 1, stagflation: 0, soft_landing: 0 };
const inertiaTimeline = generateMonthlyMacroTimeline(inertiaSnapshot, 8, createSequence([0.1, 0.5]));
if (inertiaTimeline.months[1].transitionCause !== 'entry_protection' || inertiaTimeline.months[4].transitionCause !== 'persistence_protection' || inertiaTimeline.months[6].transitionCause !== 'exit_protection' || inertiaTimeline.months[7].scenario !== 'recession') {
  throw new Error('Inertia ENTRY, PERSISTENCE and EXIT phases must follow their configured ages');
}
assertClose(getStayProbability(inertiaSnapshot.inertiaConfigurations.expansion, 6).probability, 0.5, 1e-12, 'EXIT persistence at month 6');

const ar1Snapshot = createSnapshot();
ar1Snapshot.inertiaConfigurations.expansion = { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 10, exitDecay: 0 };
ar1Snapshot.intensityConfigurations.expansion = { meanIntensity: 0.5, stdDevIntensity: 0.2 };
const ar1Timeline = generateMonthlyMacroTimeline(ar1Snapshot, 4, createSequence([0.1, 0.5]));
const thirdMonth = ar1Timeline.months[2];
if (thirdMonth.intensityDiagnostics.kind !== 'ar1') throw new Error('Third regime month must use standard AR(1) intensity');
const secondMonth = ar1Timeline.months[1];
assertClose(thirdMonth.intensityDiagnostics.mean, 0.5 + INTENSITY_AR_RHO * (secondMonth.intensity - 0.5), 1e-12, 'AR(1) conditional mean');
for (let index = 1; index < ar1Timeline.months.length; index += 1) {
  const current = ar1Timeline.months[index];
  const previous = ar1Timeline.months[index - 1];
  if (current.intensity < 0 || current.intensity > 1 || Math.abs(current.intensity - previous.intensity) > 0.4) {
    throw new Error('Persistent intensity must stay in [0,1] and inside its truncated variation interval');
  }
}

const frequencySnapshot = createSnapshot();
frequencySnapshot.structuralProbabilities = { expansion: 0.4, recession: 0.3, stagflation: 0.2, soft_landing: 0.1 };
const frequencyCounts = { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 };
const frequencyRandom = createLcg();
const frequencySampleSize = 20_000;
for (let index = 0; index < frequencySampleSize; index += 1) {
  frequencyCounts[generateMonthlyMacroTimeline(frequencySnapshot, 1, frequencyRandom).months[0].scenario] += 1;
}
for (const scenario of MONTE_CARLO_SCENARIOS) {
  assertClose(frequencyCounts[scenario] / frequencySampleSize, frequencySnapshot.structuralProbabilities[scenario], 0.02, `Structural frequency ${scenario}`);
}

const transitionSnapshot = createSnapshot();
transitionSnapshot.transitionMatrix.expansion = { expansion: 0.3, recession: 0.7, stagflation: 0, soft_landing: 0 };
const transitionRandom = createLcg();
let recessionTransitions = 0;
const transitionSampleSize = 20_000;
for (let index = 0; index < transitionSampleSize; index += 1) {
  if (generateMonthlyMacroTimeline(transitionSnapshot, 2, transitionRandom).months[1].scenario === 'recession') recessionTransitions += 1;
}
assertClose(recessionTransitions / transitionSampleSize, 0.7, 0.02, 'Markov empirical transition frequency');

const intensitySnapshot = createSnapshot();
intensitySnapshot.intensityConfigurations.expansion = { meanIntensity: 0.5, stdDevIntensity: 0.1 };
const intensityRandom = createLcg();
let intensitySum = 0;
const intensitySampleSize = 20_000;
for (let index = 0; index < intensitySampleSize; index += 1) {
  intensitySum += generateMonthlyMacroTimeline(intensitySnapshot, 1, intensityRandom).months[0].intensity;
}
assertClose(intensitySum / intensitySampleSize, 0.5, 0.02, 'Base truncated-normal intensity mean');

console.log('Monte Carlo Step 5 macro engine tests passed.');