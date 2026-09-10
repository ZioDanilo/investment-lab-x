import { MonteCarloCoordinator } from './src/app/core/engines/monte-carlo-coordinator.ts';

const snapshot = {
  etfs: [{
    isin: 'ETF-A',
    name: 'ETF A',
    nickname: 'A',
    statistics: {
      expansion: { expectedReturn: 0.08, volatility: 0.15, returnRange: { min: -0.3, max: 0.3 } },
      recession: { expectedReturn: -0.02, volatility: 0.18, returnRange: { min: -0.35, max: 0.25 } },
      stagflation: { expectedReturn: -0.04, volatility: 0.2, returnRange: { min: -0.4, max: 0.2 } },
      soft_landing: { expectedReturn: 0.05, volatility: 0.14, returnRange: { min: -0.25, max: 0.28 } },
      general: { expectedReturn: 0.06, volatility: 0.15, returnRange: { min: -0.25, max: 0.25 } }
    }
  }],
  structuralProbabilities: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 },
  transitionMatrix: { expansion: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 }, recession: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 }, stagflation: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 }, soft_landing: { expansion: 0.25, recession: 0.25, stagflation: 0.25, soft_landing: 0.25 } },
  inertiaConfigurations: { expansion: { entryProbability: 0.5, persistenceProbability: 0.5, entryMonths: 1, exitStartMonth: 2, exitDecay: 0.1 }, recession: { entryProbability: 0.5, persistenceProbability: 0.5, entryMonths: 1, exitStartMonth: 2, exitDecay: 0.1 }, stagflation: { entryProbability: 0.5, persistenceProbability: 0.5, entryMonths: 1, exitStartMonth: 2, exitDecay: 0.1 }, soft_landing: { entryProbability: 0.5, persistenceProbability: 0.5, entryMonths: 1, exitStartMonth: 2, exitDecay: 0.1 } },
  intensityConfigurations: { expansion: { meanIntensity: 0.2, stdDevIntensity: 0.05 }, recession: { meanIntensity: 0.2, stdDevIntensity: 0.05 }, stagflation: { meanIntensity: 0.2, stdDevIntensity: 0.05 }, soft_landing: { meanIntensity: 0.2, stdDevIntensity: 0.05 } },
  globalProperties: { scenario_transition_intensity_threshold: 0.4, new_scenario_first_month_max_intensity: 0.4, new_scenario_second_month_max_intensity: 0.4, scenario_intensity_max_monthly_variation: 0.1 },
  correlations: []
};

const input = { positions: [{ isin: 'ETF-A', targetWeight: 1 }], initialCapital: 10000, horizonYears: 1 };
let generalStartedAt = -1;
let mainCompletedAt = -1;

class MockMainWorker {
  constructor() { this.listeners = new Set(); }
  addEventListener(type, cb) { if (type === 'message') this.listeners.add(cb); }
  postMessage(msg) {
    if (msg.type === 'INIT') {
      setTimeout(() => this.dispatch({ data: { type: 'READY', executionId: msg.executionId, workerId: msg.workerId } }), 0);
      return;
    }
    if (msg.type === 'RUN_BATCH') {
      setTimeout(() => {
        this.dispatch({ data: { type: 'BATCH_RESULT', executionId: msg.executionId, workerId: msg.workerId, batchStart: msg.batchStart, batchEnd: msg.batchEnd, results: [{ simulationId: 0, initialCapital: 10000, finalCapital: 11000, totalReturn: 0.1, cagr: 0.1, maxDrawdown: 0.05, monthly: [], maxRecoveryTimeMonths: 1, unrecovered: false, scenarioPath: { years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12 }], frequencies: { expansion: 1, recession: 0, stagflation: 0, soft_landing: 0 } }, years: [{ year: 1, scenario: 'expansion', durationInCurrentScenario: 12, etfReturns: [], portfolioReturn: 0.1, startingCapital: 10000, endingCapital: 11000, runningPeak: 11000, drawdown: 0.05 }], performanceDiagnostics: {}, correlationDiagnostics: {}, generalBenchmark: { expectedReturn: 0.06, volatility: 0.15 }, matricesCoherent: true }] } });
      }, 15);
      setTimeout(() => {
        mainCompletedAt = Date.now();
        this.dispatch({ data: { type: 'SIMULATION_COMPLETE', executionId: msg.executionId, workerId: msg.workerId, completedPaths: 1, totalPaths: 1 } });
      }, 25);
    }
  }
  dispatch(event) { for (const cb of [...this.listeners]) cb(event); }
  terminate() {}
}

class MockGeneralWorker {
  constructor() { this.listeners = new Set(); }
  addEventListener(type, cb) { if (type === 'message') this.listeners.add(cb); }
  postMessage(msg) {
    if (msg.type === 'RUN_GENERAL_BENCHMARK') {
      generalStartedAt = Date.now();
      setTimeout(() => this.dispatch({ data: { type: 'GENERAL_BENCHMARK_RESULT', executionId: msg.executionId, workerId: msg.workerId, result: { executionId: msg.executionId, generalBenchmarkCAGR: 0.07, generalBenchmarkVolatility: 0.16, completedPaths: 1, monthsProcessed: 12, candidateVectors: 0, acceptedVectors: 0, rejectedVectors: 0, physicalFloorRejectedVectors: 0, pathMetrics: [] } } }), 35);
    }
  }
  dispatch(event) { for (const cb of [...this.listeners]) cb(event); }
  terminate() {}
}

const coordinator = new MonteCarloCoordinator({
  input,
  snapshot,
  mode: 'SMOKE',
  workerFactory: () => new MockMainWorker(),
  generalBenchmarkWorkerFactory: () => new MockGeneralWorker(),
  workerCountOverride: 1,
  batchSize: 1,
  onProgress: () => undefined
});

const outcome = await coordinator.run();
console.log(JSON.stringify({
  status: outcome.status,
  generalStartedAt,
  mainCompletedAt,
  generalBeforeMain: generalStartedAt < mainCompletedAt,
  generalBenchmarkCAGR: outcome.result?.statistics?.generalComparison?.generalBenchmarkCAGR
}, null, 2));
