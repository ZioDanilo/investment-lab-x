import {
  MonteCarloPathResult,
  MonteCarloSummary,
  MacroScenario,
  MACRO_SCENARIOS,
  PortfolioPosition,
  EtfContributionStats,
  ExtendedMonteCarloSummary,
  PortfolioSimulationSnapshot,
  MonteCarloPathDiagnostics,
  MonteCarloGeneralBenchmark,
  MonteCarloCorrelationDiagnostics,
  MonteCarloScenarioCorrelationDiagnostics
} from '../models/monte-carlo.model';
import {
  MonteCarloResult,
  MonteCarloPercentileSet,
  MonteCarloCapitalFanPoint,
  MonteCarloRepresentativePath
} from '../models/monte-carlo-contracts.model';

type AdvancedV2TimingEntry = {
  operation: string;
  scope: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  sampleCount: number;
  dimension: number;
};

const ADV_TIMING_KEY = '__mcAdvTiming';

const getAdvTimingStore = (): AdvancedV2TimingEntry[] => {
  const scope = globalThis as typeof globalThis & { [ADV_TIMING_KEY]?: AdvancedV2TimingEntry[] };
  if (!Array.isArray(scope[ADV_TIMING_KEY])) {
    scope[ADV_TIMING_KEY] = [];
  }
  return scope[ADV_TIMING_KEY] as AdvancedV2TimingEntry[];
};

const recordAdvTiming = (
  operation: string,
  scope: string,
  startMs: number,
  endMs: number,
  sampleCount: number,
  dimension: number
): void => {
  getAdvTimingStore().push({
    operation,
    scope,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    sampleCount,
    dimension
  });
};

const buildDeltaMatrix = (empiricalReturn: number[][], target: number[][], absolute = false): number[][] => {
  const rows = Array.isArray(empiricalReturn) ? empiricalReturn.length : 0;
  const columns = rows > 0 && Array.isArray(empiricalReturn[0]) ? empiricalReturn[0].length : 0;
  if (rows === 0 || columns === 0 || !Array.isArray(target) || target.length !== rows || target[0]?.length !== columns) {
    return [];
  }

  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const delta = (Number(empiricalReturn[row]?.[column] ?? 0) - Number(target[row]?.[column] ?? 0));
      matrix[row][column] = absolute ? Math.abs(delta) : delta;
    }
  }
  return matrix;
};

/**
 * Computes aggregate statistics from multiple Monte Carlo simulation paths.
 */
export class MonteCarloStatisticsEngine {
  static readonly DRAWDOWN_REFERENCE_YEARS = 30;
  static readonly DRAWDOWN_HORIZON_EXPONENT = 0.20;

  static normalizeDrawdownTo30Years(drawdown: number, simulationYears: number): number {
    if (!Number.isFinite(drawdown)) return 0;
    if (simulationYears <= 0) return drawdown;
    if (drawdown <= 0) return 0;
    if (drawdown >= 1) return 1;
    const factor = Math.pow(this.DRAWDOWN_REFERENCE_YEARS / simulationYears, this.DRAWDOWN_HORIZON_EXPONENT);
    return 1 - Math.pow(1 - drawdown, factor);
  }

  private static assertFiniteNumber(value: number, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${field} must be a finite number`);
    }
    return value;
  }

  private static assertValidMaxDrawdown(path: MonteCarloPathResult): number {
    const maxDrawdown = path.maxDrawdown;
    if (typeof maxDrawdown !== 'number' || !Number.isFinite(maxDrawdown) || maxDrawdown < 0 || maxDrawdown > 1) {
      throw new Error(`path ${path.simulationId} has invalid maxDrawdown: ${maxDrawdown}`);
    }
    return maxDrawdown;
  }

  private static coerceGeneralBenchmark(generalBenchmark?: MonteCarloGeneralBenchmark): MonteCarloGeneralBenchmark | undefined {
    if (!generalBenchmark) return undefined;
    if (!Number.isFinite(generalBenchmark.expectedReturn)) {
      throw new Error('generalBenchmark.expectedReturn must be a finite number');
    }
    if (!Number.isFinite(generalBenchmark.volatility)) {
      throw new Error('generalBenchmark.volatility must be a finite number');
    }
    return generalBenchmark;
  }

  /**
   * Calculate CAGR for a single path.
   * Per spec, finalCapital = 0 leads to exact -1.0 (not NaN/Infinity).
   */
  static calculatePathCagr(
    initialCapital: number,
    finalCapital: number,
    horizonYears: number
  ): number {
    if (initialCapital <= 0) throw new Error(`initialCapital must be > 0, got ${initialCapital}`);
    if (horizonYears <= 0) throw new Error(`horizonYears must be > 0, got ${horizonYears}`);
    if (!isFinite(initialCapital) || isNaN(initialCapital)) throw new Error(`initialCapital is not finite: ${initialCapital}`);
    if (!isFinite(finalCapital) || isNaN(finalCapital)) throw new Error(`finalCapital is not finite: ${finalCapital}`);
    if (finalCapital === 0) return -1;
    return Math.pow(finalCapital / initialCapital, 1 / horizonYears) - 1;
  }

  static calculateTrimmedMean5Percent(values: number[]): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];
    const sorted = [...values].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * 0.05);
    if (trimCount === 0) {
      return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    }
    const start = trimCount;
    const end = sorted.length - trimCount;
    if (end <= start) return this.calculateMedian(sorted);
    const trimmed = sorted.slice(start, end);
    return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
  }

  /**
   * Calculate the median of an array of numbers.
   * Does NOT modify the original array.
   */
  static calculateMedian(values: number[]): number {
    if (values.length === 0) throw new Error('Cannot calculate median of empty array');
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length % 2 === 1) {
      return sorted[Math.floor(sorted.length / 2)];
    }
    const upperIndex = sorted.length / 2;
    const lowerIndex = upperIndex - 1;
    return (sorted[lowerIndex] + sorted[upperIndex]) / 2;
  }

  static calculateLinearPercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];
    const position = (sorted.length - 1) * (percentile / 100);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    if (lowerIndex === upperIndex) return sorted[lowerIndex];
    const lower = sorted[lowerIndex];
    const upper = sorted[upperIndex];
    const weight = position - lowerIndex;
    return lower + (upper - lower) * weight;
  }

  /**
   * Calculate percentile (0–100) from a numeric array.
   * Does NOT modify the original array.
   */
  static calculatePercentile(values: number[], p: number): number {
    return this.calculateLinearPercentile(values, p);
  }

  private static computePearsonMatrix(samples: number[][]): number[][] {
    if (!Array.isArray(samples) || samples.length < 2) return [];
    const dimension = samples[0].length;
    if (dimension === 0) return [];

    const means = Array(dimension).fill(0);
    for (const sample of samples) {
      for (let i = 0; i < dimension; i += 1) {
        means[i] += Number(sample[i] ?? 0);
      }
    }
    for (let i = 0; i < dimension; i += 1) {
      means[i] /= samples.length;
    }

    const covariance = Array.from({ length: dimension }, () => Array(dimension).fill(0));
    for (const sample of samples) {
      for (let row = 0; row < dimension; row += 1) {
        for (let column = 0; column < dimension; column += 1) {
          covariance[row][column] += (Number(sample[row] ?? 0) - means[row]) * (Number(sample[column] ?? 0) - means[column]);
        }
      }
    }

    return Array.from({ length: dimension }, (_, row) => Array.from({ length: dimension }, (_, column) => {
      const varianceRow = covariance[row][row] / Math.max(1, samples.length - 1);
      const varianceColumn = covariance[column][column] / Math.max(1, samples.length - 1);
      if (varianceRow <= 0 || varianceColumn <= 0) return row === column ? 1 : 0;
      return covariance[row][column] / Math.max(1, samples.length - 1) / Math.sqrt(varianceRow * varianceColumn);
    }));
  }

  private static computeSpearmanMatrix(samples: number[][]): number[][] {
    if (!Array.isArray(samples) || samples.length < 2) return [];
    const dimension = samples[0].length;
    if (dimension === 0) return [];
    const ranked = Array.from({ length: samples.length }, () => Array(dimension).fill(0));

    for (let column = 0; column < dimension; column += 1) {
      const values = samples.map((sample) => Number(sample[column] ?? 0));
      const indexed = values.map((value, row) => ({ value, row }));
      indexed.sort((left, right) => left.value - right.value);
      let offset = 0;
      while (offset < indexed.length) {
        let cursor = offset + 1;
        while (cursor < indexed.length && indexed[cursor].value === indexed[offset].value) {
          cursor += 1;
        }
        const averageRank = (offset + 1 + cursor) / 2;
        for (let index = offset; index < cursor; index += 1) {
          ranked[indexed[index].row][column] = averageRank;
        }
        offset = cursor;
      }
    }

    return this.computePearsonMatrix(ranked);
  }

  private static computeTailDependenceMatrix(samples: number[][], upper: boolean): number[][] {
    if (!Array.isArray(samples) || samples.length < 2) return [];
    const dimension = samples[0].length;
    if (dimension === 0) return [];
    const thresholds = Array.from({ length: dimension }, (_, index) => {
      const sorted = samples.map((sample) => Number(sample[index] ?? 0)).sort((left, right) => left - right);
      const percentileIndex = upper ? Math.ceil(sorted.length * 0.95) - 1 : Math.floor(sorted.length * 0.05);
      return sorted[Math.max(0, Math.min(sorted.length - 1, percentileIndex))];
    });

    return Array.from({ length: dimension }, (_, row) => Array.from({ length: dimension }, (_, column) => {
      if (row === column) return 1;
      let conditioningCount = 0;
      let jointCount = 0;
      for (const sample of samples) {
        const rowValue = Number(sample[row] ?? 0);
        const columnValue = Number(sample[column] ?? 0);
        const rowInTail = upper ? rowValue >= thresholds[row] : rowValue <= thresholds[row];
        const columnInTail = upper ? columnValue >= thresholds[column] : columnValue <= thresholds[column];
        if (rowInTail) {
          conditioningCount += 1;
          if (columnInTail) jointCount += 1;
        }
      }
      return conditioningCount === 0 ? 0 : jointCount / conditioningCount;
    }));
  }

  private static computeMatrixMeanAbsoluteOffDiagonal(matrix: number[][]): number {
    if (!Array.isArray(matrix) || matrix.length === 0) return 0;
    const values: number[] = [];
    for (let row = 0; row < matrix.length; row += 1) {
      for (let column = 0; column < matrix[row].length; column += 1) {
        if (row === column) continue;
        values.push(Math.abs(Number(matrix[row]?.[column] ?? 0)));
      }
    }
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private static computeMatrixMaxAbsoluteOffDiagonal(matrix: number[][]): number {
    if (!Array.isArray(matrix) || matrix.length === 0) return 0;
    let max = 0;
    for (let row = 0; row < matrix.length; row += 1) {
      for (let column = 0; column < matrix[row].length; column += 1) {
        if (row === column) continue;
        max = Math.max(max, Math.abs(Number(matrix[row]?.[column] ?? 0)));
      }
    }
    return max;
  }

  private static normalizeScenarioMatrix(matrix: unknown): number[][] {
    if (!Array.isArray(matrix)) return [];
    return matrix.map((row) => Array.isArray(row) ? row.map((value) => Number(value ?? 0)) : []);
  }

  private static resolveScenarioTargetMatrix(
    scenario: MacroScenario,
    paths: MonteCarloPathResult[],
    modelMatrices?: Partial<Record<MacroScenario, { target?: number[][]; operational?: number[][]; latent?: number[][] }>>
  ): number[][] {
    const modelMatrix = modelMatrices?.[scenario]?.target ?? modelMatrices?.[scenario]?.operational ?? modelMatrices?.[scenario]?.latent;
    if (Array.isArray(modelMatrix) && modelMatrix.length > 0) {
      return this.normalizeScenarioMatrix(modelMatrix);
    }

    const scenarioPathCandidates = paths
      .map((path) => Array.isArray((path as any)?.diagnostics?.targetCorrelation)
        ? (path as any).diagnostics.targetCorrelation
        : Array.isArray((path as any)?.correlationDiagnostics?.target)
          ? (path as any).correlationDiagnostics.target
          : Array.isArray((path as any)?.correlationDiagnostics?.byScenario?.[scenario]?.target)
            ? (path as any).correlationDiagnostics.byScenario[scenario].target
            : [])
      .filter((matrix) => Array.isArray(matrix) && matrix.length > 0);

    return scenarioPathCandidates.length > 0 ? this.normalizeScenarioMatrix(scenarioPathCandidates[0]) : [];
  }

  private static collectStableObservationSamples(paths: MonteCarloPathResult[]): {
    overallSamples: number[][];
    byScenario: Record<MacroScenario, number[][]>;
    overallSampleCount: number;
    sampleCountByScenario: Record<MacroScenario, number>;
  } {
    const byScenario: Record<MacroScenario, number[][]> = {
      expansion: [],
      recession: [],
      stagflation: [],
      soft_landing: []
    };
    const overallSamples: number[][] = [];
    const sampleCountByScenario: Record<MacroScenario, number> = {
      expansion: 0,
      recession: 0,
      stagflation: 0,
      soft_landing: 0
    };

    const sortedPaths = [...paths].sort((left, right) => (left.simulationId ?? 0) - (right.simulationId ?? 0));
    for (const path of sortedPaths) {
      const observationEntries = Array.isArray((path as any).__advancedObservationSamples) ? (path as any).__advancedObservationSamples : [];
      for (let monthIndex = 0; monthIndex < observationEntries.length; monthIndex += 1) {
        const entry = observationEntries[monthIndex];
        const vector = Array.isArray(entry?.etfReturns) ? entry.etfReturns.map((value: number) => Number(value ?? 0)) : [];
        if (vector.length === 0) continue;
        const scenario = entry?.scenario as MacroScenario | undefined;
        if (!scenario || !byScenario[scenario]) continue;
        const canonicalEntry = { ...entry, simulationId: path.simulationId, monthIndex, scenario };
        const canonicalVector = canonicalEntry.etfReturns.map((value: number) => Number(value ?? 0));
        overallSamples.push(canonicalVector);
        byScenario[scenario].push(canonicalVector);
        sampleCountByScenario[scenario] += 1;
      }
    }

    return {
      overallSamples,
      byScenario,
      overallSampleCount: overallSamples.length,
      sampleCountByScenario
    };
  }

  private static createScenarioCorrelationSummary(
    scenario: MacroScenario,
    samples: number[][],
    targetMatrix: number[][],
    sampleCount: number
  ): MonteCarloScenarioCorrelationDiagnostics {
    const pearsonStart = performance.now();
    const empiricalReturn = samples.length > 0 ? this.computePearsonMatrix(samples) : [];
    const pearsonEnd = performance.now();
    recordAdvTiming('pearson', scenario, pearsonStart, pearsonEnd, sampleCount, samples[0]?.length ?? 0);

    const spearmanStart = performance.now();
    const spearmanDiagnostic = samples.length > 0 ? this.computeSpearmanMatrix(samples) : [];
    const spearmanEnd = performance.now();
    recordAdvTiming('spearman', scenario, spearmanStart, spearmanEnd, sampleCount, samples[0]?.length ?? 0);

    const lowerTailStart = performance.now();
    const lowerTailDependence5 = samples.length > 0 ? this.computeTailDependenceMatrix(samples, false) : [];
    const lowerTailEnd = performance.now();
    recordAdvTiming('tail_lower', scenario, lowerTailStart, lowerTailEnd, sampleCount, samples[0]?.length ?? 0);

    const upperTailStart = performance.now();
    const upperTailDependence5 = samples.length > 0 ? this.computeTailDependenceMatrix(samples, true) : [];
    const upperTailEnd = performance.now();
    recordAdvTiming('tail_upper', scenario, upperTailStart, upperTailEnd, sampleCount, samples[0]?.length ?? 0);

    const deltas = empiricalReturn.length > 0 && targetMatrix.length > 0 ? buildDeltaMatrix(empiricalReturn, targetMatrix, false) : [];
    const absoluteDeltas = empiricalReturn.length > 0 && targetMatrix.length > 0 ? buildDeltaMatrix(empiricalReturn, targetMatrix, true) : [];
    const meanAbsoluteDelta = this.computeMatrixMeanAbsoluteOffDiagonal(absoluteDeltas);
    const maxAbsoluteDelta = this.computeMatrixMaxAbsoluteOffDiagonal(absoluteDeltas);

    return {
      target: targetMatrix,
      operational: targetMatrix,
      latent: targetMatrix,
      empiricalLatentShock: empiricalReturn,
      empiricalReturn,
      pearsonPrimary: empiricalReturn,
      spearmanDiagnostic,
      lowerTailDependence5,
      upperTailDependence5,
      deltas,
      absoluteDeltas,
      sampleCount,
      meanAbsoluteDelta,
      maxAbsoluteDelta
    };
  }

  private static createCanonicalCorrelationBundle(
    correlationDiagnostics?: MonteCarloCorrelationDiagnostics
  ): MonteCarloCorrelationDiagnostics {
    const overall = correlationDiagnostics?.overall ?? {
      target: correlationDiagnostics?.target ?? null,
      operational: correlationDiagnostics?.operational ?? null,
      latent: correlationDiagnostics?.latent ?? null,
      empiricalLatentShock: correlationDiagnostics?.empiricalLatentShock ?? null,
      empiricalReturn: correlationDiagnostics?.empiricalReturn ?? null,
      pearsonPrimary: correlationDiagnostics?.pearsonPrimary ?? null,
      spearmanDiagnostic: correlationDiagnostics?.spearmanDiagnostic ?? null,
      lowerTailDependence5: correlationDiagnostics?.lowerTailDependence5 ?? null,
      upperTailDependence5: correlationDiagnostics?.upperTailDependence5 ?? null,
      deltas: correlationDiagnostics?.deltas ?? null,
      absoluteDeltas: correlationDiagnostics?.absoluteDeltas ?? null,
      sampleCount: correlationDiagnostics?.sampleCount ?? 0,
      meanAbsoluteDelta: 0,
      maxAbsoluteDelta: 0
    };

    const byScenario = correlationDiagnostics?.byScenario ?? (() => {
      const fallbackByScenario: Partial<Record<MacroScenario, MonteCarloScenarioCorrelationDiagnostics>> = {};
      for (const scenario of MACRO_SCENARIOS) {
        fallbackByScenario[scenario] = {
          target: correlationDiagnostics?.target ?? null,
          operational: correlationDiagnostics?.operational ?? null,
          latent: correlationDiagnostics?.latent ?? null,
          empiricalLatentShock: correlationDiagnostics?.empiricalLatentShock ?? null,
          empiricalReturn: correlationDiagnostics?.empiricalReturn ?? null,
          pearsonPrimary: correlationDiagnostics?.pearsonPrimary ?? null,
          spearmanDiagnostic: correlationDiagnostics?.spearmanDiagnostic ?? null,
          lowerTailDependence5: correlationDiagnostics?.lowerTailDependence5 ?? null,
          upperTailDependence5: correlationDiagnostics?.upperTailDependence5 ?? null,
          deltas: correlationDiagnostics?.deltas ?? null,
          absoluteDeltas: correlationDiagnostics?.absoluteDeltas ?? null,
          sampleCount: 0,
          meanAbsoluteDelta: 0,
          maxAbsoluteDelta: 0
        };
      }
      return fallbackByScenario;
    })();

    const compatibility = {
      target: overall.target ?? correlationDiagnostics?.target ?? null,
      operational: overall.operational ?? correlationDiagnostics?.operational ?? null,
      latent: overall.latent ?? correlationDiagnostics?.latent ?? null,
      empiricalLatentShock: overall.empiricalLatentShock ?? correlationDiagnostics?.empiricalLatentShock ?? null,
      empiricalReturn: overall.empiricalReturn ?? correlationDiagnostics?.empiricalReturn ?? null,
      pearsonPrimary: overall.pearsonPrimary ?? correlationDiagnostics?.pearsonPrimary ?? null,
      spearmanDiagnostic: overall.spearmanDiagnostic ?? correlationDiagnostics?.spearmanDiagnostic ?? null,
      lowerTailDependence5: overall.lowerTailDependence5 ?? correlationDiagnostics?.lowerTailDependence5 ?? null,
      upperTailDependence5: overall.upperTailDependence5 ?? correlationDiagnostics?.upperTailDependence5 ?? null,
      deltas: overall.deltas ?? correlationDiagnostics?.deltas ?? null,
      absoluteDeltas: overall.absoluteDeltas ?? correlationDiagnostics?.absoluteDeltas ?? null,
      sampleCount: overall.sampleCount ?? correlationDiagnostics?.sampleCount ?? 0,
      maeByScenario: correlationDiagnostics?.maeByScenario ?? Object.fromEntries(MACRO_SCENARIOS.map((scenario) => [scenario, byScenario[scenario]?.meanAbsoluteDelta ?? 0])),
      rmseByScenario: correlationDiagnostics?.rmseByScenario ?? Object.fromEntries(MACRO_SCENARIOS.map((scenario) => [scenario, 0])),
      maxAbsoluteErrorByScenario: correlationDiagnostics?.maxAbsoluteErrorByScenario ?? Object.fromEntries(MACRO_SCENARIOS.map((scenario) => [scenario, byScenario[scenario]?.maxAbsoluteDelta ?? 0]))
    };

    return {
      overall: {
        ...overall,
        meanAbsoluteDelta: overall.meanAbsoluteDelta ?? 0,
        maxAbsoluteDelta: overall.maxAbsoluteDelta ?? 0
      },
      byScenario,
      ...compatibility
    };
  }

  private static hasMeaningfulCorrelationDiagnostics(
    correlationDiagnostics?: Partial<MonteCarloCorrelationDiagnostics> | null
  ): boolean {
    if (!correlationDiagnostics || typeof correlationDiagnostics !== 'object') return false;

    const matrixKeys = [
      'target',
      'operational',
      'latent',
      'empiricalLatentShock',
      'empiricalReturn',
      'pearsonPrimary',
      'spearmanDiagnostic',
      'lowerTailDependence5',
      'upperTailDependence5',
      'deltas',
      'absoluteDeltas'
    ] as const;

    for (const key of matrixKeys) {
      const value = (correlationDiagnostics as Record<string, unknown>)[key];
      if (Array.isArray(value) && value.length > 0) return true;
    }

    const byScenario = (correlationDiagnostics as { byScenario?: Record<string, unknown> }).byScenario;
    if (byScenario && typeof byScenario === 'object') {
      for (const scenarioDiagnostics of Object.values(byScenario)) {
        if (!scenarioDiagnostics || typeof scenarioDiagnostics !== 'object') continue;
        for (const key of matrixKeys) {
          const value = (scenarioDiagnostics as Record<string, unknown>)[key];
          if (Array.isArray(value) && value.length > 0) return true;
        }
      }
    }

    return false;
  }

  private static createRunLevelCorrelationDiagnostics(
    paths: MonteCarloPathResult[],
    modelMatrices?: Partial<Record<MacroScenario, { target?: number[][]; operational?: number[][]; latent?: number[][] }>>,
    profileEvent?: (event: string, timestamp?: number, details?: Record<string, unknown>) => void
  ): MonteCarloCorrelationDiagnostics {
    const correlationStart = performance.now();
    profileEvent?.('ADVANCED_CORRELATION_START', performance.now(), { pathsLength: paths.length });
    profileEvent?.('ADV_SAMPLE_COLLECTION_START', performance.now(), { pathsLength: paths.length });
    const sampleCollectionStart = performance.now();
    const stableSamples = this.collectStableObservationSamples(paths);
    const sampleCollectionEnd = performance.now();
    recordAdvTiming('collectStableObservationSamples', 'overall', sampleCollectionStart, sampleCollectionEnd, stableSamples.overallSampleCount, 5);
    profileEvent?.('ADV_SAMPLE_COLLECTION_END', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    const targetByScenario: Record<MacroScenario, number[][]> = {
      expansion: this.resolveScenarioTargetMatrix('expansion', paths, modelMatrices),
      recession: this.resolveScenarioTargetMatrix('recession', paths, modelMatrices),
      stagflation: this.resolveScenarioTargetMatrix('stagflation', paths, modelMatrices),
      soft_landing: this.resolveScenarioTargetMatrix('soft_landing', paths, modelMatrices)
    };

    profileEvent?.('ADV_PEARSON_START', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    const overallPearsonStart = performance.now();
    const overallEmpiricalReturn = stableSamples.overallSamples.length > 0 ? this.computePearsonMatrix(stableSamples.overallSamples) : [];
    const overallPearsonEnd = performance.now();
    recordAdvTiming('pearson', 'overall', overallPearsonStart, overallPearsonEnd, stableSamples.overallSampleCount, stableSamples.overallSamples[0]?.length ?? 0);
    profileEvent?.('ADV_PEARSON_END', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    profileEvent?.('ADV_SPEARMAN_START', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    const overallSpearmanStart = performance.now();
    const overallSpearman = stableSamples.overallSamples.length > 0 ? this.computeSpearmanMatrix(stableSamples.overallSamples) : [];
    const overallSpearmanEnd = performance.now();
    recordAdvTiming('spearman', 'overall', overallSpearmanStart, overallSpearmanEnd, stableSamples.overallSampleCount, stableSamples.overallSamples[0]?.length ?? 0);
    profileEvent?.('ADV_SPEARMAN_END', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    profileEvent?.('ADV_LOWER_TAIL_START', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    const overallLowerTailStart = performance.now();
    const overallLowerTail = stableSamples.overallSamples.length > 0 ? this.computeTailDependenceMatrix(stableSamples.overallSamples, false) : [];
    const overallLowerTailEnd = performance.now();
    recordAdvTiming('tail_lower', 'overall', overallLowerTailStart, overallLowerTailEnd, stableSamples.overallSampleCount, stableSamples.overallSamples[0]?.length ?? 0);
    profileEvent?.('ADV_LOWER_TAIL_END', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    profileEvent?.('ADV_UPPER_TAIL_START', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    const overallUpperTailStart = performance.now();
    const overallUpperTail = stableSamples.overallSamples.length > 0 ? this.computeTailDependenceMatrix(stableSamples.overallSamples, true) : [];
    const overallUpperTailEnd = performance.now();
    recordAdvTiming('tail_upper', 'overall', overallUpperTailStart, overallUpperTailEnd, stableSamples.overallSampleCount, stableSamples.overallSamples[0]?.length ?? 0);
    profileEvent?.('ADV_UPPER_TAIL_END', performance.now(), {
      pathsLength: paths.length,
      advancedSampleCount: stableSamples.overallSampleCount,
      dimension: stableSamples.overallSamples[0]?.length ?? 0
    });
    const overallTarget = Object.values(targetByScenario).find((matrix) => Array.isArray(matrix) && matrix.length > 0) ?? [];
    const overallDeltas = overallEmpiricalReturn.length > 0 && overallTarget.length > 0 ? buildDeltaMatrix(overallEmpiricalReturn, overallTarget, false) : [];
    const overallAbsoluteDeltas = overallEmpiricalReturn.length > 0 && overallTarget.length > 0 ? buildDeltaMatrix(overallEmpiricalReturn, overallTarget, true) : [];

    profileEvent?.('BY_SCENARIO_START', Date.now(), { pathsLength: paths.length, advancedSampleCount: stableSamples.overallSampleCount, dimension: stableSamples.overallSamples[0]?.length ?? 0 });
    const byScenario: Partial<Record<MacroScenario, MonteCarloScenarioCorrelationDiagnostics>> = {};
    for (const scenario of MACRO_SCENARIOS) {
      const targetMatrix = targetByScenario[scenario] ?? [];
      const sampleCount = stableSamples.sampleCountByScenario[scenario];
      const scenarioStart = performance.now();
      byScenario[scenario] = this.createScenarioCorrelationSummary(scenario, stableSamples.byScenario[scenario], targetMatrix, sampleCount);
      const scenarioEnd = performance.now();
      recordAdvTiming('createScenarioCorrelationSummary', scenario, scenarioStart, scenarioEnd, sampleCount, stableSamples.byScenario[scenario][0]?.length ?? 0);
    }
    profileEvent?.('BY_SCENARIO_END', Date.now(), { pathsLength: paths.length, advancedSampleCount: stableSamples.overallSampleCount, dimension: stableSamples.overallSamples[0]?.length ?? 0 });
    profileEvent?.('ADVANCED_CORRELATION_END', performance.now(), { pathsLength: paths.length, advancedSampleCount: stableSamples.overallSampleCount, dimension: stableSamples.overallSamples[0]?.length ?? 0 });
    const correlationEnd = performance.now();
    recordAdvTiming('createRunLevelCorrelationDiagnostics', 'overall', correlationStart, correlationEnd, stableSamples.overallSampleCount, 5);

    const overall: MonteCarloScenarioCorrelationDiagnostics = {
      target: overallTarget,
      operational: overallTarget,
      latent: overallTarget,
      empiricalLatentShock: overallEmpiricalReturn,
      empiricalReturn: overallEmpiricalReturn,
      pearsonPrimary: overallEmpiricalReturn,
      spearmanDiagnostic: overallSpearman,
      lowerTailDependence5: overallLowerTail,
      upperTailDependence5: overallUpperTail,
      deltas: overallDeltas,
      absoluteDeltas: overallAbsoluteDeltas,
      sampleCount: stableSamples.overallSampleCount,
      meanAbsoluteDelta: this.computeMatrixMeanAbsoluteOffDiagonal(overallAbsoluteDeltas),
      maxAbsoluteDelta: this.computeMatrixMaxAbsoluteOffDiagonal(overallAbsoluteDeltas)
    };

    const compatibility: MonteCarloCorrelationDiagnostics = {
      target: overallTarget,
      operational: overallTarget,
      latent: overallTarget,
      empiricalLatentShock: overall.empiricalLatentShock ?? null,
      empiricalReturn: overall.empiricalReturn ?? null,
      pearsonPrimary: overall.pearsonPrimary ?? null,
      spearmanDiagnostic: overall.spearmanDiagnostic ?? null,
      lowerTailDependence5: overall.lowerTailDependence5 ?? null,
      upperTailDependence5: overall.upperTailDependence5 ?? null,
      deltas: overall.deltas ?? null,
      absoluteDeltas: overall.absoluteDeltas ?? null,
      sampleCount: overall.sampleCount ?? 0,
      maeByScenario: Object.fromEntries(MACRO_SCENARIOS.map((scenario) => [scenario, byScenario[scenario]?.meanAbsoluteDelta ?? 0])),
      rmseByScenario: Object.fromEntries(MACRO_SCENARIOS.map((scenario) => [scenario, 0])),
      maxAbsoluteErrorByScenario: Object.fromEntries(MACRO_SCENARIOS.map((scenario) => [scenario, byScenario[scenario]?.maxAbsoluteDelta ?? 0]))
    };

    return {
      overall,
      byScenario,
      ...compatibility
    };
  }

  private static computeMin(values: number[], fallback = 0): number {
    if (values.length === 0) return fallback;
    let min = Number.POSITIVE_INFINITY;
    for (const value of values) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value < min) min = value;
    }
    return min === Number.POSITIVE_INFINITY ? fallback : min;
  }

  private static computeMax(values: number[], fallback = 0): number {
    if (values.length === 0) return fallback;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of values) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value > max) max = value;
    }
    return max === Number.NEGATIVE_INFINITY ? fallback : max;
  }

  static calculateSampleStandardDeviation(values: number[]): number {
    if (values.length <= 1) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  static calculatePathVolatility(monthlyPortfolioReturns: number[], annualizationFactor = 12): number {
    if (monthlyPortfolioReturns.length === 0) return 0;
    const sampleStdDev = this.calculateSampleStandardDeviation(monthlyPortfolioReturns);
    return sampleStdDev * Math.sqrt(annualizationFactor);
  }

  static calculatePathCagrFromPath(path: MonteCarloPathResult, horizonYears: number): number {
    return this.calculatePathCagr(path.initialCapital, path.finalCapital, horizonYears);
  }

  static buildPercentileSet(values: number[]): MonteCarloPercentileSet {
    return {
      p5: this.calculateLinearPercentile(values, 5),
      p25: this.calculateLinearPercentile(values, 25),
      p50: this.calculateLinearPercentile(values, 50),
      p75: this.calculateLinearPercentile(values, 75),
      p95: this.calculateLinearPercentile(values, 95)
    };
  }

  static buildCapitalFan(paths: MonteCarloPathResult[], horizonYears: number): MonteCarloCapitalFanPoint[] {
    const fan: MonteCarloCapitalFanPoint[] = [];
    for (let year = 1; year <= horizonYears; year += 1) {
      const yearlyCapitals: number[] = paths.flatMap((path) => {
        const monthlySeries = Array.isArray(path.monthly) ? path.monthly : [];
        const endOfYearEntry = monthlySeries.filter((monthEntry) => monthEntry.year === year).sort((a, b) => (a.month ?? 0) - (b.month ?? 0)).at(-1);
        if (endOfYearEntry) {
          const capitalValue = endOfYearEntry.endingCapital ?? endOfYearEntry.capital ?? path.finalCapital;
          return [capitalValue];
        }
        const annualValue = path.years.find((entry) => entry.year === year)?.endingCapital;
        return annualValue !== undefined ? [annualValue] : [path.finalCapital];
      });
      fan.push({
        year,
        capitalP5: this.calculateLinearPercentile(yearlyCapitals, 5),
        capitalP25: this.calculateLinearPercentile(yearlyCapitals, 25),
        capitalP50: this.calculateLinearPercentile(yearlyCapitals, 50),
        capitalP75: this.calculateLinearPercentile(yearlyCapitals, 75),
        capitalP95: this.calculateLinearPercentile(yearlyCapitals, 95)
      });
    }
    return fan;
  }

  static selectRepresentativePath(paths: MonteCarloPathResult[], medianCagr: number): MonteCarloRepresentativePath {
    if (paths.length === 0) {
      return { simulationId: -1, cagr: 0, maxDrawdown: 0, capital: [] };
    }
    const sortedByMaxDrawdown = [...paths].sort((a, b) => b.maxDrawdown - a.maxDrawdown);
    const bucketSize = Math.max(1, Math.ceil(sortedByMaxDrawdown.length * 0.05));
    const candidatePool = sortedByMaxDrawdown.slice(0, bucketSize);
    const selectedPath = candidatePool.reduce((best, current) => {
      const bestDistance = Math.abs(best.cagr - medianCagr);
      const currentDistance = Math.abs(current.cagr - medianCagr);
      if (currentDistance < bestDistance) return current;
      if (currentDistance === bestDistance && current.simulationId < best.simulationId) return current;
      return best;
    }, candidatePool[0]);

    const capital = Array.isArray(selectedPath.monthly)
      ? selectedPath.monthly
          .map((entry) => ({ month: entry.month, capital: entry.endingCapital ?? entry.capital ?? 0 }))
          .filter((entry) => Number.isFinite(entry.capital))
      : selectedPath.years.map((entry) => ({ month: entry.year * 12, capital: entry.endingCapital }));

    return {
      simulationId: selectedPath.simulationId,
      cagr: selectedPath.cagr,
      maxDrawdown: selectedPath.maxDrawdown,
      capital
    };
  }

  static buildOfficialResult(
    paths: MonteCarloPathResult[],
    horizonYears: number,
    initialCapital: number,
    statisticsInput?: {
      diagnostics?: MonteCarloPathDiagnostics;
      generalBenchmark?: MonteCarloGeneralBenchmark;
      correlationDiagnostics?: MonteCarloCorrelationDiagnostics;
      performanceDiagnostics?: { redrawCount?: number; rejectRate?: number };
      matricesCoherent?: boolean;
      advancedStatisticsEnabled?: boolean;
      modelMatrices?: Partial<Record<MacroScenario, { target?: number[][]; operational?: number[][]; latent?: number[][] }>>;
      profileEvent?: (event: string, timestamp?: number, details?: Record<string, unknown>) => void;
    }
  ): MonteCarloResult {
    const profileEvent = statisticsInput?.profileEvent;
    profileEvent?.('BUILD_OFFICIAL_START', performance.now(), { pathsLength: paths.length });
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('buildOfficialResult requires at least one path');
    }

    for (const path of paths) {
      this.assertValidMaxDrawdown(path);
    }

    const officialResultStart = performance.now();
    profileEvent?.('BASE_PATH_STATS_START', performance.now(), { pathsLength: paths.length });
    const cagrValues = paths.map((path) => {
      if (path.finalCapital === 0) return -1;
      return this.calculatePathCagr(path.initialCapital, path.finalCapital, horizonYears);
    });
    const maxDrawdownValues = paths.map((path) => path.maxDrawdown);
    const completedRecoveryTimes = paths.flatMap((path) => {
      const value = path.maxRecoveryTimeMonths;
      if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return [];
      if (path.unrecovered === true) return [];
      return [value];
    });
    const pathVolatilities = paths.map((path) => {
      const monthlyReturns = Array.isArray(path.monthly)
        ? path.monthly
            .map((entry) => entry.portfolioReturn)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        : [];
      return this.calculatePathVolatility(monthlyReturns);
    });

    const robustCagr = this.calculateTrimmedMean5Percent(cagrValues);
    const rawQ95MaxDrawdown = this.calculateLinearPercentile(maxDrawdownValues, 95);
    const rawWorstMaxDrawdown = maxDrawdownValues.length > 0 ? Math.max(...maxDrawdownValues) : 0;
    const normalizedQ95MaxDrawdown = this.normalizeDrawdownTo30Years(rawQ95MaxDrawdown, horizonYears);
    const normalizedWorstMaxDrawdown = this.normalizeDrawdownTo30Years(rawWorstMaxDrawdown, horizonYears);
    const volatilityKpi = this.calculateTrimmedMean5Percent(pathVolatilities);
    const medianCagr = this.calculateMedian(cagrValues.length > 0 ? cagrValues : [0]);
    const recoveryTimeKpi = completedRecoveryTimes.length > 0 ? this.calculateTrimmedMean5Percent(completedRecoveryTimes) : null;
    profileEvent?.('BASE_PATH_STATS_END', performance.now(), { pathsLength: paths.length });

    profileEvent?.('PERCENTILES_START', performance.now(), { pathsLength: paths.length });
    const finalCapitalPercentiles = this.buildPercentileSet(paths.map((path) => path.finalCapital));
    const cagrPercentiles = this.buildPercentileSet(cagrValues);
    const maxDrawdownPercentiles = this.buildPercentileSet(maxDrawdownValues);
    const recoveryPercentiles = completedRecoveryTimes.length > 0 ? this.buildPercentileSet(completedRecoveryTimes) : null;
    profileEvent?.('PERCENTILES_END', performance.now(), { pathsLength: paths.length });

    profileEvent?.('CAPITAL_FAN_START', performance.now(), { pathsLength: paths.length });
    const capitalFan = this.buildCapitalFan(paths, horizonYears);
    profileEvent?.('CAPITAL_FAN_END', performance.now(), { pathsLength: paths.length });
    profileEvent?.('REPRESENTATIVE_PATH_START', performance.now(), { pathsLength: paths.length });
    const representativePath = this.selectRepresentativePath(paths, medianCagr);
    profileEvent?.('REPRESENTATIVE_PATH_END', performance.now(), { pathsLength: paths.length });
    const flatDiagnostics = statisticsInput && !statisticsInput.diagnostics && (('correlations' in statisticsInput) || ('generalBenchmark' in statisticsInput) || ('performance' in statisticsInput) || ('matricesCoherent' in statisticsInput)) ? (statisticsInput as any) : statisticsInput?.diagnostics;
    const advancedStatisticsEnabled = statisticsInput?.advancedStatisticsEnabled ?? true;
    profileEvent?.('ADVANCED_CORRELATION_START', performance.now(), { pathsLength: paths.length });
    profileEvent?.('SCENARIO_STATISTICS_START', performance.now(), { pathsLength: paths.length });
    const pooledCorrelationDiagnostics = advancedStatisticsEnabled
      ? this.createRunLevelCorrelationDiagnostics(paths, statisticsInput?.modelMatrices, profileEvent)
      : {} as MonteCarloCorrelationDiagnostics;
    const pathCorrelationDiagnostics = advancedStatisticsEnabled ? paths.reduce((accumulator, path) => {
      const candidate = (path as any)?.correlationDiagnostics;
      if (candidate && Object.keys(candidate).length > 0) {
        return { ...accumulator, ...candidate };
      }
      return accumulator;
    }, {} as MonteCarloCorrelationDiagnostics) : {} as MonteCarloCorrelationDiagnostics;
    const chosenCorrelationDiagnostics = advancedStatisticsEnabled
      ? (statisticsInput?.correlationDiagnostics ?? flatDiagnostics?.correlations
        ?? (this.hasMeaningfulCorrelationDiagnostics(pooledCorrelationDiagnostics) ? pooledCorrelationDiagnostics : (
          this.hasMeaningfulCorrelationDiagnostics(pathCorrelationDiagnostics) ? pathCorrelationDiagnostics : pooledCorrelationDiagnostics
        )))
      : {} as MonteCarloCorrelationDiagnostics;
    const pathGeneralBenchmark = paths.reduce<MonteCarloGeneralBenchmark | undefined>((accumulator, path) => {
      const candidate = (path as any)?.generalBenchmark;
      return accumulator ?? candidate;
    }, undefined);
    const generalBenchmark = this.coerceGeneralBenchmark(statisticsInput?.generalBenchmark ?? flatDiagnostics?.generalBenchmark ?? pathGeneralBenchmark ?? undefined);
    const officialStatistics = this.buildScenarioStatistics(paths, horizonYears, {
      diagnostics: flatDiagnostics,
      generalBenchmark,
      correlationDiagnostics: chosenCorrelationDiagnostics,
      performanceDiagnostics: statisticsInput?.performanceDiagnostics ?? flatDiagnostics?.performance,
      matricesCoherent: statisticsInput?.matricesCoherent ?? flatDiagnostics?.matricesCoherent,
      advancedStatisticsEnabled
    });
    profileEvent?.('SCENARIO_STATISTICS_END', performance.now(), { pathsLength: paths.length });
    const officialReturnGeneration = (officialStatistics as any)?.returnGeneration ?? {};
    const canonicalRedrawCount = Number(officialReturnGeneration.totalRejectedVectors ?? 0);
    const canonicalRejectRate = Number(officialReturnGeneration.rejectRate ?? 0);
    (officialStatistics as Record<string, unknown>).advancedStatisticsEnabled = advancedStatisticsEnabled;

    profileEvent?.('TECHNICAL_CHECKS_START', performance.now(), { pathsLength: paths.length });
    const technicalChecks = this.buildTechnicalChecks(paths, horizonYears, initialCapital, cagrValues, maxDrawdownValues, statisticsInput?.matricesCoherent ?? flatDiagnostics?.matricesCoherent);
    profileEvent?.('TECHNICAL_CHECKS_END', performance.now(), { pathsLength: paths.length });
    const officialResult = {
      mainKpis: {
        robustCagr,
        robustMaxDrawdown: normalizedQ95MaxDrawdown,
        worstCaseMaxDrawdown: normalizedWorstMaxDrawdown,
        volatility: volatilityKpi,
        recoveryTimeMonths: recoveryTimeKpi
      },
      percentiles: {
        finalCapital: finalCapitalPercentiles,
        cagr: cagrPercentiles,
        maxDrawdown: maxDrawdownPercentiles,
        recoveryTimeMonths: recoveryPercentiles
      },
      capitalFan,
      representativePath,
      statistics: officialStatistics,
      technicalChecks,
      performanceMetrics: {
        totalTime: null,
        pathsPerSecond: null,
        monthsPerSecond: null,
        factorizationTime: null,
        totalRedraw: canonicalRedrawCount,
        rejectRate: canonicalRejectRate
      }
    };
    const officialResultEnd = performance.now();
    profileEvent?.('BUILD_OFFICIAL_END', performance.now(), { pathsLength: paths.length });
    recordAdvTiming('buildOfficialResult', 'official', officialResultStart, officialResultEnd, paths.length, 5);
    return officialResult;
  }

  private static buildScenarioStatistics(
    paths: MonteCarloPathResult[],
    horizonYears: number,
    statisticsInput?: {
      diagnostics?: MonteCarloPathDiagnostics;
      generalBenchmark?: MonteCarloGeneralBenchmark;
      correlationDiagnostics?: MonteCarloCorrelationDiagnostics;
      performanceDiagnostics?: { redrawCount?: number; rejectRate?: number };
      matricesCoherent?: boolean;
      advancedStatisticsEnabled?: boolean;
    }
  ): Record<string, unknown> {
    const scenarioFrequencies: Record<MacroScenario, number> = {
      expansion: 0,
      recession: 0,
      stagflation: 0,
      soft_landing: 0
    };
    for (const path of paths) {
      const frequencies = path.scenarioPath?.frequencies ?? {} as Partial<Record<MacroScenario, number>>;
      for (const scenario of MACRO_SCENARIOS) {
        scenarioFrequencies[scenario] += frequencies[scenario] ?? 0;
      }
    }
    const totalScenarioCount = Object.values(scenarioFrequencies).reduce((sum, value) => sum + value, 0) || 1;
    for (const scenario of MACRO_SCENARIOS) {
      scenarioFrequencies[scenario] /= totalScenarioCount;
    }

    const observedDuration: Record<MacroScenario, number> = {
      expansion: 0,
      recession: 0,
      stagflation: 0,
      soft_landing: 0
    };
    for (const path of paths) {
      for (const year of path.scenarioPath?.years ?? []) {
        observedDuration[year.scenario] += year.durationInCurrentScenario;
      }
    }

    const empiricalMatrix: Record<MacroScenario, Record<MacroScenario, number>> = {
      expansion: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 },
      recession: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 },
      stagflation: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 },
      soft_landing: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 }
    };
    for (const path of paths) {
      const years = path.scenarioPath?.years ?? [];
      for (let index = 0; index < years.length - 1; index += 1) {
        const current = years[index];
        const next = years[index + 1];
        if (current && next) {
          empiricalMatrix[current.scenario][next.scenario] += 1;
        }
      }
    }
    for (const scenario of MACRO_SCENARIOS) {
      const rowTotal = Object.values(empiricalMatrix[scenario]).reduce((sum, value) => sum + value, 0) || 1;
      for (const target of MACRO_SCENARIOS) {
        empiricalMatrix[scenario][target] /= rowTotal;
      }
    }

    const intensityValues: number[] = [];
    const intensityBands = {
      '0-20': 0,
      '20-40': 0,
      '40-60': 0,
      '60-80': 0,
      '80-100': 0
    };
    for (const path of paths) {
      for (const month of path.monthly ?? []) {
        const intensity = typeof month?.intensity === 'number' && Number.isFinite(month.intensity) ? month.intensity : 0;
        intensityValues.push(intensity);
        if (intensity >= 0 && intensity < 0.2) intensityBands['0-20'] += 1;
        else if (intensity >= 0.2 && intensity < 0.4) intensityBands['20-40'] += 1;
        else if (intensity >= 0.4 && intensity < 0.6) intensityBands['40-60'] += 1;
        else if (intensity >= 0.6 && intensity < 0.8) intensityBands['60-80'] += 1;
        else if (intensity >= 0.8 && intensity <= 1.0) intensityBands['80-100'] += 1;
      }
    }

    const pathReturns = (paths.flatMap((path) => path.monthly ?? []).map((entry) => entry.portfolioReturn ?? 0)).filter((value) => Number.isFinite(value));
    const meanReturn = pathReturns.length > 0 ? pathReturns.reduce((sum, value) => sum + value, 0) / pathReturns.length : 0;
    const returnVolatility = this.calculateSampleStandardDeviation(pathReturns);
    const intensityMean = intensityValues.length > 0 ? intensityValues.reduce((sum, value) => sum + value, 0) / intensityValues.length : 0;
    const intensityVolatility = this.calculateSampleStandardDeviation(intensityValues);

    const flatDiagnostics = statisticsInput && !statisticsInput.diagnostics && (('correlations' in statisticsInput) || ('generalBenchmark' in statisticsInput) || ('performance' in statisticsInput) || ('matricesCoherent' in statisticsInput)) ? (statisticsInput as any) : statisticsInput?.diagnostics;
    const pathCorrelationDiagnostics = paths.reduce((accumulator, path) => {
      const candidate = (path as any)?.correlationDiagnostics;
      if (candidate && Object.keys(candidate).length > 0) {
        return { ...accumulator, ...candidate };
      }
      return accumulator;
    }, {} as MonteCarloCorrelationDiagnostics);
    const pathGeneralBenchmark = paths.reduce<MonteCarloGeneralBenchmark | undefined>((accumulator, path) => {
      const candidate = (path as any)?.generalBenchmark;
      return accumulator ?? candidate;
    }, undefined);
    const correlationDiagnostics = statisticsInput?.correlationDiagnostics ?? flatDiagnostics?.correlations
      ?? (this.hasMeaningfulCorrelationDiagnostics(pathCorrelationDiagnostics) ? pathCorrelationDiagnostics : {});
    const generalBenchmark = statisticsInput?.generalBenchmark ?? flatDiagnostics?.generalBenchmark ?? pathGeneralBenchmark;
    const performance = statisticsInput?.performanceDiagnostics ?? flatDiagnostics?.performance;
    const advancedStatisticsEnabled = statisticsInput?.advancedStatisticsEnabled ?? true;
    const canonicalCorrelationDiagnostics = advancedStatisticsEnabled ? this.createCanonicalCorrelationBundle(correlationDiagnostics) : undefined;
    const indicatorMatrix = advancedStatisticsEnabled ? canonicalCorrelationDiagnostics : undefined;

    const maxDrawdownValues = paths.map((path) => path.maxDrawdown);
    const drawdownPercentiles = this.buildPercentileSet(maxDrawdownValues);
    const generalBenchmarkCAGR = generalBenchmark ? (generalBenchmark.simulatedLongTermReturn ?? meanReturn) : null;
    const generalBenchmarkVolatility = generalBenchmark ? (generalBenchmark.simulatedVolatility ?? returnVolatility) : null;
    const returnGenerationAggregate = paths.reduce((aggregate, path) => {
      const range = (path as any).returnDiagnostics ?? null;
      if (!range) return aggregate;
      aggregate.candidateVectors += range.candidateVectors ?? 0;
      aggregate.acceptedVectors += range.acceptedVectors ?? 0;
      aggregate.rejectedVectors += range.rejectedVectors ?? 0;
      aggregate.physicalFloorRejectedVectors += range.physicalFloorRejectedVectors ?? 0;
      aggregate.oldRangeViolationCount += range.oldRangeViolationCount ?? 0;
      aggregate.effectiveRangeRejectedVectors += range.effectiveRangeRejectedVectors ?? 0;
      const candidateReturnCountFromRange = range.byEtfScenario
        ? Object.values(range.byEtfScenario as Record<string, any>).reduce((sum, value) => sum + (value?.candidateReturnCount ?? 0), 0)
        : 0;
      aggregate.candidateReturnCount += candidateReturnCountFromRange || (range.candidateVectors ?? 0);
      for (const [key, rawValue] of Object.entries(range.byEtfScenario ?? {})) {
        const value = rawValue as Record<string, any> | undefined;
        const current = aggregate.byEtfScenario[key] ?? {
          candidateReturnCount: 0,
          belowEffectiveMinCount: 0,
          aboveEffectiveMaxCount: 0,
          lowerRejectRate: 0,
          upperRejectRate: 0,
          totalOutOfRangeRate: 0,
          meanLowerDistanceSigma: null,
          meanUpperDistanceSigma: null
        };
        current.candidateReturnCount += value?.candidateReturnCount ?? 0;
        current.belowEffectiveMinCount += value?.belowEffectiveMinCount ?? 0;
        current.aboveEffectiveMaxCount += value?.aboveEffectiveMaxCount ?? 0;
        current.lowerRejectRate = current.candidateReturnCount > 0 ? current.belowEffectiveMinCount / current.candidateReturnCount : 0;
        current.upperRejectRate = current.candidateReturnCount > 0 ? current.aboveEffectiveMaxCount / current.candidateReturnCount : 0;
        current.totalOutOfRangeRate = current.candidateReturnCount > 0 ? (current.belowEffectiveMinCount + current.aboveEffectiveMaxCount) / current.candidateReturnCount : 0;
        current.meanLowerDistanceSigma = value?.meanLowerDistanceSigma ?? current.meanLowerDistanceSigma;
        current.meanUpperDistanceSigma = value?.meanUpperDistanceSigma ?? current.meanUpperDistanceSigma;
        aggregate.byEtfScenario[key] = current;
      }
      return aggregate;
    }, {
      candidateVectors: 0,
      candidateReturnCount: 0,
      acceptedVectors: 0,
      rejectedVectors: 0,
      physicalFloorRejectedVectors: 0,
      oldRangeViolationCount: 0,
      effectiveRangeRejectedVectors: 0,
      byEtfScenario: {} as Record<string, any>
    });
    const macroSummary: Record<string, unknown> = {};
    for (const scenario of MACRO_SCENARIOS) {
      const pathEpisodeDurations: number[] = [];
      const pathScenarioMonthIntensities: number[] = [];

      for (const path of paths) {
        const scenarioStates = Array.isArray(path.scenarioPath?.years) ? path.scenarioPath.years : [];
        const monthlyEntries = Array.isArray(path.monthly) ? path.monthly : [];
        const monthsToInspect = Math.max(scenarioStates.length, monthlyEntries.length);
        let currentEpisodeScenario: MacroScenario | null = null;
        let currentEpisodeDuration = 0;

        for (let monthIndex = 0; monthIndex < monthsToInspect; monthIndex += 1) {
          const state = scenarioStates[monthIndex];
          const nextScenario = state?.scenario as MacroScenario | undefined;
          const monthIntensity = monthlyEntries[monthIndex]?.intensity;

          if (nextScenario === scenario && Number.isFinite(monthIntensity)) {
            pathScenarioMonthIntensities.push(Number(monthIntensity));
          }

          if (nextScenario === undefined) {
            if (currentEpisodeScenario === scenario && currentEpisodeDuration > 0) {
              pathEpisodeDurations.push(currentEpisodeDuration);
            }
            currentEpisodeScenario = null;
            currentEpisodeDuration = 0;
            continue;
          }

          if (currentEpisodeScenario === null) {
            currentEpisodeScenario = nextScenario;
            currentEpisodeDuration = 1;
            continue;
          }

          if (nextScenario === currentEpisodeScenario) {
            currentEpisodeDuration += 1;
            continue;
          }

          if (currentEpisodeScenario === scenario) {
            pathEpisodeDurations.push(currentEpisodeDuration);
          }
          currentEpisodeScenario = nextScenario;
          currentEpisodeDuration = 1;
        }

        if (currentEpisodeScenario === scenario && currentEpisodeDuration > 0) {
          pathEpisodeDurations.push(currentEpisodeDuration);
        }
      }

      const validScenarioIntensities = pathScenarioMonthIntensities.filter((value) => Number.isFinite(value));
      const episodeDurations = pathEpisodeDurations.filter((value) => Number.isFinite(value) && value > 0);
      const totalScenarioMonths = episodeDurations.reduce((sum, value) => sum + value, 0);
      const numberOfEpisodes = episodeDurations.length;
      const averageEpisodeDuration = numberOfEpisodes > 0 ? totalScenarioMonths / numberOfEpisodes : 0;
      const p50Duration = numberOfEpisodes > 0 ? this.calculateLinearPercentile(episodeDurations, 50) : 0;
      const p95Duration = numberOfEpisodes > 0 ? this.calculateLinearPercentile(episodeDurations, 95) : 0;
      const maxDuration = numberOfEpisodes > 0 ? this.computeMax(episodeDurations, 0) : 0;
      const meanIntensity = validScenarioIntensities.length > 0 ? validScenarioIntensities.reduce((sum, value) => sum + value, 0) / validScenarioIntensities.length : 0;
      const p95Intensity = validScenarioIntensities.length > 0 ? this.calculateLinearPercentile(validScenarioIntensities, 95) : 0;

      macroSummary[scenario] = {
        frequency: scenarioFrequencies[scenario],
        totalScenarioMonths,
        numberOfEpisodes,
        averageEpisodeDuration,
        p50Duration,
        p95Duration,
        maxDuration,
        meanIntensity,
        p95Intensity,
      };
    }
    const observedEpisodeDurations = paths.flatMap((path) => path.scenarioPath?.years ?? []).map((entry) => entry.durationInCurrentScenario).filter((value) => Number.isFinite(value) && value >= 0);
    const averageObservedMonthsPerScenario = observedEpisodeDurations.length > 0
      ? observedEpisodeDurations.reduce((sum, value) => sum + value, 0) / observedEpisodeDurations.length
      : (horizonYears * 12) / Math.max(1, MACRO_SCENARIOS.length);
    const candidateReturnDenominator = returnGenerationAggregate.candidateReturnCount > 0 ? returnGenerationAggregate.candidateReturnCount : returnGenerationAggregate.candidateVectors;
    const canonicalRedrawCount = returnGenerationAggregate.rejectedVectors;
    const canonicalRejectRate = returnGenerationAggregate.candidateVectors > 0 ? returnGenerationAggregate.rejectedVectors / returnGenerationAggregate.candidateVectors : 0;
    const canonicalPhysicalFloorRejectRate = returnGenerationAggregate.candidateVectors > 0 ? returnGenerationAggregate.physicalFloorRejectedVectors / returnGenerationAggregate.candidateVectors : 0;

    const baseStatistics = {
      advancedStatisticsEnabled,
      returnGeneration: {
        totalCandidateVectors: returnGenerationAggregate.candidateVectors,
        totalAcceptedVectors: returnGenerationAggregate.acceptedVectors,
        totalRejectedVectors: returnGenerationAggregate.rejectedVectors,
        totalPhysicalFloorRejectedVectors: returnGenerationAggregate.physicalFloorRejectedVectors,
        totalOldRangeViolationCount: returnGenerationAggregate.oldRangeViolationCount,
        totalEffectiveRangeRejectedVectors: returnGenerationAggregate.effectiveRangeRejectedVectors,
        totalRedrawCount: canonicalRedrawCount,
        rejectRate: canonicalRejectRate,
        physicalFloorRejectRate: canonicalPhysicalFloorRejectRate,
        oldRangeViolationRate: candidateReturnDenominator > 0 ? returnGenerationAggregate.oldRangeViolationCount / candidateReturnDenominator : 0,
      },
      scenario: {
        frequencies: scenarioFrequencies,
        duration: {
          averageMonthsPerScenario: averageObservedMonthsPerScenario,
          observed: observedDuration
        },
        transitions: {
          empiricalMatrix,
          source: 'path-level-observed-transition-summary'
        },
        persistence: {
          expansion: empiricalMatrix.expansion.expansion,
          recession: empiricalMatrix.recession.recession,
          stagflation: empiricalMatrix.stagflation.stagflation,
          soft_landing: empiricalMatrix.soft_landing.soft_landing
        }
      },
      intensity: {
        distribution: {
          mean: statisticsInput?.diagnostics?.intensity?.distribution?.mean ?? intensityMean,
          volatility: statisticsInput?.diagnostics?.intensity?.distribution?.volatility ?? intensityVolatility,
          bands: intensityBands
        },
        persistence: statisticsInput?.diagnostics?.intensity?.persistence ?? { observed: true }
      },
      returns: {
        sampleCount: pathReturns.length,
        meanMonthlyReturn: meanReturn,
        monthlyVolatility: returnVolatility,
        annualizedVolatility: returnVolatility * Math.sqrt(12),
        minimumMonthlyReturn: pathReturns.length > 0 ? this.computeMin(pathReturns) : 0,
        p1: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 1) : 0,
        p5: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 5) : 0,
        p50: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 50) : 0,
        p95: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 95) : 0,
        p99: pathReturns.length > 0 ? this.calculateLinearPercentile(pathReturns, 99) : 0,
        maximumMonthlyReturn: pathReturns.length > 0 ? this.computeMax(pathReturns) : 0,
      },
      drawdown: {
        p5: drawdownPercentiles.p5,
        p25: drawdownPercentiles.p25,
        p50: drawdownPercentiles.p50,
        p75: drawdownPercentiles.p75,
        p95: drawdownPercentiles.p95,
        p99: this.calculateLinearPercentile(maxDrawdownValues, 99),
        max: this.computeMax(maxDrawdownValues, 0),
      },
      macro: macroSummary,
      rangeDiagnostics: {
        candidateVectors: returnGenerationAggregate.candidateVectors,
        acceptedVectors: returnGenerationAggregate.acceptedVectors,
        rejectedVectors: returnGenerationAggregate.rejectedVectors,
        physicalFloorRejectedVectors: returnGenerationAggregate.physicalFloorRejectedVectors,
        oldRangeViolationCount: returnGenerationAggregate.oldRangeViolationCount,
        effectiveRangeRejectedVectors: returnGenerationAggregate.effectiveRangeRejectedVectors,
        byEtfScenario: returnGenerationAggregate.byEtfScenario
      },
      ...(advancedStatisticsEnabled ? {
        correlations: indicatorMatrix,
        generalComparison: {
          targetExpectedReturnDelta: generalBenchmark ? (generalBenchmark.simulatedLongTermReturn ?? meanReturn) - generalBenchmark.expectedReturn : null,
          targetVolatilityDelta: generalBenchmark ? (generalBenchmark.simulatedVolatility ?? returnVolatility) - generalBenchmark.volatility : null,
          generalBenchmarkCAGR: generalBenchmarkCAGR,
          generalBenchmarkVolatility: generalBenchmarkVolatility
        }
      } : {
        correlations: {
          skipped: true,
          reason: 'advancedStatisticsEnabled=false'
        },
        generalComparison: {
          skipped: true,
          reason: 'advancedStatisticsEnabled=false'
        }
      }),
      performance: performance ?? { redrawCount: null, rejectRate: null }
    };

    return baseStatistics;
  }

  private static buildTechnicalChecks(
    paths: MonteCarloPathResult[],
    horizonYears: number,
    initialCapital: number,
    cagrValues: number[],
    maxDrawdownValues: number[],
    matricesCoherent = true
  ): Record<string, unknown> {
    const capitalMatches = paths.every((path) => {
      const monthlyEntries = Array.isArray(path.monthly) ? path.monthly : [];
      if (monthlyEntries.length === 0) {
        return Number.isFinite(path.finalCapital) && path.finalCapital >= 0;
      }
      return monthlyEntries.every((entry) => {
        const positions = Array.isArray((entry as any).positions) ? (entry as any).positions as Array<{ value?: number }> : [];
        const sumPositions = positions.length > 0
          ? positions.reduce((sum: number, position: { value?: number }) => sum + (Number.isFinite(position.value) ? position.value as number : 0), 0)
          : null;
        const endingCapital = entry.endingCapital ?? path.finalCapital;
        if (sumPositions !== null) {
          return Math.abs(sumPositions - endingCapital) <= 1e-6;
        }
        return Number.isFinite(endingCapital) && endingCapital >= 0;
      });
    });

    const returnMatches = paths.every((path) => {
      const monthlyEntries = Array.isArray(path.monthly) ? path.monthly : [];
      if (monthlyEntries.length === 0) {
        return Number.isFinite(path.totalReturn);
      }
      return monthlyEntries.every((entry) => {
        const positions = Array.isArray((entry as any).positions) ? (entry as any).positions as Array<{ contribution?: number }> : [];
        const sumContributions = positions.length > 0
          ? positions.reduce((sum: number, position: { contribution?: number }) => sum + (Number.isFinite(position.contribution) ? position.contribution as number : 0), 0)
          : null;
        const portfolioReturn = entry.portfolioReturn ?? path.totalReturn;
        if (sumContributions !== null) {
          return Math.abs(sumContributions - portfolioReturn) <= 1e-6;
        }
        return Number.isFinite(portfolioReturn);
      });
    });

    const cagrChecks = paths.map((path) => {
      if (path.finalCapital <= 0) return { simulationId: path.simulationId, ok: true };
      const identityCheck = Math.abs((1 + this.calculatePathCagr(path.initialCapital, path.finalCapital, horizonYears)) - Math.pow(1 + path.totalReturn, 1 / horizonYears)) <= 1e-6;
      return { simulationId: path.simulationId, ok: identityCheck };
    });

    const orderedPercentiles = this.buildPercentileSet(cagrValues);
    const percentileOrdered = [orderedPercentiles.p5, orderedPercentiles.p25, orderedPercentiles.p50, orderedPercentiles.p75, orderedPercentiles.p95].every((value, index, arr) => index === 0 || arr[index - 1] <= value);
    const fanOrdered = this.buildCapitalFan(paths, horizonYears).every((point) => point.capitalP5 <= point.capitalP25 && point.capitalP25 <= point.capitalP50 && point.capitalP50 <= point.capitalP75 && point.capitalP75 <= point.capitalP95);
    const finiteValues = paths.every((path) => Number.isFinite(path.finalCapital) && Number.isFinite(path.maxDrawdown) && Number.isFinite(path.totalReturn) && Number.isFinite(path.cagr)) && maxDrawdownValues.every((value) => Number.isFinite(value));

    return {
      passed: capitalMatches && returnMatches && percentileOrdered && fanOrdered && finiteValues && cagrChecks.every((check) => check.ok) && matricesCoherent,
      percentilesOrdered: percentileOrdered,
      fanOrdered,
      finiteValues,
      matricesCoherent,
      diagnostics: { pathCount: paths.length, horizonYears, initialCapital }
    };
  }

  private static calculateSummaryInternal(
    paths: MonteCarloPathResult[],
    initialCapital: number,
    targetCagr: number,
    horizonYears: number,
    portfolio: PortfolioPosition[],
    portfolioSnapshot: PortfolioSimulationSnapshot,
    missingMacroStatistics: string[],
    missingCorrelationPairs: Array<{ isinA: string; isinB: string; scenario: MacroScenario }>
  ): ExtendedMonteCarloSummary {
    if (paths.length === 0) {
      return this.createEmptySummary(initialCapital, horizonYears, targetCagr, portfolio, portfolioSnapshot, missingMacroStatistics, missingCorrelationPairs);
    }
    const finalCapitals = paths.map((path) => path.finalCapital);
    const cagrValues = paths.map((path) => (path.finalCapital === 0 ? -1 : (path.cagr ?? this.calculatePathCagr(path.initialCapital, path.finalCapital, horizonYears))));
    const maxDrawdowns = paths.map((path) => path.maxDrawdown ?? 0);
    const validPaths = paths.filter((path) => Number.isFinite(path.cagr) && Number.isFinite(path.finalCapital));
    const failedPathCount = paths.length - validPaths.length;
    const medianCagr = this.calculateMedian(cagrValues.length > 0 ? cagrValues : [0]);
    const averageCagr = cagrValues.reduce((sum, value) => sum + value, 0) / Math.max(1, cagrValues.length);
    const annualizedVolatilities: number[] = paths.map((path) => {
      const monthlyReturns = (path.monthly ?? []).map((entry) => entry.portfolioReturn ?? 0).filter((value) => Number.isFinite(value));
      return this.calculatePathVolatility(monthlyReturns);
    });
    const medianAnnualizedVolatility = this.calculateMedian(annualizedVolatilities.length > 0 ? annualizedVolatilities : [0]);
    const medianMaxDrawdown = this.calculateMedian(maxDrawdowns.length > 0 ? maxDrawdowns : [0]);

    return {
      simulationCount: paths.length,
      validSimulationCount: validPaths.length,
      failedPathCount,
      horizonYears,
      initialCapital,
      averageFinalCapital: finalCapitals.reduce((sum, value) => sum + value, 0) / finalCapitals.length,
      medianFinalCapital: this.calculateMedian(finalCapitals.length > 0 ? finalCapitals : [initialCapital]),
      percentile5FinalCapital: this.calculateLinearPercentile(finalCapitals, 5),
      percentile25FinalCapital: this.calculateLinearPercentile(finalCapitals, 25),
      percentile75FinalCapital: this.calculateLinearPercentile(finalCapitals, 75),
      percentile95FinalCapital: this.calculateLinearPercentile(finalCapitals, 95),
      averageCagr,
      medianCagr,
      percentile5Cagr: this.calculateLinearPercentile(cagrValues, 5),
      percentile25Cagr: this.calculateLinearPercentile(cagrValues, 25),
      percentile75Cagr: this.calculateLinearPercentile(cagrValues, 75),
      percentile95Cagr: this.calculateLinearPercentile(cagrValues, 95),
      medianConsistencyDifference: 0,
      averageMaxDrawdown: maxDrawdowns.reduce((sum, value) => sum + value, 0) / Math.max(1, maxDrawdowns.length),
      averageWorst5PercentMaxDrawdown: 0,
      worstMaxDrawdown: this.computeMax(maxDrawdowns, 0),
      probabilityOfLoss: paths.filter((path) => path.totalReturn < 0).length / Math.max(1, paths.length),
      probabilityCagrAboveTarget: validPaths.filter((path) => (path.cagr ?? 0) >= targetCagr).length / Math.max(1, validPaths.length),
      scenarioFrequencies: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 },
      averageEtfContribution: [],
      missingMacroStatistics,
      missingCorrelationPairs,
      portfolioSnapshot,
      medianAnnualizedVolatility,
      medianMaxDrawdown,
      etfsMissingGeneralStats: []
    };
  }

  /**
   * Calculate summary statistics from all paths
   */
  static calculateSummary(
    paths: MonteCarloPathResult[],
    initialCapital: number,
    targetCagr: number,
    horizonYears: number,
    portfolio: PortfolioPosition[],
    portfolioSnapshot: PortfolioSimulationSnapshot,
    missingMacroStatistics: string[] = [],
    missingCorrelationPairs: Array<{ isinA: string; isinB: string; scenario: MacroScenario }> = []
  ): ExtendedMonteCarloSummary {
    if (paths.length === 0) {
      return this.createEmptySummary(
        initialCapital,
        horizonYears,
        targetCagr,
        portfolio,
        portfolioSnapshot,
        missingMacroStatistics,
        missingCorrelationPairs
      );
    }

    // =========================================================================
    // SEPARATE VALID vs FAILED PATHS
    // A path is failed if finalCapital <= 0 (total loss)
    // =========================================================================
    const failedPaths = paths.filter(p => p.finalCapital <= 0 || !isFinite(p.cagr) || isNaN(p.cagr));
    const validPaths = paths.filter(p => p.finalCapital > 0 && isFinite(p.cagr) && !isNaN(p.cagr));
    const failedPathCount = failedPaths.length;
    const validSimulationCount = validPaths.length;

    if (validPaths.length === 0) {
      return { ...this.createEmptySummary(initialCapital, horizonYears, targetCagr, portfolio, portfolioSnapshot, missingMacroStatistics, missingCorrelationPairs), simulationCount: paths.length, failedPathCount };
    }

    // Extract metrics from VALID paths only
    const finalCapitals = validPaths.map(p => p.finalCapital);
    const cagrs = validPaths.map(p => p.cagr);
    const maxDrawdowns = paths.map(p => p.maxDrawdown); // all paths for drawdown

    // Compute per-path annualized volatility = std dev of annual portfolio returns
    const annualizedVolatilities: number[] = validPaths.map(path => {
      const returns = path.years.map((y: any) => y.portfolioReturn);
      if (returns.length === 0) return 0;
      const mean = returns.reduce((s: number, v: number) => s + v, 0) / returns.length;
      const variance = returns.reduce((s: number, v: number) => s + Math.pow(v - mean, 2), 0) / returns.length;
      return Math.sqrt(variance); // already annual, no sqrt(T) needed
    });

    const sortedVolatilities = [...annualizedVolatilities].sort((a, b) => a - b);
    const medianAnnualizedVolatility = this.calculateMedian(annualizedVolatilities.length > 0 ? annualizedVolatilities : [0]);
    const sortedMaxDrawdowns = [...maxDrawdowns].sort((a, b) => a - b); // ascending (most negative first)
    const medianMaxDrawdown = this.calculateMedian(maxDrawdowns.length > 0 ? maxDrawdowns : [0]);
    const worst5Count = Math.max(1, Math.ceil(maxDrawdowns.length * 0.05));
    const worst5MaxDrawdowns = [...maxDrawdowns].sort((a, b) => b - a).slice(0, worst5Count);
    const averageWorst5PercentMaxDrawdown =
      worst5MaxDrawdowns.reduce((sum, value) => sum + value, 0) / worst5MaxDrawdowns.length;
    void sortedVolatilities; // suppress unused warning

    // =========================================================================
    // PRIMARY METRIC: medianCagr — true statistical median of valid CAGRs
    // =========================================================================
    const medianCagr = this.calculateMedian(cagrs);
    const medianFinalCapital = this.calculateMedian(finalCapitals);

    // Consistency check: medianFinalCapital should be close to reconstructed from medianCagr
    const reconstructedMedianCapital = initialCapital * Math.pow(1 + medianCagr, horizonYears);
    const medianConsistencyDifference = Math.abs(medianFinalCapital - reconstructedMedianCapital);

    // CAGR percentiles
    const percentile5Cagr = this.calculatePercentile(cagrs, 5);
    const percentile25Cagr = this.calculatePercentile(cagrs, 25);
    const percentile75Cagr = this.calculatePercentile(cagrs, 75);
    const percentile95Cagr = this.calculatePercentile(cagrs, 95);

    // Capital percentiles
    const percentile5FinalCapital = this.calculatePercentile(finalCapitals, 5);
    const percentile25FinalCapital = this.calculatePercentile(finalCapitals, 25);
    const percentile75FinalCapital = this.calculatePercentile(finalCapitals, 75);
    const percentile95FinalCapital = this.calculatePercentile(finalCapitals, 95);

    // Average CAGR kept for debug/comparison only (not primary)
    const averageCagr = cagrs.reduce((sum, v) => sum + v, 0) / cagrs.length;

    // Calculate probabilities (use validPaths for CAGR, all paths for loss)
    const probabilityOfLoss = paths.filter(p => p.totalReturn < 0).length / paths.length;
    const probabilityCagrAboveTarget = validPaths.filter(
      p => p.cagr >= targetCagr  // >= as per spec
    ).length / validSimulationCount;

    // Calculate scenario frequencies
    const scenarioFrequencies: Record<MacroScenario, number> = {
      expansion: 0,
      recession: 0,
      stagflation: 0,
      soft_landing: 0
    };

    for (const path of paths) {
      for (const freq of Object.entries(path.scenarioPath.frequencies)) {
        scenarioFrequencies[freq[0] as MacroScenario] += freq[1];
      }
    }

    // Normalize by total samples
    const totalScenarioCount = Object.values(scenarioFrequencies).reduce(
      (sum, v) => sum + v,
      0
    );
    for (const scenario of MACRO_SCENARIOS) {
      scenarioFrequencies[scenario] =
        totalScenarioCount > 0
          ? scenarioFrequencies[scenario] / totalScenarioCount
          : 0;
    }

    // Calculate ETF contributions
    const etfContributions = this.calculateEtfContributions(
      validPaths,
      portfolio
    );

    if (validSimulationCount > 0 && medianConsistencyDifference > initialCapital * 0.01) {
      console.warn(`[MonteCarloStatistics] medianConsistencyDifference = ${medianConsistencyDifference.toFixed(0)} (>1% of initial capital)`);
    }

    return {
      simulationCount: paths.length,
      validSimulationCount,
      failedPathCount,
      horizonYears,
      initialCapital,
      averageFinalCapital:
        finalCapitals.reduce((sum, v) => sum + v, 0) / finalCapitals.length,
      medianFinalCapital,
      percentile5FinalCapital,
      percentile25FinalCapital,
      percentile75FinalCapital,
      percentile95FinalCapital,
      averageCagr,       // kept for debug, not primary
      medianCagr,        // PRIMARY METRIC
      percentile5Cagr,
      percentile25Cagr,
      percentile75Cagr,
      percentile95Cagr,
      medianConsistencyDifference,
      averageMaxDrawdown:
        maxDrawdowns.reduce((sum, v) => sum + v, 0) /
        maxDrawdowns.length,
      averageWorst5PercentMaxDrawdown,
      worstMaxDrawdown: this.computeMax(maxDrawdowns, 0),
      medianAnnualizedVolatility,
      medianMaxDrawdown,
      probabilityOfLoss,
      probabilityCagrAboveTarget,
      scenarioFrequencies,
      averageEtfContribution: etfContributions,
      missingMacroStatistics,
      missingCorrelationPairs,
      portfolioSnapshot,
      etfsMissingGeneralStats: []
    };
  }

  /**
   * Calculate average contributions by ETF
   */
  private static calculateEtfContributions(
    paths: MonteCarloPathResult[],
    portfolio: PortfolioPosition[]
  ): EtfContributionStats[] {
    const contributionMap: Record<
      string,
      {
        name: string;
        annualContributions: number[];
        totalContribution: number;
      }
    > = {};

    // Initialize
    for (const pos of portfolio) {
      contributionMap[pos.isin] = {
        name: pos.name,
        annualContributions: [],
        totalContribution: 0
      };
    }

    // Accumulate contributions from all paths
    for (const path of paths) {
      for (const year of path.years) {
        for (const etfReturn of year.etfReturns) {
          if (!contributionMap[etfReturn.isin]) {
            contributionMap[etfReturn.isin] = {
              name: etfReturn.name,
              annualContributions: [],
              totalContribution: 0
            };
          }

          contributionMap[etfReturn.isin].annualContributions.push(
            etfReturn.contribution
          );
          contributionMap[etfReturn.isin].totalContribution +=
            etfReturn.contribution;
        }
      }
    }

    // Calculate statistics
    return Object.entries(contributionMap)
      .map(([isin, data]) => ({
        isin,
        name: data.name,
        averageAnnualContribution:
          data.annualContributions.length > 0
            ? data.annualContributions.reduce((sum, v) => sum + v, 0) /
              data.annualContributions.length
            : 0,
        cumulativeContribution: data.totalContribution
      }))
      .sort((a, b) => b.cumulativeContribution - a.cumulativeContribution);
  }

  /**
   * Create empty summary for zero paths
   */
  private static createEmptySummary(
    initialCapital: number,
    horizonYears: number,
    targetCagr: number,
    portfolio: PortfolioPosition[],
    portfolioSnapshot: PortfolioSimulationSnapshot,
    missingMacroStatistics: string[],
    missingCorrelationPairs: Array<{ isinA: string; isinB: string; scenario: MacroScenario }>
  ): ExtendedMonteCarloSummary {
    return {
      simulationCount: 0,
      validSimulationCount: 0,
      failedPathCount: 0,
      horizonYears,
      initialCapital,
      averageFinalCapital: initialCapital,
      medianFinalCapital: initialCapital,
      percentile5FinalCapital: initialCapital,
      percentile25FinalCapital: initialCapital,
      percentile75FinalCapital: initialCapital,
      percentile95FinalCapital: initialCapital,
      averageCagr: 0,
      medianCagr: 0,
      percentile5Cagr: 0,
      percentile25Cagr: 0,
      percentile75Cagr: 0,
      percentile95Cagr: 0,
      medianConsistencyDifference: 0,
      averageMaxDrawdown: 0,
      averageWorst5PercentMaxDrawdown: 0,
      worstMaxDrawdown: 0,
      probabilityOfLoss: 0,
      probabilityCagrAboveTarget: 0,
      scenarioFrequencies: {
        expansion: 0,
        recession: 0,
        stagflation: 0,
        soft_landing: 0
      },
      averageEtfContribution: portfolio.map(p => ({
        isin: p.isin,
        name: p.name,
        averageAnnualContribution: 0,
        cumulativeContribution: 0
      })),
      missingMacroStatistics,
      missingCorrelationPairs,
      portfolioSnapshot,
      medianAnnualizedVolatility: 0,
      medianMaxDrawdown: 0,
      etfsMissingGeneralStats: []
    };
  }
}
