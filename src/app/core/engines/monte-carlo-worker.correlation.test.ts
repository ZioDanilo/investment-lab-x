import assert from 'node:assert/strict';
import type { MonteCarloSnapshot } from '../models/monte-carlo-contracts.model';

(globalThis as any).self ??= globalThis;
const { buildPathResult, toCompactPathResult, encodeTransportBatch, decodeTransportBatch } = require('./monte-carlo-worker') as typeof import('./monte-carlo-worker');
const { MONTE_CARLO_GLOBAL_PROPERTY_KEYS, MONTE_CARLO_SCENARIOS } = require('../models/monte-carlo-contracts.model');
const { prepareMonteCarloPrecomputation } = require('../precomputation/monte-carlo-precomputation');

const createSnapshot = (correlation: number, isins: string[] = ['ETF-A', 'ETF-B']): MonteCarloSnapshot => {
  const orderedIsins = [...isins];
  const correlations = [] as MonteCarloSnapshot['correlations'];
  for (let row = 0; row < orderedIsins.length; row += 1) {
    for (let column = row + 1; column < orderedIsins.length; column += 1) {
      correlations.push({
        isin1: orderedIsins[row],
        isin2: orderedIsins[column],
        expansion: correlation,
        recession: correlation,
        stagflation: correlation,
        soft_landing: correlation
      });
    }
  }

  return {
    etfs: orderedIsins.map((isin) => ({
      isin,
      name: isin,
      nickname: null,
      statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
        expectedReturn: 0.12,
        volatility: 0.2,
        returnRange: { min: -1, max: 1 }
      }])) as MonteCarloSnapshot['etfs'][number]['statistics']
    })),
    structuralProbabilities: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 },
    transitionMatrix: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((from: string) => [from, Object.fromEntries(MONTE_CARLO_SCENARIOS.map((to: string) => [to, from === to ? 1 : 0]))])) as MonteCarloSnapshot['transitionMatrix'],
    inertiaConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario: string) => [scenario, { entryProbability: 1, persistenceProbability: 1, entryMonths: 1, exitStartMonth: 2, exitDecay: 0 }])) as MonteCarloSnapshot['inertiaConfigurations'],
    intensityConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario: string) => [scenario, { meanIntensity: 0.5, stdDevIntensity: 0.1 }])) as MonteCarloSnapshot['intensityConfigurations'],
    globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key: string) => [key, 0.4])) as MonteCarloSnapshot['globalProperties'],
    correlations
  };
};

const snapshot = createSnapshot(0.6, ['ETF-A', 'ETF-B']);
const precompute = prepareMonteCarloPrecomputation(snapshot);
const input = {
  initialCapital: 100,
  horizonYears: 1,
  positions: [
    { isin: 'ETF-A', targetWeight: 0.5, minWeight: 0, maxWeight: 1 },
    { isin: 'ETF-B', targetWeight: 0.5, minWeight: 0, maxWeight: 1 }
  ],
  rebalance: { enabled: true, frequencyYears: 1 }
} as any;

const strictCompareTransport = (label: string, left: unknown, right: unknown): void => {
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (a === b) return;
    if (typeof a === 'number' && typeof b === 'number') {
      assert.ok(Number.isFinite(a), `${label} :: ${path} :: left is not finite`);
      assert.ok(Number.isFinite(b), `${label} :: ${path} :: right is not finite`);
      assert.equal(a, b, `${label} :: ${path} :: number mismatch`);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      assert.equal(a.length, b.length, `${label} :: ${path} :: array length mismatch`);
      for (let index = 0; index < a.length; index += 1) {
        walk(a[index], b[index], `${path}[${index}]`);
      }
      return;
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      const leftKeys = Object.keys(a as Record<string, unknown>);
      const rightKeys = Object.keys(b as Record<string, unknown>);
      assert.equal(leftKeys.length, rightKeys.length, `${label} :: ${path} :: object key count mismatch`);
      for (const key of leftKeys) {
        assert.ok(rightKeys.includes(key), `${label} :: ${path} :: missing key ${key}`);
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return;
    }
    assert.equal(String(a), String(b), `${label} :: ${path} :: scalar mismatch`);
  };
  walk(left, right, 'root');
};

const path = buildPathResult(input, snapshot, precompute, 1, 0);
const compact = toCompactPathResult(path);
assert.ok(Array.isArray(path.__advancedObservationSamples) && path.__advancedObservationSamples.length > 0, 'path should retain the monthly ETF observations needed for run-level diagnostics');
assert.ok(Array.isArray(compact.__advancedObservationSamples) && compact.__advancedObservationSamples.length > 0, 'compact path should preserve advanced observation samples for production aggregation');
assert.ok(path.correlationDiagnostics === undefined || Object.keys(path.correlationDiagnostics ?? {}).length === 0, 'path-level advanced correlation matrices should not be produced for the final result');

const transport = encodeTransportBatch([compact, compact]);
assert.ok(Array.isArray(transport.transferList) && transport.transferList.length > 0, 'transport batch must ship ArrayBuffers');
assert.ok(Array.isArray(transport.paths) === false, 'transport batch should not keep nested path objects in the main payload');
const decoded = decodeTransportBatch(transport);
assert.equal(decoded.length, 2, 'decoded batch must restore the original path count');
strictCompareTransport('ROUND_TRIP_SINGLE_PATH', compact, decoded[0]);
strictCompareTransport('ROUND_TRIP_DUPLICATE_PATH', compact, decoded[1]);
assert.equal(decoded[0].__advancedObservationSamples.length, compact.__advancedObservationSamples.length, 'advanced samples must survive typed-array transport');

const multiPathSnapshot = createSnapshot(0.6, ['ETF-A', 'ETF-B', 'ETF-C', 'ETF-D', 'ETF-E']);
const multiPrecompute = prepareMonteCarloPrecomputation(multiPathSnapshot);
const multiInput = {
  initialCapital: 100,
  horizonYears: 2,
  positions: [
    { isin: 'ETF-A', targetWeight: 0.2, minWeight: 0, maxWeight: 1 },
    { isin: 'ETF-B', targetWeight: 0.2, minWeight: 0, maxWeight: 1 },
    { isin: 'ETF-C', targetWeight: 0.2, minWeight: 0, maxWeight: 1 },
    { isin: 'ETF-D', targetWeight: 0.2, minWeight: 0, maxWeight: 1 },
    { isin: 'ETF-E', targetWeight: 0.2, minWeight: 0, maxWeight: 1 }
  ],
  rebalance: { enabled: true, frequencyYears: 1 }
} as any;
const multiPaths = Array.from({ length: 3 }, (_, index) => buildPathResult(multiInput, multiPathSnapshot, multiPrecompute, index + 10, index + 7, true));
const multiCompact = multiPaths.map((candidate) => toCompactPathResult(candidate));
const multiTransport = encodeTransportBatch(multiCompact);
const multiDecoded = decodeTransportBatch(multiTransport);
assert.equal(multiDecoded.length, multiCompact.length, 'multi-path decoded batch must restore the original path count');
for (let index = 0; index < multiCompact.length; index += 1) {
  strictCompareTransport(`ROUND_TRIP_MULTI_PATH_${index}`, multiCompact[index], multiDecoded[index]);
}

const assertDeviationRoundTrip = (direction: 'above_expected' | 'below_expected') => {
  const compact = {
    simulationId: 42,
    dominantEtfIsin: 'ETF-A',
    dominantEtfName: 'ETF A',
    initialCapital: 1000,
    finalCapital: 1100,
    totalReturn: 0.1,
    cagr: 0.08,
    maxDrawdown: 0.2,
    monthly: [],
    scenarioPath: {
      years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }],
      frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 }
    },
    years: [{
      year: 1,
      scenario: 'expansion',
      durationInCurrentScenario: 12,
      etfReturns: [{
        isin: 'ETF-A',
        name: 'ETF A',
        weight: 1,
        annualReturn: 0.12,
        contribution: 0.12,
        intensity: 10,
        deviationDirection: direction
      }],
      portfolioReturn: 0.1,
      startingCapital: 1000,
      endingCapital: 1100,
      runningPeak: 1100,
      drawdown: 0.2
    }],
    __advancedObservationSamples: [],
    matricesCoherent: true
  } as any;

  const transport = encodeTransportBatch([compact]);
  const decoded = decodeTransportBatch(transport);
  const encodedCode = transport.message.arrays.annualEtfDeviationCode[0];
  assert.equal(encodedCode, direction === 'above_expected' ? 0 : 1, `encoded code should be canonical for ${direction}`);
  assert.equal(decoded[0].years[0].etfReturns[0].deviationDirection, direction, `decoded direction should round-trip for ${direction}`);
};

assertDeviationRoundTrip('above_expected');
assertDeviationRoundTrip('below_expected');
assert.equal(new Set([
  encodeTransportBatch([{ simulationId: 1, dominantEtfIsin: 'X', dominantEtfName: 'X', initialCapital: 100, finalCapital: 110, totalReturn: 0.1, cagr: 0.1, maxDrawdown: 0.2, monthly: [], scenarioPath: { years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }], frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } }, years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [{ isin: 'X', name: 'X', weight: 1, annualReturn: 0.1, contribution: 0.1, intensity: 1, deviationDirection: 'above_expected' }], portfolioReturn: 0.1, startingCapital: 100, endingCapital: 110, runningPeak: 110, drawdown: 0.2 }], __advancedObservationSamples: [], matricesCoherent: true }]).message.arrays.annualEtfDeviationCode[0],
  encodeTransportBatch([{ simulationId: 2, dominantEtfIsin: 'Y', dominantEtfName: 'Y', initialCapital: 100, finalCapital: 110, totalReturn: 0.1, cagr: 0.1, maxDrawdown: 0.2, monthly: [], scenarioPath: { years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }], frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } }, years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [{ isin: 'Y', name: 'Y', weight: 1, annualReturn: 0.1, contribution: 0.1, intensity: 1, deviationDirection: 'below_expected' }], portfolioReturn: 0.1, startingCapital: 100, endingCapital: 110, runningPeak: 110, drawdown: 0.2 }], __advancedObservationSamples: [], matricesCoherent: true }]).message.arrays.annualEtfDeviationCode[0]
]).size, 2, 'valid canonical deviationDirection values must have unique encoded codes');

console.log('worker correlation diagnostics test passed');
