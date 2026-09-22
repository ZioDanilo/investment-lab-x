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
  runSeed?: number;
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

const mix32 = (value: number): number => {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae3d);
  x ^= x >>> 16;
  return x >>> 0;
};

export const derivePathSeed = (runSeed: number, globalSimulationId: number): number => {
  const mixedSeed = mix32((runSeed >>> 0) ^ 0x9e3779b9);
  const mixedPath = mix32((Math.imul(((globalSimulationId + 1) >>> 0), 0x9e3779b1)) ^ mixedSeed);
  return mixedPath >>> 0;
};

const createDeterministicRandom = (simulationId: number, runSeed: number): SeededRandom => {
  const baseSeed = derivePathSeed(runSeed, simulationId);
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

  const advancedObservationSamples = Array.isArray(path?.__advancedObservationSamples)
    ? path.__advancedObservationSamples.map((entry: any) => ({
        scenario: entry?.scenario ?? 'expansion',
        etfReturns: Array.isArray(entry?.etfReturns) ? entry.etfReturns.map((value: any) => Number(value ?? 0)) : []
      }))
    : [];

  const compactedPath: Record<string, any> = {
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

  if (advancedObservationSamples.length > 0) {
    compactedPath.__advancedObservationSamples = advancedObservationSamples;
  }

  return compactedPath;
};

const scenarioCodeLookup = {
  expansion: 0,
  recession: 1,
  stagflation: 2,
  soft_landing: 3
} as const;

const deviationDirectionCodeLookup = {
  above_expected: 0,
  below_expected: 1
} as const;

const deviationDirectionNameLookup = ['above_expected', 'below_expected'] as const;
const scenarioNameLookup = ['expansion', 'recession', 'stagflation', 'soft_landing'] as const;

export const encodeTransportBatch = (paths: any[]): { message: Record<string, any>; transferList: Transferable[] } => {
  const safePaths = Array.isArray(paths) ? paths : [];
  const pathCount = safePaths.length;
  const monthOffsets = new Uint32Array(pathCount + 1);
  const yearOffsets = new Uint32Array(pathCount + 1);
  const scenarioOffsets = new Uint32Array(pathCount + 1);
  const advancedOffsets = new Uint32Array(pathCount + 1);
  const annualEtfStartByYear = new Uint32Array(Math.max(0, pathCount * 12 + 1));
  const annualEtfCount = new Uint32Array(Math.max(0, pathCount * 12 + 1));

  let monthTotal = 0;
  let yearTotal = 0;
  let scenarioTotal = 0;
  let advancedTotal = 0;
  let advancedScalarTotal = 0;
  let annualEtfTotal = 0;

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const path = safePaths[pathIndex] ?? {};
    const monthly = Array.isArray(path.monthly) ? path.monthly : [];
    const years = Array.isArray(path.years) ? path.years : [];
    const scenarioPathYears = Array.isArray(path.scenarioPath?.years) ? path.scenarioPath.years : [];
    const advancedSamples = Array.isArray(path.__advancedObservationSamples) ? path.__advancedObservationSamples : [];
    monthOffsets[pathIndex] = monthTotal;
    yearOffsets[pathIndex] = yearTotal;
    scenarioOffsets[pathIndex] = scenarioTotal;
    advancedOffsets[pathIndex] = advancedTotal;
    monthTotal += monthly.length;
    yearTotal += years.length;
    scenarioTotal += scenarioPathYears.length;
    advancedTotal += advancedSamples.length;
    annualEtfTotal += years.reduce((sum, yearEntry) => sum + (Array.isArray(yearEntry?.etfReturns) ? yearEntry.etfReturns.length : 0), 0);
    advancedScalarTotal += advancedSamples.reduce((sum, sample) => sum + (Array.isArray(sample?.etfReturns) ? sample.etfReturns.length : 0), 0);
  }
  monthOffsets[pathCount] = monthTotal;
  yearOffsets[pathCount] = yearTotal;
  scenarioOffsets[pathCount] = scenarioTotal;
  advancedOffsets[pathCount] = advancedTotal;
  const annualEtfStartByYearResolved = new Uint32Array(yearTotal + 1);
  const annualEtfCountResolved = new Uint32Array(yearTotal);
  let annualEtfCursor = 0;
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const years = Array.isArray(safePaths[pathIndex]?.years) ? safePaths[pathIndex].years : [];
    for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
      const globalYearIndex = yearOffsets[pathIndex] + yearIndex;
      const etfReturns = Array.isArray(years[yearIndex]?.etfReturns) ? years[yearIndex].etfReturns : [];
      annualEtfStartByYearResolved[globalYearIndex] = annualEtfCursor;
      annualEtfCountResolved[globalYearIndex] = etfReturns.length;
      annualEtfCursor += etfReturns.length;
    }
  }
  annualEtfStartByYearResolved[yearTotal] = annualEtfCursor;

  const monthlyMonth = new Uint32Array(monthTotal);
  const monthlyYear = new Uint32Array(monthTotal);
  const monthlyEndingCapital = new Float64Array(monthTotal);
  const monthlyPortfolioReturn = new Float64Array(monthTotal);
  const monthlyRunningPeak = new Float64Array(monthTotal);
  const monthlyDrawdown = new Float64Array(monthTotal);
  const monthlyIntensity = new Float64Array(monthTotal);

  const annualYear = new Uint32Array(yearTotal);
  const annualScenarioCode = new Uint8Array(yearTotal);
  const annualScenarioDuration = new Uint32Array(yearTotal);
  const annualPortfolioReturn = new Float64Array(yearTotal);
  const annualStartingCapital = new Float64Array(yearTotal);
  const annualEndingCapital = new Float64Array(yearTotal);
  const annualRunningPeak = new Float64Array(yearTotal);
  const annualDrawdown = new Float64Array(yearTotal);
  const annualEtfWeight = new Float64Array(annualEtfTotal);
  const annualEtfAnnualReturn = new Float64Array(annualEtfTotal);
  const annualEtfContribution = new Float64Array(annualEtfTotal);
  const annualEtfIntensity = new Float64Array(annualEtfTotal);
  const annualEtfDeviationCode = new Uint8Array(annualEtfTotal);

  const scenarioYearCode = new Uint8Array(scenarioTotal);
  const scenarioYearDuration = new Uint32Array(scenarioTotal);
  const scenarioYear = new Uint32Array(scenarioTotal);
  const frequencyMatrix = new Float64Array(pathCount * 4);

  const advancedScenarioCode = new Uint8Array(advancedTotal);
  const advancedSampleLength = new Uint32Array(advancedTotal);
  const advancedEtfReturns = new Float64Array(advancedScalarTotal);

  let monthlyCursor = 0;
  let annualCursor = 0;
  let scenarioCursor = 0;
  let advancedCursor = 0;
  let advancedScalarCursor = 0;

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const path = safePaths[pathIndex] ?? {};
    const monthly = Array.isArray(path.monthly) ? path.monthly : [];
    const years = Array.isArray(path.years) ? path.years : [];
    const scenarioPathYears = Array.isArray(path.scenarioPath?.years) ? path.scenarioPath.years : [];
    const advancedSamples = Array.isArray(path.__advancedObservationSamples) ? path.__advancedObservationSamples : [];

    for (let monthIndex = 0; monthIndex < monthly.length; monthIndex += 1) {
      const entry = monthly[monthIndex] ?? {};
      const cursor = monthOffsets[pathIndex] + monthIndex;
      monthlyMonth[cursor] = Number(entry.month ?? monthIndex + 1) >>> 0;
      monthlyYear[cursor] = Number(entry.year ?? 1) >>> 0;
      monthlyEndingCapital[cursor] = Number(entry.endingCapital ?? entry.capital ?? 0);
      monthlyPortfolioReturn[cursor] = Number(entry.portfolioReturn ?? 0);
      monthlyRunningPeak[cursor] = Number(entry.runningPeak ?? 0);
      monthlyDrawdown[cursor] = Number(entry.drawdown ?? 0);
      monthlyIntensity[cursor] = Number(entry.intensity ?? 0);
      monthlyCursor += 1;
    }

    for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
      const entry = years[yearIndex] ?? {};
      const cursor = yearOffsets[pathIndex] + yearIndex;
      annualYear[cursor] = Number(entry.year ?? yearIndex + 1) >>> 0;
      annualScenarioCode[cursor] = scenarioCodeLookup[(entry.scenario as keyof typeof scenarioCodeLookup) ?? 'expansion'];
      annualScenarioDuration[cursor] = Number(entry.durationInCurrentScenario ?? 0) >>> 0;
      annualPortfolioReturn[cursor] = Number(entry.portfolioReturn ?? 0);
      annualStartingCapital[cursor] = Number(entry.startingCapital ?? 0);
      annualEndingCapital[cursor] = Number(entry.endingCapital ?? 0);
      annualRunningPeak[cursor] = Number(entry.runningPeak ?? 0);
      annualDrawdown[cursor] = Number(entry.drawdown ?? 0);

      const yearEtfReturns = Array.isArray(entry?.etfReturns) ? entry.etfReturns : [];
      for (let etfIndex = 0; etfIndex < yearEtfReturns.length; etfIndex += 1) {
        const etf = yearEtfReturns[etfIndex] ?? {};
        const flatIndex = annualEtfStartByYearResolved[cursor] + etfIndex;
        const deviationDirection = typeof etf.deviationDirection === 'string' ? etf.deviationDirection : 'above_expected';
        annualEtfWeight[flatIndex] = Number(etf.weight ?? 0);
        annualEtfAnnualReturn[flatIndex] = Number(etf.annualReturn ?? 0);
        annualEtfContribution[flatIndex] = Number(etf.contribution ?? 0);
        annualEtfIntensity[flatIndex] = Number(etf.intensity ?? 0);
        annualEtfDeviationCode[flatIndex] = deviationDirectionCodeLookup[deviationDirection as keyof typeof deviationDirectionCodeLookup] ?? deviationDirectionCodeLookup.above_expected;
      }
      annualCursor += 1;
    }

    for (let scenarioIndex = 0; scenarioIndex < scenarioPathYears.length; scenarioIndex += 1) {
      const entry = scenarioPathYears[scenarioIndex] ?? {};
      const cursor = scenarioOffsets[pathIndex] + scenarioIndex;
      scenarioYear[cursor] = Number(entry.year ?? scenarioIndex + 1) >>> 0;
      scenarioYearCode[cursor] = scenarioCodeLookup[(entry.scenario as keyof typeof scenarioCodeLookup) ?? 'expansion'];
      scenarioYearDuration[cursor] = Number(entry.durationInCurrentScenario ?? 0) >>> 0;
      scenarioCursor += 1;
    }

    const frequency = path.scenarioPath?.frequencies ?? {};
    frequencyMatrix[pathIndex * 4 + 0] = Number(frequency.expansion ?? 0);
    frequencyMatrix[pathIndex * 4 + 1] = Number(frequency.recession ?? 0);
    frequencyMatrix[pathIndex * 4 + 2] = Number(frequency.stagflation ?? 0);
    frequencyMatrix[pathIndex * 4 + 3] = Number(frequency.soft_landing ?? 0);

    for (let advancedIndex = 0; advancedIndex < advancedSamples.length; advancedIndex += 1) {
      const sample = advancedSamples[advancedIndex] ?? {};
      const cursor = advancedOffsets[pathIndex] + advancedIndex;
      const sampleValues = Array.isArray(sample.etfReturns) ? sample.etfReturns : [];
      advancedScenarioCode[cursor] = scenarioCodeLookup[(sample.scenario as keyof typeof scenarioCodeLookup) ?? 'expansion'];
      advancedSampleLength[cursor] = sampleValues.length >>> 0;
      for (let sampleValueIndex = 0; sampleValueIndex < sampleValues.length; sampleValueIndex += 1) {
        advancedEtfReturns[advancedScalarCursor] = Number(sampleValues[sampleValueIndex] ?? 0);
        advancedScalarCursor += 1;
      }
      advancedCursor += 1;
    }
  }

  const message = {
    type: 'ADD_BATCH',
    transportVersion: 1,
    pathCount,
    arrays: {
      simulationIds: new Uint32Array(safePaths.map((path) => Number(path?.simulationId ?? 0))),
      initialCapital: new Float64Array(safePaths.map((path) => Number(path?.initialCapital ?? 0))),
      finalCapital: new Float64Array(safePaths.map((path) => Number(path?.finalCapital ?? 0))),
      totalReturn: new Float64Array(safePaths.map((path) => Number(path?.totalReturn ?? 0))),
      cagr: new Float64Array(safePaths.map((path) => Number(path?.cagr ?? 0))),
      maxDrawdown: new Float64Array(safePaths.map((path) => Number(path?.maxDrawdown ?? 0))),
      monthlyMonth,
      monthlyYear,
      monthlyEndingCapital,
      monthlyPortfolioReturn,
      monthlyRunningPeak,
      monthlyDrawdown,
      monthlyIntensity,
      annualYear,
      annualScenarioCode,
      annualScenarioDuration,
      annualPortfolioReturn,
      annualStartingCapital,
      annualEndingCapital,
      annualRunningPeak,
      annualDrawdown,
      annualEtfWeight,
      annualEtfAnnualReturn,
      annualEtfContribution,
      annualEtfIntensity,
      annualEtfDeviationCode,
      annualEtfCount: annualEtfCountResolved,
      annualEtfStartByYear: annualEtfStartByYearResolved,
      scenarioYear,
      scenarioYearCode,
      scenarioYearDuration,
      frequencyMatrix,
      advancedScenarioCode,
      advancedSampleLength,
      advancedEtfReturns
    },
    offsets: {
      monthOffsets,
      yearOffsets,
      scenarioOffsets,
      advancedOffsets
    },
    strings: {
      dominantEtfIsin: safePaths.map((path) => path?.dominantEtfIsin ?? ''),
      dominantEtfName: safePaths.map((path) => path?.dominantEtfName ?? ''),
      annualEtfIsin: safePaths.flatMap((path) => (Array.isArray(path?.years) ? path.years.flatMap((yearEntry) => (Array.isArray(yearEntry?.etfReturns) ? yearEntry.etfReturns.map((etf: any) => etf?.isin ?? '') : [])) : [])),
      annualEtfName: safePaths.flatMap((path) => (Array.isArray(path?.years) ? path.years.flatMap((yearEntry) => (Array.isArray(yearEntry?.etfReturns) ? yearEntry.etfReturns.map((etf: any) => etf?.name ?? etf?.isin ?? '') : [])) : []))
    },
    metadata: safePaths.map((path) => ({
      unrecovered: !!path?.unrecovered,
      maxRecoveryTimeMonths: path?.maxRecoveryTimeMonths ?? null,
      unrecoveredDurationMonths: path?.unrecoveredDurationMonths ?? null,
      matricesCoherent: !!path?.matricesCoherent,
      monthlyCount: Array.isArray(path?.monthly) ? path.monthly.length : 0,
      advancedCount: Array.isArray(path?.__advancedObservationSamples) ? path.__advancedObservationSamples.length : 0,
      returnDiagnostics: path?.returnDiagnostics,
      performanceDiagnostics: path?.performanceDiagnostics,
      correlationDiagnostics: path?.correlationDiagnostics,
      generalBenchmark: path?.generalBenchmark
    })),
    serializedPaths: safePaths.map((path) => JSON.stringify({
      simulationId: path?.simulationId,
      dominantEtfIsin: path?.dominantEtfIsin ?? '',
      dominantEtfName: path?.dominantEtfName ?? '',
      initialCapital: path?.initialCapital,
      finalCapital: path?.finalCapital,
      totalReturn: path?.totalReturn,
      cagr: path?.cagr,
      maxDrawdown: path?.maxDrawdown,
      maxRecoveryTimeMonths: path?.maxRecoveryTimeMonths ?? null,
      unrecovered: path?.unrecovered ?? false,
      unrecoveredDurationMonths: path?.unrecoveredDurationMonths ?? null,
      returnDiagnostics: path?.returnDiagnostics,
      performanceDiagnostics: path?.performanceDiagnostics,
      correlationDiagnostics: path?.correlationDiagnostics,
      generalBenchmark: path?.generalBenchmark,
      matricesCoherent: path?.matricesCoherent ?? true
    }))
  };

  const transferList = Array.from(new Set(
    Object.values(message.arrays)
      .flatMap((value) => {
        if (value instanceof ArrayBuffer) return [value];
        if (ArrayBuffer.isView(value)) return [value.buffer as ArrayBuffer];
        return [];
      })
      .filter((value): value is ArrayBuffer => value instanceof ArrayBuffer)
  )) as Transferable[];

  return { message, transferList };
};

export const decodeTransportBatch = (message: any): any[] => {
  const payload = message?.message ?? message ?? {};
  const arrays = payload?.arrays ?? {};
  const offsets = payload?.offsets ?? {};
  const pathCount = Number(payload?.pathCount ?? 0);
  const asUint32 = (value: any, fallbackLength: number): Uint32Array => {
    if (value instanceof Uint32Array) return value;
    if (Array.isArray(value)) return new Uint32Array(value);
    return new Uint32Array(fallbackLength);
  };
  const monthOffsets = asUint32(offsets.monthOffsets, pathCount + 1);
  const yearOffsets = asUint32(offsets.yearOffsets, pathCount + 1);
  const scenarioOffsets = asUint32(offsets.scenarioOffsets, pathCount + 1);
  const advancedOffsets = asUint32(offsets.advancedOffsets, pathCount + 1);

  const decoded: any[] = [];
  let advancedScalarCursor = 0;
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const startMonth = Number(monthOffsets[pathIndex] ?? 0);
    const endMonth = Number(monthOffsets[pathIndex + 1] ?? startMonth);
    const startYear = Number(yearOffsets[pathIndex] ?? 0);
    const endYear = Number(yearOffsets[pathIndex + 1] ?? startYear);
    const startScenario = Number(scenarioOffsets[pathIndex] ?? 0);
    const endScenario = Number(scenarioOffsets[pathIndex + 1] ?? startScenario);
    const startAdvanced = Number(advancedOffsets[pathIndex] ?? 0);
    const endAdvanced = Number(advancedOffsets[pathIndex + 1] ?? startAdvanced);

    const serialized = Array.isArray(payload?.serializedPaths) && payload.serializedPaths[pathIndex] ? JSON.parse(payload.serializedPaths[pathIndex]) : null;
    const monthly = Array.isArray(serialized?.monthly) ? serialized.monthly : [];
    if (!Array.isArray(serialized?.monthly)) {
      for (let index = startMonth; index < endMonth; index += 1) {
        monthly.push({
          month: Number(arrays.monthlyMonth?.[index] ?? index + 1),
          year: Number(arrays.monthlyYear?.[index] ?? 1),
          endingCapital: Number(arrays.monthlyEndingCapital?.[index] ?? 0),
          capital: Number(arrays.monthlyEndingCapital?.[index] ?? 0),
          portfolioReturn: Number(arrays.monthlyPortfolioReturn?.[index] ?? 0),
          runningPeak: Number(arrays.monthlyRunningPeak?.[index] ?? 0),
          drawdown: Number(arrays.monthlyDrawdown?.[index] ?? 0),
          intensity: Number(arrays.monthlyIntensity?.[index] ?? 0)
        });
      }
    }

    const years = Array.isArray(serialized?.years) ? serialized.years : [];
    if (!Array.isArray(serialized?.years)) {
      for (let index = startYear; index < endYear; index += 1) {
        const scenarioCode = Number(arrays.annualScenarioCode?.[index] ?? 0);
        const etfCount = Number(arrays.annualEtfCount?.[index] ?? 0);
        const etfStart = Number(arrays.annualEtfStartByYear?.[index] ?? 0);
        const etfReturns = [] as any[];
        for (let etfIndex = 0; etfIndex < etfCount; etfIndex += 1) {
          const flatIndex = etfStart + etfIndex;
          const deviationCode = Number(arrays.annualEtfDeviationCode?.[flatIndex] ?? 0);
          etfReturns.push({
            isin: payload?.strings?.annualEtfIsin?.[flatIndex] ?? '',
            name: payload?.strings?.annualEtfName?.[flatIndex] ?? '',
            weight: Number(arrays.annualEtfWeight?.[flatIndex] ?? 0),
            annualReturn: Number(arrays.annualEtfAnnualReturn?.[flatIndex] ?? 0),
            contribution: Number(arrays.annualEtfContribution?.[flatIndex] ?? 0),
            intensity: Number(arrays.annualEtfIntensity?.[flatIndex] ?? 0),
            deviationDirection: (deviationDirectionNameLookup[deviationCode] ?? 'above_expected')
          });
        }
        years.push({
          year: Number(arrays.annualYear?.[index] ?? index + 1),
          scenario: scenarioNameLookup[scenarioCode] ?? 'expansion',
          durationInCurrentScenario: Number(arrays.annualScenarioDuration?.[index] ?? 0),
          etfReturns,
          portfolioReturn: Number(arrays.annualPortfolioReturn?.[index] ?? 0),
          startingCapital: Number(arrays.annualStartingCapital?.[index] ?? 0),
          endingCapital: Number(arrays.annualEndingCapital?.[index] ?? 0),
          runningPeak: Number(arrays.annualRunningPeak?.[index] ?? 0),
          drawdown: Number(arrays.annualDrawdown?.[index] ?? 0)
        });
      }
    }

    const scenarioPathYears = Array.isArray(serialized?.scenarioPath?.years) ? serialized.scenarioPath.years : [];
    if (!Array.isArray(serialized?.scenarioPath?.years)) {
      for (let index = startScenario; index < endScenario; index += 1) {
        const scenarioCode = Number(arrays.scenarioYearCode?.[index] ?? 0);
        scenarioPathYears.push({
          year: Number(arrays.scenarioYear?.[index] ?? index + 1),
          scenario: scenarioNameLookup[scenarioCode] ?? 'expansion',
          durationInCurrentScenario: Number(arrays.scenarioYearDuration?.[index] ?? 0)
        });
      }
    }

    const advancedObservationSamples = Array.isArray(serialized?.__advancedObservationSamples) ? serialized.__advancedObservationSamples : [];
    if (!Array.isArray(serialized?.__advancedObservationSamples)) {
      for (let index = startAdvanced; index < endAdvanced; index += 1) {
        const sampleLength = Number(arrays.advancedSampleLength?.[index] ?? 0);
        const sampleValues = [] as number[];
        for (let itemIndex = 0; itemIndex < sampleLength; itemIndex += 1) {
          sampleValues.push(Number(arrays.advancedEtfReturns?.[advancedScalarCursor] ?? 0));
          advancedScalarCursor += 1;
        }
        const scenarioCode = Number(arrays.advancedScenarioCode?.[index] ?? 0);
        advancedObservationSamples.push({
          scenario: scenarioNameLookup[scenarioCode] ?? 'expansion',
          etfReturns: sampleValues
        });
      }
    }

    const frequency = Array.isArray(serialized?.scenarioPath?.years) ? (serialized.scenarioPath.frequencies ?? {
      expansion: 0,
      recession: 0,
      stagflation: 0,
      soft_landing: 0
    }) : {
      expansion: Number(arrays.frequencyMatrix?.[(pathIndex * 4) + 0] ?? 0),
      recession: Number(arrays.frequencyMatrix?.[(pathIndex * 4) + 1] ?? 0),
      stagflation: Number(arrays.frequencyMatrix?.[(pathIndex * 4) + 2] ?? 0),
      soft_landing: Number(arrays.frequencyMatrix?.[(pathIndex * 4) + 3] ?? 0)
    };

    decoded.push({
      simulationId: Number(arrays.simulationIds?.[pathIndex] ?? pathIndex),
      dominantEtfIsin: payload?.strings?.dominantEtfIsin?.[pathIndex] ?? serialized?.dominantEtfIsin ?? '',
      dominantEtfName: payload?.strings?.dominantEtfName?.[pathIndex] ?? serialized?.dominantEtfName ?? '',
      initialCapital: Number(arrays.initialCapital?.[pathIndex] ?? serialized?.initialCapital ?? 0),
      finalCapital: Number(arrays.finalCapital?.[pathIndex] ?? serialized?.finalCapital ?? 0),
      totalReturn: Number(arrays.totalReturn?.[pathIndex] ?? serialized?.totalReturn ?? 0),
      cagr: Number(arrays.cagr?.[pathIndex] ?? serialized?.cagr ?? 0),
      maxDrawdown: Number(arrays.maxDrawdown?.[pathIndex] ?? serialized?.maxDrawdown ?? 0),
      monthly,
      maxRecoveryTimeMonths: payload?.metadata?.[pathIndex]?.maxRecoveryTimeMonths ?? serialized?.maxRecoveryTimeMonths ?? null,
      unrecovered: !!(payload?.metadata?.[pathIndex]?.unrecovered ?? serialized?.unrecovered ?? false),
      unrecoveredDurationMonths: payload?.metadata?.[pathIndex]?.unrecoveredDurationMonths ?? serialized?.unrecoveredDurationMonths ?? null,
      scenarioPath: {
        years: scenarioPathYears,
        frequencies: frequency
      },
      years,
      returnDiagnostics: serialized?.returnDiagnostics ?? undefined,
      performanceDiagnostics: serialized?.performanceDiagnostics ?? undefined,
      correlationDiagnostics: serialized?.correlationDiagnostics ?? undefined,
      generalBenchmark: serialized?.generalBenchmark ?? undefined,
      __advancedObservationSamples: advancedObservationSamples,
      matricesCoherent: !!(payload?.metadata?.[pathIndex]?.matricesCoherent ?? serialized?.matricesCoherent ?? true)
    });
  }

  return decoded;
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

export const buildPathResult = (input: MonteCarloUserInput, snapshot: MonteCarloSnapshot, precompute: any, simulationId: number, runSeed: number, advancedStatisticsEnabled = true, profilingEnabled = false) => {
  const resolvedRunSeed = Number.isFinite(runSeed) ? (runSeed >>> 0) : 0;
  const rng = createDeterministicRandom(simulationId, resolvedRunSeed);
  const horizonMonths = input.horizonYears * 12;
  const macroStart = performance.now();
  const macro = generateMonthlyMacroTimeline(snapshot, horizonMonths, () => rng.next());
  const macroTimelineMs = performance.now() - macroStart;
  const monthlyStart = performance.now();
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
  const monthlyReturnGenerationMs = performance.now() - monthlyStart;

  const portfolioStart = performance.now();
  const portfolioPath = evolveMonteCarloPortfolioPath(input, monthlyVectors);
  const portfolioEvolutionMs = performance.now() - portfolioStart;
  const advancedObservationStart = performance.now();
  const __advancedObservationSamples = advancedStatisticsEnabled
    ? monthlyVectors.map((vector) => ({
        scenario: vector.scenario,
        etfReturns: vector.etfReturns.map((entry) => entry.monthlyReturn)
      }))
    : [];
  const advancedObservationCollectionMs = performance.now() - advancedObservationStart;
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
    __timings: {
      macroTimelineMs,
      monthlyReturnGenerationMs,
      portfolioEvolutionMs,
      advancedObservationCollectionMs,
      compactResultMs: 0,
      batchConstructionMs: 0,
      postMessageCallMs: 0
    },
    __profileSummary: profilingEnabled ? {
      pathCoreMs: macroTimelineMs + monthlyReturnGenerationMs + portfolioEvolutionMs,
      advancedCollectionMs: advancedObservationCollectionMs,
      pathResultOtherMs: 0,
      compactMs: 0,
      encodeMs: 0,
      postMessageMs: 0,
      totalMs: macroTimelineMs + monthlyReturnGenerationMs + portfolioEvolutionMs + advancedObservationCollectionMs
    } : undefined,
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
    correlationDiagnostics: undefined,
    __advancedObservationSamples,
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

const emitLifecycleEvent = (executionId: string, workerId: number, event: string, details: Record<string, unknown> = {}, runStartMs?: number): void => {
  const relativeMs = Number.isFinite(runStartMs) ? Number((performance.now() - Number(runStartMs)).toFixed(2)) : Number(performance.now().toFixed(2));
  asWorkerScope.postMessage({
    type: 'LIFECYCLE_EVENT',
    executionId,
    workerId,
    event,
    relativeMs,
    ...details
  });
};

const emitDiagnosticLifecycleEvent = (executionId: string, workerId: number, event: string, details: Record<string, unknown> = {}): void => {
  const payload: Record<string, unknown> = {
    type: 'LIFECYCLE_EVENT',
    executionId,
    workerId,
    event,
    ...details
  };
  if (typeof payload.mcChannelId === 'undefined') {
    payload.mcChannelId = `${executionId}:${workerId}`;
  }
  asWorkerScope.postMessage(payload);
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
    if (message.executionId && message.executionId.startsWith('probe-')) {
      asWorkerScope.postMessage({
        type: 'PROFILE_EVENT',
        executionId: message.executionId,
        workerId: message.workerId,
        event: 'PROBE_WORKER_TO_COORDINATOR',
        ts: performance.timeOrigin + performance.now()
      });
    }
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
        const diagnosticMcChannelId = `${message.executionId}:${message.workerId}`;
        emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'SIM_PORT_INIT_RECEIVED', {
          mcChannelId: diagnosticMcChannelId
        });
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
      emitLifecycleEvent(message.executionId, message.workerId, 'WORKER_START', {
        pathCount: message.pathCount ?? 0,
        workerId: message.workerId
      }, message.runStartMs);
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
    const { batchStart = 0, batchEnd = 0, input, snapshot, precompute, pathCount = 0, runSeed } = message;
    const profilingEnabled = !!message.profileWorkerTiming;
    const batchProfile = profilingEnabled ? {
      pathCoreMs: 0,
      advancedCollectionMs: 0,
      pathResultOtherMs: 0,
      compactMs: 0,
      encodeMs: 0,
      postMessageMs: 0,
      workerTotalMs: 0
    } : null;
    emitLifecycleEvent(message.executionId, message.workerId, 'WORKER_LAST_PATH_GENERATED', {
      batchId: `${batchStart}-${batchEnd}`,
      pathCount: batchEnd - batchStart,
      completedPaths: batchEnd
    }, message.runStartMs);
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
        const resolvedRunSeed = Number.isFinite(runSeed) ? (runSeed >>> 0) : 0;
            const pathResult = buildPathResult(
          input,
          snapshot,
          precompute,
          simulationId,
          resolvedRunSeed,
          message.advancedStatistics ?? true,
          profilingEnabled
        );
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
    let compactMs = 0;
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_RUN_BATCH_LOOP_DONE',
      executionId: message.executionId,
      workerId: message.workerId,
      resultsCount: results.length
    });

    const batchPipelineGuard = () => {
      try {
        const compactStartedAt = performance.now();
        emitLifecycleEvent(message.executionId, message.workerId, 'BATCH_COMPACT_START', {
          batchId: `${batchStart}-${batchEnd}`,
          pathCount: results.length,
          completedPaths: batchEnd
        }, message.runStartMs);
        const compactResults = results.map((path) => {
          const t0 = performance.now();
          const compacted = toCompactPathResult(path);
          if (path && path.__timings) {
            path.__timings.compactResultMs = performance.now() - t0;
          }
          return compacted;
        });
        compactMs = performance.now() - compactStartedAt;
        if (batchProfile) {
          batchProfile.compactMs += compactMs;
        }
        emitLifecycleEvent(message.executionId, message.workerId, 'BATCH_COMPACT_END', {
          batchId: `${batchStart}-${batchEnd}`,
          pathCount: compactResults.length,
          completedPaths: batchEnd
        }, message.runStartMs);

        const encodeStartedAt = performance.now();
        emitLifecycleEvent(message.executionId, message.workerId, 'BATCH_ENCODE_START', {
          batchId: `${batchStart}-${batchEnd}`,
          pathCount: compactResults.length,
          completedPaths: batchEnd
        }, message.runStartMs);
        const transport = encodeTransportBatch(compactResults);
        const transferListLength = Array.isArray(transport.transferList) ? transport.transferList.length : 0;
        const uniqueBufferCount = new Set((transport.transferList ?? []).filter((value): value is ArrayBuffer => value instanceof ArrayBuffer).map((value) => value)).size;
        const encodeMs = performance.now() - encodeStartedAt;
        if (batchProfile) {
          batchProfile.encodeMs += encodeMs;
        }
        emitLifecycleEvent(message.executionId, message.workerId, 'BATCH_ENCODE_END', {
          batchId: `${batchStart}-${batchEnd}`,
          pathCount: compactResults.length,
          completedPaths: batchEnd,
          transferListLength,
          uniqueBufferCount
        }, message.runStartMs);

        const aggregationPort = getAggregationPort(message);
        const sendStartedAt = performance.now();
        if (aggregationPort) {
          const postMessageStartedAt = performance.now();
          const mcChannelId = `${message.executionId}:${message.workerId}`;
          emitLifecycleEvent(message.executionId, message.workerId, 'POSTMESSAGE_START', {
            batchId: `${batchStart}-${batchEnd}`,
            pathCount: compactResults.length,
            completedPaths: batchEnd
          }, message.runStartMs);
          emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'SIM_ADD_BATCH_POST_START', {
            mcChannelId,
            batchStart,
            batchEnd,
            pathCount: compactResults.length
          });
          aggregationPort.start();
          aggregationPort.postMessage(transport.message, transport.transferList);
          emitDiagnosticLifecycleEvent(message.executionId, message.workerId, 'SIM_ADD_BATCH_POST_END', {
            mcChannelId,
            batchStart,
            batchEnd,
            pathCount: compactResults.length
          });
          emitLifecycleEvent(message.executionId, message.workerId, 'POSTMESSAGE_END', {
            batchId: `${batchStart}-${batchEnd}`,
            pathCount: compactResults.length,
            completedPaths: batchEnd,
            transferListLength,
            uniqueBufferCount
          }, message.runStartMs);
          const sendMs = performance.now() - sendStartedAt;
          const postMsgMs = performance.now() - postMessageStartedAt;
          if (batchProfile) {
            batchProfile.postMessageMs += postMsgMs;
          }
          asWorkerScope.postMessage({
            type: 'BATCH_PROFILE_SUMMARY',
            executionId: message.executionId,
            workerId: message.workerId,
            batch: {
              batchStart,
              batchEnd,
              pathCount: compactResults.length,
              transferListLength,
              uniqueBufferCount,
              sendMs,
              postMsgMs
            }
          });
        }

        emitLifecycleEvent(message.executionId, message.workerId, 'WORKER_LAST_BATCH_POSTED', {
          batchId: `${batchStart}-${batchEnd}`,
          pathCount: compactResults.length,
          completedPaths: batchEnd
        }, message.runStartMs);
        return compactResults;
      } catch (error) {
        const errorName = error instanceof Error ? String(error.name) : 'UnknownError';
        const errorMessage = error instanceof Error ? String(error.message) : String(error);
        const stage = (() => {
          if (typeof performance === 'undefined') return 'unknown';
          return 'batch-pipeline';
        })();
        try {
          emitLifecycleEvent(message.executionId, message.workerId, 'BATCH_PIPELINE_EXCEPTION', {
            batchId: `${batchStart}-${batchEnd}`,
            workerId: message.workerId,
            stage,
            errorName,
            errorMessage,
            pathCount: results.length,
            completedPaths: batchEnd
          }, message.runStartMs);
        } catch {
          console.error('[MC-BATCH-PIPELINE] diagnostic event failed', {
            executionId: message.executionId,
            workerId: message.workerId,
            batchId: `${batchStart}-${batchEnd}`,
            errorName,
            errorMessage
          });
        }
        throw error;
      }
    };

    const compactResults = batchPipelineGuard();
    asWorkerScope.postMessage({
      type: 'MC_PORT_TEST_CHECKPOINT',
      checkpoint: 'PROD_COMPACT_BEGIN',
      executionId: message.executionId,
      workerId: message.workerId,
      compactInputCount: results.length
    });
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
        const batchProfilingId = `${message.executionId}:${message.workerId}:${batchStart}:${batchEnd}`;
        const readyTs = performance.timeOrigin + performance.now();
        const transport = encodeTransportBatch(compactResults);
        const productionPayload = transport.message;
        productionPayload.executionId = message.executionId;
        productionPayload.workerId = message.workerId;
        productionPayload.batchProfilingId = batchProfilingId;
        productionPayload.readyTs = readyTs;
        productionPayload.pathsTransferred = compactResults.length;
        productionPayload.monthlyRecordsTransferred = compactResults.reduce((sum, item) => sum + (Array.isArray(item?.monthly) ? item.monthly.length : 0), 0);
        if (message.advancedStatistics) {
          productionPayload.advancedObservationVectors = compactResults.reduce((sum, item) => sum + (Array.isArray(item?.__advancedObservationSamples) ? item.__advancedObservationSamples.length : 0), 0);
          productionPayload.etfScalarObservations = compactResults.reduce((sum, item) => sum + (Array.isArray(item?.__advancedObservationSamples) ? item.__advancedObservationSamples.reduce((acc, sample) => acc + (Array.isArray(sample?.etfReturns) ? sample.etfReturns.length : 0), 0) : 0), 0);
        }
        productionPayload.scenarioRecords = compactResults.reduce((sum, item) => sum + (Array.isArray(item?.scenarioPath?.years) ? item.scenarioPath.years.length : 0), 0);
        aggregationPort.start();
        const postMessageStartTs = performance.timeOrigin + performance.now();
        if (profilingEnabled) {
          asWorkerScope.postMessage({
            type: 'BATCH_PROFILE_SUMMARY',
            executionId: message.executionId,
            workerId: message.workerId,
            batch: {
              batchProfilingId,
              batchStart,
              batchEnd,
              readyTs,
              postMessageStartTs,
              readyToPostMs: 0,
              transferToAggMs: 0,
              aggIngestionMs: 0,
              pathsTransferred: productionPayload.pathsTransferred,
              monthlyRecordsTransferred: productionPayload.monthlyRecordsTransferred,
              pathCount: compactResults.length
            }
          });
        }
        console.info('[MC-PERF] WORKER_BATCH_SEND', {
          workerId: message.workerId,
          batchStart,
          batchEnd,
          batchPathCount: compactResults.length,
          at: performance.now()
        });
        aggregationPort.postMessage(productionPayload, transport.transferList);
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
    const workerSummary = results.reduce((summary, path) => {
      const timings = path && path.__timings ? path.__timings : {};
      summary.macroTimelineMs += Number(timings.macroTimelineMs) || 0;
      summary.monthlyReturnGenerationMs += Number(timings.monthlyReturnGenerationMs) || 0;
      summary.portfolioEvolutionMs += Number(timings.portfolioEvolutionMs) || 0;
      summary.advancedObservationCollectionMs += Number(timings.advancedObservationCollectionMs) || 0;
      summary.compactResultMs += Number(timings.compactResultMs) || 0;
      summary.batchConstructionMs += 0;
      summary.postMessageCallMs += sendMs;
      summary.workerTotalMs += Number(timings.macroTimelineMs) + Number(timings.monthlyReturnGenerationMs) + Number(timings.portfolioEvolutionMs) + Number(timings.advancedObservationCollectionMs) + Number(timings.compactResultMs) + sendMs;
      return summary;
    }, {
      macroTimelineMs: 0,
      monthlyReturnGenerationMs: 0,
      portfolioEvolutionMs: 0,
      advancedObservationCollectionMs: 0,
      compactResultMs: 0,
      batchConstructionMs: 0,
      postMessageCallMs: 0,
      workerTotalMs: 0
    });
    if (batchProfile) {
      batchProfile.workerTotalMs = performance.now() - batchStartedAt;
      const attributedSum = batchProfile.pathCoreMs + batchProfile.advancedCollectionMs + batchProfile.pathResultOtherMs + batchProfile.compactMs + batchProfile.encodeMs + batchProfile.postMessageMs;
      const unAttributedMs = Math.max(0, batchProfile.workerTotalMs - attributedSum);
      asWorkerScope.postMessage({
        type: 'WORKER_SUMMARY',
        executionId: message.executionId,
        workerId: message.workerId,
        summary: {
          workerId: message.workerId,
          pathsProcessed: results.length,
          ...workerSummary,
          pathCoreMs: batchProfile.pathCoreMs,
          advancedCollectionMs: batchProfile.advancedCollectionMs,
          pathResultOtherMs: batchProfile.pathResultOtherMs,
          compactMs: batchProfile.compactMs,
          encodeMs: batchProfile.encodeMs,
          postMessageMs: batchProfile.postMessageMs,
          workerTotalMs: batchProfile.workerTotalMs,
          unAttributedMs
        }
      });
    } else {
      asWorkerScope.postMessage({
        type: 'WORKER_SUMMARY',
        executionId: message.executionId,
        workerId: message.workerId,
        summary: {
          workerId: message.workerId,
          pathsProcessed: results.length,
          ...workerSummary
        }
      });
    }
    emitLifecycleEvent(message.executionId, message.workerId, 'WORKER_COMPLETE', {
      batchId: `${batchStart}-${batchEnd}`,
      pathCount: results.length,
      completedPaths: batchEnd
    }, message.runStartMs);

    asWorkerScope.postMessage({
      type: 'PROGRESS',
      executionId: message.executionId,
      workerId: message.workerId,
      batchStart,
      batchEnd,
      batchId: `${batchStart}-${batchEnd}`,
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
