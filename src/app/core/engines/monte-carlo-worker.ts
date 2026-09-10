import { MonteCarloUserInput, MonteCarloSnapshot } from '../models/monte-carlo-contracts.model';
import { generateMonthlyMacroTimeline } from '../macro/monte-carlo-macro-engine';
import { calculateSpearmanCorrelation, generateMonthlyReturnVector, ReturnCorrelationDiagnosticsAccumulator } from '../returns/monte-carlo-return-engine';
import { prepareMonteCarloPrecomputation } from '../precomputation/monte-carlo-precomputation';
import { evolveMonteCarloPortfolioPath } from '../portfolio/monte-carlo-portfolio-path-engine';
import { SeededRandom } from './seeded-random';

interface WorkerMessage {
  type: 'INIT' | 'RUN_BATCH' | 'CANCEL' | 'WORKER_BATCH_METRICS' | 'PORT_PING' | 'PORT_PONG' | 'MC_PORT_TEST_PING' | 'MC_PORT_TEST_PONG' | 'MC_PORT_TEST_ADD_BATCH' | 'MC_PORT_TEST_ADD_BATCH_ACK' | 'MC_PORT_TEST_SEND_ADD_BATCH' | 'MC_PORT_TEST_ADD_BATCH_RESULT';
  executionId: string;
  workerId: number;
  testId?: string;
  batchStart?: number;
  batchEnd?: number;
  pathCount?: number;
  precompute?: unknown;
  snapshot?: any;
  input?: any;
  aggregationPort?: MessagePort;
  totalBatchMs?: number;
  macroMs?: number;
  returnMs?: number;
  portfolioMs?: number;
  compactMs?: number;
  sendMs?: number;
  value?: number;
  advancedStatistics?: boolean;
}

const asWorkerScope = (typeof self !== 'undefined' ? self : globalThis) as typeof globalThis & {
  postMessage: (message: any) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

const createDeterministicRandom = (simulationId: number, workerId: number): SeededRandom => {
  const baseSeed = (workerId * 1_000_003 + simulationId * 1_000_033 + 1) >>> 0;
  return new SeededRandom(baseSeed);
};

export const toCompactPathResult = (path: any): any => {
  const monthly = Array.isArray(path?.monthly)
    ? path.monthly.map((entry: any) => ({
        month: entry?.month,
        year: entry?.year,
        endingCapital: entry?.endingCapital ?? entry?.capital,
        capital: entry?.capital ?? entry?.endingCapital,
        portfolioReturn: entry?.portfolioReturn,
        runningPeak: entry?.runningPeak,
        drawdown: entry?.drawdown,
        intensity: entry?.intensity
      }))
    : [];

  const scenarioPath = {
    years: Array.isArray(path?.scenarioPath?.years)
      ? path.scenarioPath.years.map((entry: any) => ({
          year: entry?.year,
          scenario: entry?.scenario ?? 'expansion',
          durationInCurrentScenario: entry?.durationInCurrentScenario ?? 0
        }))
      : [],
    frequencies: {
      expansion: path?.scenarioPath?.frequencies?.expansion ?? 0,
      recession: path?.scenarioPath?.frequencies?.recession ?? 0,
      stagflation: path?.scenarioPath?.frequencies?.stagflation ?? 0,
      soft_landing: path?.scenarioPath?.frequencies?.soft_landing ?? 0
    }
  };

  const years = Array.isArray(path?.years)
    ? path.years.map((entry: any) => ({
        year: entry?.year,
        scenario: entry?.scenario ?? 'expansion',
        durationInCurrentScenario: entry?.durationInCurrentScenario ?? 0,
        etfReturns: Array.isArray(entry?.etfReturns) ? entry.etfReturns.map((etf: any) => ({
          isin: etf?.isin ?? '',
          name: etf?.name ?? '',
          weight: etf?.weight ?? 0,
          annualReturn: etf?.annualReturn ?? 0,
          contribution: etf?.contribution ?? 0,
          intensity: etf?.intensity ?? 0,
          deviationDirection: etf?.deviationDirection ?? 'above_expected'
        })) : [],
        portfolioReturn: entry?.portfolioReturn ?? 0,
        startingCapital: entry?.startingCapital ?? 0,
        endingCapital: entry?.endingCapital ?? 0,
        runningPeak: entry?.runningPeak ?? 0,
        drawdown: entry?.drawdown ?? 0
      }))
    : [];

  return {
    simulationId: path?.simulationId ?? -1,
    dominantEtfIsin: path?.dominantEtfIsin ?? '',
    dominantEtfName: path?.dominantEtfName ?? '',
    initialCapital: path?.initialCapital ?? 0,
    finalCapital: path?.finalCapital ?? 0,
    totalReturn: path?.totalReturn ?? 0,
    cagr: path?.cagr ?? 0,
    maxDrawdown: path?.maxDrawdown ?? 0,
    monthly,
    maxRecoveryTimeMonths: path?.maxRecoveryTimeMonths ?? null,
    unrecovered: path?.unrecovered ?? false,
    unrecoveredDurationMonths: path?.unrecoveredDurationMonths ?? null,
    scenarioPath,
    years,
    returnDiagnostics: path?.returnDiagnostics,
    performanceDiagnostics: path?.performanceDiagnostics,
    correlationDiagnostics: path?.correlationDiagnostics,
    generalBenchmark: path?.generalBenchmark,
    matricesCoherent: path?.matricesCoherent ?? true
  };
};

export const __advancedDiagnosticsRuntime = {
  buildRunLevelCorrelationDiagnostics: 0,
  calculateSpearmanCorrelation: 0,
  calculateTailDependence: 0,
  buildDeltaMatrix: 0,
  recordRangeCandidate: 0,
  reset: () => {
    __advancedDiagnosticsRuntime.buildRunLevelCorrelationDiagnostics = 0;
    __advancedDiagnosticsRuntime.calculateSpearmanCorrelation = 0;
    __advancedDiagnosticsRuntime.calculateTailDependence = 0;
    __advancedDiagnosticsRuntime.buildDeltaMatrix = 0;
    __advancedDiagnosticsRuntime.recordRangeCandidate = 0;
  }
};

if (typeof globalThis !== 'undefined') {
  (globalThis as any).__advancedDiagnosticsRuntime = __advancedDiagnosticsRuntime;
}

const cloneMatrix = (matrix: number[][]): number[][] => matrix.map((row) => [...row]);

export const buildDeltaMatrix = (empiricalReturn: number[][], target: number[][], absolute = false): number[][] => {
  __advancedDiagnosticsRuntime.buildDeltaMatrix += 1;
  const rows = Array.isArray(empiricalReturn) ? empiricalReturn.length : 0;
  const columns = rows > 0 && Array.isArray(empiricalReturn[0]) ? empiricalReturn[0].length : 0;
  if (rows === 0 || columns === 0 || !Array.isArray(target) || target.length !== rows || target[0]?.length !== columns) {
    return [];
  }

  const deltaMatrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const empiricalValue = Number(empiricalReturn[row]?.[column] ?? 0);
      const targetValue = Number(target[row]?.[column] ?? 0);
      const delta = row === column ? 0 : empiricalValue - targetValue;
      deltaMatrix[row][column] = absolute ? Math.abs(delta) : delta;
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = row + 1; column < columns; column += 1) {
      const delta = (absolute ? Math.abs : (value: number) => value)(
        (Number(empiricalReturn[row]?.[column] ?? 0) - Number(target[row]?.[column] ?? 0))
      );
      deltaMatrix[row][column] = delta;
      deltaMatrix[column][row] = delta;
    }
  }

  return deltaMatrix;
};

export const buildScenarioErrorSummary = (targetMatrix: number[][], empiricalMatrix: number[][]): { mae: number; rmse: number; maxAbsoluteError: number } => {
  const rows = Array.isArray(targetMatrix) ? targetMatrix.length : 0;
  if (rows === 0 || !Array.isArray(empiricalMatrix) || empiricalMatrix.length !== rows) {
    return { mae: 0, rmse: 0, maxAbsoluteError: 0 };
  }

  const errors: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = row + 1; column < rows; column += 1) {
      const empiricalValue = Number(empiricalMatrix[row]?.[column] ?? 0);
      const targetValue = Number(targetMatrix[row]?.[column] ?? 0);
      errors.push(empiricalValue - targetValue);
    }
  }

  if (errors.length === 0) {
    return { mae: 0, rmse: 0, maxAbsoluteError: 0 };
  }

  const mae = errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, value) => sum + (value * value), 0) / errors.length);
  const maxAbsoluteError = errors.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

  return { mae, rmse, maxAbsoluteError };
};

const buildRunLevelCorrelationDiagnostics = (monthlyVectors: any[], precompute: any, advancedStatisticsEnabled = true): Record<string, any> => {
  if (!advancedStatisticsEnabled) {
    return {};
  }
  __advancedDiagnosticsRuntime.buildRunLevelCorrelationDiagnostics += 1;
  const matrixPreparation = monthlyVectors[0]?.diagnostics?.targetCorrelation
    ? { originalMatrix: monthlyVectors[0].diagnostics.targetCorrelation, operationalMatrix: monthlyVectors[0].diagnostics.operationalCorrelation }
    : precompute?.correlationMatrices?.expansion ?? Object.values(precompute?.correlationMatrices ?? {})[0] ?? null;

  if (!matrixPreparation) {
    return {};
  }

  const accumulator = new ReturnCorrelationDiagnosticsAccumulator(
    Array.isArray(matrixPreparation.originalMatrix) ? matrixPreparation.originalMatrix : [],
    Array.isArray(matrixPreparation.operationalMatrix) ? matrixPreparation.operationalMatrix : []
  );

  for (const vector of monthlyVectors) {
    if (Array.isArray(vector?.etfReturns) && vector.etfReturns.length > 0) {
      accumulator.record(vector);
    }
  }

  const empirical = accumulator.toDiagnostics();
  const targetMatrix = Array.isArray(empirical.targetCorrelation) ? empirical.targetCorrelation : Array.isArray(matrixPreparation.originalMatrix) ? matrixPreparation.originalMatrix : [];
  const empiricalReturnMatrix = Array.isArray(empirical.empiricalReturnCorrelation) ? empirical.empiricalReturnCorrelation : [];
  __advancedDiagnosticsRuntime.calculateSpearmanCorrelation += 1;
  const spearman = calculateSpearmanCorrelation(
    monthlyVectors.flatMap((vector) => Array.isArray(vector?.etfReturns) ? [vector.etfReturns.map((entry: any) => entry.monthlyReturn)] : [])
  );

  const scenarioMappings = {
    expansion: 'expansion',
    soft_landing: 'soft_landing',
    recession: 'recession',
    stagflation: 'stagflation'
  } as const;

  const scenarioDiagnostics = Object.fromEntries(
    Object.entries(scenarioMappings).map(([key, scenario]) => {
      const scenarioVectors = monthlyVectors.filter((vector) => vector?.scenario === scenario);
      if (scenarioVectors.length === 0) {
        return [key, { mae: 0, rmse: 0, maxAbsoluteError: 0 }];
      }

      const scenarioAccumulator = new ReturnCorrelationDiagnosticsAccumulator(
        Array.isArray(precompute?.correlationMatrices?.[scenario]?.originalMatrix) ? precompute.correlationMatrices[scenario].originalMatrix : targetMatrix,
        Array.isArray(precompute?.correlationMatrices?.[scenario]?.operationalMatrix) ? precompute.correlationMatrices[scenario].operationalMatrix : targetMatrix
      );

      for (const vector of scenarioVectors) {
        if (Array.isArray(vector?.etfReturns) && vector.etfReturns.length > 0) {
          scenarioAccumulator.record(vector);
        }
      }

      const scenarioEmpirical = scenarioAccumulator.toDiagnostics();
      const scenarioTarget = Array.isArray(precompute?.correlationMatrices?.[scenario]?.originalMatrix)
        ? precompute.correlationMatrices[scenario].originalMatrix
        : targetMatrix;
      const scenarioEmpiricalReturn = Array.isArray(scenarioEmpirical.empiricalReturnCorrelation)
        ? scenarioEmpirical.empiricalReturnCorrelation
        : empiricalReturnMatrix;
      const summary = buildScenarioErrorSummary(scenarioTarget, scenarioEmpiricalReturn);
      return [key, summary];
    })
  );

  const deltas = buildDeltaMatrix(empiricalReturnMatrix, targetMatrix, false);
  const absoluteDeltas = buildDeltaMatrix(empiricalReturnMatrix, targetMatrix, true);

  return {
    target: Array.isArray(empirical.targetCorrelation) ? empirical.targetCorrelation : Array.isArray(matrixPreparation.originalMatrix) ? matrixPreparation.originalMatrix : null,
    operational: Array.isArray(empirical.operationalCorrelation) ? empirical.operationalCorrelation : Array.isArray(matrixPreparation.operationalMatrix) ? matrixPreparation.operationalMatrix : null,
    latent: Array.isArray(empirical.latentCorrelation) ? empirical.latentCorrelation : Array.isArray(matrixPreparation.operationalMatrix) ? matrixPreparation.operationalMatrix : null,
    empiricalLatentShock: Array.isArray(empirical.empiricalShockCorrelation) ? empirical.empiricalShockCorrelation : null,
    empiricalReturn: empiricalReturnMatrix,
    pearsonPrimary: empiricalReturnMatrix,
    spearmanDiagnostic: spearman,
    lowerTailDependence5: Array.isArray(empirical.lowerTailDependence) ? empirical.lowerTailDependence : null,
    upperTailDependence5: Array.isArray(empirical.upperTailDependence) ? empirical.upperTailDependence : null,
    deltas,
    absoluteDeltas,
    maeByScenario: {
      expansion: scenarioDiagnostics.expansion.mae,
      soft_landing: scenarioDiagnostics.soft_landing.mae,
      recession: scenarioDiagnostics.recession.mae,
      stagflation: scenarioDiagnostics.stagflation.mae
    },
    rmseByScenario: {
      expansion: scenarioDiagnostics.expansion.rmse,
      soft_landing: scenarioDiagnostics.soft_landing.rmse,
      recession: scenarioDiagnostics.recession.rmse,
      stagflation: scenarioDiagnostics.stagflation.rmse
    },
    maxAbsoluteErrorByScenario: {
      expansion: scenarioDiagnostics.expansion.maxAbsoluteError,
      soft_landing: scenarioDiagnostics.soft_landing.maxAbsoluteError,
      recession: scenarioDiagnostics.recession.maxAbsoluteError,
      stagflation: scenarioDiagnostics.stagflation.maxAbsoluteError
    }
  };
};

export const buildPathResult = (input: MonteCarloUserInput, snapshot: MonteCarloSnapshot, precompute: any, simulationId: number, workerId: number, advancedStatisticsEnabled = true) => {
  const rng = createDeterministicRandom(simulationId, workerId);
  const horizonMonths = input.horizonYears * 12;
  const macro = generateMonthlyMacroTimeline(snapshot, horizonMonths, () => rng.next());
  const monthlyVectors = macro.months.map((monthState) =>
    generateMonthlyReturnVector(
      snapshot,
      precompute,
      monthState.scenario,
      monthState.intensity,
      () => rng.next(),
      advancedStatisticsEnabled
    )
  );

  const portfolioPath = evolveMonteCarloPortfolioPath(input, monthlyVectors);
  const correlationDiagnostics = advancedStatisticsEnabled ? buildRunLevelCorrelationDiagnostics(monthlyVectors, precompute, advancedStatisticsEnabled) : {};
  const dominantEtf = input.positions.reduce((best, position) => {
    if (!best || position.targetWeight > best.targetWeight) return position;
    return best;
  }, input.positions[0]);

  const monthlyReturnDiagnostics = monthlyVectors.reduce((aggregated, vector) => {
    const range = vector.diagnostics?.rangeDiagnostics;
    if (!range) return aggregated;
    aggregated.candidateVectors += range.candidateVectors;
    aggregated.acceptedVectors += range.acceptedVectors;
    aggregated.rejectedVectors += range.rejectedVectors;
    aggregated.physicalFloorRejectedVectors += range.physicalFloorRejectedVectors ?? 0;
    aggregated.oldRangeViolationCount += range.oldRangeViolationCount ?? 0;
    aggregated.effectiveRangeRejectedVectors += range.effectiveRangeRejectedVectors ?? 0;
    for (const [key, value] of Object.entries(range.byEtfScenario ?? {})) {
      const current = aggregated.byEtfScenario[key] ?? {
        candidateReturnCount: 0,
        belowEffectiveMinCount: 0,
        aboveEffectiveMaxCount: 0,
        lowerRejectRate: 0,
        upperRejectRate: 0,
        totalOutOfRangeRate: 0,
        meanLowerDistanceSigma: null,
        meanUpperDistanceSigma: null
      };
      current.candidateReturnCount += value.candidateReturnCount;
      current.belowEffectiveMinCount += value.belowEffectiveMinCount;
      current.aboveEffectiveMaxCount += value.aboveEffectiveMaxCount;
      current.lowerRejectRate = current.candidateReturnCount > 0 ? current.belowEffectiveMinCount / current.candidateReturnCount : 0;
      current.upperRejectRate = current.candidateReturnCount > 0 ? current.aboveEffectiveMaxCount / current.candidateReturnCount : 0;
      current.totalOutOfRangeRate = current.candidateReturnCount > 0 ? (current.belowEffectiveMinCount + current.aboveEffectiveMaxCount) / current.candidateReturnCount : 0;
      if (value.meanLowerDistanceSigma !== null) {
        current.meanLowerDistanceSigma = (current.meanLowerDistanceSigma ?? 0) + value.meanLowerDistanceSigma;
      }
      if (value.meanUpperDistanceSigma !== null) {
        current.meanUpperDistanceSigma = (current.meanUpperDistanceSigma ?? 0) + value.meanUpperDistanceSigma;
      }
      aggregated.byEtfScenario[key] = current;
    }
    return aggregated;
  }, {
    candidateVectors: 0,
    acceptedVectors: 0,
    rejectedVectors: 0,
    physicalFloorRejectedVectors: 0,
    oldRangeViolationCount: 0,
    effectiveRangeRejectedVectors: 0,
    byEtfScenario: {} as Record<string, any>
  });

  const pathResult = {
    simulationId,
    dominantEtfIsin: dominantEtf?.isin ?? '',
    dominantEtfName: dominantEtf?.isin ?? '',
    initialCapital: input.initialCapital,
    finalCapital: portfolioPath.finalCapital,
    totalReturn: portfolioPath.totalReturn,
    cagr: Math.pow(portfolioPath.finalCapital / input.initialCapital, 1 / Math.max(1, input.horizonYears)) - 1,
    maxDrawdown: portfolioPath.maxDrawdown,
    monthly: portfolioPath.monthly.map((entry) => ({
      month: entry.month,
      year: entry.year,
      endingCapital: entry.endingCapital,
      capital: entry.endingCapital,
      portfolioReturn: entry.portfolioReturn,
      runningPeak: entry.runningPeak,
      drawdown: entry.drawdown,
      intensity: entry.intensity,
      positions: entry.positions.map((position) => ({
        isin: position.isin,
        value: position.endingValue,
        contribution: position.contribution,
        weight: position.currentWeightEnd ?? position.targetWeight,
        targetWeight: position.targetWeight
      }))
    })),
    maxRecoveryTimeMonths: portfolioPath.maxRecoveryTimeMonths,
    unrecovered: portfolioPath.unrecovered,
    unrecoveredDurationMonths: portfolioPath.unrecoveredDurationMonths,
    returnDiagnostics: monthlyReturnDiagnostics,
    years: portfolioPath.annual.map((entry) => ({
      year: entry.year,
      scenario: macro.months[(entry.year * 12) - 1]?.scenario ?? 'expansion',
      durationInCurrentScenario: 12,
      etfReturns: entry.etfs.map((etf) => ({
        isin: etf.isin,
        name: etf.isin,
        weight: input.positions.find((position) => position.isin === etf.isin)?.targetWeight ?? 0,
        expectedReturn: 0,
        annualReturn: etf.annualReturn,
        contribution: etf.annualContributionAtTargetWeight,
        intensity: 0,
        deviationDirection: 'above_expected'
      })),
      portfolioReturn: entry.annualPortfolioReturn,
      startingCapital: entry.startingCapital,
      endingCapital: entry.endingCapital,
      runningPeak: entry.endingCapital,
      drawdown: portfolioPath.maxDrawdown
    })),
    scenarioPath: {
      years: macro.months.map((monthState, index) => ({
        year: Math.floor(index / 12) + 1,
        scenario: monthState.scenario,
        durationInCurrentScenario: monthState.monthsInCurrentScenario
      })),
      frequencies: macro.months.reduce((frequencies, monthState) => {
        frequencies[monthState.scenario] += 1;
        return frequencies;
      }, { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 } as Record<string, number>)
    },
    portfolioSnapshot: {
      generatedAt: new Date().toISOString(),
      positions: input.positions.map((position) => ({ isin: position.isin, name: position.isin, weight: position.targetWeight })),
      totalWeightBeforeNormalization: 1,
      normalized: true
    },
    diagnostics: {
      scenario: { frequencies: { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 } },
      performance: { redrawCount: portfolioPath.monthly.length, rejectRate: 0 }
    },
    performanceDiagnostics: { redrawCount: 0, rejectRate: 0 },
    correlationDiagnostics,
    generalBenchmark: undefined,
    matricesCoherent: true
  };

  return pathResult;
};

let boundAggregationPort: MessagePort | null = null;

const getAggregationPort = (message: WorkerMessage): MessagePort | null => {
  if (message.aggregationPort) {
    boundAggregationPort = message.aggregationPort;
    return message.aggregationPort;
  }
  return boundAggregationPort;
};

asWorkerScope.onmessage = (event: MessageEvent) => {
  const message = event.data as WorkerMessage;
  if (message && typeof message.type === 'string' && (message.type === 'INIT' || message.type === 'RUN_BATCH')) {
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'SIM_MAIN_ONMESSAGE_ENTER_V4',
      originalType: message.type,
      testId: message.testId ?? null,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null
    });
  }
  if (message && typeof message.type === 'string' && message.type.startsWith('MC_PORT_TEST_')) {
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'SIM_MAIN_ONMESSAGE_ENTER',
      originalType: message.type,
      testId: message.testId ?? null,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null
    });
  }
  if (!message || !message.executionId) {
    return;
  }

  if (message.type === 'INIT') {
    try {
      const aggregationPort = getAggregationPort(message);
      boundAggregationPort = aggregationPort;
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'SIM_INIT_RECEIVE_ENTER',
        executionId: message.executionId,
        workerId: message.workerId,
        hasPrecompute: message.precompute != null,
        hasAggregationPort: !!aggregationPort
      });
      if (aggregationPort) {
        aggregationPort.onmessage = (event: MessageEvent) => {
          const portMessage = event.data as WorkerMessage;
          if (portMessage && typeof portMessage.type === 'string' && portMessage.type.startsWith('MC_PORT_TEST_')) {
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_CHECKPOINT',
              checkpoint: 'SIM_PORT_MESSAGE_ENTER',
              originalType: portMessage.type,
              testId: portMessage.testId ?? null,
              executionId: portMessage.executionId ?? null,
              workerId: portMessage.workerId ?? null,
              value: portMessage.value ?? null
            });
          }
          if (!portMessage || !portMessage.executionId) return;

          if (portMessage.type === 'MC_PORT_TEST_PING') {
            if (!portMessage.testId) return;
            console.info('[MC-PORT-TEST] PING_RECEIVED', {
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId
            });
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_PING_RECEIVED',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId
            });
            console.info('[MC-PORT-TEST] PONG_SENT', {
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: message.workerId
            });
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_PONG',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: message.workerId
            });
            aggregationPort.postMessage({
              type: 'MC_PORT_TEST_PONG',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: message.workerId
            });
            return;
          }

          if (portMessage.type === 'MC_PORT_TEST_ADD_BATCH') {
            if (!portMessage.testId) return;
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_ADD_BATCH_RECEIVED',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId,
              value: portMessage.value ?? null
            });
            aggregationPort.postMessage({
              type: 'MC_PORT_TEST_ADD_BATCH_ACK',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: message.workerId,
              value: portMessage.value ?? null
            });
            return;
          }

          if (portMessage.type === 'MC_PORT_TEST_ADD_BATCH_ACK') {
            asWorkerScope.postMessage({
              type: 'MC_PORT_TEST_CHECKPOINT',
              checkpoint: 'SIM_ACK_BRANCH_ENTER',
              originalType: portMessage.type,
              testId: portMessage.testId ?? null,
              executionId: portMessage.executionId ?? null,
              workerId: portMessage.workerId ?? null,
              value: portMessage.value ?? null
            });
            if (
              !portMessage.testId ||
              !portMessage.executionId ||
              portMessage.workerId === undefined ||
              portMessage.workerId === null
            ) {
              return;
            }
            console.info('[MC-PORT-TEST] ADD_BATCH_TEST_ACK_RECEIVED_BY_SIM', {
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId,
              value: portMessage.value ?? null
            });
            const resultPayload = {
              type: 'MC_PORT_TEST_ADD_BATCH_RESULT',
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId,
              received: true,
              value: portMessage.value ?? null,
              ackReceived: true
            };
            console.info('[MC-PORT-TEST] RESULT_SEND_BEGIN', {
              testId: portMessage.testId,
              executionId: portMessage.executionId,
              workerId: portMessage.workerId,
              value: resultPayload.value
            });
            try {
              asWorkerScope.postMessage(resultPayload);
              console.info('[MC-PORT-TEST] RESULT_SENT', {
                testId: portMessage.testId,
                executionId: portMessage.executionId,
                workerId: portMessage.workerId,
                value: resultPayload.value,
                received: resultPayload.received,
                ackReceived: resultPayload.ackReceived
              });
            } catch (error) {
              console.error('[MC-PORT-TEST] RESULT_SEND_ERROR', {
                testId: portMessage.testId,
                executionId: portMessage.executionId,
                workerId: portMessage.workerId,
                error
              });
            }
            return;
          }
        };
        aggregationPort.start();
      }
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'SIM_INIT_PORT_BOUND',
        executionId: message.executionId,
        workerId: message.workerId,
        hasBoundAggregationPort: !!aggregationPort
      });
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'SIM_INIT_STATE_ASSIGNED',
        executionId: message.executionId,
        workerId: message.workerId,
        hasPrecompute: message.precompute != null,
        hasAggregationPort: !!aggregationPort
      });
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'SIM_INIT_READY_SEND_BEGIN',
        executionId: message.executionId,
        workerId: message.workerId,
        hasPrecompute: message.precompute != null,
        hasAggregationPort: !!aggregationPort
      });
      asWorkerScope.postMessage({ type: 'READY', executionId: message.executionId, workerId: message.workerId });
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'SIM_INIT_READY_SEND_DONE',
        executionId: message.executionId,
        workerId: message.workerId,
        hasPrecompute: message.precompute != null,
        hasAggregationPort: !!aggregationPort
      });
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'SIM_INIT_ERROR',
        executionId: message.executionId,
        workerId: message.workerId,
        errorName,
        errorMessage,
        errorStack: error instanceof Error && typeof error.stack === 'string' ? error.stack : null
      });
      throw error;
    }
  }

  if (message.type === 'MC_PORT_TEST_SEND_ADD_BATCH') {
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'SIM_TRIGGER_BRANCH_ENTER',
      originalType: message.type,
      testId: message.testId ?? null,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null
    });
    const aggregationPort = getAggregationPort(message);
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'SIM_TRIGGER_PORT_RESOLVED',
      originalType: message.type,
      testId: message.testId ?? null,
      executionId: message.executionId ?? null,
      workerId: message.workerId ?? null,
      hasAggregationPort: !!aggregationPort
    });
    if (!aggregationPort) {
      console.error('[MC-PORT-TEST] ADD_BATCH_TEST_TRIGGER_RECEIVED_MISSING_PORT', {
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId
      });
      return;
    }
    console.info('[MC-PORT-TEST] ADD_BATCH_TEST_TRIGGER_RECEIVED', {
      testId: message.testId,
      executionId: message.executionId,
      workerId: message.workerId,
      hasAggregationPort: !!aggregationPort,
      value: message.value ?? 123.456
    });
    console.info('[MC-PORT-TEST] ADD_BATCH_TEST_SEND_BEGIN', {
      testId: message.testId,
      executionId: message.executionId,
      workerId: message.workerId,
      value: message.value ?? 123.456
    });
    try {
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'SIM_ADD_BATCH_PORT_POST_BEGIN',
        originalType: 'MC_PORT_TEST_ADD_BATCH',
        testId: message.testId ?? null,
        executionId: message.executionId ?? null,
        workerId: message.workerId ?? null
      });
      aggregationPort.postMessage({
        type: 'MC_PORT_TEST_ADD_BATCH',
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId,
        value: message.value ?? 123.456
      });
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'SIM_ADD_BATCH_PORT_POST_DONE',
        originalType: 'MC_PORT_TEST_ADD_BATCH',
        testId: message.testId ?? null,
        executionId: message.executionId ?? null,
        workerId: message.workerId ?? null
      });
      console.info('[MC-PORT-TEST] ADD_BATCH_TEST_SENT', {
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId,
        value: message.value ?? 123.456
      });
    } catch (error) {
      console.error('[MC-PORT-TEST] ADD_BATCH_TEST_SEND_ERROR', {
        testId: message.testId,
        executionId: message.executionId,
        workerId: message.workerId,
        error
      });
    }
    return;
  }


  if (message.type === 'CANCEL') {
    asWorkerScope.postMessage({ type: 'CANCELLED', executionId: message.executionId, workerId: message.workerId });
    return;
  }

  if (message.type === 'RUN_BATCH') {
    const batchStartedAt = performance.now();
    const { batchStart = 0, batchEnd = 0, input, snapshot, precompute, pathCount = 0 } = message;
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_RUN_BATCH_RECEIVE_ENTER',
      executionId: message.executionId,
      workerId: message.workerId,
      batchStart,
      batchEnd,
      pathCount,
      hasPrecompute: precompute != null
    });
    const results: any[] = [];
    const macroStartedAt = performance.now();
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_RUN_BATCH_LOOP_BEGIN',
      executionId: message.executionId,
      workerId: message.workerId,
      batchStart,
      batchEnd,
      numberOfPaths: batchEnd - batchStart
    });
    for (let simulationId = batchStart; simulationId < batchEnd; simulationId += 1) {
      asWorkerScope.postMessage({
        type: 'MC_PORT_TEST_CHECKPOINT',
        checkpoint: 'PROD_FIRST_PATH_BEGIN',
        executionId: message.executionId,
        workerId: message.workerId,
        simulationId,
        monthlyReturnCount: Array.isArray((input as any)?.positions) ? (input as any).positions.length : null,
        hasResult: false
      });
      try {
        const pathResult = buildPathResult(input, snapshot, precompute, simulationId, message.workerId, message.advancedStatistics ?? true);
        results.push(pathResult);
        asWorkerScope.postMessage({
          type: 'MC_PORT_TEST_CHECKPOINT',
          checkpoint: 'PROD_FIRST_PATH_DONE',
          executionId: message.executionId,
          workerId: message.workerId,
          simulationId,
          monthlyReturnCount: Array.isArray((input as any)?.positions) ? (input as any).positions.length : null,
          hasResult: true
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        asWorkerScope.postMessage({
          type: 'MC_PORT_TEST_CHECKPOINT',
          checkpoint: 'PROD_FIRST_PATH_ERROR',
          executionId: message.executionId,
          workerId: message.workerId,
          errorName,
          errorMessage,
          errorStack: error instanceof Error && typeof error.stack === 'string' ? error.stack : null
        });
        throw error;
      }
    }
    const macroMs = performance.now() - macroStartedAt;
    const returnMs = 0;
    const portfolioMs = 0;
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_RUN_BATCH_LOOP_DONE',
      executionId: message.executionId,
      workerId: message.workerId,
      resultsCount: results.length
    });
    const compactStartedAt = performance.now();
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_COMPACT_BEGIN',
      executionId: message.executionId,
      workerId: message.workerId,
      compactInputCount: results.length
    });
    const compactResults = results.map((path) => toCompactPathResult(path));
    const compactMs = performance.now() - compactStartedAt;
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_COMPACT_DONE',
      executionId: message.executionId,
      workerId: message.workerId,
      compactResultsCount: compactResults.length
    });
    const aggregationPort = getAggregationPort(message);
    const sendStartedAt = performance.now();
    if (aggregationPort) {
      try {
        const productionPayload = {
          type: 'ADD_BATCH',
          executionId: message.executionId,
          workerId: message.workerId,
          batch: compactResults,
          expectedPathCount: pathCount
        };
        const structuredClonePass = (() => {
          try {
            structuredClone(productionPayload);
            return true;
          } catch (error) {
            return false;
          }
        })();
        asWorkerScope.postMessage({
          type: 'MC_PORT_TEST_CHECKPOINT',
          checkpoint: 'PROD_ADD_BATCH_SEND_BEGIN',
          originalType: 'ADD_BATCH',
          executionId: message.executionId,
          workerId: message.workerId,
          pathCountInBatch: compactResults.length,
          payloadTopLevelKeys: Object.keys(productionPayload),
          pass: structuredClonePass
        });
        if (!structuredClonePass) {
          asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_PAYLOAD_STRUCTURED_CLONE_PASS',
            originalType: 'ADD_BATCH',
            executionId: message.executionId,
            workerId: message.workerId,
            pass: false,
            nonTrivialCloneTypesFound: ['structuredClone-failed']
          });
        } else {
          asWorkerScope.postMessage({
            type: 'MC_PORT_TEST_CHECKPOINT',
            checkpoint: 'PROD_PAYLOAD_STRUCTURED_CLONE_PASS',
            originalType: 'ADD_BATCH',
            executionId: message.executionId,
            workerId: message.workerId,
            pass: true,
            nonTrivialCloneTypesFound: []
          });
        }
        aggregationPort.start();
        console.info('[MC-PERF] WORKER_BATCH_SEND', {
          workerId: message.workerId,
          batchStart,
          batchEnd,
          batchPathCount: compactResults.length,
          at: performance.now()
        });
        aggregationPort.postMessage(productionPayload);
        asWorkerScope.postMessage({
          type: 'MC_PORT_TEST_CHECKPOINT',
          checkpoint: 'PROD_ADD_BATCH_SEND_DONE',
          originalType: 'ADD_BATCH',
          executionId: message.executionId,
          workerId: message.workerId,
          pathCountInBatch: compactResults.length,
          payloadTopLevelKeys: Object.keys(productionPayload)
        });
        console.info('[MC-PERF] WORKER_BATCH_POSTED', {
          workerId: message.workerId,
          batchStart,
          batchEnd,
          batchPathCount: compactResults.length,
          at: performance.now()
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        asWorkerScope.postMessage({
          type: 'MC_PORT_TEST_CHECKPOINT',
          checkpoint: 'PROD_ADD_BATCH_SEND_ERROR',
          originalType: 'ADD_BATCH',
          executionId: message.executionId,
          workerId: message.workerId,
          errorName,
          errorMessage
        });
        console.error('[MC-PERF] WORKER_BATCH_POST_ERROR', {
          workerId: message.workerId,
          batchStart,
          batchEnd,
          error
        });
        throw error;
      }
    }
    const sendMs = performance.now() - sendStartedAt;

    asWorkerScope.postMessage({
      type: 'PROGRESS',
      executionId: message.executionId,
      workerId: message.workerId,
      completedPaths: batchEnd,
      totalPaths: pathCount
    });

    asWorkerScope.postMessage({
      type: 'SIMULATION_COMPLETE',
      executionId: message.executionId,
      workerId: message.workerId,
      completedPaths: batchEnd,
      totalPaths: pathCount
    });

    asWorkerScope.postMessage({
      type: 'WORKER_BATCH_METRICS',
      executionId: message.executionId,
      workerId: message.workerId,
      batchStart,
      batchEnd,
      totalBatchMs: performance.now() - batchStartedAt,
      macroMs,
      returnMs,
      portfolioMs,
      compactMs,
      sendMs
    });
  }
};
