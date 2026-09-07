import { generateMonthlyMacroTimeline } from './src/app/core/macro/monte-carlo-macro-engine.ts';
import { generateMonthlyReturnVector } from './src/app/core/returns/monte-carlo-return-engine.ts';
import { prepareMonteCarloPrecomputation } from './src/app/core/precomputation/monte-carlo-precomputation.ts';
import { evolveMonteCarloPortfolioPath } from './src/app/core/portfolio/monte-carlo-portfolio-path-engine.ts';
import { MonteCarloStatisticsEngine } from './src/app/core/engines/monte-carlo-statistics.engine.ts';

const snapshot = {
  etfs: [
    { isin: 'ETF-A', name: 'ETF A', nickname: 'A', statistics: { expansion: { expectedReturn: 0.08, volatility: 0.13, returnRange: { min: -0.2, max: 0.25 } }, recession: { expectedReturn: -0.05, volatility: 0.17, returnRange: { min: -0.35, max: 0.1 } }, stagflation: { expectedReturn: -0.02, volatility: 0.18, returnRange: { min: -0.3, max: 0.12 } }, soft_landing: { expectedReturn: 0.06, volatility: 0.12, returnRange: { min: -0.15, max: 0.2 } }, general: { expectedReturn: 0.06, volatility: 0.15, returnRange: { min: -0.25, max: 0.2 } } } },
    { isin: 'ETF-B', name: 'ETF B', nickname: 'B', statistics: { expansion: { expectedReturn: 0.09, volatility: 0.15, returnRange: { min: -0.18, max: 0.26 } }, recession: { expectedReturn: -0.04, volatility: 0.18, returnRange: { min: -0.32, max: 0.11 } }, stagflation: { expectedReturn: -0.01, volatility: 0.17, returnRange: { min: -0.28, max: 0.13 } }, soft_landing: { expectedReturn: 0.07, volatility: 0.13, returnRange: { min: -0.12, max: 0.22 } }, general: { expectedReturn: 0.07, volatility: 0.16, returnRange: { min: -0.24, max: 0.22 } } } }
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
    new_scenario_first_month_max_intensity: 0.7,
    new_scenario_second_month_max_intensity: 0.8,
    scenario_intensity_max_monthly_variation: 0.2
  },
  correlations: [{ isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.35, recession: 0.42, stagflation: 0.4, soft_landing: 0.38 }]
};

const precompute = prepareMonteCarloPrecomputation(snapshot);
const makeInput = (years, initialCapital = 100000) => ({
  positions: [{ isin: 'ETF-A', targetWeight: 0.6 }, { isin: 'ETF-B', targetWeight: 0.4 }],
  initialCapital,
  horizonYears: years
});

const runLevel = (label, paths, years) => {
  const started = performance.now();
  const results = [];
  for (let sim = 0; sim < paths; sim += 1) {
    const rng = (() => {
      let seed = (sim * 1664525 + 1013904223) >>> 0;
      return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0x100000000;
      };
    })();
    const macro = generateMonthlyMacroTimeline(snapshot, years * 12, () => rng());
    const monthlyVectors = macro.months.map((monthState) =>
      generateMonthlyReturnVector(snapshot, precompute, monthState.scenario, monthState.intensity, () => rng())
    );
    const path = evolveMonteCarloPortfolioPath(makeInput(years, 100000), monthlyVectors);
    results.push(path);
  }
  const elapsedMs = Math.round(performance.now() - started);
  const structuralOk = results.length === paths && results.every((path) => Number.isFinite(path.finalCapital) && path.finalCapital >= 0 && path.monthly.length === years * 12);
  const official = MonteCarloStatisticsEngine.buildOfficialResult(results, years, 100000, { weightedAverageScenarioCorrelation: 0.25, maxScenarioCorrelation: 0.38, longTermExpectedReturn: 0.06 }, { matricesCoherent: true });
  console.log(JSON.stringify({
    label,
    paths,
    years,
    elapsedMs,
    structuralOk,
    technicalPassed: official.technicalChecks.passed,
    finalCapitalRange: [Math.min(...results.map((p) => p.finalCapital)), Math.max(...results.map((p) => p.finalCapital))],
    medianCagr: official.percentiles.cagr.p50,
    medianFinalCapital: official.percentiles.finalCapital.p50,
    recoveryTime: official.mainKpis.recoveryTimeMonths
  }, null, 2));
};

runLevel('SMOKE', 100, 10);
runLevel('INTERMEDIATE', 1000, 30);
runLevel('COMPLETE', 10000, 50);
