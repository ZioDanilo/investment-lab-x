import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMonteCarloSnapshotRequest, buildMonteCarloUserInput, buildMonteCarloUserInputFromPortfolioHoldings, createCompleteExecutionMode } from './monte-carlo-ui-flow';
import { MONTE_CARLO_EXECUTION_MODES } from './engines/monte-carlo-coordinator';
import { validateMonteCarloRunContract } from './validation/monte-carlo-contract.validator';
import type { MonteCarloSnapshot } from './models/monte-carlo-contracts.model';

type EtfLike = {
  isin: string;
  weight: number;
};

const makeSnapshot = (): MonteCarloSnapshot => ({
  etfs: [
    {
      isin: 'ETF-A',
      name: 'ETF A',
      nickname: 'A',
      statistics: {
        expansion: { expectedReturn: 0.08, volatility: 0.13, returnRange: { min: -0.2, max: 0.25 } },
        recession: { expectedReturn: -0.05, volatility: 0.17, returnRange: { min: -0.35, max: 0.1 } },
        stagflation: { expectedReturn: -0.02, volatility: 0.18, returnRange: { min: -0.3, max: 0.12 } },
        soft_landing: { expectedReturn: 0.06, volatility: 0.12, returnRange: { min: -0.15, max: 0.2 } },
        general: { expectedReturn: 0.06, volatility: 0.15, returnRange: { min: -0.25, max: 0.2 } }
      }
    },
    {
      isin: 'ETF-B',
      name: 'ETF B',
      nickname: 'B',
      statistics: {
        expansion: { expectedReturn: 0.09, volatility: 0.15, returnRange: { min: -0.18, max: 0.26 } },
        recession: { expectedReturn: -0.04, volatility: 0.18, returnRange: { min: -0.32, max: 0.11 } },
        stagflation: { expectedReturn: -0.01, volatility: 0.17, returnRange: { min: -0.28, max: 0.13 } },
        soft_landing: { expectedReturn: 0.07, volatility: 0.13, returnRange: { min: -0.12, max: 0.22 } },
        general: { expectedReturn: 0.07, volatility: 0.16, returnRange: { min: -0.24, max: 0.22 } }
      }
    }
  ],
  structuralProbabilities: { expansion: 0.45, recession: 0.2, stagflation: 0.15, soft_landing: 0.2 },
  transitionMatrix: {
    expansion: { expansion: 0.6, recession: 0.1, stagflation: 0.1, soft_landing: 0.2 },
    recession: { expansion: 0.25, recession: 0.2, stagflation: 0.1, soft_landing: 0.45 },
    stagflation: { expansion: 0.2, recession: 0.2, stagflation: 0.3, soft_landing: 0.3 },
    soft_landing: { expansion: 0.35, recession: 0.25, stagflation: 0.1, soft_landing: 0.3 }
  },
  inertiaConfigurations: {
    expansion: { entryProbability: 0.2, persistenceProbability: 0.75, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    recession: { entryProbability: 0.25, persistenceProbability: 0.7, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    stagflation: { entryProbability: 0.3, persistenceProbability: 0.68, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    soft_landing: { entryProbability: 0.2, persistenceProbability: 0.8, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 }
  },
  intensityConfigurations: {
    expansion: { meanIntensity: 0.35, stdDevIntensity: 0.12 },
    recession: { meanIntensity: 0.55, stdDevIntensity: 0.15 },
    stagflation: { meanIntensity: 0.47, stdDevIntensity: 0.14 },
    soft_landing: { meanIntensity: 0.3, stdDevIntensity: 0.1 }
  },
  globalProperties: {
    scenario_transition_intensity_threshold: 0.6,
    new_scenario_first_month_max_intensity: 0.4,
    new_scenario_second_month_max_intensity: 0.7,
    scenario_intensity_max_monthly_variation: 0.4
  },
  correlations: [{ isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.35, recession: 0.42, stagflation: 0.4, soft_landing: 0.38 }]
});

const etfs: EtfLike[] = [
  { isin: 'ETF-A', weight: 0.6 },
  { isin: 'ETF-B', weight: 0.4 }
];

assert.deepEqual(buildMonteCarloSnapshotRequest(etfs), { isins: ['ETF-A', 'ETF-B'] });

const input = buildMonteCarloUserInput(etfs, 10000, 10);
assert.deepEqual(input.positions, [
  { isin: 'ETF-A', targetWeight: 0.6 },
  { isin: 'ETF-B', targetWeight: 0.4 }
]);
const portfolioInput = buildMonteCarloUserInputFromPortfolioHoldings([
  { isin: 'ETF-A', weight: 0.6 },
  { isin: 'ETF-B', weight: 0.4 }
], 10000, 10);
assert.deepEqual(portfolioInput.positions, [
  { isin: 'ETF-A', targetWeight: 0.6 },
  { isin: 'ETF-B', targetWeight: 0.4 }
]);
assert.equal(input.initialCapital, 10000);
assert.equal(input.horizonYears, 10);
validateMonteCarloRunContract(input, makeSnapshot());
assert.equal(MONTE_CARLO_EXECUTION_MODES.COMPLETE, 1_000);
assert.equal(createCompleteExecutionMode(), 'COMPLETE');
assert.throws(() => buildMonteCarloUserInput([{ isin: 'ETF-A', weight: 0.7 }, { isin: 'ETF-B', weight: 0.1 }], 10000, 10), /INVALID_TARGET_WEIGHT_SUM|EMPTY_PORTFOLIO/);
assert.ok(!('simulationCount' in input));
assert.ok(!('pathCount' in input));
assert.ok(!('seed' in input));
assert.ok(!('workerCount' in input));

const template = readFileSync(new URL('../features/montecarlo/montecarlo-new-page.component.html', import.meta.url), 'utf8');
assert.equal(template.includes('simulationCount'), false);
assert.equal(template.includes('pathCount'), false);
assert.equal(template.includes('seed'), false);
assert.equal(template.includes('worker'), false);

console.log('PASS monte-carlo-step10.test');
