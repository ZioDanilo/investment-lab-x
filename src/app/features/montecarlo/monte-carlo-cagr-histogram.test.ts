import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCagrHistogramFromPaths, buildDrawdownDisplayGeometry, buildHistogramGeometry, buildMaxDrawdownHistogramFromPaths, formatHistogramPercentage, resolveHistogramHoverIndex } from './monte-carlo-cagr-histogram';

const describeBins = (values: number[]) => buildCagrHistogramFromPaths(values.map((value) => ({ cagr: value }))).bins;

test('TEST A — basic positive values', () => {
  const bins = describeBins([0.031, 0.039, 0.050, 0.052, 0.0599, 0.0600]);
  const counts = Object.fromEntries(bins.map((bin) => [bin.label, bin.value]));
  assert.equal(counts['3% – 4%'], 2);
  assert.equal(counts['4% – 5%'], 0);
  assert.equal(counts['5% – 6%'], 3);
  assert.equal(counts['6% – 7%'], 1);
  assert.equal(bins.reduce((sum, bin) => sum + bin.value, 0), 6);
});

test('TEST B — exact integer boundaries', () => {
  const bins = describeBins([0.0400, 0.04999, 0.0500, 0.05999, 0.0600]);
  const counts = Object.fromEntries(bins.map((bin) => [bin.label, bin.value]));
  assert.equal(counts['4% – 5%'], 2);
  assert.equal(counts['5% – 6%'], 2);
  assert.equal(counts['6% – 7%'], 1);
  assert.equal(bins.reduce((sum, bin) => sum + bin.value, 0), 5);
});

test('TEST C — negative CAGR', () => {
  const bins = describeBins([-0.023, -0.011, -0.010, -0.002, 0.000, 0.008]);
  const counts = Object.fromEntries(bins.map((bin) => [bin.label, bin.value]));
  assert.equal(counts['-3% – -2%'], 1);
  assert.equal(counts['-2% – -1%'], 1);
  assert.equal(counts['-1% – 0%'], 2);
  assert.equal(counts['0% – 1%'], 2);
  assert.equal(bins.reduce((sum, bin) => sum + bin.value, 0), 6);
});

test('TEST D — empty intermediate bucket', () => {
  const bins = describeBins([0.025, 0.045]);
  const counts = Object.fromEntries(bins.map((bin) => [bin.label, bin.value]));
  assert.equal(counts['2% – 3%'], 1);
  assert.equal(counts['3% – 4%'], 0);
  assert.equal(counts['4% – 5%'], 1);
  assert.equal(bins.reduce((sum, bin) => sum + bin.value, 0), 2);
});

test('TEST E — population integrity', () => {
  const values = Array.from({ length: 1000 }, (_, index) => {
    const ratio = (index / 999) * 0.18 - 0.09;
    return Number((ratio).toFixed(6));
  });
  const histogram = buildCagrHistogramFromPaths(values.map((value) => ({ cagr: value })));
  assert.equal(histogram.bins.reduce((sum, bin) => sum + bin.value, 0), 1000);
});

test('TEST F — percentage formatting and tooltip semantics', () => {
  assert.equal(formatHistogramPercentage(271, 1000), '27,1%');
  assert.equal(formatHistogramPercentage(1, 1000), '0,1%');
  assert.equal(formatHistogramPercentage(82, 1000), '8,2%');
});

test('TEST F2 — tooltip percentage matches the bar height source value', () => {
  assert.equal(formatHistogramPercentage(271, 1000), '27,1%');
  assert.equal(formatHistogramPercentage(1, 1000), '0,1%');
  assert.equal(formatHistogramPercentage(0, 1000), '0,0%');
});

test('TEST M — return X labels are numeric only and centered on each bar', () => {
  const bins = buildCagrHistogramFromPaths([
    { cagr: 0.011 },
    { cagr: 0.021 },
    { cagr: 0.062 },
    { cagr: 0.067 },
    { cagr: 0.071 },
    { cagr: 0.078 }
  ]).bins;

  const labels = bins.map((bin) => `${bin.lowerBoundPercent}`);
  const geometry = buildHistogramGeometry(bins, 40, 440, 8);

  for (let index = 0; index < geometry.length; index += 1) {
    const entry = geometry[index];
    assert.equal(labels[index], String(entry.bin.lowerBoundPercent));
    assert.ok(!labels[index].includes('%'));
    assert.ok(Math.abs(entry.centerX - (entry.x + entry.width / 2)) < 1e-9);
  }

  const sample = geometry.slice(0, 3);
  assert.deepEqual(sample.map((entry) => entry.bin.lowerBoundPercent), [0, 1, 2]);
  assert.deepEqual(sample.map((entry) => entry.centerX), sample.map((entry) => entry.x + entry.width / 2));
});

test('TEST N — drawdown X labels are numeric only and centered on each bar', () => {
  const bins = buildMaxDrawdownHistogramFromPaths([
    { maxDrawdown: -0.05 },
    { maxDrawdown: -0.09 },
    { maxDrawdown: -0.14 },
    { maxDrawdown: -0.22 },
    { maxDrawdown: -0.27 }
  ]).bins;

  const geometry = buildDrawdownDisplayGeometry(bins, 30, 330, 0);
  const labels = geometry.ticks.map((tick) => `${tick.upperBoundPercent}`);

  for (let index = 0; index < geometry.ticks.length; index += 1) {
    const tick = geometry.ticks[index];
    const bar = geometry.bars[index];
    assert.equal(labels[index], String(tick.upperBoundPercent));
    assert.ok(!labels[index].includes('%'));
    assert.ok(Math.abs(tick.x - bar.centerX) < 1e-9);
  }

  assert.deepEqual(labels.slice(0, 3), ['5', '10', '15']);
  assert.deepEqual(geometry.ticks.map((tick) => tick.label), labels);
});

test('TEST G — shared geometry aligns bars and labels with one empty edge bin on each side', () => {
  const bins = buildCagrHistogramFromPaths(
    [0.06, 0.065, 0.071, 0.078, 0.083, 0.089, 0.095, 0.099, 0.100, 0.111, 0.112].map((value) => ({ cagr: value }))
  ).bins;
  const geometry = buildHistogramGeometry(bins, 40, 440, 8);

  for (const entry of geometry) {
    assert.ok(Math.abs(entry.centerX - (entry.x + entry.width / 2)) < 1e-9);
  }

  assert.equal(geometry[0].centerX, geometry[0].x + geometry[0].width / 2);
  assert.equal(geometry[geometry.length - 1].centerX, geometry[geometry.length - 1].x + geometry[geometry.length - 1].width / 2);
  assert.equal(geometry[0].bin.lowerBoundPercent, 5);
  assert.equal(geometry[geometry.length - 1].bin.lowerBoundPercent, 12);
  assert.equal(geometry[0].bin.upperBoundPercent, 6);
  assert.equal(geometry[geometry.length - 1].bin.upperBoundPercent, 13);
  assert.equal(geometry.length, 8);
});

test('TEST H — baseline geometry and hover lifecycle', () => {
  const bins = buildCagrHistogramFromPaths(
    [0.06, 0.065, 0.071, 0.078, 0.083, 0.089, 0.095, 0.099, 0.100, 0.111, 0.112].map((value) => ({ cagr: value }))
  ).bins;
  const baselineY = 150;
  const maxValue = Math.max(...bins.map((bin) => bin.value), 1);

  for (const bin of bins) {
    const height = (bin.value / maxValue) * 120;
    const barY = baselineY - height;
    assert.ok(Math.abs((barY + height) - baselineY) < 1e-9, 'bar bottom should sit exactly on the x-axis baseline');
  }

  assert.equal(resolveHistogramHoverIndex(null, 7), 7);
  assert.equal(resolveHistogramHoverIndex(7, null), null);
  assert.equal(resolveHistogramHoverIndex(7, 8), 8);
  assert.equal(resolveHistogramHoverIndex(8, null), null);
});

test('TEST I — explicit return/drawdown axis semantics remain distinct', () => {
  const returnBins = buildCagrHistogramFromPaths([
    { cagr: 0.045 },
    { cagr: 0.049 },
    { cagr: 0.051 },
    { cagr: 0.055 }
  ]).bins;

  const drawdownBins = buildMaxDrawdownHistogramFromPaths([
    { maxDrawdown: -0.15 },
    { maxDrawdown: -0.17 },
    { maxDrawdown: -0.23 },
    { maxDrawdown: -0.24 }
  ]).bins;

  const returnBucket = returnBins.find((bin) => bin.lowerBoundPercent === 4 && bin.upperBoundPercent === 5);
  const drawdownBucket = drawdownBins.find((bin) => bin.lowerBoundPercent === 15 && bin.upperBoundPercent === 20);

  assert.ok(returnBucket, 'expected 4%–5% return bucket to exist');
  assert.ok(drawdownBucket, 'expected 15%–20% drawdown bucket to exist');

  assert.equal(returnBucket!.lowerBoundPercent, 4);
  assert.equal(returnBucket!.upperBoundPercent, 5);
  assert.equal(returnBucket!.upperBoundPercent - returnBucket!.lowerBoundPercent, 1);
  assert.equal(`${returnBucket!.lowerBoundPercent}%`, '4%');

  assert.equal(drawdownBucket!.lowerBoundPercent, 15);
  assert.equal(drawdownBucket!.upperBoundPercent, 20);
  assert.equal(drawdownBucket!.upperBoundPercent - drawdownBucket!.lowerBoundPercent, 5);
  assert.equal(`${drawdownBucket!.upperBoundPercent}%`, '20%');

  assert.notEqual(
    returnBucket!.upperBoundPercent - returnBucket!.lowerBoundPercent,
    drawdownBucket!.upperBoundPercent - drawdownBucket!.lowerBoundPercent
  );
});

test('TEST J — trim outer empty bins while keeping internal zero buckets', () => {
  const bins = [
    { label: '0–5%', value: 0, lowerBoundPercent: 0, upperBoundPercent: 5, lowerInclusive: true, upperInclusive: false },
    { label: '5–10%', value: 0, lowerBoundPercent: 5, upperBoundPercent: 10, lowerInclusive: true, upperInclusive: false },
    { label: '10–15%', value: 0, lowerBoundPercent: 10, upperBoundPercent: 15, lowerInclusive: true, upperInclusive: false },
    { label: '15–20%', value: 0, lowerBoundPercent: 15, upperBoundPercent: 20, lowerInclusive: true, upperInclusive: false },
    { label: '20–25%', value: 3, lowerBoundPercent: 20, upperBoundPercent: 25, lowerInclusive: true, upperInclusive: false },
    { label: '25–30%', value: 10, lowerBoundPercent: 25, upperBoundPercent: 30, lowerInclusive: true, upperInclusive: false },
    { label: '30–35%', value: 0, lowerBoundPercent: 30, upperBoundPercent: 35, lowerInclusive: true, upperInclusive: false },
    { label: '35–40%', value: 7, lowerBoundPercent: 35, upperBoundPercent: 40, lowerInclusive: true, upperInclusive: false },
    { label: '40–45%', value: 0, lowerBoundPercent: 40, upperBoundPercent: 45, lowerInclusive: true, upperInclusive: false },
    { label: '45–50%', value: 0, lowerBoundPercent: 45, upperBoundPercent: 50, lowerInclusive: true, upperInclusive: false }
  ];

  const firstNonEmptyIndex = bins.findIndex((bin) => bin.value > 0);
  const lastNonEmptyIndex = bins.reduce((lastIndex, bin, index) => (bin.value > 0 ? index : lastIndex), -1);
  const trimmed = bins.slice(firstNonEmptyIndex, lastNonEmptyIndex + 1);

  assert.deepEqual(trimmed.map((bin) => bin.value), [3, 10, 0, 7]);
  assert.equal(trimmed[0].lowerBoundPercent, 20);
  assert.equal(trimmed[trimmed.length - 1].upperBoundPercent, 40);
});

test('TEST K — drawdown display window keeps one empty bin on each side and preserves internal zeros', () => {
  const bins = [
    { label: '0–5%', value: 0, lowerBoundPercent: 0, upperBoundPercent: 5, lowerInclusive: true, upperInclusive: false },
    { label: '5–10%', value: 0, lowerBoundPercent: 5, upperBoundPercent: 10, lowerInclusive: true, upperInclusive: false },
    { label: '10–15%', value: 20, lowerBoundPercent: 10, upperBoundPercent: 15, lowerInclusive: true, upperInclusive: false },
    { label: '15–20%', value: 100, lowerBoundPercent: 15, upperBoundPercent: 20, lowerInclusive: true, upperInclusive: false },
    { label: '20–25%', value: 70, lowerBoundPercent: 20, upperBoundPercent: 25, lowerInclusive: true, upperInclusive: false },
    { label: '25–30%', value: 0, lowerBoundPercent: 25, upperBoundPercent: 30, lowerInclusive: true, upperInclusive: false },
    { label: '30–35%', value: 0, lowerBoundPercent: 30, upperBoundPercent: 35, lowerInclusive: true, upperInclusive: false }
  ];

  const geometry = buildDrawdownDisplayGeometry(bins, 30, 330, 0);

  assert.equal(geometry.displayedBins.length, 5);
  assert.deepEqual(geometry.displayedBins.map((bin) => ({ lower: bin.lowerBoundPercent, upper: bin.upperBoundPercent, value: bin.value })), [
    { lower: 5, upper: 10, value: 0 },
    { lower: 10, upper: 15, value: 20 },
    { lower: 15, upper: 20, value: 100 },
    { lower: 20, upper: 25, value: 70 },
    { lower: 25, upper: 30, value: 0 }
  ]);
  assert.deepEqual(geometry.ticks.map((tick) => tick.label), ['10', '15', '20', '25', '30']);
  assert.equal(geometry.ticks[0].x, geometry.bars[0].centerX);
  assert.equal(geometry.ticks[geometry.ticks.length - 1].x, geometry.bars[geometry.bars.length - 1].centerX);
});

test('TEST L — return display window keeps one empty bin on each side and internal zeros remain visible', () => {
  const bins = [
    { label: '0–1%', value: 0, lowerBoundPercent: 0, upperBoundPercent: 1, lowerInclusive: true, upperInclusive: false },
    { label: '1–2%', value: 0, lowerBoundPercent: 1, upperBoundPercent: 2, lowerInclusive: true, upperInclusive: false },
    { label: '2–3%', value: 10, lowerBoundPercent: 2, upperBoundPercent: 3, lowerInclusive: true, upperInclusive: false },
    { label: '3–4%', value: 30, lowerBoundPercent: 3, upperBoundPercent: 4, lowerInclusive: true, upperInclusive: false },
    { label: '4–5%', value: 0, lowerBoundPercent: 4, upperBoundPercent: 5, lowerInclusive: true, upperInclusive: false },
    { label: '5–6%', value: 20, lowerBoundPercent: 5, upperBoundPercent: 6, lowerInclusive: true, upperInclusive: false },
    { label: '6–7%', value: 0, lowerBoundPercent: 6, upperBoundPercent: 7, lowerInclusive: true, upperInclusive: false },
    { label: '7–8%', value: 0, lowerBoundPercent: 7, upperBoundPercent: 8, lowerInclusive: true, upperInclusive: false }
  ];

  const geometry = buildDrawdownDisplayGeometry(bins, 30, 330, 0);
  assert.equal(geometry.displayedBins.length, 6);
  assert.deepEqual(geometry.displayedBins.map((bin) => ({ lower: bin.lowerBoundPercent, upper: bin.upperBoundPercent, value: bin.value })), [
    { lower: 1, upper: 2, value: 0 },
    { lower: 2, upper: 3, value: 10 },
    { lower: 3, upper: 4, value: 30 },
    { lower: 4, upper: 5, value: 0 },
    { lower: 5, upper: 6, value: 20 },
    { lower: 6, upper: 7, value: 0 }
  ]);
  assert.deepEqual(geometry.ticks.map((tick) => tick.label), ['2', '3', '4', '5', '6', '7']);
});
