import { MonteCarloUserInput, MonteCarloSnapshot } from '../models/monte-carlo-contracts.model';
import { generateMonthlyMacroTimeline } from '../macro/monte-carlo-macro-engine';
import { generateMonthlyReturnVector } from '../returns/monte-carlo-return-engine';
import { prepareMonteCarloPrecomputation } from '../precomputation/monte-carlo-precomputation';
import { evolveMonteCarloPortfolioPath } from '../portfolio/monte-carlo-portfolio-path-engine';
import { SeededRandom } from './seeded-random';

interface WorkerMessage {
  type: 'INIT' | 'RUN_BATCH' | 'CANCEL';
  executionId: string;
  workerId: number;
  batchStart?: number;
  batchEnd?: number;
  pathCount?: number;
  precompute?: unknown;
  snapshot?: any;
  input?: any;
  aggregationPort?: MessagePort;
}

const asWorkerScope = self as typeof globalThis & {
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

const buildPathResult = (input: MonteCarloUserInput, snapshot: MonteCarloSnapshot, precompute: any, simulationId: number, workerId: number) => {
  const rng = createDeterministicRandom(simulationId, workerId);
  const horizonMonths = input.horizonYears * 12;
  const macro = generateMonthlyMacroTimeline(snapshot, horizonMonths, () => rng.next());
  const monthlyVectors = macro.months.map((monthState) =>
    generateMonthlyReturnVector(
      snapshot,
      precompute,
      monthState.scenario,
      monthState.intensity,
      () => rng.next()
    )
  );

  const portfolioPath = evolveMonteCarloPortfolioPath(input, monthlyVectors);
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
    correlationDiagnostics: {},
    generalBenchmark: { expectedReturn: 0.06, volatility: 0.15, simulatedLongTermReturn: portfolioPath.totalReturn, simulatedVolatility: 0.12 },
    matricesCoherent: true
  };

  return pathResult;
};

const getAggregationPort = (message: WorkerMessage): MessagePort | null => {
  if (!message.aggregationPort) return null;
  return message.aggregationPort;
};

asWorkerScope.onmessage = (event: MessageEvent) => {
  const message = event.data as WorkerMessage;
  if (!message || !message.executionId) {
    return;
  }

  if (message.type === 'INIT') {
    asWorkerScope.postMessage({ type: 'READY', executionId: message.executionId, workerId: message.workerId });
    return;
  }

  if (message.type === 'CANCEL') {
    asWorkerScope.postMessage({ type: 'CANCELLED', executionId: message.executionId, workerId: message.workerId });
    return;
  }

  if (message.type === 'RUN_BATCH') {
    const { batchStart = 0, batchEnd = 0, input, snapshot, precompute, pathCount = 0 } = message;
    const results: any[] = [];
    for (let simulationId = batchStart; simulationId < batchEnd; simulationId += 1) {
      const pathResult = buildPathResult(input, snapshot, precompute, simulationId, message.workerId);
      results.push(pathResult);
    }

    const compactResults = results.map((path) => toCompactPathResult(path));
    const aggregationPort = getAggregationPort(message);
    if (aggregationPort) {
      aggregationPort.postMessage({
        type: 'ADD_BATCH',
        executionId: message.executionId,
        workerId: message.workerId,
        batch: compactResults,
        expectedPathCount: pathCount
      });
    }

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
  }
};
