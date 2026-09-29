import assert from 'node:assert/strict';

(globalThis as any).self ??= globalThis;
const { toCompactPathResult, encodeTransportBatch, decodeTransportBatch } = require('./monte-carlo-worker') as typeof import('./monte-carlo-worker');

const buildSamplePath = (simulationId: number, capital = 100, scenario = 'expansion') => ({
  simulationId,
  dominantEtfIsin: 'ETF-A',
  dominantEtfName: 'ETF A',
  initialCapital: capital,
  finalCapital: capital * 1.1,
  totalReturn: 0.1,
  cagr: 0.08,
  maxDrawdown: 0.2,
  monthly: Array.from({ length: 12 }, (_, monthIndex) => ({
    month: monthIndex + 1,
    year: 1,
    portfolioReturn: 0.01,
    endingCapital: capital * (1 + 0.01 * (monthIndex + 1)),
    intensity: 0.5
  })),
  scenarioPath: {
    years: [{ year: 1, scenario, durationInCurrentScenario: 12 }],
    frequencies: { expansion: scenario === 'expansion' ? 12 : 0, recession: scenario === 'recession' ? 12 : 0, stagflation: scenario === 'stagflation' ? 12 : 0, soft_landing: scenario === 'soft_landing' ? 12 : 0 }
  },
  years: [{
    year: 1,
    scenario,
    durationInCurrentScenario: 12,
    etfReturns: [{
      isin: 'ETF-A',
      name: 'ETF A',
      weight: 1,
      annualReturn: 0.1,
      contribution: 0.1,
      intensity: 1,
      deviationDirection: 'above_expected'
    }],
    portfolioReturn: 0.1,
    startingCapital: capital,
    endingCapital: capital * 1.1,
    runningPeak: capital * 1.1,
    drawdown: 0.2
  }],
  __advancedObservationSamples: Array.from({ length: 12 }, (_, monthIndex) => ({
    scenario,
    etfReturns: [0.01 + monthIndex * 0.001, -0.02 + monthIndex * 0.001]
  })),
  matricesCoherent: true
} as any);

const strictCompareTransport = (label: string, left: unknown, right: unknown): void => {
  const walk = (a: unknown, b: unknown, location: string): void => {
    if (a === b) return;
    if (typeof a === 'number' && typeof b === 'number') {
      assert.ok(Number.isFinite(a), `${label} :: ${location} :: left is not finite`);
      assert.ok(Number.isFinite(b), `${label} :: ${location} :: right is not finite`);
      assert.equal(a, b, `${label} :: ${location} :: number mismatch`);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      assert.equal(a.length, b.length, `${label} :: ${location} :: array length mismatch`);
      for (let index = 0; index < a.length; index += 1) {
        walk(a[index], b[index], `${location}[${index}]`);
      }
      return;
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      const leftKeys = Object.keys(a as Record<string, unknown>);
      const rightKeys = Object.keys(b as Record<string, unknown>);
      for (const key of leftKeys) {
        assert.ok(rightKeys.includes(key), `${label} :: ${location} :: missing key ${key}`);
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${location}.${key}`);
      }
      return;
    }
    assert.equal(String(a), String(b), `${label} :: ${location} :: scalar mismatch`);
  };
  walk(left, right, 'root');
};

const stripAdvancedObservationSamples = (candidate: Record<string, unknown> | undefined): Record<string, unknown> => {
  if (!candidate || typeof candidate !== 'object') return {};
  const { __advancedObservationSamples: _omitted, ...remaining } = candidate as Record<string, unknown>;
  return remaining;
};

const stripUndefinedTransportValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedTransportValues(entry)).filter((entry) => entry !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === undefined) continue;
      cleaned[key] = stripUndefinedTransportValues(child);
    }
    return cleaned;
  }
  return value;
};

const path = buildSamplePath(1, 100, 'expansion');
const compact = toCompactPathResult(path);
assert.ok(Array.isArray(path.__advancedObservationSamples) && path.__advancedObservationSamples.length > 0, 'raw path should retain the monthly ETF observations needed for run-level diagnostics');
assert.ok(compact.__advancedObservationSamples === undefined, 'compact transport payload intentionally omits advanced observation samples; they are retained on the full path only');

const transport = encodeTransportBatch([compact, compact]);
assert.ok(Array.isArray(transport.transferList) && transport.transferList.length > 0, 'transport batch must ship ArrayBuffers');
assert.ok(Array.isArray(transport.paths) === false, 'transport batch should not keep nested path objects in the main payload');
const decoded = decodeTransportBatch(transport);
assert.equal(decoded.length, 2, 'decoded batch must restore the original path count');
assert.ok(Array.isArray(decoded[0].__advancedObservationSamples) === false, 'decoded compact payload should not rehydrate advanced observation samples that are intentionally omitted from transport');
strictCompareTransport('ROUND_TRIP_SINGLE_PATH', stripUndefinedTransportValues(stripAdvancedObservationSamples(compact)), stripUndefinedTransportValues(stripAdvancedObservationSamples(decoded[0])));
strictCompareTransport('ROUND_TRIP_DUPLICATE_PATH', stripUndefinedTransportValues(stripAdvancedObservationSamples(compact)), stripUndefinedTransportValues(stripAdvancedObservationSamples(decoded[1])));
assert.ok(Array.isArray(decoded[0].__advancedObservationSamples) === false, 'decoded compact payload should not rehydrate advanced observation samples that are intentionally omitted from transport');

const multiPaths = Array.from({ length: 3 }, (_, index) => buildSamplePath(index + 10, 100, index % 2 === 0 ? 'expansion' : 'soft_landing'));
const multiCompact = multiPaths.map((candidate) => toCompactPathResult(candidate));
const multiTransport = encodeTransportBatch(multiCompact);
const multiDecoded = decodeTransportBatch(multiTransport);
assert.equal(multiDecoded.length, multiCompact.length, 'multi-path decoded batch must restore the original path count');
for (let index = 0; index < multiCompact.length; index += 1) {
  strictCompareTransport(`ROUND_TRIP_MULTI_PATH_${index}`, stripUndefinedTransportValues(stripAdvancedObservationSamples(multiCompact[index])), stripUndefinedTransportValues(stripAdvancedObservationSamples(multiDecoded[index])));
}

const assertDeviationRoundTrip = (direction: 'above_expected' | 'below_expected') => {
  const candidate = {
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

  const candidateTransport = encodeTransportBatch([candidate]);
  const candidateDecoded = decodeTransportBatch(candidateTransport);
  const encodedCode = candidateTransport.message.arrays.annualEtfDeviationCode[0];
  assert.equal(encodedCode, direction === 'above_expected' ? 0 : 1, `encoded code should be canonical for ${direction}`);
  assert.equal(candidateDecoded[0].years[0].etfReturns[0].deviationDirection, direction, `decoded direction should round-trip for ${direction}`);
};

assertDeviationRoundTrip('above_expected');
assertDeviationRoundTrip('below_expected');
assert.equal(new Set([
  encodeTransportBatch([{ simulationId: 1, dominantEtfIsin: 'X', dominantEtfName: 'X', initialCapital: 100, finalCapital: 110, totalReturn: 0.1, cagr: 0.1, maxDrawdown: 0.2, monthly: [], scenarioPath: { years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }], frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } }, years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [{ isin: 'X', name: 'X', weight: 1, annualReturn: 0.1, contribution: 0.1, intensity: 1, deviationDirection: 'above_expected' }], portfolioReturn: 0.1, startingCapital: 100, endingCapital: 110, runningPeak: 110, drawdown: 0.2 }], __advancedObservationSamples: [], matricesCoherent: true }]).message.arrays.annualEtfDeviationCode[0],
  encodeTransportBatch([{ simulationId: 2, dominantEtfIsin: 'Y', dominantEtfName: 'Y', initialCapital: 100, finalCapital: 110, totalReturn: 0.1, cagr: 0.1, maxDrawdown: 0.2, monthly: [], scenarioPath: { years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }], frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } }, years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [{ isin: 'Y', name: 'Y', weight: 1, annualReturn: 0.1, contribution: 0.1, intensity: 1, deviationDirection: 'below_expected' }], portfolioReturn: 0.1, startingCapital: 100, endingCapital: 110, runningPeak: 110, drawdown: 0.2 }], __advancedObservationSamples: [], matricesCoherent: true }]).message.arrays.annualEtfDeviationCode[0]
]).size, 2, 'valid canonical deviationDirection values must have unique encoded codes');

console.log('worker correlation diagnostics test passed');
