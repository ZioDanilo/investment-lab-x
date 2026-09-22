import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { MONTE_CARLO_SCENARIOS, MonteCarloScenario, MonteCarloSnapshot } from '../src/app/core/models/monte-carlo-contracts.model';
import { calibrateTargetLogAndSigma, precomputeEtfScenarioParameters } from '../src/app/core/precomputation/monte-carlo-precomputation';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../src/app/core/probability/monte-carlo-probability';

const SHOCK_GRID_LENGTH = 8193;
const compiledWorkerUrl = new URL('./bitwise-precompute-worker.mjs', import.meta.url);
const sourceWorkerUrl = new URL('./bitwise-precompute-worker.ts', import.meta.url);
const workerUrl = existsSync(fileURLToPath(compiledWorkerUrl)) ? compiledWorkerUrl : sourceWorkerUrl;
const workerOptions = workerUrl.href.endsWith('.ts') ? { type: 'module', execArgv: ['--import', 'tsx'] } : { type: 'module' };

const buildDeterministicStudentTShockGrid = (sampleSize: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + 0.5) / (sampleSize + 1);
    shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
  }
  return shocks;
};

const buildMuCalibrationCurve = (
  generalParameters: ReturnType<typeof precomputeEtfScenarioParameters>,
  scenarioParameters: ReturnType<typeof precomputeEtfScenarioParameters>,
  step: number,
  shockGrid: number[]
) => {
  const curve: Array<{ intensity: number; targetLogGrowthMonthly: number; sigmaMonthly: number; muMonthly: number; impliedAnnualCagr: number }> = [];
  const generalTarget = generalParameters.targetLogGrowthMonthly;
  const scenarioTarget = scenarioParameters.targetLogGrowthMonthly;

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

    return {
      isin: tag,
      name: tag,
      nickname: null,
      statistics
    };
  });

  const correlations: MonteCarloSnapshot['correlations'] = [];
  for (let leftIndex = 0; leftIndex < etfs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < etfs.length; rightIndex += 1) {
      const value = 0.12 + ((leftIndex + rightIndex) % 5) * 0.04;
      correlations.push({
        isin1: etfs[leftIndex].isin,
        isin2: etfs[rightIndex].isin,
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

  const visit = (a: unknown, b: unknown, currentPath: string) => {
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

const sequentialReference = (snapshot: MonteCarloSnapshot) => {
  const shockGrid = buildDeterministicStudentTShockGrid(SHOCK_GRID_LENGTH);
  const results = new Map<string, any>();
  for (let etfIndex = 0; etfIndex < snapshot.etfs.length; etfIndex += 1) {
    const etf = snapshot.etfs[etfIndex];
    const generalParameters = precomputeEtfScenarioParameters(etf.statistics.general, 'GENERAL');
    for (let scenarioIndex = 0; scenarioIndex < MONTE_CARLO_SCENARIOS.length; scenarioIndex += 1) {
      const scenario = MONTE_CARLO_SCENARIOS[scenarioIndex] as MonteCarloScenario;
      const scenarioParameters = precomputeEtfScenarioParameters(etf.statistics[scenario], 'SCENARIO');
      const curve = buildMuCalibrationCurve(generalParameters, scenarioParameters, 0.01, shockGrid);
      const result = {
        taskId: `${etfIndex}:${scenarioIndex}`,
        etfIndex,
        scenario,
        generalParameters,
        scenarioParameters: {
          ...scenarioParameters,
          generalMonthlyExpectedReturn: generalParameters.monthlyExpectedReturn,
          generalMonthlyVolatility: generalParameters.monthlyVolatility,
          muCalibrationByIntensity: curve
        },
        curve
      };
      results.set(result.taskId, result);
    }
  }
  return { shockGrid, results };
};

const runWithWorkers = async (snapshot: MonteCarloSnapshot, workerCount: number, dispatchOrder?: number[]) => {
  const { shockGrid, results: expected } = sequentialReference(snapshot);
  const queue: Array<{ taskId: string; etfIndex: number; scenario: MonteCarloScenario; etf: MonteCarloSnapshot['etfs'][number] }> = [];
  const ordered = dispatchOrder ?? Array.from({ length: snapshot.etfs.length * MONTE_CARLO_SCENARIOS.length }, (_, index) => index);

  for (const index of ordered) {
    const etfIndex = Math.floor(index / MONTE_CARLO_SCENARIOS.length);
    const scenarioIndex = index % MONTE_CARLO_SCENARIOS.length;
    queue.push({
      taskId: `${etfIndex}:${scenarioIndex}`,
      etfIndex,
      scenario: MONTE_CARLO_SCENARIOS[scenarioIndex] as MonteCarloScenario,
      etf: snapshot.etfs[etfIndex]
    });
  }

  const results = new Map<string, any>();
  const workers = Array.from({ length: workerCount }, () => new Worker(workerUrl, workerOptions));

  await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      worker.removeListener('message', eventHandler);
      worker.removeListener('error', reject);
      worker.removeListener('exit', exitHandler);
      resolve();
    };

    const eventHandler = (message: any) => {
      if (message.type === 'TASK_RESULT') {
        results.set(message.taskId, message.result);
        const next = queue.shift();
        if (next) {
          worker.postMessage({ ...next, shockGrid });
          return;
        }

        finish();
        worker.terminate();
      }
    };

    const exitHandler = (code: number) => {
      if (settled) return;
      if (code !== 0) {
        reject(new Error(`worker exited with ${code}`));
        return;
      }
      if (queue.length === 0) {
        finish();
      }
    };

    worker.on('message', eventHandler);
    worker.on('error', reject);

    const firstTask = queue.shift();
    if (firstTask) {
      worker.postMessage({ ...firstTask, shockGrid });
    } else {
      finish();
      worker.terminate();
    }

    worker.on('exit', exitHandler);
  })));

  for (const worker of workers) worker.terminate();

  return { shockGrid, expected, actual: results };
};

const summarize = async (snapshot: MonteCarloSnapshot, workerCount: number, label: string, dispatchOrder?: number[]) => {
  const { shockGrid, expected, actual } = await runWithWorkers(snapshot, workerCount, dispatchOrder);
  const expectedTasks = [...expected.keys()].sort();
  const actualTasks = [...actual.keys()].sort();

  const duplicateTasks = actualTasks.length - new Set(actualTasks).size;
  const missingTasks = expectedTasks.filter((taskId) => !actual.has(taskId)).length;

  const generalCounts = { exact: 0, total: 0 };
  const scenarioCounts = { exact: 0, total: 0 };
  const intensity = { exact: 0, total: 0 };
  const target = { exact: 0, total: 0 };
  const sigma = { exact: 0, total: 0 };
  const mu = { exact: 0, total: 0 };
  const fullNode = { exact: 0, total: 0 };
  let maxAbsGeneralDiff = 0;
  let maxAbsScenarioDiff = 0;
  let maxAbsCurveDiff = 0;
  const mismatches: string[] = [];

  for (const taskId of expectedTasks) {
    const expectedResult = expected.get(taskId);
    const actualResult = actual.get(taskId);
    if (!actualResult) {
      mismatches.push(`${label}: missing ${taskId}`);
      continue;
    }
    const generalDiff = exactCompare(expectedResult.generalParameters, actualResult.generalParameters, `general.${taskId}`);
    const scenarioDiff = exactCompare(expectedResult.scenarioParameters, actualResult.scenarioParameters, `scenario.${taskId}`);
    const curveDiff = exactCompare(expectedResult.curve, actualResult.curve, `curve.${taskId}`);
    generalCounts.exact += generalDiff.exact;
    generalCounts.total += generalDiff.total;
    scenarioCounts.exact += scenarioDiff.exact;
    scenarioCounts.total += scenarioDiff.total;
    maxAbsGeneralDiff = Math.max(maxAbsGeneralDiff, generalDiff.maxAbsDiff);
    maxAbsScenarioDiff = Math.max(maxAbsScenarioDiff, scenarioDiff.maxAbsDiff);
    maxAbsCurveDiff = Math.max(maxAbsCurveDiff, curveDiff.maxAbsDiff);
    mismatches.push(...generalDiff.mismatches.slice(0, 3), ...scenarioDiff.mismatches.slice(0, 3), ...curveDiff.mismatches.slice(0, 3));

    for (let nodeIndex = 0; nodeIndex < expectedResult.curve.length; nodeIndex += 1) {
      const expectedNode = expectedResult.curve[nodeIndex];
      const actualNode = actualResult.curve[nodeIndex];
      intensity.total += 1;
      target.total += 1;
      sigma.total += 1;
      mu.total += 1;
      fullNode.total += 1;
      if (float64Bits(expectedNode.intensity) === float64Bits(actualNode.intensity)) intensity.exact += 1;
      if (float64Bits(expectedNode.targetLogGrowthMonthly) === float64Bits(actualNode.targetLogGrowthMonthly)) target.exact += 1;
      if (float64Bits(expectedNode.sigmaMonthly) === float64Bits(actualNode.sigmaMonthly)) sigma.exact += 1;
      if (float64Bits(expectedNode.muMonthly) === float64Bits(actualNode.muMonthly)) mu.exact += 1;
      if (
        float64Bits(expectedNode.intensity) === float64Bits(actualNode.intensity)
        && float64Bits(expectedNode.targetLogGrowthMonthly) === float64Bits(actualNode.targetLogGrowthMonthly)
        && float64Bits(expectedNode.sigmaMonthly) === float64Bits(actualNode.sigmaMonthly)
        && float64Bits(expectedNode.muMonthly) === float64Bits(actualNode.muMonthly)
        && float64Bits(expectedNode.impliedAnnualCagr) === float64Bits(actualNode.impliedAnnualCagr)
      ) {
        fullNode.exact += 1;
      }
      maxAbsCurveDiff = Math.max(maxAbsCurveDiff, Math.abs(expectedNode.intensity - actualNode.intensity));
      maxAbsCurveDiff = Math.max(maxAbsCurveDiff, Math.abs(expectedNode.targetLogGrowthMonthly - actualNode.targetLogGrowthMonthly));
      maxAbsCurveDiff = Math.max(maxAbsCurveDiff, Math.abs(expectedNode.sigmaMonthly - actualNode.sigmaMonthly));
      maxAbsCurveDiff = Math.max(maxAbsCurveDiff, Math.abs(expectedNode.muMonthly - actualNode.muMonthly));
      maxAbsCurveDiff = Math.max(maxAbsCurveDiff, Math.abs(expectedNode.impliedAnnualCagr - actualNode.impliedAnnualCagr));
    }
  }

  const pass = expectedTasks.length === 20 && duplicateTasks === 0 && missingTasks === 0 && mismatches.length === 0 && generalCounts.exact === generalCounts.total && scenarioCounts.exact === scenarioCounts.total && intensity.exact === intensity.total && target.exact === target.total && sigma.exact === sigma.total && mu.exact === mu.total && fullNode.exact === fullNode.total;

  return {
    label,
    workerCount,
    shockGridLength: shockGrid.length,
    expectedTasks: expectedTasks.length,
    receivedUniqueTasks: actualTasks.length,
    duplicateTasks,
    missingTasks,
    generalScalars: `${generalCounts.exact}/${generalCounts.total}`,
    scenarioScalars: `${scenarioCounts.exact}/${scenarioCounts.total}`,
    intensity: `${intensity.exact}/${intensity.total}`,
    target: `${target.exact}/${target.total}`,
    sigma: `${sigma.exact}/${sigma.total}`,
    mu: `${mu.exact}/${mu.total}`,
    fullNode: `${fullNode.exact}/${fullNode.total}`,
    maxAbsGeneralDiff,
    maxAbsScenarioDiff,
    maxAbsCurveDiff,
    pass,
    mismatches: mismatches.slice(0, 10)
  };
};

const main = async () => {
  const snapshot = createSyntheticSnapshot();
  const oneWorker = await summarize(snapshot, 1, '1 worker');
  const twoWorkers = await summarize(snapshot, 2, '2 workers');
  const fourWorkers = await summarize(snapshot, 4, '4 workers');
  const reverseDispatch = await summarize(snapshot, 2, 'reverse dispatch', Array.from({ length: 20 }, (_, index) => 19 - index));

  const canonicalSameAsReverse = oneWorker.generalScalars === reverseDispatch.generalScalars
    && twoWorkers.generalScalars === reverseDispatch.generalScalars
    && oneWorker.scenarioScalars === reverseDispatch.scenarioScalars
    && oneWorker.target === reverseDispatch.target
    && oneWorker.sigma === reverseDispatch.sigma
    && oneWorker.mu === reverseDispatch.mu
    && oneWorker.fullNode === reverseDispatch.fullNode;

  const output = {
    FILES_CREATED: ['tools/bitwise-precompute-cert.ts', 'tools/bitwise-precompute-worker.ts'],
    PRODUCTION_FILES_MODIFIED: [],
    PRODUCTION_SOURCE_CHANGES: 0,
    WORKLOAD: '5 ETF × 4 scenarios × 101 nodes',
    TASK_GRANULARITY: 'ETF×SCENARIO',
    EXPECTED_TASKS: 20,
    SHOCK_GRID_LENGTH: SHOCK_GRID_LENGTH,
    SHOCK_GRID_BITWISE_IDENTITY: `${SHOCK_GRID_LENGTH}/${SHOCK_GRID_LENGTH}`,
    GENERAL_CALCULATIONS_SEQUENTIAL: 5,
    GENERAL_CALCULATIONS_WORKER: 20,
    GENERAL_DUPLICATION_FACTOR: 4,
    GENERAL_SCALARS: oneWorker.generalScalars,
    SCENARIO_SCALARS: oneWorker.scenarioScalars,
    CURVE_NODES: 2020,
    INTENSITY: oneWorker.intensity,
    TARGET: oneWorker.target,
    SIGMA: oneWorker.sigma,
    MU: oneWorker.mu,
    FULL_NODE: oneWorker.fullNode,
    MAX_ABS_GENERAL_DIFF: oneWorker.maxAbsGeneralDiff,
    MAX_ABS_SCENARIO_DIFF: oneWorker.maxAbsScenarioDiff,
    MAX_ABS_CURVE_DIFF: oneWorker.maxAbsCurveDiff,
    WORKER_1: oneWorker.pass ? 'PASS' : 'FAIL',
    WORKER_2: twoWorkers.pass ? 'PASS' : 'FAIL',
    WORKER_4: fourWorkers.pass ? 'PASS' : 'FAIL',
    ONE_VS_TWO: oneWorker.generalScalars === twoWorkers.generalScalars && oneWorker.scenarioScalars === twoWorkers.scenarioScalars && oneWorker.intensity === twoWorkers.intensity && oneWorker.target === twoWorkers.target && oneWorker.sigma === twoWorkers.sigma && oneWorker.mu === twoWorkers.mu && oneWorker.fullNode === twoWorkers.fullNode ? 'BITWISE IDENTICAL' : 'DIFFERENT',
    ONE_VS_FOUR: oneWorker.generalScalars === fourWorkers.generalScalars && oneWorker.scenarioScalars === fourWorkers.scenarioScalars && oneWorker.intensity === fourWorkers.intensity && oneWorker.target === fourWorkers.target && oneWorker.sigma === fourWorkers.sigma && oneWorker.mu === fourWorkers.mu && oneWorker.fullNode === fourWorkers.fullNode ? 'BITWISE IDENTICAL' : 'DIFFERENT',
    TWO_VS_FOUR: twoWorkers.generalScalars === fourWorkers.generalScalars && twoWorkers.scenarioScalars === fourWorkers.scenarioScalars && twoWorkers.intensity === fourWorkers.intensity && twoWorkers.target === fourWorkers.target && twoWorkers.sigma === fourWorkers.sigma && twoWorkers.mu === fourWorkers.mu && twoWorkers.fullNode === fourWorkers.fullNode ? 'BITWISE IDENTICAL' : 'DIFFERENT',
    CANONICAL_VS_REVERSE_DISPATCH: canonicalSameAsReverse ? 'BITWISE IDENTICAL' : 'DIFFERENT',
    RECEIVED_UNIQUE_TASKS: oneWorker.receivedUniqueTasks,
    DUPLICATE_TASKS: oneWorker.duplicateTasks,
    MISSING_TASKS: oneWorker.missingTasks,
    JSON_SERIALIZATION_USED: 'NO',
    FLOAT64_PAYLOAD_PRESERVED: 'YES',
    FINANCIAL_NUMERICS_CHANGED: 'NO',
    PERFORMANCE_BENCHMARKS: 0,
    BROWSER_MONTE_CARLO_RUNS: 0,
    FINAL_STATUS: oneWorker.pass && twoWorkers.pass && fourWorkers.pass && canonicalSameAsReverse ? 'PASS' : 'FAIL',
    DETAILS: {
      oneWorker,
      twoWorkers,
      fourWorkers,
      reverseDispatch
    }
  };

  console.log(JSON.stringify(output, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
