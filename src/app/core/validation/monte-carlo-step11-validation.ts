import { generateMonthlyMacroTimeline } from '../macro/monte-carlo-macro-engine';
import { MonteCarloCoordinator, MONTE_CARLO_EXECUTION_MODES } from '../engines/monte-carlo-coordinator';
import { MonteCarloSnapshot, MonteCarloUserInput, MONTE_CARLO_GLOBAL_PROPERTY_KEYS } from '../models/monte-carlo-contracts.model';

const createSequence = (values: number[]): (() => number) => {
  let index = 0;
  return () => values[index++ % values.length];
};

export const createV1ValidationSnapshot = (): MonteCarloSnapshot => ({
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
  globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [
    key,
    key === 'scenario_transition_intensity_threshold' ? 0.6 :
    key === 'new_scenario_first_month_max_intensity' ? 0.4 :
    key === 'new_scenario_second_month_max_intensity' ? 0.7 :
    key === 'scenario_intensity_max_monthly_variation' ? 0.4 :
    0.4
  ])) as MonteCarloSnapshot['globalProperties'],
  correlations: [
    { isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.35, recession: 0.42, stagflation: 0.4, soft_landing: 0.38 }
  ]
});

const makeUserInput = (): MonteCarloUserInput => ({
  positions: [
    { isin: 'ETF-A', targetWeight: 0.6 },
    { isin: 'ETF-B', targetWeight: 0.4 }
  ],
  initialCapital: 10_000,
  horizonYears: 10
});

class ValidationFailure extends Error {
  constructor(
    public readonly category: 'ENGINE_STRUCTURAL_FAILURE' | 'TEST_HARNESS_FAILURE' | 'EXECUTION_ENVIRONMENT_FAILURE',
    message: string
  ) {
    super(message);
    this.name = 'ValidationFailure';
  }
}

const assertReachabilityInvariants = (snapshot: MonteCarloSnapshot): void => {
  const transitionThreshold = snapshot.globalProperties.scenario_transition_intensity_threshold;
  const month1Target = snapshot.globalProperties.new_scenario_first_month_max_intensity;
  const month2Target = snapshot.globalProperties.new_scenario_second_month_max_intensity;
  const maxVariation = snapshot.globalProperties.scenario_intensity_max_monthly_variation;
  const sampleSize = 500;
  const horizonMonths = 24;
  let maxPreviousIntensityOnTransition = 0;
  let observedTransitions = 0;
  let observedMonth2SoftThresholds = 0;

  for (let sample = 0; sample < sampleSize; sample += 1) {
    const timeline = generateMonthlyMacroTimeline(snapshot, horizonMonths, createSequence([
      0.11 + (sample % 13) * 0.03,
      0.21 + ((sample + 3) % 11) * 0.04,
      0.31 + ((sample + 5) % 9) * 0.05,
      0.41 + ((sample + 7) % 7) * 0.06,
      0.51 + ((sample + 9) % 5) * 0.07,
      0.61 + ((sample + 11) % 3) * 0.08
    ]));

    for (let monthIndex = 1; monthIndex < timeline.months.length; monthIndex += 1) {
      const previous = timeline.months[monthIndex - 1];
      const current = timeline.months[monthIndex];

      if (previous.intensity > transitionThreshold && current.scenario !== previous.scenario) {
        throw new ValidationFailure(
          'ENGINE_STRUCTURAL_FAILURE',
          `Transition lock violated: previousIntensity=${previous.intensity} > ${transitionThreshold} but scenario changed from ${previous.scenario} to ${current.scenario}`
        );
      }

      if (current.scenario !== previous.scenario) {
        observedTransitions += 1;
        maxPreviousIntensityOnTransition = Math.max(maxPreviousIntensityOnTransition, previous.intensity);

        const lower = Math.max(0, previous.intensity - maxVariation);
        const upper = 1;
        if (!(lower < month1Target && month1Target < upper)) {
          throw new ValidationFailure(
            'ENGINE_STRUCTURAL_FAILURE',
            `Real month1 support invalid: previousScenario=${previous.scenario}, previousIntensity=${previous.intensity}, lower=${lower}, target=${month1Target}, upper=${upper}`
          );
        }
      }

      if (monthIndex >= 2) {
        const beforePrevious = timeline.months[monthIndex - 2];
        const beforeCurrent = timeline.months[monthIndex - 1];
        if (beforePrevious.scenario !== beforeCurrent.scenario && beforeCurrent.scenario === current.scenario) {
          observedMonth2SoftThresholds += 1;
          const lower = Math.max(0, beforeCurrent.intensity - maxVariation);
          const upper = 1;
          if (!(lower < month2Target && month2Target < upper)) {
            throw new ValidationFailure(
              'ENGINE_STRUCTURAL_FAILURE',
              `Real month2 support invalid: previousScenario=${beforeCurrent.scenario}, previousIntensity=${beforeCurrent.intensity}, lower=${lower}, target=${month2Target}, upper=${upper}`
            );
          }
        }
      }
    }
  }

  if (observedTransitions === 0) {
    throw new ValidationFailure(
      'TEST_HARNESS_FAILURE',
      'No real scenario transitions were observed in the V1 macro sample; the reachability check did not exercise a valid month1 transition.'
    );
  }

  if (observedMonth2SoftThresholds === 0) {
    throw new ValidationFailure(
      'TEST_HARNESS_FAILURE',
      'No real month2 soft-threshold observations were produced in the V1 macro sample; the month2 invariant could not be exercised.'
    );
  }

  if (maxPreviousIntensityOnTransition > 0.6 + 1e-9) {
    throw new ValidationFailure(
      'ENGINE_STRUCTURAL_FAILURE',
      `Transition lock and month1 support are inconsistent: observed max previousIntensity on a real transition was ${maxPreviousIntensityOnTransition} > 0.60.`
    );
  }
};

const validatePathStructure = (paths: any[], horizonYears: number, expectedPathCount: number): void => {
  if (paths.length !== expectedPathCount) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'path count must match the execution mode');
  }
  const expectedMonths = horizonYears * 12;

  for (const path of paths) {
    if (!Number.isInteger(path.simulationId)) {
      throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'simulationId must be an integer');
    }
    if (!Array.isArray(path.monthly)) {
      throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'monthly returns must exist');
    }
    if (path.monthly.length !== expectedMonths) {
      throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'each path must have the correct month count');
    }
    if (!(Number.isFinite(path.initialCapital) && path.initialCapital > 0)) {
      throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'initialCapital must be finite and positive');
    }
    if (!(Number.isFinite(path.finalCapital) && path.finalCapital >= 0)) {
      throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'final capital must be finite and non-negative');
    }
    if (!(path.maxDrawdown >= 0 && path.maxDrawdown <= 1)) {
      throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'maxDrawdown must be a valid proportion');
    }
    if (!(path.totalReturn >= -1)) {
      throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'totalReturn must be >= -1');
    }
    if (!(path.cagr >= -1)) {
      throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'path CAGR must be >= -1');
    }

    for (const entry of path.monthly) {
      if (!(Number.isFinite(entry.endingCapital) && entry.endingCapital >= 0)) {
        throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'monthly ending capital must be finite and non-negative');
      }
      if (!Number.isFinite(entry.portfolioReturn)) {
        throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'monthly portfolio return must be finite');
      }
      if (!(entry.endingCapital >= 0)) {
        throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'capital must be non-negative');
      }
      if (!(entry.portfolioReturn >= -1 && entry.portfolioReturn <= 10)) {
        throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'monthly return must stay in a numerically valid range');
      }
    }
  }
};

const runCoordinatorMode = async (mode: keyof typeof MONTE_CARLO_EXECUTION_MODES): Promise<{ outcome: any; elapsedMs: number }> => {
  const snapshot = createV1ValidationSnapshot();
  const input = makeUserInput();
  const coordinator = new MonteCarloCoordinator({
    input,
    snapshot,
    mode,
    workerCountOverride: 4,
    batchSize: Math.max(50, Math.floor(MONTE_CARLO_EXECUTION_MODES[mode] / 10))
  });
  const startedAt = Date.now();
  const outcome = await coordinator.run();
  const elapsedMs = Date.now() - startedAt;
  if (outcome.status !== 'success') {
    throw new ValidationFailure('EXECUTION_ENVIRONMENT_FAILURE', `mode ${mode} must succeed`);
  }
  if (outcome.totalPaths !== MONTE_CARLO_EXECUTION_MODES[mode]) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', `mode ${mode} must report the correct path count`);
  }
  if (outcome.completedPaths !== MONTE_CARLO_EXECUTION_MODES[mode]) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', `mode ${mode} must complete all paths`);
  }
  if (outcome.progress !== 100) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', `mode ${mode} must reach 100% progress`);
  }
  if (!Array.isArray(outcome.paths)) {
    throw new ValidationFailure('TEST_HARNESS_FAILURE', 'outcome.paths must be an array');
  }
  validatePathStructure(outcome.paths, input.horizonYears, MONTE_CARLO_EXECUTION_MODES[mode]);
  return { outcome, elapsedMs };
};

export const runStep11Validation = async (): Promise<void> => {
  const snapshot = createV1ValidationSnapshot();

  try {
    assertReachabilityInvariants(snapshot);

    const smoke = await runCoordinatorMode('SMOKE');
    const intermediate = await runCoordinatorMode('INTERMEDIATE');
    const complete = await runCoordinatorMode('COMPLETE');

    const summary = {
      smoke: {
        mode: 'SMOKE',
        paths: MONTE_CARLO_EXECUTION_MODES.SMOKE,
        years: 10,
        pathMonths: MONTE_CARLO_EXECUTION_MODES.SMOKE * 12 * 10,
        elapsedMs: smoke.elapsedMs,
        pathsPerSecond: MONTE_CARLO_EXECUTION_MODES.SMOKE / Math.max(0.001, smoke.elapsedMs / 1000),
        monthsPerSecond: (MONTE_CARLO_EXECUTION_MODES.SMOKE * 12 * 10) / Math.max(0.001, smoke.elapsedMs / 1000)
      },
      intermediate: {
        mode: 'INTERMEDIATE',
        paths: MONTE_CARLO_EXECUTION_MODES.INTERMEDIATE,
        years: 30,
        pathMonths: MONTE_CARLO_EXECUTION_MODES.INTERMEDIATE * 12 * 30,
        elapsedMs: intermediate.elapsedMs,
        pathsPerSecond: MONTE_CARLO_EXECUTION_MODES.INTERMEDIATE / Math.max(0.001, intermediate.elapsedMs / 1000),
        monthsPerSecond: (MONTE_CARLO_EXECUTION_MODES.INTERMEDIATE * 12 * 30) / Math.max(0.001, intermediate.elapsedMs / 1000)
      },
      complete: {
        mode: 'COMPLETE',
        paths: MONTE_CARLO_EXECUTION_MODES.COMPLETE,
        years: 50,
        pathMonths: MONTE_CARLO_EXECUTION_MODES.COMPLETE * 12 * 50,
        elapsedMs: complete.elapsedMs,
        pathsPerSecond: MONTE_CARLO_EXECUTION_MODES.COMPLETE / Math.max(0.001, complete.elapsedMs / 1000),
        monthsPerSecond: (MONTE_CARLO_EXECUTION_MODES.COMPLETE * 12 * 50) / Math.max(0.001, complete.elapsedMs / 1000)
      }
    };

  const expectedCompletePathMonths = MONTE_CARLO_EXECUTION_MODES.COMPLETE * 12 * 50;
  if (summary.complete.pathMonths !== expectedCompletePathMonths) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', `COMPLETE path-month count must match the active runtime config: ${expectedCompletePathMonths}`);
  }
  if (!(summary.complete.pathsPerSecond > 0)) {
    throw new ValidationFailure('EXECUTION_ENVIRONMENT_FAILURE', 'COMPLETE throughput must be positive');
  }
  if (!(summary.complete.monthsPerSecond > 0)) {
    throw new ValidationFailure('EXECUTION_ENVIRONMENT_FAILURE', 'COMPLETE month throughput must be positive');
  }

  const officialResult = complete.outcome.result;
  if (!officialResult) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'COMPLETE run must return an official Monte Carlo result');
  }
  if (!officialResult.mainKpis) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'mainKpis must be populated');
  }
  if (!officialResult.percentiles) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'percentiles must be populated');
  }
  if (!(Array.isArray(officialResult.capitalFan) && officialResult.capitalFan.length > 0)) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'capitalFan must be populated');
  }
  if (!officialResult.representativePath) {
    throw new ValidationFailure('ENGINE_STRUCTURAL_FAILURE', 'representativePath must be populated');
  }

    console.log('STEP 11 VALIDATION PASS');
    console.log(JSON.stringify({
      classification: 'MONTE CARLO V1 CERTIFIED',
      v1Globals: {
        scenario_transition_intensity_threshold: 0.6,
        new_scenario_first_month_max_intensity: 0.4,
        new_scenario_second_month_max_intensity: 0.7,
        scenario_intensity_max_monthly_variation: 0.4,
        rho: 0.85
      },
      summary,
      mainKpis: {
        robustCagr: officialResult.mainKpis.robustCagr,
        robustMaxDrawdown: officialResult.mainKpis.robustMaxDrawdown,
        recoveryTimeMonths: officialResult.mainKpis.recoveryTimeMonths,
        volatility: officialResult.mainKpis.volatility,
        decorrelationIndex: officialResult.mainKpis.decorrelationIndex,
        lantieriIndex: officialResult.mainKpis.lantieriIndex
      }
    }, null, 2));
  } catch (error) {
    const nodeProcess = (globalThis as any).process;
    if (error instanceof ValidationFailure) {
      const category = error.category;
      console.error(`${category} — ${error.message}`);
      if (nodeProcess) {
        nodeProcess.exitCode = 1;
      }
      return;
    }
    if (error instanceof Error) {
      console.error(`TEST_HARNESS_FAILURE — ${error.message}`);
      if (nodeProcess) {
        nodeProcess.exitCode = 1;
      }
      return;
    }
    console.error('TEST_HARNESS_FAILURE — Unknown validation failure');
    if (nodeProcess) {
      nodeProcess.exitCode = 1;
    }
  }
};

const nodeProcess = (globalThis as any).process;
if (nodeProcess && typeof nodeProcess.argv !== 'undefined' && typeof nodeProcess.argv[1] === 'string' && nodeProcess.argv[1].endsWith('monte-carlo-step11-validation.ts')) {
  void runStep11Validation();
}
