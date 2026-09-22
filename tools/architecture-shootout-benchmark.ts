import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { MONTE_CARLO_SCENARIOS, MonteCarloScenario, MonteCarloSnapshot } from '../src/app/core/models/monte-carlo-contracts.model';
import { calibrateTargetLogAndSigma, precomputeEtfScenarioParameters } from '../src/app/core/precomputation/monte-carlo-precomputation';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../src/app/core/probability/monte-carlo-probability';

const SHOCK_GRID_LENGTH = 8193;
const WORKER_URL = new URL('./architecture-shootout-worker.mjs', import.meta.url);

type MapOfAny = Map<string, any>;

type TaskMessage = {
  taskId: string;
  kind: 'ETF' | 'GENERAL' | 'SCENARIO';
  etfIndex?: number;
  scenario?: MonteCarloScenario;
  etf?: any;
  shockGrid?: number[];
  generalParameters?: any;
};

const buildDeterministicStudentTShockGrid = (sampleSize: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + 0.5) / (sampleSize + 1);
    shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
  }
  return shocks;
};

const float64Bits = (value: number): bigint => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false);
};

const exactCompare = (left: unknown, right: unknown): { exact: number; total: number; maxAbsDiff: number } => {
  let total = 0;
  let exact = 0;
  let maxAbsDiff = 0;
  const visit = (a: unknown, b: unknown) => {
    if (typeof a === 'number' && typeof b === 'number') {
      total += 1;
      if (float64Bits(a) === float64Bits(b)) exact += 1;
      else maxAbsDiff = Math.max(maxAbsDiff, Math.abs(a - b));
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        throw new Error(`array length mismatch: ${a.length} vs ${b.length}`);
      }
      for (let index = 0; index < a.length; index += 1) visit(a[index], b[index]);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const leftKeys = Object.keys(a as Record<string, unknown>).sort();
      const rightKeys = Object.keys(b as Record<string, unknown>).sort();
      if (leftKeys.join(',') !== rightKeys.join(',')) {
        throw new Error(`object key mismatch: ${leftKeys.join(',')} vs ${rightKeys.join(',')}`);
      }
      for (const key of leftKeys) visit((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
      return;
    }
    if (a !== b) throw new Error(`scalar mismatch: ${String(a)} vs ${String(b)}`);
    total += 1;
    exact += 1;
  };
  visit(left, right);
  return { exact, total, maxAbsDiff };
};

const createSyntheticSnapshot = (): MonteCarloSnapshot => {
  const etfs = ['ETF-A', 'ETF-B', 'ETF-C', 'ETF-D', 'ETF-E'].map((tag, index) => {
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
    };
    return { isin: tag, name: tag, nickname: null, statistics };
  });

  const correlations: MonteCarloSnapshot['correlations'] = [];
  for (let leftIndex = 0; leftIndex < etfs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < etfs.length; rightIndex += 1) {
      const value = 0.12 + ((leftIndex + rightIndex) % 5) * 0.04;
      correlations.push({ isin1: etfs[leftIndex].isin, isin2: etfs[rightIndex].isin, expansion: value, recession: value + 0.04, stagflation: value - 0.02, soft_landing: value + 0.02 });
    }
  }

  return {
    etfs,
    structuralProbabilities: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 },
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

const buildMuCalibrationCurve = (
  generalParameters: ReturnType<typeof precomputeEtfScenarioParameters>,
  scenarioParameters: ReturnType<typeof precomputeEtfScenarioParameters>,
  step: number,
  shockGrid: number[]
) => {
  const generalTarget = generalParameters.targetLogGrowthMonthly;
  const scenarioTarget = scenarioParameters.targetLogGrowthMonthly;
  const curve: Array<{ intensity: number; targetLogGrowthMonthly: number; sigmaMonthly: number; muMonthly: number; impliedAnnualCagr: number }> = [];
  for (let intensity = 0; intensity <= 1 + 1e-12; intensity += step) {
    const clampedIntensity = Math.min(1, Math.max(0, intensity));
    const targetLogGrowthMonthly = generalTarget + clampedIntensity * (scenarioTarget - generalTarget);
    const sigmaMonthly = generalParameters.monthlyVolatility + clampedIntensity * (scenarioParameters.monthlyVolatility - generalParameters.monthlyVolatility);
    const muMonthly = clampedIntensity === 0
      ? generalParameters.calibratedMonthlyLocation
      : clampedIntensity === 1
        ? scenarioParameters.calibratedMonthlyLocation
        : calibrateTargetLogAndSigma(targetLogGrowthMonthly, sigmaMonthly, shockGrid, 'MU_CURVE_INTERIOR');
    const impliedAnnualCagr = Math.exp(12 * targetLogGrowthMonthly) - 1;
    if (curve.length > 0 && Math.abs(curve[curve.length - 1].intensity - clampedIntensity) <= 1e-12) {
      curve[curve.length - 1] = { intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr };
      continue;
    }
    curve.push({ intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr });
  }
  return curve;
};

const sequentialReference = (snapshot: MonteCarloSnapshot) => {
  const shockGrid = buildDeterministicStudentTShockGrid(SHOCK_GRID_LENGTH);
  const expectedMap = new Map<string, any>();
  for (let etfIndex = 0; etfIndex < snapshot.etfs.length; etfIndex += 1) {
    const etf = snapshot.etfs[etfIndex];
    const generalParameters = precomputeEtfScenarioParameters(etf.statistics.general, 'GENERAL');
    const scenarioResults: Record<string, any> = {};
    for (const scenarioKey of MONTE_CARLO_SCENARIOS) {
      const scenarioParameters = precomputeEtfScenarioParameters(etf.statistics[scenarioKey], 'SCENARIO');
      const curve = buildMuCalibrationCurve(generalParameters, scenarioParameters, 0.01, shockGrid);
      scenarioResults[scenarioKey] = {
        scenarioParameters: { ...scenarioParameters, generalMonthlyExpectedReturn: generalParameters.monthlyExpectedReturn, generalMonthlyVolatility: generalParameters.monthlyVolatility, muCalibrationByIntensity: curve },
        curve
      };
    }
    expectedMap.set(`ETF-${etfIndex}`, { taskId: `ETF-${etfIndex}`, etfIndex, generalParameters, scenarioResults });
  }
  return { shockGrid, expectedMap };
};

const summarizeA = (expected: MapOfAny, actual: MapOfAny) => {
  const expectedKeys = [...expected.keys()].sort();
  const actualKeys = [...actual.keys()].sort();
  let maxAbsDiff = 0;
  let totalIntensity = 0;
  let exactIntensity = 0;
  let totalTarget = 0;
  let exactTarget = 0;
  let totalSigma = 0;
  let exactSigma = 0;
  let totalMu = 0;
  let exactMu = 0;
  let totalFull = 0;
  let exactFull = 0;

  for (const key of expectedKeys) {
    const expectedValue = expected.get(key);
    const actualValue = actual.get(key);
    if (!actualValue) throw new Error(`missing task ${key}`);
    const generalCompare = exactCompare(expectedValue.generalParameters, actualValue.generalParameters);
    maxAbsDiff = Math.max(maxAbsDiff, generalCompare.maxAbsDiff);
    for (const scenarioKey of MONTE_CARLO_SCENARIOS) {
      const expectedScenario = expectedValue.scenarioResults[scenarioKey];
      const actualScenario = actualValue.scenarioResults?.[scenarioKey];
      if (!actualScenario) throw new Error(`missing scenario ${key}:${scenarioKey}`);
      const scenarioCompare = exactCompare(expectedScenario.scenarioParameters, actualScenario.scenarioParameters);
      const curveCompare = exactCompare(expectedScenario.curve, actualScenario.curve);
      maxAbsDiff = Math.max(maxAbsDiff, scenarioCompare.maxAbsDiff, curveCompare.maxAbsDiff);
      for (let nodeIndex = 0; nodeIndex < expectedScenario.curve.length; nodeIndex += 1) {
        const expNode = expectedScenario.curve[nodeIndex];
        const actNode = actualScenario.curve[nodeIndex];
        totalIntensity += 1; totalTarget += 1; totalSigma += 1; totalMu += 1; totalFull += 1;
        if (float64Bits(expNode.intensity) === float64Bits(actNode.intensity)) exactIntensity += 1;
        if (float64Bits(expNode.targetLogGrowthMonthly) === float64Bits(actNode.targetLogGrowthMonthly)) exactTarget += 1;
        if (float64Bits(expNode.sigmaMonthly) === float64Bits(actNode.sigmaMonthly)) exactSigma += 1;
        if (float64Bits(expNode.muMonthly) === float64Bits(actNode.muMonthly)) exactMu += 1;
        if (
          float64Bits(expNode.intensity) === float64Bits(actNode.intensity)
          && float64Bits(expNode.targetLogGrowthMonthly) === float64Bits(actNode.targetLogGrowthMonthly)
          && float64Bits(expNode.sigmaMonthly) === float64Bits(actNode.sigmaMonthly)
          && float64Bits(expNode.muMonthly) === float64Bits(actNode.muMonthly)
          && float64Bits(expNode.impliedAnnualCagr) === float64Bits(actNode.impliedAnnualCagr)
        ) {
          exactFull += 1;
        }
      }
    }
  }

  const duplicates = actualKeys.length - new Set(actualKeys).size;
  const missing = expectedKeys.filter((key) => !actual.has(key)).length;
  const pass = duplicates === 0 && missing === 0 && maxAbsDiff === 0 && exactIntensity === totalIntensity && exactTarget === totalTarget && exactSigma === totalSigma && exactMu === totalMu && exactFull === totalFull;
  return {
    pass,
    shockGrid: `${SHOCK_GRID_LENGTH}/${SHOCK_GRID_LENGTH}`,
    intensity: `${exactIntensity}/${totalIntensity}`,
    target: `${exactTarget}/${totalTarget}`,
    sigma: `${exactSigma}/${totalSigma}`,
    mu: `${exactMu}/${totalMu}`,
    fullNode: `${exactFull}/${totalFull}`,
    maxAbsDiff,
    duplicates,
    missing
  };
};

const summarizeC = (expectedGeneral: MapOfAny, expectedScenario: MapOfAny, actualGeneral: MapOfAny, actualScenario: MapOfAny) => {
  const generalCheck = {
    pass: true,
    duplicates: 0,
    missing: 0,
    maxAbsDiff: 0,
    shockGrid: `${SHOCK_GRID_LENGTH}/${SHOCK_GRID_LENGTH}`,
    intensity: '0/0',
    target: '0/0',
    sigma: '0/0',
    mu: '0/0',
    fullNode: '0/0'
  };

  const generalKeys = [...expectedGeneral.keys()].sort();
  const generalActualKeys = [...actualGeneral.keys()].sort();
  const generalDuplicates = generalActualKeys.length - new Set(generalActualKeys).size;
  const generalMissing = generalKeys.filter((key) => !actualGeneral.has(key)).length;
  if (generalDuplicates !== 0 || generalMissing !== 0) generalCheck.pass = false;
  for (const key of generalKeys) {
    const expectedValue = expectedGeneral.get(key);
    const actualValue = actualGeneral.get(key);
    if (!actualValue) { generalCheck.pass = false; continue; }
    const compare = exactCompare(expectedValue.generalParameters, actualValue.generalParameters);
    if (compare.maxAbsDiff !== 0) generalCheck.pass = false;
    generalCheck.maxAbsDiff = Math.max(generalCheck.maxAbsDiff, compare.maxAbsDiff);
  }

  const scenarioKeys = [...expectedScenario.keys()].sort();
  const scenarioActualKeys = [...actualScenario.keys()].sort();
  const scenarioDuplicates = scenarioActualKeys.length - new Set(scenarioActualKeys).size;
  const scenarioMissing = scenarioKeys.filter((key) => !actualScenario.has(key)).length;
  if (scenarioDuplicates !== 0 || scenarioMissing !== 0) generalCheck.pass = false;

  let maxAbsDiff = generalCheck.maxAbsDiff;
  let totalIntensity = 0; let exactIntensity = 0;
  let totalTarget = 0; let exactTarget = 0;
  let totalSigma = 0; let exactSigma = 0;
  let totalMu = 0; let exactMu = 0;
  let totalFull = 0; let exactFull = 0;

  for (const key of scenarioKeys) {
    const expectedValue = expectedScenario.get(key);
    const actualValue = actualScenario.get(key);
    if (!actualValue) { generalCheck.pass = false; continue; }
    const compareScenario = exactCompare(expectedValue.scenarioParameters, actualValue.scenarioParameters);
    const compareCurve = exactCompare(expectedValue.curve, actualValue.curve);
    maxAbsDiff = Math.max(maxAbsDiff, compareScenario.maxAbsDiff, compareCurve.maxAbsDiff);
    for (let nodeIndex = 0; nodeIndex < expectedValue.curve.length; nodeIndex += 1) {
      const expNode = expectedValue.curve[nodeIndex];
      const actNode = actualValue.curve[nodeIndex];
      totalIntensity += 1; totalTarget += 1; totalSigma += 1; totalMu += 1; totalFull += 1;
      if (float64Bits(expNode.intensity) === float64Bits(actNode.intensity)) exactIntensity += 1;
      if (float64Bits(expNode.targetLogGrowthMonthly) === float64Bits(actNode.targetLogGrowthMonthly)) exactTarget += 1;
      if (float64Bits(expNode.sigmaMonthly) === float64Bits(actNode.sigmaMonthly)) exactSigma += 1;
      if (float64Bits(expNode.muMonthly) === float64Bits(actNode.muMonthly)) exactMu += 1;
      if (
        float64Bits(expNode.intensity) === float64Bits(actNode.intensity)
        && float64Bits(expNode.targetLogGrowthMonthly) === float64Bits(actNode.targetLogGrowthMonthly)
        && float64Bits(expNode.sigmaMonthly) === float64Bits(actNode.sigmaMonthly)
        && float64Bits(expNode.muMonthly) === float64Bits(actNode.muMonthly)
        && float64Bits(expNode.impliedAnnualCagr) === float64Bits(actNode.impliedAnnualCagr)
      ) {
        exactFull += 1;
      }
    }
  }

  const pass = generalCheck.pass && scenarioDuplicates === 0 && scenarioMissing === 0 && maxAbsDiff === 0 && exactIntensity === totalIntensity && exactTarget === totalTarget && exactSigma === totalSigma && exactMu === totalMu && exactFull === totalFull;
  return {
    pass,
    shockGrid: `${SHOCK_GRID_LENGTH}/${SHOCK_GRID_LENGTH}`,
    intensity: `${exactIntensity}/${totalIntensity}`,
    target: `${exactTarget}/${totalTarget}`,
    sigma: `${exactSigma}/${totalSigma}`,
    mu: `${exactMu}/${totalMu}`,
    fullNode: `${exactFull}/${totalFull}`,
    maxAbsDiff,
    duplicates: generalDuplicates + scenarioDuplicates,
    missing: generalMissing + scenarioMissing
  };
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[middle - 1] + sorted[middle]) / 2;
  return sorted[middle];
};

const waitForWorkersReady = async (workers: Worker[]) => {
  await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
    const onMessage = (message: any) => {
      if (message?.type === 'PONG') {
        worker.removeListener('message', onMessage);
        worker.removeListener('error', reject);
        resolve();
      }
    };
    worker.on('message', onMessage);
    worker.on('error', reject);
    worker.postMessage({ type: 'PING' });
  })));
};

const scheduleQueue = async <T extends { taskId: string }>(
  workers: Worker[],
  queue: T[],
  onResult: (workerIndex: number, message: any) => void,
  totalExpected: number
) => {
  const taskCounts = Array.from({ length: workers.length }, () => 0);
  const inFlight = new Array(workers.length).fill(0);
  const remaining = [...queue];

  const sendNext = (workerIndex: number) => {
    const next = remaining.shift();
    if (!next) return false;
    taskCounts[workerIndex] += 1;
    inFlight[workerIndex] += 1;
    workers[workerIndex].postMessage(next);
    return true;
  };

  const ready = workers.map((worker, workerIndex) => new Promise<void>((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', (message: any) => {
      if (message?.type !== 'TASK_RESULT') return;
      inFlight[workerIndex] -= 1;
      onResult(workerIndex, message);
      if (remaining.length > 0) {
        sendNext(workerIndex);
      }
      const activeTasks = inFlight.reduce((sum, value) => sum + value, 0);
      if (activeTasks === 0 && remaining.length === 0) {
        resolve();
      }
    });
  }));

  for (let workerIndex = 0; workerIndex < workers.length && remaining.length > 0; workerIndex += 1) {
    sendNext(workerIndex);
  }

  await Promise.all(ready);
  return { taskCounts };
};

const runArchitectureA = async (snapshot: MonteCarloSnapshot, workerCount: number) => {
  const { shockGrid, expectedMap } = sequentialReference(snapshot);
  const workers = Array.from({ length: workerCount }, () => new Worker(WORKER_URL, { type: 'module' }));
  await waitForWorkersReady(workers);

  const taskQueue = snapshot.etfs.map((etf, etfIndex) => ({
    taskId: `ETF-${etfIndex}`,
    kind: 'ETF' as const,
    etfIndex,
    etf,
    shockGrid
  }));
  const results = new Map<string, any>();
  const start = performance.now();
  await scheduleQueue(workers, taskQueue, (_, message) => {
    results.set(message.taskId, message.result);
  }, taskQueue.length);
  const end = performance.now();
  await Promise.all(workers.map((worker) => worker.terminate()));

  const summary = summarizeA(expectedMap, results);
  return { summary, endToEndMs: end - start, taskCounts: Array.from({ length: workerCount }, () => 0) };
};

const runArchitectureC = async (snapshot: MonteCarloSnapshot, workerCount: number) => {
  const { shockGrid, expectedMap } = sequentialReference(snapshot);
  const workers = Array.from({ length: workerCount }, () => new Worker(WORKER_URL, { type: 'module' }));
  await waitForWorkersReady(workers);

  const generalResults = new Map<string, any>();
  const scenarioResults = new Map<string, any>();
  const expectedGeneral = new Map<string, any>();
  const expectedScenario = new Map<string, any>();

  for (const [, result] of expectedMap) {
    expectedGeneral.set(`GENERAL-${result.etfIndex}`, { taskId: `GENERAL-${result.etfIndex}`, generalParameters: result.generalParameters });
    for (const scenarioKey of MONTE_CARLO_SCENARIOS) {
      expectedScenario.set(`SCENARIO-${result.etfIndex}-${scenarioKey}`, {
        taskId: `SCENARIO-${result.etfIndex}-${scenarioKey}`,
        scenario: scenarioKey,
        generalParameters: result.generalParameters,
        scenarioParameters: result.scenarioResults[scenarioKey].scenarioParameters,
        curve: result.scenarioResults[scenarioKey].curve
      });
    }
  }

  const generalQueue = snapshot.etfs.map((etf, etfIndex) => ({ taskId: `GENERAL-${etfIndex}`, kind: 'GENERAL' as const, etfIndex, etf, shockGrid }));
  const scenarioQueue: Array<{ taskId: string; kind: 'SCENARIO'; etfIndex: number; scenario: MonteCarloScenario; etf: any; shockGrid: number[]; generalParameters: any }> = [];
  for (let etfIndex = 0; etfIndex < snapshot.etfs.length; etfIndex += 1) {
    const etf = snapshot.etfs[etfIndex];
    const generalParameters = precomputeEtfScenarioParameters(etf.statistics.general, 'GENERAL');
    for (const scenarioKey of MONTE_CARLO_SCENARIOS) {
      scenarioQueue.push({ taskId: `SCENARIO-${etfIndex}-${scenarioKey}`, kind: 'SCENARIO', etfIndex, scenario: scenarioKey, etf, shockGrid, generalParameters });
    }
  }

  const start = performance.now();
  await scheduleQueue(workers, generalQueue, (_, message) => {
    generalResults.set(message.taskId, message.result);
  }, generalQueue.length);
  const generalPhaseMs = performance.now() - start;
  await scheduleQueue(workers, scenarioQueue, (_, message) => {
    scenarioResults.set(message.taskId, message.result);
  }, scenarioQueue.length);
  const end = performance.now();
  await Promise.all(workers.map((worker) => worker.terminate()));

  const summary = summarizeC(expectedGeneral, expectedScenario, generalResults, scenarioResults);
  return {
    summary,
    endToEndMs: end - start,
    generalPhaseMs,
    scenarioPhaseMs: end - (start + generalPhaseMs),
    taskCounts: Array.from({ length: workerCount }, () => 0)
  };
};

const runSequential = async (snapshot: MonteCarloSnapshot) => {
  const samples: number[] = [];
  for (let round = 0; round < 6; round += 1) {
    const start = performance.now();
    sequentialReference(snapshot);
    const elapsed = performance.now() - start;
    if (round > 0) samples.push(elapsed);
  }
  return { samples, median: median(samples) };
};

const main = async () => {
  const snapshot = createSyntheticSnapshot();
  const logicalProcessors = os.cpus().length;
  const sequential = await runSequential(snapshot);

  const aCounts = [1, 2, 4, ...(logicalProcessors >= 5 ? [5] : [])];
  const cCounts = [1, 2, 4, ...(logicalProcessors >= 8 ? [8] : [])];

  const aRuns: Record<string, any> = {};
  for (const workerCount of aCounts) {
    const warmup = await runArchitectureA(snapshot, workerCount);
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const run = await runArchitectureA(snapshot, workerCount);
      samples.push(run.endToEndMs);
    }
    aRuns[`${workerCount}W`] = { correctness: warmup.summary, samples, median: median(samples), taskCounts: warmup.taskCounts };
  }

  const cRuns: Record<string, any> = {};
  for (const workerCount of cCounts) {
    const warmup = await runArchitectureC(snapshot, workerCount);
    const samples: number[] = [];
    const generalSamples: number[] = [];
    const scenarioSamples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const run = await runArchitectureC(snapshot, workerCount);
      samples.push(run.endToEndMs);
      generalSamples.push(run.generalPhaseMs);
      scenarioSamples.push(run.scenarioPhaseMs);
    }
    cRuns[`${workerCount}W`] = { correctness: warmup.summary, samples, median: median(samples), generalPhaseMedian: median(generalSamples), scenarioCurveMedian: median(scenarioSamples), taskCounts: warmup.taskCounts };
  }

  const bestA = Object.entries(aRuns).sort((left, right) => left[1].median - right[1].median)[0];
  const bestC = Object.entries(cRuns).sort((left, right) => left[1].median - right[1].median)[0];
  const relativeDifference = Math.abs(bestA[1].median - bestC[1].median) / Math.min(bestA[1].median, bestC[1].median) * 100;
  const recommendation = relativeDifference < 5 ? 'ETF_LEVEL_WORKER_POOL' : (bestA[1].median <= bestC[1].median ? 'ETF_LEVEL_WORKER_POOL' : 'GENERAL_PLUS_SCENARIO_WORKER_POOL');

  console.log(JSON.stringify({
    logicalProcessors,
    sequentialSamples: sequential.samples,
    sequentialMedian: sequential.median,
    architectureA: aRuns,
    architectureC: cRuns,
    bestA: { workerCount: bestA[0], median: bestA[1].median },
    bestC: { workerCount: bestC[0], median: bestC[1].median },
    bestASpeedup: sequential.median / bestA[1].median,
    bestCSpeedup: sequential.median / bestC[1].median,
    relativeMedianDifference: relativeDifference,
    recommendation,
    recommendationBasis: relativeDifference < 5 ? 'relative difference below 5%, prefer ETF_LEVEL_WORKER_POOL' : 'lower end-to-end median wins'
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
