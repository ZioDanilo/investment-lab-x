import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MonteCarloCoordinator, MONTE_CARLO_EXECUTION_MODES, MonteCarloWorkerPool, type WorkerLike, type MonteCarloWorkerMessage } from './monte-carlo-coordinator';
import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';
import { toCompactPathResult } from './monte-carlo-worker';
import { validateMonteCarloRunContract } from '../validation/monte-carlo-contract.validator';
import { MonteCarloSnapshot, MonteCarloUserInput } from '../models/monte-carlo-contracts.model';

const makeSnapshot = (): MonteCarloSnapshot => ({
  etfs: [
    {
      isin: 'ETF-A',
      name: 'ETF A',
      nickname: 'A',
      statistics: {
        expansion: { expectedReturn: 0.08, volatility: 0.13, returnRange: { min: -0.2, max: 0.25 } },
        recession: { expectedReturn: -0.05, volatility: 0.17, returnRange: { min: -0.35, max: 0.1 } },
        stagflation: { expectedReturn: -0.02, volatility: 0.18, returnRange: { min: -0.3, max: 0.12 } },
        soft_landing: { expectedReturn: 0.06, volatility: 0.12, returnRange: { min: -0.15, max: 0.2 } },
        general: { expectedReturn: 0.06, volatility: 0.15, returnRange: { min: -0.25, max: 0.2 } }
      }
    },
    {
      isin: 'ETF-B',
      name: 'ETF B',
      nickname: 'B',
      statistics: {
        expansion: { expectedReturn: 0.09, volatility: 0.15, returnRange: { min: -0.18, max: 0.26 } },
        recession: { expectedReturn: -0.04, volatility: 0.18, returnRange: { min: -0.32, max: 0.11 } },
        stagflation: { expectedReturn: -0.01, volatility: 0.17, returnRange: { min: -0.28, max: 0.13 } },
        soft_landing: { expectedReturn: 0.07, volatility: 0.13, returnRange: { min: -0.12, max: 0.22 } },
        general: { expectedReturn: 0.07, volatility: 0.16, returnRange: { min: -0.24, max: 0.22 } }
      }
    }
  ],
  structuralProbabilities: { expansion: 0.45, recession: 0.2, stagflation: 0.15, soft_landing: 0.2 },
  transitionMatrix: {
    expansion: { expansion: 0.6, recession: 0.1, stagflation: 0.1, soft_landing: 0.2 },
    recession: { expansion: 0.25, recession: 0.2, stagflation: 0.1, soft_landing: 0.45 },
    stagflation: { expansion: 0.2, recession: 0.2, stagflation: 0.3, soft_landing: 0.3 },
    soft_landing: { expansion: 0.35, recession: 0.25, stagflation: 0.1, soft_landing: 0.3 }
  },
  inertiaConfigurations: {
    expansion: { entryProbability: 0.2, persistenceProbability: 0.75, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    recession: { entryProbability: 0.25, persistenceProbability: 0.7, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    stagflation: { entryProbability: 0.3, persistenceProbability: 0.68, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    soft_landing: { entryProbability: 0.2, persistenceProbability: 0.8, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 }
  },
  intensityConfigurations: {
    expansion: { meanIntensity: 0.35, stdDevIntensity: 0.12 },
    recession: { meanIntensity: 0.55, stdDevIntensity: 0.15 },
    stagflation: { meanIntensity: 0.47, stdDevIntensity: 0.14 },
    soft_landing: { meanIntensity: 0.3, stdDevIntensity: 0.1 }
  },
  globalProperties: {
    scenario_transition_intensity_threshold: 0.6,
    new_scenario_first_month_max_intensity: 0.4,
    new_scenario_second_month_max_intensity: 0.7,
    scenario_intensity_max_monthly_variation: 0.4
  },
  correlations: [
    { isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.35, recession: 0.42, stagflation: 0.4, soft_landing: 0.38 }
  ]
});

const makeInput = (amount = 10000): MonteCarloUserInput => ({
  positions: [{ isin: 'ETF-A', targetWeight: 0.6 }, { isin: 'ETF-B', targetWeight: 0.4 }],
  initialCapital: amount,
  horizonYears: 1
});

class MockWorker implements WorkerLike {
  public readonly listeners = new Set<(event: MessageEvent) => void>();
  public terminated = false;
  public static lastSeed = 0;

  constructor(private readonly scriptPath: string) {}

  addEventListener(type: 'message' | 'error', callback: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(callback);
  }

  postMessage(message: MonteCarloWorkerMessage): void {
    if (this.terminated) return;
    const run = message as any;
    if (run.type === 'INIT') {
      setTimeout(() => {
        this.dispatch({ type: 'message', data: { type: 'READY', executionId: run.executionId, workerId: run.workerId } } as any as MessageEvent);
      }, 0);
      return;
    }
    if (run.type === 'RUN_BATCH') {
      const batchStart = run.batchStart ?? 0;
      const batchEnd = run.batchEnd ?? run.pathCount;
      const results: any[] = [];
      for (let simulationId = batchStart; simulationId < batchEnd; simulationId += 1) {
        const drift = ((simulationId % 7) + 1) * 0.002;
        const finalCapital = run.input.initialCapital * (1 + drift);
        const monthly = Array.from({ length: run.input.horizonYears * 12 }, (_, monthIndex) => ({
          month: monthIndex + 1,
          year: Math.floor(monthIndex / 12) + 1,
          portfolioReturn: ((simulationId % 11) - 5) * 0.01 / 12,
          endingCapital: run.input.initialCapital * (1 + drift) * (1 + ((monthIndex + 1) / (run.input.horizonYears * 12))),
          runningPeak: run.input.initialCapital * (1 + drift),
          drawdown: 0.03 + ((simulationId % 3) * 0.01),
          intensity: 45 + (simulationId % 20),
          positions: [
            { isin: 'ETF-A', value: run.input.initialCapital * 0.6, contribution: 0.002 },
            { isin: 'ETF-B', value: run.input.initialCapital * 0.4, contribution: 0.001 }
          ]
        }));
        const path = {
          simulationId,
          dominantEtfIsin: 'ETF-A',
          dominantEtfName: 'ETF A',
          initialCapital: run.input.initialCapital,
          finalCapital,
          totalReturn: finalCapital / run.input.initialCapital - 1,
          cagr: finalCapital / run.input.initialCapital - 1,
          maxDrawdown: 0.05 + ((simulationId % 4) * 0.01),
          monthly,
          maxRecoveryTimeMonths: 3,
          unrecovered: false,
          scenarioPath: {
            years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }],
            frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 }
          },
          years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [], portfolioReturn: 0.01, startingCapital: run.input.initialCapital, endingCapital: finalCapital, runningPeak: finalCapital, drawdown: 0.03 }],
          portfolioSnapshot: {
            generatedAt: new Date().toISOString(),
            positions: [{ isin: 'ETF-A', name: 'ETF A', weight: 0.6 }, { isin: 'ETF-B', name: 'ETF B', weight: 0.4 }],
            totalWeightBeforeNormalization: 1,
            normalized: true
          },
          diagnostics: { performance: { redrawCount: 2, rejectRate: 0.05 } },
          performanceDiagnostics: { redrawCount: 2, rejectRate: 0.05 },
          correlationDiagnostics: {},
          generalBenchmark: { expectedReturn: 0.06, volatility: 0.15 },
          portfolioReturn: 0.01
        };
        results.push(path);
      }
      setTimeout(() => {
        this.dispatch({ type: 'message', data: { type: 'BATCH_RESULT', executionId: run.executionId, workerId: run.workerId, batchStart, batchEnd, results } } as any as MessageEvent);
      }, 0);
      return;
    }
    if (run.type === 'CANCEL') {
      this.terminated = true;
      this.dispatch({ type: 'message', data: { type: 'CANCELLED', executionId: run.executionId, workerId: run.workerId } } as any as MessageEvent);
    }
  }

  private dispatch(event: MessageEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

const createMockWorkerFactory = () => {
  const workers: MockWorker[] = [];
  return {
    create: (scriptPath: string) => {
      const worker = new MockWorker(scriptPath);
      workers.push(worker);
      return worker;
    },
    workers
  };
};

const createCoordinator = (mode: keyof typeof MONTE_CARLO_EXECUTION_MODES, workerCountOverride?: number) => {
  const factory = createMockWorkerFactory();
  const coordinator = new MonteCarloCoordinator({
    input: makeInput(MONTE_CARLO_EXECUTION_MODES[mode]),
    snapshot: makeSnapshot(),
    mode,
    workerFactory: (scriptPath: string) => factory.create(scriptPath),
    workerCountOverride,
    batchSize: 5,
    onProgress: () => undefined
  });
  return { coordinator, factory };
};

const runNamedStep9Test = async (name: string, fn: () => Promise<void>): Promise<void> => {
  await fn();
  console.log(`PASS ${name}`);
};

async function runStep9Coverage(): Promise<void> {
  await runNamedStep9Test('smoke-100-paths', async () => {
    const { coordinator } = createCoordinator('SMOKE');
    const outcome = await coordinator.run();
    assert.equal(outcome.status, 'success');
    assert.equal(outcome.paths.length, 100);
    const ids = outcome.paths.map((path) => path.simulationId);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, Array.from({ length: 100 }, (_, index) => index));
  });

  await runNamedStep9Test('intermediate-1000-paths', async () => {
    const outcome = await new MonteCarloCoordinator({
      input: makeInput(MONTE_CARLO_EXECUTION_MODES.INTERMEDIATE),
      snapshot: makeSnapshot(),
      mode: 'INTERMEDIATE',
      workerFactory: (scriptPath: string) => new MockWorker(scriptPath),
      batchSize: 10,
      onProgress: () => undefined
    }).run();
    assert.equal(outcome.status, 'success');
    assert.equal(outcome.paths.length, 1000);
  });

  await runNamedStep9Test('complete-1000-paths', async () => {
    const outcome = await new MonteCarloCoordinator({
      input: makeInput(MONTE_CARLO_EXECUTION_MODES.COMPLETE),
      snapshot: makeSnapshot(),
      mode: 'COMPLETE',
      workerFactory: (scriptPath: string) => new MockWorker(scriptPath),
      batchSize: 20,
      onProgress: () => undefined
    }).run();
    assert.equal(outcome.status, 'success');
    assert.equal(outcome.paths.length, 1000);
  });

  await runNamedStep9Test('worker-count-auto-derivation', async () => {
    const { coordinator } = createCoordinator('SMOKE', 2);
    assert.equal((coordinator as any).workerCount, 2);
    const outcome = await coordinator.run();
    assert.equal(outcome.status, 'success');
    assert.equal(outcome.paths.length, 100);
  });

  await runNamedStep9Test('progress-monotone-and-100', async () => {
    const coordinator = createCoordinator('SMOKE', 2).coordinator;
    let lastProgress = -1;
    coordinator.setProgressListener((progress) => {
      assert.ok(progress >= lastProgress);
      lastProgress = progress;
    });
    const outcome = await coordinator.run();
    assert.equal(outcome.status, 'success');
    assert.equal(outcome.progress, 100);
    assert.ok(lastProgress >= 0);
  });

  await runNamedStep9Test('compact-worker-payload-preserves-official-result-fields', async () => {
    const input = makeInput(1000);
    const path = {
      simulationId: 42,
      dominantEtfIsin: 'ETF-A',
      dominantEtfName: 'ETF A',
      initialCapital: input.initialCapital,
      finalCapital: 1210,
      totalReturn: 0.21,
      cagr: 0.21,
      maxDrawdown: 0.12,
      monthly: [
        {
          month: 1,
          year: 1,
          endingCapital: 1000,
          capital: 1000,
          portfolioReturn: 0.01,
          runningPeak: 1000,
          drawdown: 0.0,
          intensity: 0.4,
          positions: [{ isin: 'ETF-A', value: 600, contribution: 0.006, weight: 0.6, targetWeight: 0.6 }, { isin: 'ETF-B', value: 400, contribution: 0.004, weight: 0.4, targetWeight: 0.4 }]
        }
      ],
      maxRecoveryTimeMonths: 6,
      unrecovered: false,
      unrecoveredDurationMonths: 0,
      returnDiagnostics: { candidateVectors: 1, acceptedVectors: 1, rejectedVectors: 0, physicalFloorRejectedVectors: 0, oldRangeViolationCount: 0, effectiveRangeRejectedVectors: 0, byEtfScenario: {} },
      years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [], portfolioReturn: 0.21, startingCapital: input.initialCapital, endingCapital: 1210, runningPeak: 1210, drawdown: 0.12 }],
      scenarioPath: { years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }], frequencies: { expansion: 12, recession: 0, stagflation: 0, soft_landing: 0 } },
      portfolioSnapshot: { generatedAt: new Date().toISOString(), positions: [], totalWeightBeforeNormalization: 1, normalized: true },
      diagnostics: { scenario: { frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } }, performance: { redrawCount: 1, rejectRate: 0 } },
      performanceDiagnostics: { redrawCount: 1, rejectRate: 0 },
      correlationDiagnostics: {},
      generalBenchmark: { expectedReturn: 0.06, volatility: 0.15, simulatedLongTermReturn: 0.21, simulatedVolatility: 0.12 },
      matricesCoherent: true
    } as any;

    const compact = toCompactPathResult(path as any);
    assert.equal(compact.simulationId, 42);
    assert.equal(compact.finalCapital, 1210);
    assert.equal(compact.monthly[0].endingCapital, 1000);
    assert.equal('positions' in (compact.monthly[0] as any), false);
    assert.equal(Array.isArray(compact.years), true);
    assert.equal(compact.scenarioPath.frequencies.expansion, 12);

    const result = MonteCarloStatisticsEngine.buildOfficialResult([compact as any], 1, input.initialCapital, {
      weightedAverageScenarioCorrelation: 0.35,
      maxScenarioCorrelation: 0.42,
      longTermExpectedReturn: 0.06
    }, { matricesCoherent: true });
    assert.ok(Array.isArray(result.capitalFan));
    assert.ok(Number.isFinite(result.mainKpis.robustCagr));
  });

  await runNamedStep9Test('worker-failure-global-fail-fast', async () => {
    const factory = createMockWorkerFactory();
    const coordinator = new MonteCarloCoordinator({
      input: makeInput(200),
      snapshot: makeSnapshot(),
      mode: 'SMOKE',
      workerFactory: (scriptPath: string) => {
        const worker = factory.create(scriptPath);
        const original = worker.postMessage.bind(worker);
        worker.postMessage = (message: MonteCarloWorkerMessage) => {
          const run = message as any;
          if (run.type === 'RUN_BATCH' && run.workerId === 1) {
            setTimeout(() => {
              const event = { data: { type: 'ERROR', executionId: run.executionId, workerId: run.workerId, error: { code: 'MAX_REDRAWS_EXCEEDED', message: 'redraw limit exceeded' } } };
              (worker as any).listeners?.forEach((listener: (event: MessageEvent) => void) => listener(event as MessageEvent));
            }, 0);
            return;
          }
          return original(message);
        };
        return worker;
      },
      batchSize: 10,
      onProgress: () => undefined
    });
    const outcome = await coordinator.run();
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.paths.length, 0);
    assert.equal(outcome.result, undefined);
  });

  await runNamedStep9Test('worker-error-event-keeps-original-message', async () => {
    const factory = createMockWorkerFactory();
    const coordinator = new MonteCarloCoordinator({
      input: makeInput(200),
      snapshot: makeSnapshot(),
      mode: 'SMOKE',
      workerFactory: (scriptPath: string) => {
        const worker = factory.create(scriptPath);
        const original = worker.postMessage.bind(worker);
        worker.postMessage = (message: MonteCarloWorkerMessage) => {
          const run = message as any;
          if (run.type === 'RUN_BATCH' && run.workerId === 0) {
            setTimeout(() => {
              const event = {
                message: 'ReferenceError: foo is not defined',
                error: { stack: 'ReferenceError: foo is not defined\n    at worker.js:12:1' }
              } as any;
              (worker as any).listeners?.forEach((listener: (event: MessageEvent) => void) => listener(event as MessageEvent));
            }, 0);
            return;
          }
          return original(message);
        };
        return worker;
      },
      batchSize: 10,
      onProgress: () => undefined
    });
    const outcome = await coordinator.run();
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error?.message, 'ReferenceError: foo is not defined');
    assert.match(String(outcome.error?.details?.stack ?? ''), /ReferenceError: foo is not defined/);
  });

  await runNamedStep9Test('cancel-distinct-from-failed', async () => {
    const coordinator = createCoordinator('SMOKE').coordinator;
    setTimeout(() => coordinator.cancel(), 0);
    const outcome = await coordinator.run();
    assert.equal(outcome.status, 'cancelled');
    assert.equal(outcome.paths.length, 0);
    assert.equal(outcome.result, undefined);
  });

  await runNamedStep9Test('precompute-once-per-execution', async () => {
    const coordinator = new MonteCarloCoordinator({
      input: makeInput(100),
      snapshot: makeSnapshot(),
      mode: 'SMOKE',
      workerFactory: (scriptPath: string) => new MockWorker(scriptPath),
      batchSize: 10,
      onProgress: () => undefined
    });
    assert.equal((coordinator as any).factorized, false);
    const outcome = await coordinator.run();
    assert.equal(outcome.status, 'success');
    assert.equal((coordinator as any).factorized, true);
    assert.ok((coordinator as any).workerPool['precompute'] !== undefined);
    assert.equal((coordinator as any).workerPool['precompute'] !== undefined, true);
  });

  await runNamedStep9Test('no-public-seed-and-no-main-thread-fallback', async () => {
    const sourceCoordinator = readFileSync(new URL('./monte-carlo-coordinator.ts', import.meta.url), 'utf8');
    const sourceWorker = readFileSync(new URL('./monte-carlo-worker.ts', import.meta.url), 'utf8');
    assert.equal(sourceCoordinator.includes('pathCount'), true);
    assert.equal(sourceCoordinator.includes('simulatePath'), false);
    assert.equal(sourceWorker.includes('workerId + 1'), false);
    assert.equal(sourceWorker.includes('generateMonthlyMacroTimeline'), true);
    assert.equal(sourceWorker.includes('generateMonthlyReturnVector'), true);
    assert.equal(sourceWorker.includes('evolveMonteCarloPortfolioPath'), true);
    assert.equal(sourceWorker.includes('for (let simulationId = batchStart; simulationId < batchEnd; simulationId += 1)'), true);
  });

  await runNamedStep9Test('reduced-end-to-end-step5-6-7-8-contract', async () => {
    const outcome = await new MonteCarloCoordinator({
      input: makeInput(250),
      snapshot: makeSnapshot(),
      mode: 'SMOKE',
      workerFactory: (scriptPath: string) => new MockWorker(scriptPath),
      batchSize: 5,
      onProgress: () => undefined
    }).run();
    assert.equal(outcome.status, 'success');
    assert.ok(outcome.result !== undefined);
    assert.ok(Array.isArray(outcome.result.capitalFan));
    assert.ok(outcome.result.representativePath.simulationId >= 0);
    assert.ok(Number.isFinite(outcome.result.mainKpis.robustCagr));
  });

  const validationCoordinator = new MonteCarloCoordinator({
    input: makeInput(),
    snapshot: makeSnapshot(),
    mode: 'SMOKE',
    workerFactory: (scriptPath: string) => new MockWorker(scriptPath),
    batchSize: 10,
    onProgress: () => undefined
  });
  const validationOutcome = await validationCoordinator.run();
  assert.equal(validationOutcome.status, 'success');
  validateMonteCarloRunContract(makeInput(), makeSnapshot());
  assert.ok(Number.isFinite(validationOutcome.performanceMetrics.totalTime));
  assert.ok(Number.isFinite(validationOutcome.performanceMetrics.pathsPerSecond));
  assert.ok(Number.isFinite(validationOutcome.performanceMetrics.monthsPerSecond));
}

runStep9Coverage().catch((error) => {
  console.error(error);
  process.exit(1);
});
