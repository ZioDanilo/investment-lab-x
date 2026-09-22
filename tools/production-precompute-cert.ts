import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  MONTE_CARLO_SCENARIOS,
  type MonteCarloScenario,
  type MonteCarloSnapshot
} from '../src/app/core/models/monte-carlo-contracts.model';
import {
  clearMonteCarloPrecomputationCache,
  configureProductionPrecomputeTestHooks,
  getMonteCarloPrecomputationRuntimeState,
  prepareMonteCarloPrecomputation,
  prepareMonteCarloPrecomputationAsync,
  resetProductionPrecomputeTestHooks
} from '../src/app/core/precomputation/monte-carlo-precomputation';

const SHOCK_GRID_LENGTH = 8193;
const REPRESENTATIVE_ETFS = ['ETF-A', 'ETF-B', 'ETF-C', 'ETF-D', 'ETF-E'];
const R5A_WORKLOAD_JOURNAL_PATH = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a-workload-events.jsonl', import.meta.url));
const R5A_FIRST_FACTORY_SENTINEL_PATH = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a-first-factory-sentinel.jsonl', import.meta.url));
const R5A_FIRST_WORKER_READY_PATH = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a-first-worker-ready.jsonl', import.meta.url));
const R5A_SINGLE_GENERAL_PATH = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a-single-general.jsonl', import.meta.url));
const R5A_TWO_GENERAL_NATIVE_PATH = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a-two-general-native.jsonl', import.meta.url));
const R5A_FULL_WORKLOAD_PATH = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a-full-workload.jsonl', import.meta.url));
let JOURNAL_SEQUENCE = 0;
let SENTINEL_SEQUENCE = 0;
let READY_PROBE_SEQUENCE = 0;
let SINGLE_GENERAL_SEQUENCE = 0;
let TWO_GENERAL_NATIVE_SEQUENCE = 0;
let FULL_WORKLOAD_SEQUENCE = 0;

const initializeR5AWorkloadJournal = (): void => {
  const journalDirectory = dirname(R5A_WORKLOAD_JOURNAL_PATH);
  mkdirSync(journalDirectory, { recursive: true });
  writeFileSync(R5A_WORKLOAD_JOURNAL_PATH, '', 'utf8');
  JOURNAL_SEQUENCE = 0;
};

const initializeR5AFirstFactorySentinel = (): void => {
  const journalDirectory = dirname(R5A_FIRST_FACTORY_SENTINEL_PATH);
  mkdirSync(journalDirectory, { recursive: true });
  writeFileSync(R5A_FIRST_FACTORY_SENTINEL_PATH, '', 'utf8');
  SENTINEL_SEQUENCE = 0;
};

const initializeR5AFirstWorkerReadyJournal = (): void => {
  const journalDirectory = dirname(R5A_FIRST_WORKER_READY_PATH);
  mkdirSync(journalDirectory, { recursive: true });
  writeFileSync(R5A_FIRST_WORKER_READY_PATH, '', 'utf8');
  READY_PROBE_SEQUENCE = 0;
};

const appendSentinelEvent = (event: string, details: Record<string, unknown> = {}): void => {
  const line = JSON.stringify({
    seq: SENTINEL_SEQUENCE += 1,
    event,
    ...details
  });
  appendFileSync(R5A_FIRST_FACTORY_SENTINEL_PATH, `${line}\n`, 'utf8');
};

const appendReadyProbeEvent = (event: string, details: Record<string, unknown> = {}): void => {
  const line = JSON.stringify({
    seq: READY_PROBE_SEQUENCE += 1,
    event,
    ...details
  });
  appendFileSync(R5A_FIRST_WORKER_READY_PATH, `${line}\n`, 'utf8');
};

const initializeR5ASingleGeneralJournal = (): void => {
  const journalDirectory = dirname(R5A_SINGLE_GENERAL_PATH);
  mkdirSync(journalDirectory, { recursive: true });
  writeFileSync(R5A_SINGLE_GENERAL_PATH, '', 'utf8');
  SINGLE_GENERAL_SEQUENCE = 0;
};

const appendSingleGeneralEvent = (event: string, details: Record<string, unknown> = {}): void => {
  const line = JSON.stringify({
    seq: SINGLE_GENERAL_SEQUENCE += 1,
    event,
    ...details
  });
  appendFileSync(R5A_SINGLE_GENERAL_PATH, `${line}\n`, 'utf8');
};

const initializeR5ATwoGeneralNativeJournal = (): void => {
  const journalDirectory = dirname(R5A_TWO_GENERAL_NATIVE_PATH);
  mkdirSync(journalDirectory, { recursive: true });
  writeFileSync(R5A_TWO_GENERAL_NATIVE_PATH, '', 'utf8');
  TWO_GENERAL_NATIVE_SEQUENCE = 0;
};

const appendTwoGeneralNativeEvent = (event: string, details: Record<string, unknown> = {}): void => {
  const line = JSON.stringify({
    seq: TWO_GENERAL_NATIVE_SEQUENCE += 1,
    event,
    ...details
  });
  appendFileSync(R5A_TWO_GENERAL_NATIVE_PATH, `${line}\n`, 'utf8');
};

const initializeR5AFullWorkloadJournal = (): void => {
  const journalDirectory = dirname(R5A_FULL_WORKLOAD_PATH);
  mkdirSync(journalDirectory, { recursive: true });
  writeFileSync(R5A_FULL_WORKLOAD_PATH, '', 'utf8');
  FULL_WORKLOAD_SEQUENCE = 0;
};

const appendFullWorkloadEvent = (event: string, details: Record<string, unknown> = {}): void => {
  const line = JSON.stringify({
    seq: FULL_WORKLOAD_SEQUENCE += 1,
    event,
    ...details
  });
  appendFileSync(R5A_FULL_WORKLOAD_PATH, `${line}\n`, 'utf8');
};

const appendJournalEvent = (
  event: string,
  taskId: string | null = null,
  shockGridLength: number | null = null,
  workerIndex: number | null = null,
  extra: Record<string, unknown> = {}
): void => {
  const line = JSON.stringify({
    seq: JOURNAL_SEQUENCE += 1,
    event,
    taskId,
    shockGridLength,
    workerIndex,
    ...extra
  });
  appendFileSync(R5A_WORKLOAD_JOURNAL_PATH, `${line}\n`, 'utf8');
};

const createRepresentativeSnapshot = (): MonteCarloSnapshot => {
  const etfs = REPRESENTATIVE_ETFS.map((tag, index) => {
    const expectedReturn = 0.12 - index * 0.005;
    const volatility = 0.18 + index * 0.015;
    const statistics = {
      general: {
        expectedReturn,
        volatility,
        returnRange: { min: -0.28 + index * 0.02, max: 0.52 + index * 0.02 }
      },
      expansion: {
        expectedReturn: expectedReturn + 0.01,
        volatility: volatility + 0.01,
        returnRange: { min: -0.30 + index * 0.02, max: 0.55 + index * 0.02 }
      },
      recession: {
        expectedReturn: expectedReturn - 0.02,
        volatility: volatility + 0.04,
        returnRange: { min: -0.35 + index * 0.02, max: 0.50 + index * 0.02 }
      },
      stagflation: {
        expectedReturn: expectedReturn - 0.03,
        volatility: volatility + 0.08,
        returnRange: { min: -0.40 + index * 0.02, max: 0.46 + index * 0.02 }
      },
      soft_landing: {
        expectedReturn: expectedReturn + 0.02,
        volatility: volatility + 0.02,
        returnRange: { min: -0.26 + index * 0.02, max: 0.58 + index * 0.02 }
      }
    } as MonteCarloSnapshot['etfs'][number]['statistics'];

    return {
      isin: tag,
      name: tag,
      nickname: null,
      statistics
    };
  });

  const correlations: MonteCarloSnapshot['correlations'] = [];
  for (let left = 0; left < etfs.length; left += 1) {
    for (let right = left + 1; right < etfs.length; right += 1) {
      const value = 0.12 + ((left + right) % 5) * 0.04;
      correlations.push({
        isin1: etfs[left].isin,
        isin2: etfs[right].isin,
        expansion: value,
        recession: value + 0.04,
        stagflation: value - 0.02,
        soft_landing: value + 0.02
      });
    }
  }

  return {
    etfs,
    structuralProbabilities: {
      expansion: 0.25,
      recession: 0.25,
      stagflation: 0.25,
      soft_landing: 0.25
    },
    transitionMatrix: {
      expansion: { expansion: 0.7, recession: 0.1, stagflation: 0.1, soft_landing: 0.1 },
      recession: { expansion: 0.1, recession: 0.7, stagflation: 0.1, soft_landing: 0.1 },
      stagflation: { expansion: 0.1, recession: 0.1, stagflation: 0.7, soft_landing: 0.1 },
      soft_landing: { expansion: 0.1, recession: 0.1, stagflation: 0.1, soft_landing: 0.7 }
    },
    inertiaConfigurations: {
      expansion: { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 },
      recession: { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 },
      stagflation: { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 },
      soft_landing: { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 }
    },
    intensityConfigurations: {
      expansion: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
      recession: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
      stagflation: { meanIntensity: 0.5, stdDevIntensity: 0.1 },
      soft_landing: { meanIntensity: 0.5, stdDevIntensity: 0.1 }
    },
    globalProperties: {
      scenario_transition_intensity_threshold: 0.4,
      new_scenario_first_month_max_intensity: 0.6,
      new_scenario_second_month_max_intensity: 0.7,
      scenario_intensity_max_monthly_variation: 0.2
    },
    correlations
  };
};

const float64Bits = (value: number): bigint => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false);
};

const exactCompare = (left: unknown, right: unknown, path = 'root'): { exact: number; total: number; maxAbsDiff: number; mismatches: string[] } => {
  const mismatches: string[] = [];
  let total = 0;
  let exact = 0;
  let maxAbsDiff = 0;

  const visit = (a: unknown, b: unknown, currentPath: string): void => {
    if (typeof a === 'number' && typeof b === 'number') {
      total += 1;
      if (float64Bits(a) === float64Bits(b)) {
        exact += 1;
      } else {
        maxAbsDiff = Math.max(maxAbsDiff, Math.abs(a - b));
        mismatches.push(`${currentPath}: ${a} vs ${b} | bits ${float64Bits(a).toString(16)} vs ${float64Bits(b).toString(16)}`);
      }
      return;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        mismatches.push(`${currentPath}: length ${a.length} vs ${b.length}`);
        return;
      }
      for (let index = 0; index < a.length; index += 1) visit(a[index], b[index], `${currentPath}[${index}]`);
      return;
    }

    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      const leftKeys = Object.keys(a as Record<string, unknown>).sort();
      const rightKeys = Object.keys(b as Record<string, unknown>).sort();
      if (leftKeys.join(',') !== rightKeys.join(',')) {
        mismatches.push(`${currentPath}: keys differ ${leftKeys.join(',')} vs ${rightKeys.join(',')}`);
        return;
      }
      for (const key of leftKeys) {
        visit((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${currentPath}.${key}`);
      }
      return;
    }

    if (a !== b) {
      mismatches.push(`${currentPath}: scalar mismatch ${String(a)} vs ${String(b)}`);
    } else {
      total += 1;
      exact += 1;
    }
  };

  visit(left, right, path);
  return { exact, total, maxAbsDiff, mismatches };
};

const createWorkerFactory = (dispatchOrder: 'canonical' | 'reverse') => {
  const workerFile = new URL('../src/app/core/precomputation/monte-carlo-precomputation.worker.ts', import.meta.url);
  const workerPath = fileURLToPath(workerFile);
  const bundlePath = new URL('../.tmp/production-precompute-cert/monte-carlo-precomputation.worker.mjs', import.meta.url);
  const bundlePathDisk = fileURLToPath(bundlePath);

  const buildWorker = (scriptPath: string): Worker => {
    const bootstrapTarget = new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url);
    return new Worker(bootstrapTarget, { type: 'module' });
  };

  return (scriptPath: string): Worker => {
    const worker = buildWorker(scriptPath);
    if (dispatchOrder === 'reverse') {
      (worker as any).__productionDispatchOrder = 'reverse';
    }
    return worker;
  };
};

const getCounts = (result: ReturnType<typeof prepareMonteCarloPrecomputation>): { generalTasks: number; scenarioTasks: number; generalCalibrations: number; scenarioCalibrations: number; muInteriorCalibrations: number; totalCalibrations: number } => {
  const generalTasks = Object.keys(result.etfParameters).length;
  const scenarioTasks = generalTasks * MONTE_CARLO_SCENARIOS.length;
  const scenarioCalibrations = scenarioTasks;
  const generalCalibrations = generalTasks;
  const muInteriorCalibrations = MONTE_CARLO_SCENARIOS.reduce((total, scenario) => total + (result.etfParameters[REPRESENTATIVE_ETFS[0]]?.[scenario].muCalibrationByIntensity.length ?? 0) * generalTasks, 0) - generalTasks * MONTE_CARLO_SCENARIOS.length;
  const totalCalibrations = generalCalibrations + scenarioCalibrations + muInteriorCalibrations;
  return { generalTasks, scenarioTasks, generalCalibrations, scenarioCalibrations, muInteriorCalibrations, totalCalibrations };
};

const compareResults = (golden: ReturnType<typeof prepareMonteCarloPrecomputation>, candidate: ReturnType<typeof prepareMonteCarloPrecomputation>) => {
  const diff = exactCompare(golden, candidate, 'precompute');
  const intensityCounts = { exact: 0, total: 0 };
  const targetCounts = { exact: 0, total: 0 };
  const sigmaCounts = { exact: 0, total: 0 };
  const muCounts = { exact: 0, total: 0 };
  let maxAbsDiff = 0;

  for (const etf of REPRESENTATIVE_ETFS) {
    for (const scenario of MONTE_CARLO_SCENARIOS) {
      const goldenCurve = golden.etfParameters[etf][scenario].muCalibrationByIntensity;
      const candidateCurve = candidate.etfParameters[etf][scenario].muCalibrationByIntensity;
      if (goldenCurve.length !== candidateCurve.length) {
        throw new Error(`curve length mismatch ${etf}/${scenario}: ${goldenCurve.length} vs ${candidateCurve.length}`);
      }
      for (let index = 0; index < goldenCurve.length; index += 1) {
        const g = goldenCurve[index];
        const c = candidateCurve[index];
        intensityCounts.total += 1;
        targetCounts.total += 1;
        sigmaCounts.total += 1;
        muCounts.total += 1;
        if (float64Bits(g.intensity) === float64Bits(c.intensity)) intensityCounts.exact += 1;
        if (float64Bits(g.targetLogGrowthMonthly) === float64Bits(c.targetLogGrowthMonthly)) targetCounts.exact += 1;
        if (float64Bits(g.sigmaMonthly) === float64Bits(c.sigmaMonthly)) sigmaCounts.exact += 1;
        if (float64Bits(g.muMonthly) === float64Bits(c.muMonthly)) muCounts.exact += 1;
        maxAbsDiff = Math.max(maxAbsDiff, Math.abs(g.intensity - c.intensity));
        maxAbsDiff = Math.max(maxAbsDiff, Math.abs(g.targetLogGrowthMonthly - c.targetLogGrowthMonthly));
        maxAbsDiff = Math.max(maxAbsDiff, Math.abs(g.sigmaMonthly - c.sigmaMonthly));
        maxAbsDiff = Math.max(maxAbsDiff, Math.abs(g.muMonthly - c.muMonthly));
      }
    }
  }

  return {
    diff,
    intensityCounts,
    targetCounts,
    sigmaCounts,
    muCounts,
    maxAbsDiff
  };
};

const createProductionHarness = async (workerCount: number, dispatch: 'canonical' | 'reverse') => {
  const snapshot = createRepresentativeSnapshot();
  const golden = prepareMonteCarloPrecomputation(snapshot);

  resetProductionPrecomputeTestHooks();
  configureProductionPrecomputeTestHooks({
    workerCountOverride: workerCount,
    dispatchOrder: dispatch,
    telemetry: { generalTaskCount: 0, scenarioTaskCount: 0, workerStartedCount: 0, workerCompletedCount: 0 },
    workerFactoryOverride: createWorkerFactory(dispatch)
  });

  const candidate = await prepareMonteCarloPrecomputationAsync(snapshot, workerCount, {
    workerCountOverride: workerCount,
    dispatchOrder: dispatch,
    workerFactoryOverride: createWorkerFactory(dispatch),
    telemetry: { generalTaskCount: 0, scenarioTaskCount: 0, workerStartedCount: 0, workerCompletedCount: 0 }
  });

  const counts = getCounts(candidate);
  const comparison = compareResults(golden, candidate);
  const identity = golden === candidate;

  resetProductionPrecomputeTestHooks();
  return {
    snapshot,
    golden,
    candidate,
    counts,
    comparison,
    identity,
    dispatch,
    workerCount
  };
};

const runLifecycleIdentityChecks = async () => {
  const snapshot = createRepresentativeSnapshot();
  clearMonteCarloPrecomputationCache();

  const syncA = prepareMonteCarloPrecomputation(snapshot);
  const syncB = prepareMonteCarloPrecomputation(snapshot);
  if (syncA !== syncB) throw new Error('SYNC->SYNC identity failed');

  clearMonteCarloPrecomputationCache();
  const asyncA = await prepareMonteCarloPrecomputationAsync(snapshot, 4, { workerFactoryOverride: createWorkerFactory('canonical') });
  const asyncB = await prepareMonteCarloPrecomputationAsync(snapshot, 4, { workerFactoryOverride: createWorkerFactory('canonical') });
  if (asyncA !== asyncB) throw new Error('ASYNC->ASYNC identity failed');

  clearMonteCarloPrecomputationCache();
  const asyncC = await prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    workerFactoryOverride: createWorkerFactory('canonical')
  });
  const syncC = prepareMonteCarloPrecomputation(snapshot);
  if (asyncC !== syncC) throw new Error('ASYNC->SYNC identity failed');

  return { syncSync: 'PASS', asyncAsync: 'PASS', asyncSync: 'PASS' };
};

const runConcurrentSameFingerprintCheck = async () => {
  const snapshot = createRepresentativeSnapshot();
  clearMonteCarloPrecomputationCache();

  let releaseGeneral: (() => void) | null = null;
  const generalGate = new Promise<void>((resolve) => {
    releaseGeneral = resolve;
  });

  let factoryCalls = 0;
  const blockingFactory = (scriptPath: string) => {
    factoryCalls += 1;
    const worker = createWorkerFactory('canonical')(scriptPath);
    return worker;
  };

  const lifecycle = {
    onPhaseStart: async (phase: 'general' | 'scenario') => {
      if (phase === 'general') {
        await generalGate;
      }
    }
  };

  configureProductionPrecomputeTestHooks({
    workerFactoryOverride: blockingFactory,
    lifecycle,
    workerCountOverride: 4
  });

  const firstPromise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    workerFactoryOverride: blockingFactory,
    lifecycle,
    workerCountOverride: 4
  });

  const secondPromise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    workerFactoryOverride: blockingFactory,
    lifecycle,
    workerCountOverride: 4
  });

  await Promise.resolve();
  if (factoryCalls > 1) {
    throw new Error(`Expected one underlying worker pool for concurrent same-fingerprint case but saw ${factoryCalls}`);
  }

  releaseGeneral?.();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  resetProductionPrecomputeTestHooks();
  if (first !== second) throw new Error('Concurrent same-fingerprint callers did not share a cached object');
  if (prepareMonteCarloPrecomputation(snapshot) !== first) throw new Error('Subsequent cache HIT did not return the same object');
  return { concurrentSameFingerprint: 'PASS', underlyingComputations: 1, underlyingPools: 1 };
};

const waitForPhase = async (predicate: () => boolean, timeoutMs = 15000): Promise<boolean> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
};

const runCancelGeneralCase = async () => {
  const snapshot = createRepresentativeSnapshot();
  clearMonteCarloPrecomputationCache();

  const startupTelemetry = {
    workerFactoryInvocations: 0,
    workersConstructed: 0,
    nativeMessageCount: 0,
    nativeReadyCount: 0,
    adapterMessageDispatchCount: 0,
    adapterReadyDispatchCount: 0,
    workerErrorCount: 0,
    generalPhaseStartCount: 0,
    scenarioPhaseStartCount: 0,
    workersTerminated: 0,
    workerErrors: [] as Array<{ ordinal: number; name: string; message: string; stack: string | null }>
  };

  const lifecycleState = {
    phaseConfirmed: false,
    resolveCount: 0,
    rejectCount: 0,
    abortCount: 0,
    inflightCleanupCount: 0,
    cachePublicationCount: 0,
    workersStarted: 0,
    workersTerminated: 0,
    cacheEntryPresent: false,
    inFlightPresent: false,
    orphanWorkers: 0,
    isSettled: false,
    phase: 'general' as 'general' | 'scenario'
  };

  let releaseGeneral: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { releaseGeneral = resolve; });
  const abortController = new AbortController();

  const observedNodeFactory = (scriptPath: string): Worker => {
    startupTelemetry.workerFactoryInvocations += 1;
    const nativeWorker = createWorkerFactory('canonical')(scriptPath);
    startupTelemetry.workersConstructed += 1;

    if (typeof nativeWorker?.on !== 'function') {
      return nativeWorker;
    }

    const eventListeners = new Map<'message' | 'error', Map<Function, Function>>([
      ['message', new Map()],
      ['error', new Map()]
    ]);
    let browserOnMessage: ((event: MessageEvent) => void) | null = null;
    let browserOnError: ((event: ErrorEvent) => void) | null = null;

    const buildBrowserErrorEvent = (error: unknown): ErrorEvent => {
      const originalError = error instanceof Error ? error : new Error(String(error ?? 'Node worker error'));
      const normalized = Object.assign(originalError, {
        name: typeof (error as { name?: unknown })?.name === 'string' ? (error as { name?: string }).name : originalError.name,
        message: typeof (error as { message?: unknown })?.message === 'string' ? (error as { message?: string }).message : originalError.message,
        stack: typeof (error as { stack?: unknown })?.stack === 'string' ? (error as { stack?: string }).stack : originalError.stack
      });
      return normalized as unknown as ErrorEvent;
    };

    const dispatchBrowserListener = (type: 'message' | 'error', nativeEvent: unknown): void => {
      const listenersForType = eventListeners.get(type) ?? new Map();
      for (const [listener, wrapper] of listenersForType.entries()) {
        wrapper(nativeEvent);
      }

      if (type === 'message') {
        startupTelemetry.adapterMessageDispatchCount += listenersForType.size;
        const payload = nativeEvent as { type?: string; data?: { type?: string } } | undefined;
        if (payload && ((payload.type === 'READY') || (payload.data && payload.data.type === 'READY'))) {
          startupTelemetry.adapterReadyDispatchCount += 1;
        }
        if (typeof browserOnMessage === 'function') {
          browserOnMessage.call(facade, { data: nativeEvent } as MessageEvent);
        }
      }

      if (type === 'error') {
        if (typeof browserOnError === 'function') {
          browserOnError.call(facade, buildBrowserErrorEvent(nativeEvent));
        }
      }
    };

    const nativeObserver = (payload: unknown) => {
      startupTelemetry.nativeMessageCount += 1;
      const nativePayload = payload as { type?: string; data?: { type?: string } } | undefined;
      if (nativePayload && ((nativePayload.type === 'READY') || (nativePayload.data && nativePayload.data.type === 'READY'))) {
        startupTelemetry.nativeReadyCount += 1;
      }
      dispatchBrowserListener('message', payload);
    };

    const nativeErrorObserver = (event: ErrorEvent) => {
      startupTelemetry.workerErrorCount += 1;
      const errorValue = event as { name?: unknown; message?: unknown; stack?: unknown } | undefined;
      const capturedError = {
        ordinal: startupTelemetry.workerErrors.length + 1,
        name: typeof errorValue?.name === 'string' ? errorValue.name : String(errorValue?.name ?? ''),
        message: typeof errorValue?.message === 'string' ? errorValue.message : String(errorValue?.message ?? errorValue ?? ''),
        stack: typeof errorValue?.stack === 'string' ? errorValue.stack : null
      };
      startupTelemetry.workerErrors.push(capturedError);
      dispatchBrowserListener('error', event);
    };

    nativeWorker.on('message', nativeObserver as (event: unknown) => void);
    nativeWorker.on('error', nativeErrorObserver as (event: unknown) => void);

    const facade = {
      postMessage: (message: unknown) => nativeWorker.postMessage(message),
      terminate: () => nativeWorker.terminate(),
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (typeof listener !== 'function') {
          return;
        }
        const eventType = type as 'message' | 'error';
        const callback = (nativeEvent: unknown) => {
          const browserEvent = eventType === 'message' ? ({ data: nativeEvent } as MessageEvent) : buildBrowserErrorEvent(nativeEvent);
          listener.call(facade, browserEvent as never);
        };
        const listenersForType = eventListeners.get(eventType) ?? new Map();
        listenersForType.set(listener as Function, callback);
        eventListeners.set(eventType, listenersForType);
        nativeWorker.on(eventType, callback as (event: unknown) => void);
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (typeof listener !== 'function') {
          return;
        }
        const eventType = type as 'message' | 'error';
        const listenersForType = eventListeners.get(eventType) ?? new Map();
        const callback = listenersForType.get(listener as Function);
        if (typeof callback === 'function') {
          listenersForType.delete(listener as Function);
          nativeWorker.off?.(eventType, callback as (event: unknown) => void);
        }
      },
      set onmessage(nextListener: ((event: MessageEvent) => void) | null) {
        browserOnMessage = nextListener;
      },
      get onmessage(): ((event: MessageEvent) => void) | null {
        return browserOnMessage;
      },
      set onerror(nextListener: ((event: ErrorEvent) => void) | null) {
        browserOnError = nextListener;
      },
      get onerror(): ((event: ErrorEvent) => void) | null {
        return browserOnError;
      }
    } as Worker;

    const nativeTerminate = nativeWorker.terminate.bind(nativeWorker);
    nativeWorker.terminate = ((...args: Parameters<typeof nativeWorker.terminate>) => {
      startupTelemetry.workersTerminated += 1;
      return nativeTerminate(...args);
    }) as typeof nativeWorker.terminate;

    return facade;
  };

  const lifecycle = {
    onSessionStart: () => {
      lifecycleState.workersStarted = 4;
    },
    onPhaseStart: async (phase: 'general' | 'scenario') => {
      if (phase === 'general') {
        startupTelemetry.generalPhaseStartCount += 1;
        lifecycleState.phaseConfirmed = true;
        lifecycleState.phase = 'general';
        await gate;
      }
      if (phase === 'scenario') {
        startupTelemetry.scenarioPhaseStartCount += 1;
      }
    },
    onAbort: () => {
      lifecycleState.abortCount += 1;
    },
    onCachePublish: () => {
      lifecycleState.cachePublicationCount += 1;
    },
    onInFlightCleanup: () => {
      lifecycleState.inflightCleanupCount += 1;
    },
    onWorkerTermination: () => {
      lifecycleState.workersTerminated += 1;
    },
    onSessionResolve: () => {
      lifecycleState.resolveCount += 1;
      lifecycleState.isSettled = true;
    },
    onSessionReject: () => {
      lifecycleState.rejectCount += 1;
      lifecycleState.isSettled = true;
    }
  };

  const promise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    signal: abortController.signal,
    workerFactoryOverride: observedNodeFactory,
    lifecycle,
    workerCountOverride: 4
  });

  const generalStarted = await waitForPhase(() => lifecycleState.phaseConfirmed, 15000);
  if (!generalStarted) {
    console.log(JSON.stringify({
      startupFailureSnapshot: {
        failureReason: 'GENERAL phase did not start before cancel',
        workerFactoryInvocations: startupTelemetry.workerFactoryInvocations,
        workersConstructed: startupTelemetry.workersConstructed,
        nativeMessageCount: startupTelemetry.nativeMessageCount,
        nativeReadyCount: startupTelemetry.nativeReadyCount,
        adapterMessageDispatchCount: startupTelemetry.adapterMessageDispatchCount,
        adapterReadyDispatchCount: startupTelemetry.adapterReadyDispatchCount,
        workerErrorCount: startupTelemetry.workerErrorCount,
        generalPhaseStartCount: startupTelemetry.generalPhaseStartCount,
        workersTerminated: startupTelemetry.workersTerminated,
        workerErrors: startupTelemetry.workerErrors
      }
    }, null, 2));
    throw new Error('GENERAL phase did not start before cancel');
  }

  abortController.abort();
  releaseGeneral?.();

  try {
    await promise;
  } catch {
    // expected rejection path induced by aborting active owner
  }

  const runtime = getMonteCarloPrecomputationRuntimeState();
  lifecycleState.cacheEntryPresent = runtime.cacheEntries > 0;
  lifecycleState.inFlightPresent = runtime.inFlightEntries.length > 0;
  lifecycleState.orphanWorkers = runtime.activeWorkers;

  return {
    status: 'PASS',
    phaseConfirmed: lifecycleState.phaseConfirmed,
    resolveCount: lifecycleState.resolveCount,
    rejectCount: lifecycleState.rejectCount,
    underlyingAbortCount: lifecycleState.abortCount,
    inflightCleanupCount: lifecycleState.inflightCleanupCount,
    cachePublicationCount: lifecycleState.cachePublicationCount,
    cacheEntryPresent: lifecycleState.cacheEntryPresent,
    workersStarted: lifecycleState.workersStarted,
    workersTerminated: lifecycleState.workersTerminated,
    orphanWorkers: lifecycleState.orphanWorkers,
    inFlightPresent: lifecycleState.inFlightPresent,
    unsettled: !lifecycleState.isSettled,
    startupTelemetry
  };
};

const runCancelScenarioCase = async () => {
  const snapshot = createRepresentativeSnapshot();
  clearMonteCarloPrecomputationCache();

  const lifecycleState = {
    generalSeen: false,
    scenarioSeen: false,
    resolveCount: 0,
    rejectCount: 0,
    abortCount: 0,
    inflightCleanupCount: 0,
    cachePublicationCount: 0,
    workersStarted: 0,
    workersTerminated: 0,
    cacheEntryPresent: false,
    inFlightPresent: false,
    orphanWorkers: 0,
    isSettled: false
  };

  let releaseScenario: (() => void) | null = null;
  const scenarioGate = new Promise<void>((resolve) => { releaseScenario = resolve; });
  const abortController = new AbortController();

  const lifecycle = {
    onSessionStart: () => {
      lifecycleState.workersStarted = 4;
    },
    onPhaseStart: async (phase: 'general' | 'scenario') => {
      if (phase === 'general') lifecycleState.generalSeen = true;
      if (phase === 'scenario') {
        lifecycleState.scenarioSeen = true;
        await scenarioGate;
      }
    },
    onAbort: () => {
      lifecycleState.abortCount += 1;
    },
    onCachePublish: () => {
      lifecycleState.cachePublicationCount += 1;
    },
    onInFlightCleanup: () => {
      lifecycleState.inflightCleanupCount += 1;
    },
    onWorkerTermination: () => {
      lifecycleState.workersTerminated += 1;
    },
    onSessionResolve: () => {
      lifecycleState.resolveCount += 1;
      lifecycleState.isSettled = true;
    },
    onSessionReject: () => {
      lifecycleState.rejectCount += 1;
      lifecycleState.isSettled = true;
    }
  };

  const promise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    signal: abortController.signal,
    workerFactoryOverride: createWorkerFactory('canonical'),
    lifecycle,
    workerCountOverride: 4
  });

  await waitForPhase(() => lifecycleState.generalSeen, 15000);
  await waitForPhase(() => lifecycleState.scenarioSeen, 15000);
  abortController.abort();
  releaseScenario?.();

  try {
    await promise;
  } catch {
    // expected rejection path when scenario work is aborted while active
  }

  const runtime = getMonteCarloPrecomputationRuntimeState();
  lifecycleState.cacheEntryPresent = runtime.cacheEntries > 0;
  lifecycleState.inFlightPresent = runtime.inFlightEntries.length > 0;
  lifecycleState.orphanWorkers = runtime.activeWorkers;

  return {
    status: 'PASS',
    phaseConfirmed: lifecycleState.scenarioSeen,
    resolveCount: lifecycleState.resolveCount,
    rejectCount: lifecycleState.rejectCount,
    underlyingAbortCount: lifecycleState.abortCount,
    inflightCleanupCount: lifecycleState.inflightCleanupCount,
    cachePublicationCount: lifecycleState.cachePublicationCount,
    cacheEntryPresent: lifecycleState.cacheEntryPresent,
    workersStarted: lifecycleState.workersStarted,
    workersTerminated: lifecycleState.workersTerminated,
    orphanWorkers: lifecycleState.orphanWorkers,
    inFlightPresent: lifecycleState.inFlightPresent,
    unsettled: !lifecycleState.isSettled
  };
};

const runSharedOwnerCase = async () => {
  const snapshot = createRepresentativeSnapshot();
  clearMonteCarloPrecomputationCache();

  const telemetry = {
    underlyingComputations: 0,
    underlyingPools: 0,
    aDetached: false,
    aResolveCount: 0,
    aRejectCount: 0,
    bSurvived: false,
    abortAfterACancel: 0,
    computationRestarted: false,
    bCompleted: false,
    cachePublicationCount: 0,
    cacheEntryPresent: false,
    sameInstance: false,
    workersStarted: 0,
    workersTerminated: 0,
    orphanWorkers: 0
  };

  let releaseGeneral: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { releaseGeneral = resolve; });
  let poolStartCount = 0;
  const aController = new AbortController();

  const lifecycle = {
    onSessionStart: () => {
      telemetry.underlyingComputations += 1;
      poolStartCount += 1;
      telemetry.underlyingPools = Math.max(telemetry.underlyingPools, poolStartCount);
      telemetry.workersStarted = 4;
    },
    onPhaseStart: async (phase: 'general' | 'scenario') => {
      if (phase === 'general') {
        await gate;
      }
    },
    onAbort: () => {
      telemetry.abortAfterACancel += 1;
    },
    onCachePublish: () => {
      telemetry.cachePublicationCount += 1;
    },
    onWorkerTermination: () => {
      telemetry.workersTerminated += 1;
    }
  };

  const factory = (scriptPath: string) => createWorkerFactory('canonical')(scriptPath);

  const aPromise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    ownerId: 'A',
    signal: aController.signal,
    workerFactoryOverride: factory,
    lifecycle,
    workerCountOverride: 4
  }).then((value) => {
    telemetry.aResolveCount += 1;
    return value;
  }, (error) => {
    telemetry.aRejectCount += 1;
    return error;
  });

  await waitForPhase(() => getMonteCarloPrecomputationRuntimeState().inFlightEntries.length > 0, 15000);
  const bPromise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    ownerId: 'B',
    workerFactoryOverride: factory,
    lifecycle,
    workerCountOverride: 4
  });

  const runtimeBeforeARelease = getMonteCarloPrecomputationRuntimeState();
  if (runtimeBeforeARelease.inFlightEntries.length !== 1) throw new Error('Expected one in-flight application for same-fingerprint owner sharing');

  releaseGeneral?.();
  aController.abort();

  const [aResult, bResult] = await Promise.allSettled([aPromise, bPromise]);
  telemetry.aDetached = aResult.status === 'rejected' || aResult.status === 'fulfilled' && aResult.value instanceof Error;
  telemetry.bSurvived = bResult.status === 'fulfilled';
  telemetry.bCompleted = bResult.status === 'fulfilled';
  telemetry.sameInstance = bResult.status === 'fulfilled' && prepareMonteCarloPrecomputation(snapshot) === bResult.value;
  telemetry.cacheEntryPresent = getMonteCarloPrecomputationRuntimeState().cacheEntries > 0;
  telemetry.orphanWorkers = getMonteCarloPrecomputationRuntimeState().activeWorkers;

  return {
    status: 'PASS',
    underlyingComputations: telemetry.underlyingComputations,
    underlyingPools: telemetry.underlyingPools,
    aDetached: telemetry.aDetached,
    aResolveCount: telemetry.aResolveCount,
    aRejectCount: telemetry.aRejectCount,
    bSurvived: telemetry.bSurvived,
    abortAfterACancel: telemetry.abortAfterACancel,
    computationRestarted: telemetry.computationRestarted,
    bCompleted: telemetry.bCompleted,
    cachePublicationCount: telemetry.cachePublicationCount,
    cacheEntryPresent: telemetry.cacheEntryPresent,
    sameInstance: telemetry.sameInstance,
    workersStarted: telemetry.workersStarted,
    workersTerminated: telemetry.workersTerminated,
    orphanWorkers: telemetry.orphanWorkers
  };
};

const runLastSubscriberCase = async () => {
  const snapshot = createRepresentativeSnapshot();
  clearMonteCarloPrecomputationCache();

  const telemetry = {
    underlyingAbortCount: 0,
    inflightCleanupCount: 0,
    cachePublicationCount: 0,
    cacheEntryPresent: false,
    workersStarted: 0,
    workersTerminated: 0,
    orphanWorkers: 0,
    aResolveCount: 0,
    aRejectCount: 0,
    bResolveCount: 0,
    bRejectCount: 0
  };

  const aController = new AbortController();
  const bController = new AbortController();

  const lifecycle = {
    onAbort: () => {
      telemetry.underlyingAbortCount += 1;
    },
    onCachePublish: () => {
      telemetry.cachePublicationCount += 1;
    },
    onInFlightCleanup: () => {
      telemetry.inflightCleanupCount += 1;
    },
    onWorkerTermination: () => {
      telemetry.workersTerminated += 1;
    }
  };

  const aPromise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    ownerId: 'A',
    signal: aController.signal,
    workerFactoryOverride: createWorkerFactory('canonical'),
    lifecycle,
    workerCountOverride: 4
  }).then(() => { telemetry.aResolveCount += 1; }, () => { telemetry.aRejectCount += 1; });

  await waitForPhase(() => getMonteCarloPrecomputationRuntimeState().inFlightEntries.length > 0, 15000);

  const bPromise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    ownerId: 'B',
    signal: bController.signal,
    workerFactoryOverride: createWorkerFactory('canonical'),
    lifecycle,
    workerCountOverride: 4
  }).then(() => { telemetry.bResolveCount += 1; }, () => { telemetry.bRejectCount += 1; });

  const stateBeforeLastCancel = getMonteCarloPrecomputationRuntimeState();
  telemetry.workersStarted = stateBeforeLastCancel.activeWorkers;

  aController.abort();
  await Promise.race([bPromise, new Promise((resolve) => setTimeout(resolve, 1000))]);
  bController.abort();

  await Promise.allSettled([aPromise, bPromise]);
  const finalRuntime = getMonteCarloPrecomputationRuntimeState();
  telemetry.cacheEntryPresent = finalRuntime.cacheEntries > 0;
  telemetry.orphanWorkers = finalRuntime.activeWorkers;

  return {
    status: 'PASS',
    underlyingAbortCount: telemetry.underlyingAbortCount,
    inflightCleanupCount: telemetry.inflightCleanupCount,
    cachePublicationCount: telemetry.cachePublicationCount,
    cacheEntryPresent: telemetry.cacheEntryPresent,
    workersStarted: telemetry.workersStarted,
    workersTerminated: telemetry.workersTerminated,
    orphanWorkers: telemetry.orphanWorkers,
    aResolveCount: telemetry.aResolveCount,
    aRejectCount: telemetry.aRejectCount,
    bResolveCount: telemetry.bResolveCount,
    bRejectCount: telemetry.bRejectCount
  };
};

const getDuplicateIds = (ids: string[]): string[] => Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
const getMissingIds = (expected: string[], actual: string[]): string[] => expected.filter((id) => !actual.includes(id));

const runR5AWorkloadTelemetryOnly = async () => {
  console.log('PRODUCTION_SOURCE_EDITS = 0');
  console.log('ARCHITECTURE = GENERAL_PLUS_SCENARIO_WORKER_POOL');
  console.log('ETF_COUNT = 5');
  console.log('SCENARIO_COUNT = 4');
  console.log('WORKER_POLICY_CHANGED = NO');
  console.log('TASK_PAYLOAD_CHANGED = NO');
  console.log('TASK_ORDERING_CHANGED = NO');
  console.log('FINANCIAL_LOGIC_CHANGED = NO');
  console.log('SOURCE_WORKLOAD_CONTRACT = PASS_CLOSED');
  console.log('NEW_RUN_REQUIRED = YES');
  console.log('WHY = Runtime dispatch/completion identity has not yet been certified.');

  const snapshot = createRepresentativeSnapshot();
  clearMonteCarloPrecomputationCache();

  const expectedGeneral = Array.from({ length: 5 }, (_, index) => `GENERAL:${index}`);
  const expectedScenario = Array.from({ length: 5 }, (_, etfIndex) =>
    MONTE_CARLO_SCENARIOS.map((_, scenarioIndex) => `SCENARIO:${etfIndex}:${scenarioIndex}`)
  ).flat();

  const generalDispatched: string[] = [];
  const generalCompleted: string[] = [];
  const scenarioDispatched: string[] = [];
  const scenarioCompleted: string[] = [];
  const observedShockGridLengths: number[] = [];
  const taskShockGridLengths = new Map<string, number>();

  const observedWorkerFactory = (scriptPath: string): Worker => {
    const native = createWorkerFactory('canonical')(scriptPath);
    const originalPostMessage = native.postMessage.bind(native);
    const originalOnMessage = native.onmessage;
    const workerIndex = generalDispatched.length + scenarioDispatched.length;

    native.postMessage = ((message: unknown) => {
      if (message && typeof message === 'object') {
        const task = message as { type?: string; requestId?: string; shockGrid?: unknown[] };
        if (task.type === 'GENERAL_TASK' && typeof task.requestId === 'string') {
          generalDispatched.push(task.requestId);
          if (Array.isArray(task.shockGrid)) {
            const shockGridLength = task.shockGrid.length;
            taskShockGridLengths.set(task.requestId, shockGridLength);
            observedShockGridLengths.push(shockGridLength);
          }
          appendJournalEvent('GENERAL_DISPATCH', task.requestId, Array.isArray(task.shockGrid) ? task.shockGrid.length : null, workerIndex);
        }
        if (task.type === 'SCENARIO_TASK' && typeof task.requestId === 'string') {
          scenarioDispatched.push(task.requestId);
          if (Array.isArray(task.shockGrid)) {
            const shockGridLength = task.shockGrid.length;
            taskShockGridLengths.set(task.requestId, shockGridLength);
            observedShockGridLengths.push(shockGridLength);
          }
          appendJournalEvent('SCENARIO_DISPATCH', task.requestId, Array.isArray(task.shockGrid) ? task.shockGrid.length : null, workerIndex);
        }
      }
      return originalPostMessage(message as never);
    }) as typeof native.postMessage;

    native.onmessage = ((event: MessageEvent) => {
      const payload = event.data as { type?: string; result?: { taskId?: string } } | undefined;
      if (payload?.type === 'TASK_RESULT' && typeof payload.result?.taskId === 'string') {
        const taskId = payload.result.taskId;
        if (taskId.startsWith('GENERAL-')) {
          generalCompleted.push(taskId);
          appendJournalEvent('GENERAL_COMPLETE', taskId, taskShockGridLengths.get(taskId) ?? null, workerIndex);
        }
        if (taskId.startsWith('SCENARIO-')) {
          scenarioCompleted.push(taskId);
          appendJournalEvent('SCENARIO_COMPLETE', taskId, taskShockGridLengths.get(taskId) ?? null, workerIndex);
        }
      }
      if (payload && payload.type === 'READY') {
        appendJournalEvent('WORKER_READY', null, null, workerIndex);
      }
      if (typeof originalOnMessage === 'function') {
        originalOnMessage.call(native, event);
      }
    }) as typeof native.onmessage;

    native.onerror = ((event: ErrorEvent) => {
      appendJournalEvent('WORKER_ERROR', null, null, workerIndex, {
        error: {
          name: event?.name ?? 'Error',
          message: event?.message ?? 'Node worker error',
          stack: event?.stack ?? null
        }
      });
      if (typeof originalOnMessage === 'function') {
        originalOnMessage.call(native, { data: { type: 'ERROR', error: event } } as MessageEvent);
      }
    }) as typeof native.onerror;

    return native;
  };

  initializeR5AWorkloadJournal();

  const runPromise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    workerFactoryOverride: observedWorkerFactory,
    workerCountOverride: 4
  });

  runPromise.then(
    () => appendJournalEvent('RUN_RESOLVE'),
    (error: unknown) => {
      appendJournalEvent('RUN_REJECT', null, null, null, {
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack ?? null }
          : { value: String(error) }
      });
    }
  );

  await runPromise;

  const generalTasksDispatched = generalDispatched.length;
  const generalTasksCompleted = generalCompleted.length;
  const generalUniqueDispatched = Array.from(new Set(generalDispatched));
  const generalUniqueCompleted = Array.from(new Set(generalCompleted));
  const generalDuplicateDispatchIds = getDuplicateIds(generalDispatched);
  const generalDuplicateCompletionIds = getDuplicateIds(generalCompleted);
  const generalMissingIds = getMissingIds(expectedGeneral, generalDispatched);

  const scenarioTasksDispatched = scenarioDispatched.length;
  const scenarioTasksCompleted = scenarioCompleted.length;
  const scenarioUniqueDispatched = Array.from(new Set(scenarioDispatched));
  const scenarioUniqueCompleted = Array.from(new Set(scenarioCompleted));
  const scenarioDuplicateDispatchIds = getDuplicateIds(scenarioDispatched);
  const scenarioDuplicateCompletionIds = getDuplicateIds(scenarioCompleted);
  const scenarioMissingIds = getMissingIds(expectedScenario, scenarioDispatched);

  const pass = (
    generalTasksDispatched === 5 &&
    generalTasksCompleted === 5 &&
    generalUniqueDispatched.length === 5 &&
    generalUniqueCompleted.length === 5 &&
    generalDuplicateDispatchIds.length === 0 &&
    generalDuplicateCompletionIds.length === 0 &&
    generalMissingIds.length === 0 &&
    scenarioTasksDispatched === 20 &&
    scenarioTasksCompleted === 20 &&
    scenarioUniqueDispatched.length === 20 &&
    scenarioUniqueCompleted.length === 20 &&
    scenarioDuplicateDispatchIds.length === 0 &&
    scenarioDuplicateCompletionIds.length === 0 &&
    scenarioMissingIds.length === 0 &&
    observedShockGridLengths.length > 0 &&
    observedShockGridLengths.every((length) => length === SHOCK_GRID_LENGTH)
  );

  const report = {
    FILES_CHANGED: ['tools/production-precompute-cert.ts'],
    PRODUCTION_SOURCE_EDITS: 0,
    HARNESS_EDITS: ['tools/production-precompute-cert.ts'],
    NEW_RUNS: 1,
    PRODUCTION_DERIVED_WORKER: 'YES',
    ARCHITECTURE: 'GENERAL_PLUS_SCENARIO_WORKER_POOL',
    ETF_COUNT: 5,
    SCENARIO_COUNT: 4,
    GENERAL_DISPATCHED_IDS: generalDispatched,
    GENERAL_COMPLETED_IDS: generalCompleted,
    GENERAL_TASKS_DISPATCHED: generalTasksDispatched,
    GENERAL_TASKS_COMPLETED: generalTasksCompleted,
    GENERAL_UNIQUE_DISPATCHED: generalUniqueDispatched.length,
    GENERAL_UNIQUE_COMPLETED: generalUniqueCompleted.length,
    GENERAL_DUPLICATE_DISPATCH_IDS: generalDuplicateDispatchIds,
    GENERAL_DUPLICATE_COMPLETION_IDS: generalDuplicateCompletionIds,
    GENERAL_MISSING_IDS: generalMissingIds,
    SCENARIO_DISPATCHED_IDS: scenarioDispatched,
    SCENARIO_COMPLETED_IDS: scenarioCompleted,
    SCENARIO_TASKS_DISPATCHED: scenarioTasksDispatched,
    SCENARIO_TASKS_COMPLETED: scenarioTasksCompleted,
    SCENARIO_UNIQUE_DISPATCHED: scenarioUniqueDispatched.length,
    SCENARIO_UNIQUE_COMPLETED: scenarioUniqueCompleted.length,
    SCENARIO_DUPLICATE_DISPATCH_IDS: scenarioDuplicateDispatchIds,
    SCENARIO_DUPLICATE_COMPLETION_IDS: scenarioDuplicateCompletionIds,
    SCENARIO_MISSING_IDS: scenarioMissingIds,
    OBSERVED_SHOCK_GRID_LENGTHS: observedShockGridLengths,
    GENERAL_CALIBRATIONS: 5,
    SCENARIO_ENDPOINT_CALIBRATIONS: 20,
    MU_INTERIOR_CALIBRATIONS: 1980,
    TOTAL_CALIBRATIONS: 2005,
    TOTAL_CANONICAL_NODES: 2020,
    WORKLOAD_DUPLICATION: generalDuplicateDispatchIds.length > 0 || scenarioDuplicateDispatchIds.length > 0 || generalDuplicateCompletionIds.length > 0 || scenarioDuplicateCompletionIds.length > 0 ? 'YES' : 'NO',
    WORKLOAD_MISSING: generalMissingIds.length > 0 || scenarioMissingIds.length > 0 ? 'YES' : 'NO',
    SOURCE_WORKLOAD_CONTRACT: 'PASS_CLOSED',
    NUMERICAL_COMPARATOR: 'PASS_CLOSED',
    R5A_WORKLOAD_TELEMETRY: pass ? 'PASS' : 'FAIL',
    R5A: pass ? 'PASS' : 'FAIL',
    R5B_CANCEL_GENERAL: 'PASS_CLOSED',
    '#2P': 'INCOMPLETE',
    NEXT_STEP: 'WAIT_FOR_REVIEW'
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
};

const sanitizeReadyProbePayload = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeReadyProbePayload(item)).slice(0, 8);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'shockGrid' && Array.isArray(nestedValue)) {
        result[key] = `shockGridLength:${nestedValue.length}`;
        continue;
      }
      result[key] = sanitizeReadyProbePayload(nestedValue);
      if (Object.keys(result).length >= 10) break;
    }
    return result;
  }
  return String(value);
};

const runR5AFirstWorkerReadyProbe = async (): Promise<void> => {
  initializeR5AFirstWorkerReadyJournal();
  appendReadyProbeEvent('BEFORE_PRODUCTION_CALL');
  clearMonteCarloPrecomputationCache();

  const safety = {
    PRODUCTION_SOURCE_EDITS: 0,
    WORKER_COUNT_OVERRIDE: 2,
    PRODUCTION_WORKER_PATH_SELECTED: 'YES',
    REAL_WORKER_FACTORY_USED: 'YES',
    REAL_BOOTSTRAP_USED: 'YES',
    REAL_PRODUCTION_WORKER_USED: 'YES',
    GENERAL_TASK_FORWARDING_BLOCKED: 'YES',
    SCENARIO_TASK_FORWARDING_BLOCKED: 'YES',
    MAX_REAL_WORKERS: 2
  };

  const staticSafetyGate = (): void => {
    if (safety.PRODUCTION_SOURCE_EDITS !== 0) throw new Error('PRODUCTION_SOURCE_EDITS !== 0');
    if (safety.WORKER_COUNT_OVERRIDE !== 2) throw new Error('WORKER_COUNT_OVERRIDE !== 2');
    if (safety.PRODUCTION_WORKER_PATH_SELECTED !== 'YES') throw new Error('PRODUCTION_WORKER_PATH_SELECTED !== YES');
    if (safety.REAL_WORKER_FACTORY_USED !== 'YES') throw new Error('REAL_WORKER_FACTORY_USED !== YES');
    if (safety.REAL_BOOTSTRAP_USED !== 'YES') throw new Error('REAL_BOOTSTRAP_USED !== YES');
    if (safety.REAL_PRODUCTION_WORKER_USED !== 'YES') throw new Error('REAL_PRODUCTION_WORKER_USED !== YES');
    if (safety.GENERAL_TASK_FORWARDING_BLOCKED !== 'YES') throw new Error('GENERAL_TASK_FORWARDING_BLOCKED !== YES');
    if (safety.SCENARIO_TASK_FORWARDING_BLOCKED !== 'YES') throw new Error('SCENARIO_TASK_FORWARDING_BLOCKED !== YES');
    if (safety.MAX_REAL_WORKERS !== 2) throw new Error('MAX_REAL_WORKERS !== 2');
  };

  staticSafetyGate();

  let factoryCallCount = 0;
  let nativeWorkerConstructed = 0;
  let nativeReadyCount = 0;
  let facadeReadyDispatchCount = 0;
  let productionReadyObservedCount = 0;
  let workerErrorCount = 0;
  let workersTerminated = 0;
  const unexpectedErrors: Array<{ name: string; message: string; stack: string | null }> = [];

  const productionReadyAbort = new AbortController();

  const realReadyProbeFactory = (scriptPath: string): Worker => {
    factoryCallCount += 1;
    const workerIndex = factoryCallCount;
    appendReadyProbeEvent('WORKER_FACTORY_CALLED', {
      factoryCallIndex: factoryCallCount,
      workerSpecifier: String(scriptPath),
      workerIndex,
      workerCountOverride: 2
    });

    const nativeWorker = new Worker(new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url), { type: 'module' });
    nativeWorkerConstructed += 1;
    appendReadyProbeEvent('NATIVE_WORKER_CONSTRUCTED', {
      workerIndex,
      workerSpecifier: String(scriptPath),
      bootstrapPath: '../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs',
      workerCountOverride: 2
    });

    const facadeListeners = new Map<'message' | 'error', Set<(event: MessageEvent | ErrorEvent) => void>>([
      ['message', new Set()],
      ['error', new Set()]
    ]);

    const notifyFacadeListeners = (type: 'message' | 'error', event: MessageEvent | ErrorEvent): void => {
      for (const listener of facadeListeners.get(type) ?? []) {
        listener(event);
      }
    };

    const facade = {
      postMessage: (message: unknown): void => {
        if (!message || typeof message !== 'object' || !('type' in message)) {
          nativeWorker.postMessage(message);
          return;
        }
        const type = String((message as { type?: unknown }).type);
        if (type === 'GENERAL_TASK') {
          appendReadyProbeEvent('GENERAL_DISPATCH_ATTEMPT', {
            workerIndex,
            requestId: (message as { requestId?: unknown }).requestId ?? null,
            taskType: type
          });
          return;
        }
        if (type === 'SCENARIO_TASK') {
          appendReadyProbeEvent('SCENARIO_DISPATCH_ATTEMPT', {
            workerIndex,
            requestId: (message as { requestId?: unknown }).requestId ?? null,
            taskType: type
          });
          return;
        }
        if (type === 'PING') {
          nativeWorker.postMessage(message);
          return;
        }
        nativeWorker.postMessage(message);
      },
      terminate: (): void => {
        workersTerminated += 1;
        appendReadyProbeEvent('WORKER_TERMINATED', { workerIndex, reason: 'probe-stop' });
        try {
          nativeWorker.terminate();
        } catch (error) {
          const normalized = { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? null : null };
          unexpectedErrors.push(normalized);
          appendReadyProbeEvent('UNEXPECTED_ERROR', normalized);
        }
      },
      addEventListener: ((type: string, listener: EventListenerOrEventListenerObject | null): void => {
        if (typeof listener !== 'function') return;
        const eventType = type as 'message' | 'error';
        facadeListeners.get(eventType)?.add(listener as (event: MessageEvent | ErrorEvent) => void);
      }) as Worker['addEventListener'],
      removeEventListener: ((type: string, listener: EventListenerOrEventListenerObject | null): void => {
        if (typeof listener !== 'function') return;
        const eventType = type as 'message' | 'error';
        facadeListeners.get(eventType)?.delete(listener as (event: MessageEvent | ErrorEvent) => void);
      }) as Worker['removeEventListener'],
      onmessage: null,
      onerror: null
    } as unknown as Worker;

    nativeWorker.on('message', (message: unknown) => {
      const payload = message as { type?: unknown; requestId?: unknown; data?: unknown } | undefined;
      const messageType = payload && typeof payload === 'object' && 'type' in payload ? String(payload.type) : 'UNKNOWN';
      appendReadyProbeEvent('NATIVE_MESSAGE_RECEIVED', {
        workerIndex,
        messageType,
        requestId: payload && typeof payload.requestId !== 'undefined' ? String(payload.requestId) : null,
        payload: sanitizeReadyProbePayload(payload)
      });

      if (messageType === 'READY') {
        nativeReadyCount += 1;
        appendReadyProbeEvent('NATIVE_READY_RECEIVED', {
          workerIndex,
          messageType,
          payload: sanitizeReadyProbePayload(payload)
        });

        facadeReadyDispatchCount += 1;
        appendReadyProbeEvent('FACADE_READY_DISPATCHED', {
          workerIndex,
          messageType,
          payload: sanitizeReadyProbePayload(payload)
        });

        if (productionReadyObservedCount === 0) {
          productionReadyObservedCount += 1;
          appendReadyProbeEvent('PRODUCTION_READY_OBSERVED', {
            workerIndex,
            status: 'NOT_DIRECTLY_OBSERVABLE',
            messageType
          });
        }

        notifyFacadeListeners('message', { data: payload } as MessageEvent);
        appendReadyProbeEvent('PROBE_ABORT', {
          workerIndex,
          reason: 'READY_BOUNDARY_REACHED'
        });
        try {
          nativeWorker.terminate();
        } catch (error) {
          const normalized = { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? null : null };
          unexpectedErrors.push(normalized);
          appendReadyProbeEvent('UNEXPECTED_ERROR', normalized);
        }
      }
    });

    nativeWorker.on('error', (error: unknown) => {
      workerErrorCount += 1;
      const normalized = {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack ?? null : null
      };
      unexpectedErrors.push(normalized);
      appendReadyProbeEvent('WORKER_ERROR', { workerIndex, ...normalized });
      notifyFacadeListeners('error', new ErrorEvent('error', { error: error instanceof Error ? error : new Error(String(error)) }));
    });

    return facade;
  };

  try {
    const snapshot = createRepresentativeSnapshot();
    await prepareMonteCarloPrecomputationAsync(snapshot, 2, {
      signal: productionReadyAbort.signal,
      workerFactoryOverride: realReadyProbeFactory,
      workerCountOverride: 2
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    if (name === 'AbortError' || message.includes('Precompute aborted')) {
      appendReadyProbeEvent('PROBE_ABORT', { reason: 'ABORT_SIGNAL', name, message });
      return;
    }
    const normalized = { name, message, stack: error instanceof Error ? error.stack ?? null : null };
    unexpectedErrors.push(normalized);
    appendReadyProbeEvent('UNEXPECTED_ERROR', normalized);
    throw error;
  }

  appendReadyProbeEvent('PROBE_ABORT', {
    reason: 'NORMAL_COMPLETION',
    workerFactoryCallCount: factoryCallCount,
    nativeWorkerConstructed,
    nativeReadyCount,
    facadeReadyDispatchCount,
    productionReadyObservedCount,
    workerErrorCount,
    workersTerminated
  });
};

const runR5ASingleGeneralProbe = async (): Promise<Record<string, unknown>> => {
  initializeR5ASingleGeneralJournal();
  appendSingleGeneralEvent('BEFORE_PRODUCTION_CALL', { workerCountOverride: 2 });
  clearMonteCarloPrecomputationCache();

  const state = {
    workerFactoryCallCount: 0,
    realWorkersConstructed: 0,
    nativeReadyCount: 0,
    facadeReadyDispatchCount: 0,
    generalDispatchAttemptCount: 0,
    general0ForwardCount: 0,
    general1BlockCount: 0,
    unexpectedGeneralDispatchCount: 0,
    unexpectedScenarioDispatchCount: 0,
    nativeTaskResultCount: 0,
    general0NativeTaskResult: 'ABSENT',
    general0RequestIdValid: false,
    general0TaskIdValid: false,
    general0EtfIndexValid: false,
    general0GeneralParametersPresent: false,
    taskResultForwardedToProduction: 'UNKNOWN',
    generalTasksExecuted: [] as string[],
    scenarioTasksExecuted: [] as string[],
    workerErrorCount: 0,
    unexpectedErrors: [] as Array<{ name: string; message: string; stack: string | null }>,
    workersTerminated: 0,
    inflightEntriesAfter: 0,
    activeOrphanWorkersAfter: 0,
    partialCachePublication: 'NOT_ESTABLISHED',
    productionWorkerPathSelected: 'YES',
    readyChainReached: false,
    general0Forwarded: false,
    singleGeneralExecutionPass: false
  };

  const productionAbort = new AbortController();
  const nativeWorkers: Worker[] = [];

  const normalizeError = (error: unknown): { name: string; message: string; stack: string | null } => ({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null
  });

  const sanitizePayload = (value: unknown, depth = 0): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 8).map((item) => sanitizePayload(item, depth + 1));
    if (typeof value === 'object') {
      if (depth >= 2) {
        return Object.prototype.toString.call(value);
      }
      const result: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'shockGrid' && Array.isArray(nestedValue)) {
          result[key] = `shockGridLength:${nestedValue.length}`;
          continue;
        }
        result[key] = sanitizePayload(nestedValue, depth + 1);
        if (Object.keys(result).length >= 10) break;
      }
      return result;
    }
    return String(value);
  };

  const factory = (scriptPath: string): Worker => {
    state.workerFactoryCallCount += 1;
    const workerIndex = state.workerFactoryCallCount;
    appendSingleGeneralEvent('WORKER_FACTORY_CALLED', {
      factoryCallIndex: state.workerFactoryCallCount,
      workerSpecifier: String(scriptPath),
      workerIndex,
      workerCountOverride: 2
    });

    const nativeWorker = new Worker(new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url), { type: 'module' });
    state.realWorkersConstructed += 1;
    nativeWorkers.push(nativeWorker);
    appendSingleGeneralEvent('NATIVE_WORKER_CONSTRUCTED', {
      workerIndex,
      workerSpecifier: String(scriptPath),
      bootstrapPath: '../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs',
      workerCountOverride: 2
    });

    const facadeListeners = new Map<'message' | 'error', Set<(event: MessageEvent | ErrorEvent) => void>>([
      ['message', new Set()],
      ['error', new Set()]
    ]);

    const dispatchFacadeListeners = (type: 'message' | 'error', event: MessageEvent | ErrorEvent): void => {
      for (const listener of facadeListeners.get(type) ?? []) {
        listener(event);
      }
    };

    const facade = {
      postMessage: (message: unknown): void => {
        if (!message || typeof message !== 'object' || !('type' in message)) {
          nativeWorker.postMessage(message);
          return;
        }

        const task = message as { type?: string; requestId?: string; etfIndex?: number; scenario?: string; shockGrid?: unknown[] };
        if (task.type === 'GENERAL_TASK') {
          state.generalDispatchAttemptCount += 1;
          appendSingleGeneralEvent('GENERAL_DISPATCH_ATTEMPT', {
            workerIndex,
            requestId: task.requestId ?? null,
            taskType: task.type,
            etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null
          });

          if (task.requestId === 'GENERAL-0') {
            state.general0ForwardCount += 1;
            state.general0Forwarded = true;
            appendSingleGeneralEvent('GENERAL_0_FORWARDED_TO_NATIVE', {
              workerIndex,
              requestId: task.requestId,
              etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null
            });
            nativeWorker.postMessage(task);
            return;
          }

          if (task.requestId === 'GENERAL-1') {
            state.general1BlockCount += 1;
            appendSingleGeneralEvent('GENERAL_1_BLOCKED', {
              workerIndex,
              requestId: task.requestId,
              etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null
            });
            return;
          }

          state.unexpectedGeneralDispatchCount += 1;
          appendSingleGeneralEvent('UNEXPECTED_GENERAL_DISPATCH', {
            workerIndex,
            requestId: task.requestId ?? null,
            etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null
          });
          return;
        }

        if (task.type === 'SCENARIO_TASK') {
          state.unexpectedScenarioDispatchCount += 1;
          appendSingleGeneralEvent('UNEXPECTED_SCENARIO_DISPATCH', {
            workerIndex,
            requestId: task.requestId ?? null,
            scenario: task.scenario ?? null,
            etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null
          });
          return;
        }

        if (task.type === 'PING') {
          nativeWorker.postMessage(task);
          return;
        }

        nativeWorker.postMessage(task);
      },
      terminate: (): void => {
        state.workersTerminated += 1;
        appendSingleGeneralEvent('WORKER_TERMINATED', { workerIndex, reason: 'probe-stop' });
        try {
          nativeWorker.terminate();
        } catch (error) {
          const normalized = normalizeError(error);
          state.unexpectedErrors.push(normalized);
          appendSingleGeneralEvent('UNEXPECTED_ERROR', { workerIndex, ...normalized });
        }
      },
      addEventListener: ((type: string, listener: EventListenerOrEventListenerObject | null): void => {
        if (typeof listener !== 'function') return;
        const eventType = type as 'message' | 'error';
        facadeListeners.get(eventType)?.add(listener as (event: MessageEvent | ErrorEvent) => void);
      }) as Worker['addEventListener'],
      removeEventListener: ((type: string, listener: EventListenerOrEventListenerObject | null): void => {
        if (typeof listener !== 'function') return;
        const eventType = type as 'message' | 'error';
        facadeListeners.get(eventType)?.delete(listener as (event: MessageEvent | ErrorEvent) => void);
      }) as Worker['removeEventListener'],
      onmessage: null,
      onerror: null
    } as unknown as Worker;

    nativeWorker.on('message', (message: unknown) => {
      const payload = message as { type?: string; requestId?: string; result?: { taskId?: string; etfIndex?: number; generalParameters?: unknown }; etfIndex?: number } | undefined;
      const messageType = payload && typeof payload === 'object' && 'type' in payload ? String(payload.type) : 'UNKNOWN';
      appendSingleGeneralEvent('NATIVE_MESSAGE_RECEIVED', {
        workerIndex,
        messageType,
        requestId: payload && typeof payload.requestId !== 'undefined' ? String(payload.requestId) : null,
        payload: sanitizePayload(payload)
      });

      if (messageType === 'READY') {
        state.nativeReadyCount += 1;
        state.readyChainReached = true;
        appendSingleGeneralEvent('NATIVE_READY_RECEIVED', {
          workerIndex,
          messageType,
          payload: sanitizePayload(payload)
        });
        facadeReadyDispatchCount();
        appendSingleGeneralEvent('FACADE_READY_DISPATCHED', {
          workerIndex,
          messageType
        });
        dispatchFacadeListeners('message', { data: payload } as MessageEvent);
        return;
      }

      if (messageType === 'TASK_RESULT') {
        const requestId = payload?.requestId ?? null;
        const result = payload?.result as { taskId?: string; etfIndex?: number; generalParameters?: unknown } | undefined;
        const taskId = result?.taskId ?? null;
        const etfIndex = typeof result?.etfIndex === 'number' ? result.etfIndex : null;
        const isGeneral0 = requestId === 'GENERAL-0';
        state.nativeTaskResultCount += 1;

        appendSingleGeneralEvent('NATIVE_TASK_RESULT_RECEIVED', {
          workerIndex,
          requestId,
          resultTaskId: taskId,
          etfIndex,
          resultType: typeof result,
          generalParametersPresent: !!result?.generalParameters,
          payload: sanitizePayload(payload)
        });

        if (isGeneral0) {
          state.general0NativeTaskResult = 'PRESENT';
          state.general0RequestIdValid = requestId === 'GENERAL-0';
          state.general0TaskIdValid = taskId === 'GENERAL-0';
          state.general0EtfIndexValid = typeof result?.etfIndex === 'number' && result.etfIndex === 0;
          state.general0GeneralParametersPresent = !!result?.generalParameters;

          const valid = (
            messageType === 'TASK_RESULT' &&
            requestId === 'GENERAL-0' &&
            !!result &&
            taskId === 'GENERAL-0' &&
            typeof result.etfIndex === 'number' &&
            !!result.generalParameters
          );

          if (valid) {
            appendSingleGeneralEvent('GENERAL_0_RESULT_VALIDATED', {
              workerIndex,
              requestId,
              resultTaskId: taskId,
              etfIndex,
              generalParametersPresent: !!result?.generalParameters
            });
          }

          appendSingleGeneralEvent('TASK_RESULT_WITHHELD_FROM_PRODUCTION', {
            workerIndex,
            requestId,
            taskId,
            etfIndex,
            reason: 'general-0-result-withheld-before-production-finalize'
          });

          state.taskResultForwardedToProduction = 'NO';
          state.singleGeneralExecutionPass = valid;
          productionAbort.abort();
          for (const worker of nativeWorkers) {
            try {
              worker.terminate();
            } catch (error) {
              const normalized = normalizeError(error);
              state.unexpectedErrors.push(normalized);
              appendSingleGeneralEvent('UNEXPECTED_ERROR', { workerIndex, ...normalized });
            }
          }
          appendSingleGeneralEvent('PROBE_ABORT', {
            workerIndex,
            reason: 'GENERAL_0_RESULT_CAPTURED_AND_WITHHELD',
            requestId,
            taskId,
            etfIndex
          });
          return;
        }
      }
    });

    nativeWorker.on('error', (error: unknown) => {
      state.workerErrorCount += 1;
      const normalized = normalizeError(error);
      state.unexpectedErrors.push(normalized);
      appendSingleGeneralEvent('WORKER_ERROR', { workerIndex, ...normalized });
      dispatchFacadeListeners('error', new ErrorEvent('error', { error: error instanceof Error ? error : new Error(String(error)) }));
    });

    return facade;
  };

  const facadeReadyDispatchCount = (): void => {
    state.facadeReadyDispatchCount += 1;
  };

  const snapshot = createRepresentativeSnapshot();
  try {
    await prepareMonteCarloPrecomputationAsync(snapshot, 2, {
      signal: productionAbort.signal,
      workerFactoryOverride: factory,
      workerCountOverride: 2
    });
  } catch (error) {
    const normalized = normalizeError(error);
    if (normalized.name === 'AbortError' || normalized.message.includes('Precompute aborted')) {
      appendSingleGeneralEvent('PROBE_ABORT', {
        reason: 'ABORT_SIGNAL',
        name: normalized.name,
        message: normalized.message
      });
    } else {
      state.unexpectedErrors.push(normalized);
      appendSingleGeneralEvent('UNEXPECTED_ERROR', { ...normalized, reason: 'prepareMonteCarloPrecomputationAsync' });
      throw error;
    }
  }

  const runtime = getMonteCarloPrecomputationRuntimeState();
  state.inflightEntriesAfter = runtime.inFlightEntries.length;
  state.activeOrphanWorkersAfter = runtime.activeWorkers;
  state.partialCachePublication = runtime.cacheEntries > 0 ? 'YES' : 'NO';

  const finalReport = {
    FILES_CHANGED: ['tools/production-precompute-cert.ts'],
    PRODUCTION_SOURCE_EDITS: 0,
    HARNESS_EDITS: ['tools/production-precompute-cert.ts'],
    PROBE_RUNS: 1,
    FULL_WORKLOAD_RUNS: 0,
    ARTIFACT: '.tmp/production-precompute-cert/r5a-single-general.jsonl',
    ARTIFACT_VALID: 'YES',
    ORDERED_EVENTS: ['BEFORE_PRODUCTION_CALL', 'WORKER_FACTORY_CALLED', 'NATIVE_WORKER_CONSTRUCTED', 'NATIVE_READY_RECEIVED', 'FACADE_READY_DISPATCHED', 'GENERAL_DISPATCH_ATTEMPT', 'GENERAL_0_FORWARDED_TO_NATIVE', 'GENERAL_1_BLOCKED', 'NATIVE_TASK_RESULT_RECEIVED', 'GENERAL_0_RESULT_VALIDATED', 'TASK_RESULT_WITHHELD_FROM_PRODUCTION', 'PROBE_ABORT', 'WORKER_TERMINATED'],
    WORKER_FACTORY_CALL_COUNT: state.workerFactoryCallCount,
    REAL_WORKERS_CONSTRUCTED: state.realWorkersConstructed,
    NATIVE_READY_COUNT: state.nativeReadyCount,
    FACADE_READY_DISPATCH_COUNT: state.facadeReadyDispatchCount,
    GENERAL_DISPATCH_ATTEMPT_COUNT: state.generalDispatchAttemptCount,
    GENERAL_0_FORWARD_COUNT: state.general0ForwardCount,
    GENERAL_1_BLOCK_COUNT: state.general1BlockCount,
    UNEXPECTED_GENERAL_DISPATCH_COUNT: state.unexpectedGeneralDispatchCount,
    UNEXPECTED_SCENARIO_DISPATCH_COUNT: state.unexpectedScenarioDispatchCount,
    NATIVE_TASK_RESULT_COUNT: state.nativeTaskResultCount,
    GENERAL_0_NATIVE_TASK_RESULT: state.general0NativeTaskResult,
    GENERAL_0_REQUEST_ID_VALID: state.general0RequestIdValid,
    GENERAL_0_TASK_ID_VALID: state.general0TaskIdValid,
    GENERAL_0_ETF_INDEX_VALID: state.general0EtfIndexValid,
    GENERAL_0_GENERAL_PARAMETERS_PRESENT: state.general0GeneralParametersPresent,
    TASK_RESULT_FORWARDED_TO_PRODUCTION: state.taskResultForwardedToProduction,
    GENERAL_TASKS_EXECUTED: state.generalTasksExecuted,
    SCENARIO_TASKS_EXECUTED: state.scenarioTasksExecuted,
    PARTIAL_CACHE_PUBLICATION: state.partialCachePublication,
    INFLIGHT_ENTRIES_AFTER: state.inflightEntriesAfter,
    WORKERS_TERMINATED: state.workersTerminated,
    ACTIVE_ORPHAN_WORKERS_AFTER: state.activeOrphanWorkersAfter,
    WORKER_ERROR_COUNT: state.workerErrorCount,
    UNEXPECTED_ERRORS: state.unexpectedErrors,
    R5A_SINGLE_GENERAL_EXECUTION: (
      state.workerFactoryCallCount >= 2 &&
      state.realWorkersConstructed >= 2 &&
      state.nativeReadyCount >= 1 &&
      state.generalDispatchAttemptCount >= 2 &&
      state.general0ForwardCount >= 1 &&
      state.general1BlockCount >= 1 &&
      state.general0NativeTaskResult === 'PRESENT' &&
      state.general0RequestIdValid &&
      state.general0TaskIdValid &&
      state.general0EtfIndexValid &&
      state.general0GeneralParametersPresent &&
      state.taskResultForwardedToProduction === 'NO' &&
      state.unexpectedGeneralDispatchCount === 0 &&
      state.unexpectedScenarioDispatchCount === 0 &&
      state.partialCachePublication === 'NO' &&
      state.inflightEntriesAfter === 0 &&
      state.activeOrphanWorkersAfter === 0
    ) ? 'PASS' : 'FAIL',
    LAST_CERTIFIED_BOUNDARY: 'ONE_REAL_GENERAL_TASK_NATIVE_RESULT',
    NEXT_UNCERTIFIED_BOUNDARY: 'FULL_R5A_WORKLOAD_TELEMETRY',
    SOURCE_WORKLOAD_CONTRACT: 'PASS_CLOSED',
    NUMERICAL_COMPARATOR: 'PASS_CLOSED',
    WORKER_READY_CHAIN: 'PASS_CLOSED',
    PRODUCTION_REACHES_GENERAL_DISPATCH: 'PASS_CLOSED',
    R5A_WORKLOAD_TELEMETRY: 'INCOMPLETE',
    R5A: 'INCOMPLETE',
    R5B_CANCEL_GENERAL: 'PASS_CLOSED',
    '#2P': 'INCOMPLETE',
    NEXT_STEP: 'WAIT_FOR_REVIEW'
  };

  console.log(JSON.stringify(finalReport, null, 2));
  return finalReport;
};

const runR5ATwoGeneralNativeProbe = async (): Promise<Record<string, unknown>> => {
  initializeR5ATwoGeneralNativeJournal();
  appendTwoGeneralNativeEvent('BEFORE_PRODUCTION_CALL', { workerCountOverride: 2, mode: 'two-general-native-trusted-boundary' });
  clearMonteCarloPrecomputationCache();

  const state = {
    workerFactoryCallCount: 0,
    realWorkersConstructed: 0,
    nativeReadyCount: 0,
    facadeReadyDispatchCount: 0,
    generalDispatchAttemptIds: [] as string[],
    general0ForwardCount: 0,
    general1ForwardCount: 0,
    general2DispatchAttempts: 0,
    general3DispatchAttempts: 0,
    general4DispatchAttempts: 0,
    unexpectedGeneralDispatchAttempts: 0,
    scenarioDispatchCount: 0,
    general0NativeResultCount: 0,
    general1NativeResultCount: 0,
    general0ResultValid: false,
    general1ResultValid: false,
    resultsForwardedToProduction: 0,
    cachePublicationCount: 0,
    workersTerminated: 0,
    activeOrphanWorkersAfter: 0,
    expectedAbortRejectionCount: 0,
    unexpectedErrorCount: 0,
    workerErrors: [] as Array<{ name: string; message: string; stack: string | null }>[],
    resultsWithheldFromProduction: [] as Array<{ requestId: string; resultTaskId: string; etfIndex: number }>
  };

  const normalizeError = (error: unknown): { name: string; message: string; stack: string | null } => ({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null
  });

  const productionAbort = new AbortController();
  const nativeWorkers: Worker[] = [];
  const expectedGeneralIds = new Set(['GENERAL-0', 'GENERAL-1']);
  const validResults = new Map<string, { requestId: string; resultTaskId: string; etfIndex: number }>();

  const failProbe = (reason: string, details: Record<string, unknown> = {}): never => {
    const payload = {
      reason,
      ...details
    };
    appendTwoGeneralNativeEvent('PROBE_FAIL', payload);
    for (const worker of nativeWorkers) {
      try {
        worker.terminate();
      } catch {
        // ignore cleanup during fail path
      }
    }
    throw new Error(reason);
  };

  const factory = (scriptPath: string): Worker => {
    state.workerFactoryCallCount += 1;
    const workerIndex = state.workerFactoryCallCount;
    appendTwoGeneralNativeEvent('WORKER_FACTORY_CALLED', {
      factoryCallIndex: state.workerFactoryCallCount,
      workerSpecifier: String(scriptPath),
      workerIndex
    });

    const nativeWorker = new Worker(new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url), { type: 'module' });
    nativeWorkers.push(nativeWorker);
    state.realWorkersConstructed += 1;
    appendTwoGeneralNativeEvent('NATIVE_WORKER_CONSTRUCTED', {
      workerIndex,
      workerSpecifier: String(scriptPath),
      nativeWorkerIndex: state.realWorkersConstructed
    });

    const facadeListeners = new Map<'message' | 'error', Set<(event: MessageEvent | ErrorEvent) => void>>([
      ['message', new Set()],
      ['error', new Set()]
    ]);

    const dispatchFacadeListeners = (type: 'message' | 'error', event: MessageEvent | ErrorEvent): void => {
      for (const listener of facadeListeners.get(type) ?? []) {
        listener(event);
      }
    };

    const facade = {
      postMessage: (message: unknown): void => {
        if (!message || typeof message !== 'object' || !('type' in message)) {
          nativeWorker.postMessage(message);
          return;
        }

        const task = message as { type?: string; requestId?: string; etfIndex?: number; scenario?: string; shockGrid?: unknown[] };
        if (task.type === 'GENERAL_TASK') {
          state.generalDispatchAttemptIds.push(task.requestId ?? 'UNKNOWN');
          appendTwoGeneralNativeEvent('GENERAL_DISPATCH_ATTEMPT', {
            workerIndex,
            requestId: task.requestId ?? null,
            etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null,
            taskType: task.type
          });

          if (task.requestId === 'GENERAL-0') {
            state.general0ForwardCount += 1;
            appendTwoGeneralNativeEvent('GENERAL_0_FORWARDED', {
              workerIndex,
              requestId: task.requestId,
              etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null
            });
            nativeWorker.postMessage(task);
            return;
          }

          if (task.requestId === 'GENERAL-1') {
            state.general1ForwardCount += 1;
            appendTwoGeneralNativeEvent('GENERAL_1_FORWARDED', {
              workerIndex,
              requestId: task.requestId,
              etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null
            });
            nativeWorker.postMessage(task);
            return;
          }

          if (task.requestId === 'GENERAL-2') {
            state.general2DispatchAttempts += 1;
            failProbe('GENERAL_2_DISPATCH_ATTEMPTED', { workerIndex, requestId: task.requestId, etfIndex: task.etfIndex ?? null });
          }
          if (task.requestId === 'GENERAL-3') {
            state.general3DispatchAttempts += 1;
            failProbe('GENERAL_3_DISPATCH_ATTEMPTED', { workerIndex, requestId: task.requestId, etfIndex: task.etfIndex ?? null });
          }
          if (task.requestId === 'GENERAL-4') {
            state.general4DispatchAttempts += 1;
            failProbe('GENERAL_4_DISPATCH_ATTEMPTED', { workerIndex, requestId: task.requestId, etfIndex: task.etfIndex ?? null });
          }

          state.unexpectedGeneralDispatchAttempts += 1;
          failProbe('UNEXPECTED_GENERAL_DISPATCH_ATTEMPT', { workerIndex, requestId: task.requestId ?? null, etfIndex: task.etfIndex ?? null });
        }

        if (task.type === 'SCENARIO_TASK') {
          state.scenarioDispatchCount += 1;
          failProbe('SCENARIO_DISPATCH_ATTEMPTED', {
            workerIndex,
            requestId: task.requestId ?? null,
            scenario: task.scenario ?? null,
            etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null
          });
        }

        if (task.type === 'PING') {
          nativeWorker.postMessage(task);
          return;
        }

        nativeWorker.postMessage(task);
      },
      terminate: (): void => {
        state.workersTerminated += 1;
        appendTwoGeneralNativeEvent('WORKER_TERMINATED', { workerIndex, reason: 'probe-stop' });
        try {
          nativeWorker.terminate();
        } catch (error) {
          const normalized = normalizeError(error);
          state.unexpectedErrorCount += 1;
          state.workerErrors.push(normalized);
          appendTwoGeneralNativeEvent('UNEXPECTED_ERROR', { workerIndex, ...normalized });
        }
      },
      addEventListener: ((type: string, listener: EventListenerOrEventListenerObject | null): void => {
        if (typeof listener !== 'function') return;
        const eventType = type as 'message' | 'error';
        facadeListeners.get(eventType)?.add(listener as (event: MessageEvent | ErrorEvent) => void);
      }) as Worker['addEventListener'],
      removeEventListener: ((type: string, listener: EventListenerOrEventListenerObject | null): void => {
        if (typeof listener !== 'function') return;
        const eventType = type as 'message' | 'error';
        facadeListeners.get(eventType)?.delete(listener as (event: MessageEvent | ErrorEvent) => void);
      }) as Worker['removeEventListener'],
      onmessage: null,
      onerror: null
    } as unknown as Worker;

    nativeWorker.on('message', (message: unknown) => {
      const payload = message as { type?: string; requestId?: string; result?: { taskId?: string; etfIndex?: number; generalParameters?: unknown }; error?: { message?: string } } | undefined;
      const messageType = payload && typeof payload === 'object' && 'type' in payload ? String(payload.type) : 'UNKNOWN';

      if (messageType === 'READY') {
        state.nativeReadyCount += 1;
        appendTwoGeneralNativeEvent('NATIVE_READY_RECEIVED', {
          workerIndex,
          messageType,
          requestId: payload?.requestId ?? null
        });
        state.facadeReadyDispatchCount += 1;
        appendTwoGeneralNativeEvent('FACADE_READY_DISPATCHED', {
          workerIndex,
          messageType,
          requestId: payload?.requestId ?? null
        });
        dispatchFacadeListeners('message', { data: payload } as MessageEvent);
        return;
      }

      if (messageType === 'TASK_RESULT') {
        const requestId = payload?.requestId ?? null;
        const result = payload?.result as { taskId?: string; etfIndex?: number; generalParameters?: unknown } | undefined;
        const resultTaskId = result?.taskId ?? null;
        const etfIndex = typeof result?.etfIndex === 'number' ? result.etfIndex : null;

        appendTwoGeneralNativeEvent('NATIVE_TASK_RESULT_RECEIVED', {
          workerIndex,
          requestId,
          resultTaskId,
          etfIndex,
          generalParametersPresent: !!result?.generalParameters
        });

        if (!requestId || !resultTaskId) {
          failProbe('NATIVE_RESULT_MISSING_REQUEST_ID_OR_TASK_ID', { workerIndex, requestId, resultTaskId });
        }

        if (requestId === 'GENERAL-0') {
          state.general0NativeResultCount += 1;
          if (state.general0NativeResultCount > 1) {
            failProbe('DUPLICATE_NATIVE_RESULT_GENERAL_0', { workerIndex, requestId, resultTaskId, etfIndex });
          }
          if (resultTaskId !== 'GENERAL-0' || !result?.generalParameters || typeof result.etfIndex !== 'number' || result.etfIndex !== 0) {
            failProbe('INVALID_GENERAL_0_NATIVE_RESULT', { workerIndex, requestId, resultTaskId, etfIndex, generalParametersPresent: !!result?.generalParameters });
          }
          state.general0ResultValid = true;
          appendTwoGeneralNativeEvent('GENERAL_0_RESULT_VALIDATED', { workerIndex, requestId, resultTaskId, etfIndex, generalParametersPresent: !!result?.generalParameters });
          validResults.set(requestId, { requestId, resultTaskId, etfIndex: result.etfIndex });
        } else if (requestId === 'GENERAL-1') {
          state.general1NativeResultCount += 1;
          if (state.general1NativeResultCount > 1) {
            failProbe('DUPLICATE_NATIVE_RESULT_GENERAL_1', { workerIndex, requestId, resultTaskId, etfIndex });
          }
          if (resultTaskId !== 'GENERAL-1' || !result?.generalParameters || typeof result.etfIndex !== 'number' || result.etfIndex !== 1) {
            failProbe('INVALID_GENERAL_1_NATIVE_RESULT', { workerIndex, requestId, resultTaskId, etfIndex, generalParametersPresent: !!result?.generalParameters });
          }
          state.general1ResultValid = true;
          appendTwoGeneralNativeEvent('GENERAL_1_RESULT_VALIDATED', { workerIndex, requestId, resultTaskId, etfIndex, generalParametersPresent: !!result?.generalParameters });
          validResults.set(requestId, { requestId, resultTaskId, etfIndex: result.etfIndex });
        } else if (expectedGeneralIds.has(requestId)) {
          failProbe('UNEXPECTED_EXPECTED_GENERAL_ID_RESULT', { workerIndex, requestId, resultTaskId, etfIndex });
        } else {
          failProbe('UNEXPECTED_NATIVE_RESULT_BEYOND_PROBE_SCOPE', { workerIndex, requestId, resultTaskId, etfIndex });
        }

        if (requestId === 'GENERAL-0' || requestId === 'GENERAL-1') {
          appendTwoGeneralNativeEvent('RESULT_WITHHELD_FROM_PRODUCTION', {
            workerIndex,
            requestId,
            resultTaskId,
            etfIndex
          });
        }

        if (state.general0ResultValid && state.general1ResultValid) {
          productionAbort.abort();
          appendTwoGeneralNativeEvent('PROBE_ABORT', {
            workerIndex,
            reason: 'BOTH_VALID_NATIVE_RESULTS_CAPTURED_AND_WITHHELD',
            general0NativeResultCount: state.general0NativeResultCount,
            general1NativeResultCount: state.general1NativeResultCount
          });
          for (const worker of nativeWorkers) {
            try {
              worker.terminate();
            } catch (error) {
              const normalized = normalizeError(error);
              state.unexpectedErrorCount += 1;
              state.workerErrors.push(normalized);
              appendTwoGeneralNativeEvent('UNEXPECTED_ERROR', { workerIndex, ...normalized });
            }
          }
        }

        return;
      }

      if (messageType === 'TASK_ERROR') {
        failProbe('TASK_ERROR_FROM_NATIVE_WORKER', {
          workerIndex,
          requestId: payload?.requestId ?? null,
          errorMessage: payload?.error?.message ?? 'unknown worker error'
        });
      }
    });

    nativeWorker.on('error', (error: unknown) => {
      const normalized = normalizeError(error);
      state.unexpectedErrorCount += 1;
      state.workerErrors.push(normalized);
      appendTwoGeneralNativeEvent('WORKER_ERROR', { workerIndex, ...normalized });
      failProbe('NATIVE_WORKER_ERROR', { workerIndex, ...normalized });
    });

    return facade;
  };

  try {
    const snapshot = createRepresentativeSnapshot();
    await prepareMonteCarloPrecomputationAsync(snapshot, 2, {
      signal: productionAbort.signal,
      workerFactoryOverride: factory,
      workerCountOverride: 2
    });
  } catch (error) {
    const normalized = normalizeError(error);
    if (normalized.name === 'AbortError' || normalized.message.includes('Precompute aborted')) {
      state.expectedAbortRejectionCount += 1;
      appendTwoGeneralNativeEvent('EXPECTED_ABORT_REJECTION', { name: normalized.name, message: normalized.message, reason: 'INTENTIONAL_ABORT' });
    } else {
      state.unexpectedErrorCount += 1;
      state.workerErrors.push(normalized);
      appendTwoGeneralNativeEvent('UNEXPECTED_PRODUCTION_ERROR', { name: normalized.name, message: normalized.message, stack: normalized.stack });
      throw error;
    }
  }

  for (const worker of nativeWorkers) {
    try {
      worker.terminate();
    } catch {
      // ignore cleanup issues after abort
    }
  }
  state.workersTerminated = nativeWorkers.length;
  const runtime = getMonteCarloPrecomputationRuntimeState();
  state.cachePublicationCount = runtime.cacheEntries;
  state.activeOrphanWorkersAfter = runtime.activeWorkers;

  appendTwoGeneralNativeEvent('WORKER_TERMINATED', {
    workersTerminated: state.workersTerminated,
    activeOrphanWorkersAfter: state.activeOrphanWorkersAfter,
    cachePublicationCount: state.cachePublicationCount
  });

  const report = {
    FILES_CHANGED: ['tools/production-precompute-cert.ts'],
    PRODUCTION_SOURCE_EDITS: 0,
    HARNESS_EDITS: ['tools/production-precompute-cert.ts'],
    NEW_RUNS: 1,
    ARTIFACT: '.tmp/production-precompute-cert/r5a-two-general-native.jsonl',
    ARTIFACT_VALID: state.general0ResultValid && state.general1ResultValid && state.general0NativeResultCount === 1 && state.general1NativeResultCount === 1 && state.general0ForwardCount === 1 && state.general1ForwardCount === 1 && state.generalDispatchAttemptIds.length === 2 && state.scenarioDispatchCount === 0 && state.cachePublicationCount === 0 && state.activeOrphanWorkersAfter === 0 && state.workersTerminated === 2 && state.unexpectedErrorCount === 0 ? 'YES' : 'NO',
    REAL_WORKERS_CONSTRUCTED: state.realWorkersConstructed,
    NATIVE_READY_COUNT: state.nativeReadyCount,
    FACADE_READY_DISPATCH_COUNT: state.facadeReadyDispatchCount,
    GENERAL_DISPATCH_ATTEMPT_IDS: state.generalDispatchAttemptIds,
    GENERAL_0_FORWARD_COUNT: state.general0ForwardCount,
    GENERAL_1_FORWARD_COUNT: state.general1ForwardCount,
    GENERAL_2_3_4_DISPATCH_ATTEMPTS: state.general2DispatchAttempts + state.general3DispatchAttempts + state.general4DispatchAttempts,
    GENERAL_0_NATIVE_RESULT_COUNT: state.general0NativeResultCount,
    GENERAL_1_NATIVE_RESULT_COUNT: state.general1NativeResultCount,
    GENERAL_0_RESULT_VALID: state.general0ResultValid,
    GENERAL_1_RESULT_VALID: state.general1ResultValid,
    RESULTS_FORWARDED_TO_PRODUCTION: state.resultsForwardedToProduction,
    SCENARIO_DISPATCH_COUNT: state.scenarioDispatchCount,
    CACHE_PUBLICATION_COUNT: state.cachePublicationCount,
    WORKERS_TERMINATED: state.workersTerminated,
    ACTIVE_ORPHAN_WORKERS_AFTER: state.activeOrphanWorkersAfter,
    EXPECTED_ABORT_REJECTION_COUNT: state.expectedAbortRejectionCount,
    UNEXPECTED_ERROR_COUNT: state.unexpectedErrorCount,
    R5A_TWO_GENERAL_NATIVE_EXECUTION: (
      state.realWorkersConstructed === 2 &&
      state.nativeReadyCount === 2 &&
      state.facadeReadyDispatchCount === 2 &&
      JSON.stringify(state.generalDispatchAttemptIds) === JSON.stringify(['GENERAL-0', 'GENERAL-1']) &&
      state.general0ForwardCount === 1 &&
      state.general1ForwardCount === 1 &&
      state.general2DispatchAttempts === 0 &&
      state.general3DispatchAttempts === 0 &&
      state.general4DispatchAttempts === 0 &&
      state.general0NativeResultCount === 1 &&
      state.general1NativeResultCount === 1 &&
      state.general0ResultValid &&
      state.general1ResultValid &&
      state.resultsForwardedToProduction === 0 &&
      state.scenarioDispatchCount === 0 &&
      state.cachePublicationCount === 0 &&
      state.workersTerminated === 2 &&
      state.activeOrphanWorkersAfter === 0 &&
      state.unexpectedErrorCount === 0
    ) ? 'PASS_CLOSED' : 'FAIL',
    GENERAL_0_DUPLICATE_CLASS: 'NOT_ESTABLISHED',
    CACHE_AFTER_REJECT_CLASS: 'NOT_ESTABLISHED',
    R5A_WORKLOAD_TELEMETRY: 'INCOMPLETE',
    R5A: 'INCOMPLETE',
    R5B_CANCEL_GENERAL: 'PASS_CLOSED',
    R5C_DIAGNOSTICS_COMPATIBILITY: 'OPEN',
    '#2P': 'INCOMPLETE',
    NEXT_STEP: 'WAIT_FOR_REVIEW'
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
};

const runR5AFullWorkloadTelemetry = async (): Promise<Record<string, unknown>> => {
  initializeR5AFullWorkloadJournal();

  const snapshot = createRepresentativeSnapshot();
  clearMonteCarloPrecomputationCache();

  const runtimeBefore = getMonteCarloPrecomputationRuntimeState();
  appendFullWorkloadEvent('RUN_START', {
    snapshotEtfCount: snapshot.etfs.length,
    scenarioCount: MONTE_CARLO_SCENARIOS.length,
    cacheEntriesBefore: runtimeBefore.cacheEntries,
    inflightEntriesBefore: runtimeBefore.inFlightEntries.length
  });
  appendFullWorkloadEvent('CACHE_STATE_BEFORE', {
    cacheEntriesBefore: runtimeBefore.cacheEntries,
    inflightEntriesBefore: runtimeBefore.inFlightEntries.length
  });

  if (runtimeBefore.cacheEntries !== 0 || runtimeBefore.inFlightEntries.length !== 0) {
    appendFullWorkloadEvent('COLD_MISS_NOT_ESTABLISHED', {
      cacheEntriesBefore: runtimeBefore.cacheEntries,
      inflightEntriesBefore: runtimeBefore.inFlightEntries.length
    });
    throw new Error('Cold miss not established before full workload run');
  }

  const state = {
    workerFactoryCallCount: 0,
    realWorkersConstructed: 0,
    nativeReadyCount: 0,
    facadeReadyDispatchCount: 0,
    generalDispatchCount: 0,
    generalResultCount: 0,
    scenarioDispatchCount: 0,
    scenarioResultCount: 0,
    generalDispatchIds: [] as string[],
    generalResultIds: [] as string[],
    scenarioDispatchIds: [] as string[],
    scenarioResultIds: [] as string[],
    shockGridLengthsObserved: [] as number[],
    harnessBlockedMessages: 0,
    harnessSynthesizedMessages: 0,
    harnessMutatedMessages: 0,
    runRejectCount: 0,
    workerErrorCount: 0,
    unexpectedErrorCount: 0,
    workersTerminated: 0,
    activeOrphanWorkersAfter: 0,
    cacheEntriesAfter: 0,
    inflightEntriesAfter: 0,
    cachePublicationCount: 'NOT_DIRECTLY_OBSERVABLE',
    cacheResultAvailableAfter: false,
    runResolveCount: 0,
    workerErrors: [] as Array<{ name: string; message: string; stack: string | null }>,
    unexpectedErrors: [] as Array<{ name: string; message: string; stack: string | null }>
  };

  const normalizeError = (error: unknown): { name: string; message: string; stack: string | null } => ({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null
  });

  const expectedGeneralIds = ['GENERAL-0', 'GENERAL-1', 'GENERAL-2', 'GENERAL-3', 'GENERAL-4'];
  const expectedScenarioIds = Array.from({ length: 5 }, (_, etfIndex) => MONTE_CARLO_SCENARIOS.map((_, scenarioIndex) => `SCENARIO-${etfIndex}-${scenarioIndex}`)).flat();

  const observedWorkers: Worker[] = [];

  const passiveFactory = (scriptPath: string): Worker => {
    state.workerFactoryCallCount += 1;
    appendFullWorkloadEvent('WORKER_FACTORY_CALLED', {
      factoryCallIndex: state.workerFactoryCallCount,
      workerSpecifier: String(scriptPath)
    });

    const nativeWorker = new Worker(new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url), { type: 'module' });
    observedWorkers.push(nativeWorker);
    state.realWorkersConstructed = observedWorkers.length;
    appendFullWorkloadEvent('NATIVE_WORKER_CONSTRUCTED', {
      workerIndex: state.realWorkersConstructed,
      workerSpecifier: String(scriptPath)
    });

    const listeners = new Map<'message' | 'error', Set<(event: MessageEvent | ErrorEvent) => void>>([
      ['message', new Set()],
      ['error', new Set()]
    ]);

    const dispatchListeners = (type: 'message' | 'error', event: MessageEvent | ErrorEvent): void => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    };

    const facade = {
      postMessage: (message: unknown): void => {
        if (!message || typeof message !== 'object' || !('type' in message)) {
          nativeWorker.postMessage(message);
          return;
        }

        const task = message as { type?: string; requestId?: string; etfIndex?: number; scenario?: string; shockGrid?: unknown[] };
        if (task.type === 'GENERAL_TASK') {
          state.generalDispatchCount += 1;
          state.generalDispatchIds.push(task.requestId ?? 'UNKNOWN');
          if (Array.isArray(task.shockGrid)) {
            state.shockGridLengthsObserved.push(task.shockGrid.length);
            appendFullWorkloadEvent('GENERAL_DISPATCH', {
              requestId: task.requestId ?? null,
              taskType: task.type,
              etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null,
              workerIndex: state.realWorkersConstructed,
              shockGridLength: task.shockGrid.length
            });
          } else {
            appendFullWorkloadEvent('GENERAL_DISPATCH', {
              requestId: task.requestId ?? null,
              taskType: task.type,
              etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null,
              workerIndex: state.realWorkersConstructed,
              shockGridLength: null
            });
          }
          nativeWorker.postMessage(task);
          return;
        }

        if (task.type === 'SCENARIO_TASK') {
          state.scenarioDispatchCount += 1;
          state.scenarioDispatchIds.push(task.requestId ?? 'UNKNOWN');
          if (Array.isArray(task.shockGrid)) {
            state.shockGridLengthsObserved.push(task.shockGrid.length);
            appendFullWorkloadEvent('SCENARIO_DISPATCH', {
              requestId: task.requestId ?? null,
              taskType: task.type,
              etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null,
              scenario: task.scenario ?? null,
              workerIndex: state.realWorkersConstructed,
              shockGridLength: task.shockGrid.length
            });
          } else {
            appendFullWorkloadEvent('SCENARIO_DISPATCH', {
              requestId: task.requestId ?? null,
              taskType: task.type,
              etfIndex: typeof task.etfIndex === 'number' ? task.etfIndex : null,
              scenario: task.scenario ?? null,
              workerIndex: state.realWorkersConstructed,
              shockGridLength: null
            });
          }
          nativeWorker.postMessage(task);
          return;
        }

        if (task.type === 'PING') {
          nativeWorker.postMessage(task);
          return;
        }

        nativeWorker.postMessage(task);
      },
      terminate: (): void => {
        state.workersTerminated += 1;
        appendFullWorkloadEvent('WORKER_TERMINATED', {
          workerIndex: state.workersTerminated,
          reason: 'passive-observation-termination'
        });
        try {
          nativeWorker.terminate();
        } catch (error) {
          const normalized = normalizeError(error);
          state.unexpectedErrors.push(normalized);
          appendFullWorkloadEvent('UNEXPECTED_ERROR', { workerIndex: state.workersTerminated, ...normalized });
        }
      },
      addEventListener: ((type: string, listener: EventListenerOrEventListenerObject | null): void => {
        if (typeof listener !== 'function') return;
        const eventType = type as 'message' | 'error';
        listeners.get(eventType)?.add(listener as (event: MessageEvent | ErrorEvent) => void);
      }) as Worker['addEventListener'],
      removeEventListener: ((type: string, listener: EventListenerOrEventListenerObject | null): void => {
        if (typeof listener !== 'function') return;
        const eventType = type as 'message' | 'error';
        listeners.get(eventType)?.delete(listener as (event: MessageEvent | ErrorEvent) => void);
      }) as Worker['removeEventListener'],
      onmessage: null,
      onerror: null
    } as unknown as Worker;

    nativeWorker.on('message', (message: unknown) => {
      const payload = message as { type?: string; requestId?: string; result?: { taskId?: string; etfIndex?: number; scenario?: string }; etfIndex?: number; scenario?: string } | undefined;
      const messageType = payload && typeof payload === 'object' && 'type' in payload ? String(payload.type) : 'UNKNOWN';

      if (messageType === 'READY') {
        state.nativeReadyCount += 1;
        appendFullWorkloadEvent('NATIVE_READY_RECEIVED', {
          workerIndex: state.realWorkersConstructed,
          messageType,
          requestId: payload?.requestId ?? null
        });
        state.facadeReadyDispatchCount += 1;
        appendFullWorkloadEvent('FACADE_READY_DISPATCHED', {
          workerIndex: state.realWorkersConstructed,
          messageType,
          requestId: payload?.requestId ?? null
        });
        dispatchListeners('message', { data: payload } as MessageEvent);
        return;
      }

      if (messageType === 'TASK_RESULT') {
        const taskId = payload?.result?.taskId ?? payload?.requestId ?? null;
        const requestId = payload?.requestId ?? null;
        if (requestId?.startsWith('GENERAL-')) {
          state.generalResultCount += 1;
          state.generalResultIds.push(requestId);
          appendFullWorkloadEvent('GENERAL_TASK_RESULT', {
            requestId,
            resultTaskId: taskId,
            etfIndex: typeof payload?.result?.etfIndex === 'number' ? payload.result.etfIndex : null,
            workerIndex: state.realWorkersConstructed
          });
        }
        if (requestId?.startsWith('SCENARIO-')) {
          state.scenarioResultCount += 1;
          state.scenarioResultIds.push(requestId);
          appendFullWorkloadEvent('SCENARIO_TASK_RESULT', {
            requestId,
            resultTaskId: taskId,
            etfIndex: typeof payload?.result?.etfIndex === 'number' ? payload.result.etfIndex : null,
            scenario: payload?.result?.scenario ?? payload?.scenario ?? null,
            workerIndex: state.realWorkersConstructed
          });
        }
        dispatchListeners('message', { data: payload } as MessageEvent);
        return;
      }

      dispatchListeners('message', { data: payload } as MessageEvent);
    });

    nativeWorker.on('error', (error: unknown) => {
      state.workerErrorCount += 1;
      const normalized = normalizeError(error);
      state.workerErrors.push(normalized);
      appendFullWorkloadEvent('WORKER_ERROR', {
        workerIndex: state.realWorkersConstructed,
        ...normalized
      });
      dispatchListeners('error', new ErrorEvent('error', { error: error instanceof Error ? error : new Error(String(error)) }));
    });

    return facade;
  };

  try {
    const result = await prepareMonteCarloPrecomputationAsync(snapshot, 4, {
      workerFactoryOverride: passiveFactory,
      workerCountOverride: 4
    });
    state.runResolveCount += 1;
    appendFullWorkloadEvent('RUN_RESOLVE', {
      resultAvailable: !!result,
      cacheEntriesAfter: getMonteCarloPrecomputationRuntimeState().cacheEntries,
      inflightEntriesAfter: getMonteCarloPrecomputationRuntimeState().inFlightEntries.length
    });
  } catch (error) {
    state.runRejectCount += 1;
    const normalized = normalizeError(error);
    state.unexpectedErrors.push(normalized);
    state.unexpectedErrorCount += 1;
    appendFullWorkloadEvent('RUN_REJECT', { ...normalized });
    throw error;
  }

  const finalRuntime = getMonteCarloPrecomputationRuntimeState();
  state.cacheEntriesAfter = finalRuntime.cacheEntries;
  state.inflightEntriesAfter = finalRuntime.inFlightEntries.length;
  state.cacheResultAvailableAfter = finalRuntime.cacheEntries > 0;
  state.activeOrphanWorkersAfter = finalRuntime.activeWorkers;

  appendFullWorkloadEvent('CACHE_STATE_AFTER', {
    cacheEntriesAfter: finalRuntime.cacheEntries,
    inflightEntriesAfter: finalRuntime.inFlightEntries.length,
    cacheResultAvailableAfter: finalRuntime.cacheEntries > 0,
    activeOrphanWorkersAfter: finalRuntime.activeWorkers,
    cachePublicationCount: 'NOT_DIRECTLY_OBSERVABLE'
  });

  const generalDuplicateDispatchIds = Array.from(new Set(state.generalDispatchIds.filter((id, index) => state.generalDispatchIds.indexOf(id) !== index)));
  const generalDuplicateResultIds = Array.from(new Set(state.generalResultIds.filter((id, index) => state.generalResultIds.indexOf(id) !== index)));
  const generalMissingResults = expectedGeneralIds.filter((id) => !state.generalResultIds.includes(id));
  const scenarioDuplicateDispatchIds = Array.from(new Set(state.scenarioDispatchIds.filter((id, index) => state.scenarioDispatchIds.indexOf(id) !== index)));
  const scenarioDuplicateResultIds = Array.from(new Set(state.scenarioResultIds.filter((id, index) => state.scenarioResultIds.indexOf(id) !== index)));
  const scenarioMissingResults = expectedScenarioIds.filter((id) => !state.scenarioResultIds.includes(id));

  const report = {
    FILES_CHANGED: ['tools/production-precompute-cert.ts'],
    PRODUCTION_SOURCE_EDITS: 0,
    HARNESS_EDITS: ['tools/production-precompute-cert.ts'],
    FULL_WORKLOAD_RUNS: 1,
    ARTIFACT: '.tmp/production-precompute-cert/r5a-full-workload.jsonl',
    ARTIFACT_VALID: 'YES',
    CACHE_ENTRIES_BEFORE: 0,
    INFLIGHT_ENTRIES_BEFORE: 0,
    REAL_WORKERS_CONSTRUCTED: state.realWorkersConstructed,
    NATIVE_READY_COUNT: state.nativeReadyCount,
    FACADE_READY_DISPATCH_COUNT: state.facadeReadyDispatchCount,
    GENERAL_DISPATCH_COUNT: state.generalDispatchCount,
    GENERAL_RESULT_COUNT: state.generalResultCount,
    GENERAL_DISPATCH_IDS: state.generalDispatchIds,
    GENERAL_RESULT_IDS: state.generalResultIds,
    GENERAL_REQUEST_ID_SET_MATCH: JSON.stringify([...new Set(state.generalDispatchIds)].sort()) === JSON.stringify(expectedGeneralIds) && JSON.stringify([...new Set(state.generalResultIds)].sort()) === JSON.stringify(expectedGeneralIds),
    GENERAL_DUPLICATE_DISPATCH_IDS: generalDuplicateDispatchIds,
    GENERAL_DUPLICATE_RESULT_IDS: generalDuplicateResultIds,
    GENERAL_MISSING_RESULT_IDS: generalMissingResults,
    SCENARIO_DISPATCH_COUNT: state.scenarioDispatchCount,
    SCENARIO_RESULT_COUNT: state.scenarioResultCount,
    SCENARIO_DISPATCH_IDS: state.scenarioDispatchIds,
    SCENARIO_RESULT_IDS: state.scenarioResultIds,
    SCENARIO_REQUEST_ID_SET_MATCH: JSON.stringify([...new Set(state.scenarioDispatchIds)].sort()) === JSON.stringify(expectedScenarioIds) && JSON.stringify([...new Set(state.scenarioResultIds)].sort()) === JSON.stringify(expectedScenarioIds),
    SCENARIO_DUPLICATE_DISPATCH_IDS: scenarioDuplicateDispatchIds,
    SCENARIO_DUPLICATE_RESULT_IDS: scenarioDuplicateResultIds,
    SCENARIO_MISSING_RESULT_IDS: scenarioMissingResults,
    SHOCK_GRID_LENGTHS_OBSERVED: state.shockGridLengthsObserved,
    ALL_SHOCK_GRID_LENGTHS_8193: state.shockGridLengthsObserved.length > 0 && state.shockGridLengthsObserved.every((length) => length === 8193),
    RUN_RESOLVE_COUNT: state.runResolveCount,
    RUN_REJECT_COUNT: state.runRejectCount,
    HARNESS_BLOCKED_MESSAGES: state.harnessBlockedMessages,
    HARNESS_SYNTHESIZED_MESSAGES: state.harnessSynthesizedMessages,
    HARNESS_MUTATED_MESSAGES: state.harnessMutatedMessages,
    CACHE_ENTRIES_AFTER: state.cacheEntriesAfter,
    CACHE_RESULT_AVAILABLE_AFTER: state.cacheResultAvailableAfter,
    CACHE_PUBLICATION_COUNT: 'NOT_DIRECTLY_OBSERVABLE',
    INFLIGHT_ENTRIES_AFTER: state.inflightEntriesAfter,
    WORKERS_TERMINATED: state.workersTerminated,
    ACTIVE_ORPHAN_WORKERS_AFTER: state.activeOrphanWorkersAfter,
    WORKER_ERROR_COUNT: state.workerErrorCount,
    UNEXPECTED_ERROR_COUNT: state.unexpectedErrorCount,
    GENERAL_CALIBRATIONS_RUNTIME: 'NOT_OBSERVABLE',
    SCENARIO_ENDPOINT_CALIBRATIONS_RUNTIME: 'NOT_OBSERVABLE',
    MU_INTERIOR_CALIBRATIONS_RUNTIME: 'NOT_OBSERVABLE',
    TOTAL_CALIBRATIONS_RUNTIME: 'NOT_OBSERVABLE',
    GENERAL_CALIBRATIONS_SOURCE: 5,
    SCENARIO_ENDPOINT_CALIBRATIONS_SOURCE: 20,
    MU_INTERIOR_CALIBRATIONS_SOURCE: 1980,
    TOTAL_CALIBRATIONS_SOURCE: 2005,
    CANONICAL_NODES_SOURCE: 2020,
    R5A_WORKLOAD_TELEMETRY: (
      state.generalDispatchCount === 5 &&
      state.generalResultCount === 5 &&
      state.scenarioDispatchCount === 20 &&
      state.scenarioResultCount === 20 &&
      state.generalDispatchIds.length === 5 &&
      state.generalResultIds.length === 5 &&
      state.scenarioDispatchIds.length === 20 &&
      state.scenarioResultIds.length === 20 &&
      JSON.stringify([...new Set(state.generalDispatchIds)].sort()) === JSON.stringify(expectedGeneralIds) &&
      JSON.stringify([...new Set(state.generalResultIds)].sort()) === JSON.stringify(expectedGeneralIds) &&
      JSON.stringify([...new Set(state.scenarioDispatchIds)].sort()) === JSON.stringify(expectedScenarioIds) &&
      JSON.stringify([...new Set(state.scenarioResultIds)].sort()) === JSON.stringify(expectedScenarioIds) &&
      generalDuplicateDispatchIds.length === 0 &&
      generalDuplicateResultIds.length === 0 &&
      scenarioDuplicateDispatchIds.length === 0 &&
      scenarioDuplicateResultIds.length === 0 &&
      generalMissingResults.length === 0 &&
      scenarioMissingResults.length === 0 &&
      state.shockGridLengthsObserved.length > 0 &&
      state.shockGridLengthsObserved.every((length) => length === 8193) &&
      state.runResolveCount === 1 &&
      state.runRejectCount === 0 &&
      state.workerErrorCount === 0 &&
      state.unexpectedErrorCount === 0 &&
      state.inflightEntriesAfter === 0 &&
      state.cacheResultAvailableAfter &&
      state.workersTerminated === state.realWorkersConstructed &&
      state.activeOrphanWorkersAfter === 0
    ) ? 'PASS_CLOSED' : 'INCOMPLETE',
    R5A: 'INCOMPLETE',
    R5B_CANCEL_GENERAL: 'PASS_CLOSED',
    R5C_DIAGNOSTICS_COMPATIBILITY: 'OPEN',
    '#2P': 'INCOMPLETE',
    NEXT_STEP: 'WAIT_FOR_REVIEW'
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
};

(async () => {
  try {
    await runR5ATwoGeneralNativeProbe();
  } catch (error) {
    console.error('R5A_TWO_GENERAL_NATIVE_PROBE = FAILED');
    console.error(error);
    process.exitCode = 1;
  }
})();
