export interface HistogramBin {
  label: string;
  value: number;
  lowerBoundPercent: number;
  upperBoundPercent: number;
  lowerInclusive: boolean;
  upperInclusive: boolean;
}

export interface HistogramBarGeometry {
  index: number;
  bin: HistogramBinLike;
  x: number;
  width: number;
  centerX: number;
}

export type HistogramBinLike = Pick<HistogramBin, 'label' | 'value' | 'lowerBoundPercent' | 'upperBoundPercent'> & Partial<Pick<HistogramBin, 'lowerInclusive' | 'upperInclusive'>>;

export interface HistogramInputPathLike {
  cagr?: number | null;
  [key: string]: unknown;
}

export function buildHistogramGeometry(
  bins: HistogramBinLike[],
  plotLeft = 40,
  plotWidth = 440,
  barGap = 8
): HistogramBarGeometry[] {
  if (bins.length === 0) {
    return [];
  }

  const visibleWidth = Math.max(plotWidth - plotLeft, 0);
  const widthPerBar = bins.length > 0 ? (visibleWidth - barGap * (bins.length - 1)) / bins.length : 0;

  return bins.map((bin, index) => {
    const x = plotLeft + index * (widthPerBar + barGap);
    const normalizedBin: HistogramBinLike = {
      ...bin,
      lowerInclusive: bin.lowerInclusive ?? true,
      upperInclusive: bin.upperInclusive ?? false
    };

    return {
      index,
      bin: normalizedBin,
      x,
      width: widthPerBar,
      centerX: x + widthPerBar / 2
    };
  });
}

export function buildDrawdownDisplayGeometry(
  bins: HistogramBinLike[],
  plotLeft = 30,
  availablePlotWidth = 330,
  barGap = 0
): {
  displayedBins: HistogramBinLike[];
  availablePlotWidth: number;
  plotStartX: number;
  slotWidth: number;
  axisEndX: number;
  bars: Array<{ index: number; bin: HistogramBinLike; x: number; width: number; centerX: number; slotStartX: number; }>; 
  ticks: Array<{ index: number; label: string; x: number; lowerBoundPercent: number; upperBoundPercent: number; }>; 
} {
  const normalizedBins = bins.map((bin) => ({
    ...bin,
    lowerInclusive: bin.lowerInclusive ?? true,
    upperInclusive: bin.upperInclusive ?? false
  }));

  const displayedBins = applyPresentationWindow(normalizedBins, 5, 'drawdown');
  const safePlotWidth = Math.max(availablePlotWidth, 0);
  const slotWidth = displayedBins.length > 0 ? safePlotWidth / displayedBins.length : 0;
  const barWidth = displayedBins.length > 0 ? Math.min(slotWidth * 0.7, Math.max(slotWidth - barGap, 0)) : 0;

  const bars = displayedBins.map((bin, index) => {
    const slotStartX = plotLeft + index * slotWidth;
    const x = slotStartX + (slotWidth - barWidth) / 2;
    const centerX = x + barWidth / 2;
    return {
      index,
      bin,
      x,
      width: barWidth,
      centerX,
      slotStartX
    };
  });

  const ticks = displayedBins.map((bin, index) => {
    const bar = bars[index];
    return {
      index,
      label: `${bin.upperBoundPercent}`,
      x: bar?.centerX ?? plotLeft + index * slotWidth + slotWidth / 2,
      lowerBoundPercent: bin.lowerBoundPercent,
      upperBoundPercent: bin.upperBoundPercent
    };
  });

  return {
    displayedBins,
    availablePlotWidth: safePlotWidth,
    plotStartX: plotLeft,
    slotWidth,
    axisEndX: plotLeft + safePlotWidth,
    bars,
    ticks
  };
}

export function formatHistogramPercentage(count: number, total: number): string {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) {
    return ''; 
  }

  const percentage = (count / total) * 100;
  return `${percentage.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function resolveHistogramHoverIndex(currentIndex: number | null, nextIndex: number | null): number | null {
  return nextIndex ?? null;
}

export function computeHistogramTooltipPercentage(bucketValue: number | null | undefined, totalCount: number | null | undefined): string {
  const safeBucketValue = Number(bucketValue ?? 0);
  const safeTotalCount = Number(totalCount ?? 0);

  if (!Number.isFinite(safeBucketValue) || !Number.isFinite(safeTotalCount) || safeTotalCount <= 0) {
    return '';
  }

  const percentage = (safeBucketValue / safeTotalCount) * 100;
  return percentage.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function buildZeroPresentationBin(lowerBoundPercent: number, upperBoundPercent: number): HistogramBin {
  return {
    label: `${lowerBoundPercent}%–${upperBoundPercent}%`,
    value: 0,
    lowerBoundPercent,
    upperBoundPercent,
    lowerInclusive: true,
    upperInclusive: false
  };
}

function applyPresentationWindow(bins: HistogramBinLike[], step: number, mode: 'drawdown' | 'return'): HistogramBinLike[] {
  const normalizedBins = bins.map((bin) => ({
    ...bin,
    value: Number(bin.value ?? 0),
    lowerBoundPercent: Number(bin.lowerBoundPercent ?? 0),
    upperBoundPercent: Number(bin.upperBoundPercent ?? 0),
    lowerInclusive: bin.lowerInclusive ?? true,
    upperInclusive: bin.upperInclusive ?? false
  }));

  if (normalizedBins.length === 0) {
    return [];
  }

  const firstNonEmptyIndex = normalizedBins.findIndex((bin) => Number(bin.value ?? 0) > 0);
  if (firstNonEmptyIndex === -1) {
    return normalizedBins;
  }

  const lastNonEmptyIndex = normalizedBins.reduce((lastIndex, bin, index) => (Number(bin.value ?? 0) > 0 ? index : lastIndex), -1);
  const coreBins = normalizedBins.slice(firstNonEmptyIndex, lastNonEmptyIndex + 1);

  const previousBin = (() => {
    const candidate = firstNonEmptyIndex > 0 ? normalizedBins[firstNonEmptyIndex - 1] : undefined;
    if (candidate && Number(candidate.value ?? 0) === 0) {
      return { ...candidate };
    }

    if (mode === 'drawdown' && coreBins[0].lowerBoundPercent - step < 0) {
      return undefined;
    }

    return buildZeroPresentationBin(
      Math.max(0, coreBins[0].lowerBoundPercent - step),
      coreBins[0].lowerBoundPercent
    );
  })();

  const nextBin = (() => {
    const candidate = normalizedBins[lastNonEmptyIndex + 1];
    if (candidate && Number(candidate.value ?? 0) === 0) {
      return { ...candidate };
    }

    if (!candidate) {
      return buildZeroPresentationBin(coreBins[coreBins.length - 1].upperBoundPercent, coreBins[coreBins.length - 1].upperBoundPercent + step);
    }

    return buildZeroPresentationBin(coreBins[coreBins.length - 1].upperBoundPercent, coreBins[coreBins.length - 1].upperBoundPercent + step);
  })();

  return [
    ...(previousBin ? [previousBin] : []),
    ...coreBins,
    ...(nextBin ? [nextBin] : [])
  ];
}

function trimOuterEmptyBinsReturn(bins: HistogramBin[]): HistogramBin[] {
  return applyPresentationWindow(bins, 1, 'return') as HistogramBin[];
}

function trimOuterEmptyBinsDrawdown(bins: HistogramBin[]): HistogramBin[] {
  return applyPresentationWindow(bins, 5, 'drawdown') as HistogramBin[];
}

export function buildCagrHistogramFromPaths(paths: HistogramInputPathLike[]): {
  bins: HistogramBin[];
  minCagrPercent: number;
  maxCagrPercent: number;
  total: number;
} {
  const cagrValues = paths.map((path) => Number(path?.cagr ?? 0));
  const finiteValues = cagrValues.filter((value) => Number.isFinite(value));

  if (finiteValues.length !== cagrValues.length) {
    throw new Error('Histogram input contains non-finite CAGR values');
  }

  if (cagrValues.length === 0) {
    throw new Error('Histogram input is empty');
  }

  const minCagrPercent = Math.floor(Math.min(...finiteValues) * 100);
  const maxCagrPercent = Math.floor(Math.max(...finiteValues) * 100);
  const bins = [] as HistogramBin[];
  const bucketCounts = new Map<number, number>();

  for (const cagr of finiteValues) {
    const bucketIndex = Math.floor(cagr * 100);
    bucketCounts.set(bucketIndex, (bucketCounts.get(bucketIndex) ?? 0) + 1);
  }

  for (let bucketIndex = minCagrPercent; bucketIndex <= maxCagrPercent; bucketIndex += 1) {
    const lowerBoundPercent = bucketIndex;
    const upperBoundPercent = bucketIndex + 1;
    const value = bucketCounts.get(bucketIndex) ?? 0;
    bins.push({
      label: `${lowerBoundPercent}% – ${upperBoundPercent}%`,
      value,
      lowerBoundPercent,
      upperBoundPercent,
      lowerInclusive: true,
      upperInclusive: false
    });
  }

  const displayedBins = trimOuterEmptyBinsReturn(bins);
  const total = displayedBins.reduce((sum, bin) => sum + bin.value, 0);
  if (total !== cagrValues.length) {
    throw new Error(`Histogram bucket total mismatch: expected ${cagrValues.length}, got ${total}`);
  }

  return {
    bins: displayedBins,
    minCagrPercent: displayedBins[0]?.lowerBoundPercent ?? minCagrPercent,
    maxCagrPercent: displayedBins[displayedBins.length - 1]?.upperBoundPercent ?? maxCagrPercent,
    total
  };
}

export function buildMaxDrawdownHistogramFromPaths(paths: Array<{ maxDrawdown?: number | null }>): {
  bins: HistogramBin[];
  minDrawdownPercent: number;
  maxDrawdownPercent: number;
  total: number;
} {
  const drawdownValues = paths.map((path) => {
    const value = Number(path?.maxDrawdown ?? 0);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.abs(value) * 100;
  });

  if (drawdownValues.length === 0) {
    throw new Error('Max drawdown histogram input is empty');
  }

  const maxDrawdownPercent = Math.max(...drawdownValues, 0);
  const bucketLimit = Math.max(5, Math.ceil(maxDrawdownPercent / 5) * 5);
  const bins: HistogramBin[] = [];

  for (let bucketStart = 0; bucketStart < bucketLimit; bucketStart += 5) {
    const lowerBoundPercent = bucketStart;
    const upperBoundPercent = bucketStart + 5;
    const value = drawdownValues.filter((drawdown) => {
      const magnitude = Number(drawdown ?? 0);
      return magnitude >= lowerBoundPercent && magnitude < upperBoundPercent;
    }).length;

    bins.push({
      label: `${lowerBoundPercent}–${upperBoundPercent}%`,
      value,
      lowerBoundPercent,
      upperBoundPercent,
      lowerInclusive: true,
      upperInclusive: false
    });
  }

  const displayedBins = trimOuterEmptyBinsDrawdown(bins);
  const total = displayedBins.reduce((sum, bin) => sum + bin.value, 0);
  if (total !== drawdownValues.length) {
    throw new Error(`Max drawdown bucket total mismatch: expected ${drawdownValues.length}, got ${total}`);
  }

  return {
    bins: displayedBins,
    minDrawdownPercent: displayedBins[0]?.lowerBoundPercent ?? 0,
    maxDrawdownPercent: displayedBins[displayedBins.length - 1]?.upperBoundPercent ?? bucketLimit,
    total
  };
}
