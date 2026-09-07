import { Etf } from '../models/etf.model';
import {
  MacroScenario,
  MACRO_SCENARIOS,
  EtfMacroStatistics,
  MacroScenarioStatistics,
  MonteCarloEtfYearResult,
  MonteCarloYearResult,
  MonteCarloPathResult,
  MonteCarloSummary,
  MonteCarloParams,
  StructuralProbabilities,
  TransitionMatrix,
  MonteCarloDistributionSettings,
  SampledEtfReturn,
  DistributionDiagnostic
} from '../models/monte-carlo.model';
import { SeededRandom } from './seeded-random';

// ---------------------------------------------------------------------------
// Statistiche macro di default per gli ETF che non le hanno ancora
// ---------------------------------------------------------------------------
const DEFAULT_ETF_MACRO: EtfMacroStatistics = {
  expansion:   { expectedReturn: 0.10,  volatility: 0.14, maxDrawdown: -0.25, returnRange: { min: 0.02,  max: 0.25 } },
  recession:   { expectedReturn: -0.08, volatility: 0.20, maxDrawdown: -0.40, returnRange: { min: -0.35, max: -0.02 } },
  stagflation: { expectedReturn: -0.03, volatility: 0.18, maxDrawdown: -0.30, returnRange: { min: -0.20, max: 0.05 } },
  softLanding: { expectedReturn: 0.07,  volatility: 0.10, maxDrawdown: -0.15, returnRange: { min: 0.01,  max: 0.18 } }
};

function getEtfMacroKey(scenario: MacroScenario): keyof EtfMacroStatistics {
  return scenario === 'soft_landing' ? 'softLanding' : scenario as keyof EtfMacroStatistics;
}

// ---------------------------------------------------------------------------
// sampleEtfReturn — distribuzione bilaterale centrata su expectedReturn
// ---------------------------------------------------------------------------

/**
 * Genera un rendimento casuale per un ETF in uno specifico scenario macro.
 * La distribuzione è centrata su MacroScenarioStatistics.expectedReturn,
 * con probabilità di trovarsi sopra/sotto proporzionale alle distanze
 * dai bordi del range. La magnitudine è estratta da Beta(alpha, beta).
 */
function sampleEtfReturn(
  stats: MacroScenarioStatistics,
  rng: SeededRandom,
  settings: MonteCarloDistributionSettings
): SampledEtfReturn {
  const { expectedReturn, returnRange: { min, max } } = stats;

  const lowerDistance = expectedReturn - min;
  const upperDistance = max - expectedReturn;
  const totalDistance = lowerDistance + upperDistance;

  // Caso degenere: range puntuale o expectedReturn fuori range (fallback sicuro)
  if (totalDistance <= 0) {
    return {
      annualReturn: expectedReturn,
      expectedReturn,
      intensity: 1,
      magnitude: 0,
      deviationDirection: 'above_expected'
    };
  }

  // Probabilità di stare sopra expectedReturn, ponderata per compensare l'asimmetria
  const probabilityAbove = lowerDistance / totalDistance;
  const isAbove = rng.next() < probabilityAbove;

  const magnitude = rng.beta(settings.betaAlpha, settings.betaBeta);

  let annualReturn: number;
  if (isAbove) {
    annualReturn = expectedReturn + magnitude * upperDistance;
  } else {
    annualReturn = expectedReturn - magnitude * lowerDistance;
  }

  // Clamp ai bordi del range
  annualReturn = Math.max(min, Math.min(max, annualReturn));

  // Intensità: distanza relativa dal centro (1 = vicino a expectedReturn, 100 = all'estremo)
  const intensity = Math.round(magnitude * 99) + 1;

  return {
    annualReturn,
    expectedReturn,
    intensity,
    magnitude,
    deviationDirection: isAbove ? 'above_expected' : 'below_expected'
  };
}

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

function normalizeProbs(probs: Record<MacroScenario, number>): Record<MacroScenario, number> {
  const total = MACRO_SCENARIOS.reduce((s, k) => s + probs[k], 0);
  if (total === 0) return { ...probs };
  const result = {} as Record<MacroScenario, number>;
  MACRO_SCENARIOS.forEach(k => result[k] = probs[k] / total);
  return result;
}

function blendProbabilities(
  structural: StructuralProbabilities,
  transitionRow: Record<MacroScenario, number>
): Record<MacroScenario, number> {
  const blended = {} as Record<MacroScenario, number>;
  MACRO_SCENARIOS.forEach(k => {
    blended[k] = 0.5 * structural[k] + 0.5 * transitionRow[k];
  });
  return normalizeProbs(blended);
}

function normalizeWeights(etfs: Etf[]): { etf: Etf; weight: number }[] {
  const active = etfs.filter(e => e.weight > 0);
  const total = active.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return [];
  return active.map(e => ({ etf: e, weight: e.weight / total }));
}

function pickDominantEtf(
  weighted: { etf: Etf; weight: number }[],
  rng: SeededRandom
): { isin: string; name: string } {
  if (weighted.length === 0) return { isin: '', name: '' };
  const maxW = Math.max(...weighted.map(w => w.weight));
  const candidates = weighted.filter(w => w.weight === maxW);
  const chosen = candidates[rng.nextInt(0, candidates.length - 1)];
  return { isin: chosen.etf.isin, name: chosen.etf.name };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---------------------------------------------------------------------------
// Motore Monte Carlo principale
// ---------------------------------------------------------------------------

export interface SimulateOptions {
  etfs: Etf[];
  params: MonteCarloParams;
  structural: StructuralProbabilities;
  transition: TransitionMatrix;
  distributionSettings: MonteCarloDistributionSettings;
  onProgress?: (pct: number) => void;
}

export interface SimulateResult {
  summary: MonteCarloSummary;
  detailedPaths: MonteCarloPathResult[];
}

export class MonteCarloEngine {

  static run(opts: SimulateOptions): SimulateResult {
    const { etfs, params, structural, transition, distributionSettings, onProgress } = opts;
    const { initialCapital, simulationCount, targetCagr, seed } = params;
    const YEARS = 50;

    const rng = new SeededRandom(seed);
    const weighted = normalizeWeights(etfs);

    const allFinalCapitals: number[] = [];
    const allCagrs: number[] = [];
    const allMaxDrawdowns: number[] = [];
    const scenarioTotals: Record<MacroScenario, number> = {
      expansion: 0, recession: 0, stagflation: 0, soft_landing: 0
    };

    const PROGRESS_CHUNK = 1000;
    const summaryPaths: { id: number; finalCapital: number; cagr: number; maxDrawdown: number }[] = [];

    // Fase 1: simulazioni sintetiche
    for (let sim = 0; sim < simulationCount; sim++) {
      let capital = initialCapital;
      let peak = initialCapital;
      let maxDd = 0;
      let prevScenario: MacroScenario | null = null;

      for (let y = 1; y <= YEARS; y++) {
        // Anno 1: distribuzione strutturale per il primo scenario
        // Anni 2+: matrice di transizione dal scenario precedente al 100%
        const probs = (y === 1 || prevScenario === null)
          ? normalizeProbs(structural)
          : transition[prevScenario];

        const scenario = rng.weightedChoice(probs);

        let portfolioReturn = 0;
        for (const { etf, weight } of weighted) {
          const macroStats = etf.macroStatistics ?? DEFAULT_ETF_MACRO;
          const key = getEtfMacroKey(scenario);
          const sampled = sampleEtfReturn(macroStats[key], rng, distributionSettings);
          portfolioReturn += weight * sampled.annualReturn;
        }

        capital = capital * (1 + portfolioReturn);
        peak = Math.max(peak, capital);
        const dd = capital / peak - 1;
        if (dd < maxDd) maxDd = dd;

        scenarioTotals[scenario]++;
        prevScenario = scenario;
      }

      const cagr = Math.pow(capital / initialCapital, 1 / YEARS) - 1;
      allFinalCapitals.push(capital);
      allCagrs.push(cagr);
      allMaxDrawdowns.push(maxDd);
      summaryPaths.push({ id: sim, finalCapital: capital, cagr, maxDrawdown: maxDd });

      if (onProgress && sim % PROGRESS_CHUNK === 0) {
        onProgress(Math.round((sim / simulationCount) * 90));
      }
    }

    // Identifica i path speciali
    const sortedByCapital = [...summaryPaths].sort((a, b) => a.finalCapital - b.finalCapital);
    const specialIds = new Set([
      summaryPaths[0].id,
      sortedByCapital[0].id,
      sortedByCapital[sortedByCapital.length - 1].id,
      sortedByCapital[Math.floor(sortedByCapital.length / 2)].id,
      summaryPaths.reduce((prev, cur) => cur.maxDrawdown < prev.maxDrawdown ? cur : prev).id
    ]);

    // Fase 2: ripete le simulazioni speciali raccogliendo dettaglio
    const detailedPaths: MonteCarloPathResult[] = [];
    const rng2 = new SeededRandom(seed);

    for (let sim = 0; sim < simulationCount; sim++) {
      const isSpecial = specialIds.has(sim);
      const years: MonteCarloYearResult[] = [];

      let capital = initialCapital;
      let peak = initialCapital;
      let maxDd = 0;
      let prevScenario: MacroScenario | null = null;

      for (let y = 1; y <= YEARS; y++) {
        // Anno 1: distribuzione strutturale per il primo scenario
        // Anni 2+: matrice di transizione dal scenario precedente al 100%
        const probs = (y === 1 || prevScenario === null)
          ? normalizeProbs(structural)
          : transition[prevScenario];

        const scenario = rng2.weightedChoice(probs);

        const etfReturns: MonteCarloEtfYearResult[] = [];
        let portfolioReturn = 0;
        let yearIntensity = 1;

        for (const { etf, weight } of weighted) {
          const macroStats = etf.macroStatistics ?? DEFAULT_ETF_MACRO;
          const key = getEtfMacroKey(scenario);
          const sampled = sampleEtfReturn(macroStats[key], rng2, distributionSettings);
          const contribution = weight * sampled.annualReturn;
          portfolioReturn += contribution;

          // Usa l'intensità dell'ETF con peso maggiore come intensità anno
          if (weight === Math.max(...weighted.map(w => w.weight))) {
            yearIntensity = sampled.intensity;
          }

          if (isSpecial) {
            etfReturns.push({
              isin: etf.isin,
              name: etf.name,
              weight,
              expectedReturn: sampled.expectedReturn,
              annualReturn: sampled.annualReturn,
              contribution,
              intensity: sampled.intensity,
              deviationDirection: sampled.deviationDirection
            });
          }
        }

        const startCapital = capital;
        capital = capital * (1 + portfolioReturn);
        peak = Math.max(peak, capital);
        const drawdown = capital / peak - 1;
        if (drawdown < maxDd) maxDd = drawdown;

        if (isSpecial) {
          years.push({
            year: y,
            scenario,
            intensity: yearIntensity,
            scenarioProbabilities: probs,
            etfReturns,
            portfolioReturn,
            startingCapital: startCapital,
            endingCapital: capital,
            runningPeak: peak,
            drawdown
          });
        }

        prevScenario = scenario;
      }

      if (isSpecial) {
        const cagr = Math.pow(capital / initialCapital, 1 / YEARS) - 1;
        const dominant = pickDominantEtf(weighted, rng2);
        detailedPaths.push({
          simulationId: sim,
          dominantEtfIsin: dominant.isin,
          dominantEtfName: dominant.name,
          initialCapital,
          finalCapital: capital,
          totalReturn: (capital - initialCapital) / initialCapital,
          cagr,
          maxDrawdown: maxDd,
          years
        });
      }
    }

    onProgress?.(100);

    const sortedCapitals = [...allFinalCapitals].sort((a, b) => a - b);
    const sortedCagrs = [...allCagrs].sort((a, b) => a - b);
    const totalScenarioYears = YEARS * simulationCount;

    const summary: MonteCarloSummary = {
      simulationCount,
      horizonYears: 50,
      initialCapital,
      averageFinalCapital: allFinalCapitals.reduce((s, v) => s + v, 0) / simulationCount,
      medianFinalCapital: percentile(sortedCapitals, 50),
      percentile5FinalCapital: percentile(sortedCapitals, 5),
      percentile25FinalCapital: percentile(sortedCapitals, 25),
      percentile75FinalCapital: percentile(sortedCapitals, 75),
      percentile95FinalCapital: percentile(sortedCapitals, 95),
      averageCagr: allCagrs.reduce((s, v) => s + v, 0) / simulationCount,
      medianCagr: percentile(sortedCagrs, 50),
      averageMaxDrawdown: allMaxDrawdowns.reduce((s, v) => s + v, 0) / simulationCount,
      worstMaxDrawdown: Math.min(...allMaxDrawdowns),
      probabilityOfLoss: allFinalCapitals.filter(c => c < initialCapital).length / simulationCount,
      probabilityCagrAboveTarget: allCagrs.filter(c => c >= targetCagr).length / simulationCount,
      scenarioFrequencies: {
        expansion:    scenarioTotals.expansion    / totalScenarioYears,
        recession:    scenarioTotals.recession    / totalScenarioYears,
        stagflation:  scenarioTotals.stagflation  / totalScenarioYears,
        soft_landing: scenarioTotals.soft_landing / totalScenarioYears
      }
    };

    return { summary, detailedPaths };
  }

  static async runAsync(opts: SimulateOptions): Promise<SimulateResult> {
    return new Promise(resolve => {
      setTimeout(() => resolve(MonteCarloEngine.run(opts)), 0);
    });
  }

  /**
   * Diagnostica: verifica che la media simulata converga a expectedReturn.
   * Differenza attesa < 0.002 su 100.000 campioni.
   */
  static runDistributionDiagnostic(
    statistics: MacroScenarioStatistics,
    sampleCount: number,
    seed: number,
    settings: MonteCarloDistributionSettings
  ): DistributionDiagnostic {
    const rng = new SeededRandom(seed);
    const samples: number[] = [];

    for (let i = 0; i < sampleCount; i++) {
      samples.push(sampleEtfReturn(statistics, rng, settings).annualReturn);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const avg = samples.reduce((s, v) => s + v, 0) / sampleCount;

    return {
      sampleCount,
      configuredExpectedReturn: statistics.expectedReturn,
      simulatedAverageReturn: avg,
      simulatedMedianReturn: percentile(sorted, 50),
      simulatedMinReturn: sorted[0],
      simulatedMaxReturn: sorted[sorted.length - 1],
      differenceFromExpected: Math.abs(avg - statistics.expectedReturn)
    };
  }
}

