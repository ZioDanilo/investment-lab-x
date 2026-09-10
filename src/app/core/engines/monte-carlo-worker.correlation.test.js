import assert from 'node:assert/strict';
import { buildPathResult } from './monte-carlo-worker';
import { MONTE_CARLO_GLOBAL_PROPERTY_KEYS, MONTE_CARLO_SCENARIOS } from '../models/monte-carlo-contracts.model';
import { prepareMonteCarloPrecomputation } from '../precomputation/monte-carlo-precomputation';
const createSnapshot = (correlation) => ({
    etfs: ['ETF-A', 'ETF-B'].map((isin) => ({
        isin,
        name: isin,
        nickname: null,
        statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
                expectedReturn: 0.12,
                volatility: 0.2,
                returnRange: { min: -1, max: 1 }
            }]))
    })),
    structuralProbabilities: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 },
    transitionMatrix: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((from) => [from, Object.fromEntries(MONTE_CARLO_SCENARIOS.map((to) => [to, from === to ? 1 : 0]))])),
    inertiaConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 }])),
    intensityConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, { meanIntensity: 0.5, stdDevIntensity: 0.1 }])),
    globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [key, 0.4])),
    correlations: [{ isin1: 'ETF-A', isin2: 'ETF-B', expansion: correlation, recession: correlation, stagflation: correlation, soft_landing: correlation }]
});
const snapshot = createSnapshot(0.6);
const precompute = prepareMonteCarloPrecomputation(snapshot);
const input = {
    initialCapital: 100,
    horizonYears: 1,
    positions: [
        { isin: 'ETF-A', targetWeight: 0.5, minWeight: 0, maxWeight: 1 },
        { isin: 'ETF-B', targetWeight: 0.5, minWeight: 0, maxWeight: 1 }
    ],
    rebalance: { enabled: true, frequencyYears: 1 }
};
const path = buildPathResult(input, snapshot, precompute, 1, 0);
assert.ok(path.correlationDiagnostics && Object.keys(path.correlationDiagnostics).length > 0, 'correlation diagnostics should be populated for a valid multi-ETF path');
assert.ok(Array.isArray(path.correlationDiagnostics.target) && path.correlationDiagnostics.target.length >= 2, 'target matrix should be present');
assert.ok(Array.isArray(path.correlationDiagnostics.operational) && path.correlationDiagnostics.operational.length >= 2, 'operational matrix should be present');
assert.ok(Array.isArray(path.correlationDiagnostics.empiricalReturn) && path.correlationDiagnostics.empiricalReturn.length >= 2, 'empiricalReturn should be present');
assert.ok(Array.isArray(path.correlationDiagnostics.pearsonPrimary) && path.correlationDiagnostics.pearsonPrimary.length >= 2, 'pearsonPrimary should be present');
assert.ok(Array.isArray(path.correlationDiagnostics.spearmanDiagnostic) && path.correlationDiagnostics.spearmanDiagnostic.length >= 2, 'spearmanDiagnostic should be present');
console.log('worker correlation diagnostics test passed');
