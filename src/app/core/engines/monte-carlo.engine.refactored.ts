import { Etf } from '../models/etf.model';
import {
  MacroScenario,
  MACRO_SCENARIOS,
  MonteCarloPathResult,
  ExtendedMonteCarloSummary,
  MonteCarloParams,
  StructuralProbabilities,
  TransitionMatrix,
  MonteCarloDistributionSettings,
  PortfolioPosition,
  PortfolioSimulationSnapshot,
  MacroScenarioStatistics,
  EtfMacroStatistics,
  EtfCorrelation,
  CorrelationMatrixCache,
  SimulationRebalanceSettings,
  MonteCarloRunOptions,
  DEFAULT_REBALANCE_SETTINGS,
  ExtendedMonteCarloPathResult,
  MonteCarloGeneralValidation,
  GeneralStatisticsSource,
  SingleEtfGeneralDiagnostic,
  MonteCarloRepresentativeContributionAnalysis
} from '../models/monte-carlo.model';
import { SeededRandom } from './seeded-random';
import { MacroScenarioGenerator } from './macro-scenario.generator';
import { CorrelationMatrixBuilder } from './correlation-matrix.builder';
import { EtfReturnEngine } from './etf-return.engine';
import { PortfolioReturnEngine } from './portfolio-return.engine';
import { CompoundInterestEngine } from './compound-interest.engine';
import { MonteCarloStatisticsEngine } from './monte-carlo-statistics.engine';
import { MonteCarloValidator, MonteCarloDiagnostics } from './monte-carlo-validator';

// ---------------------------------------------------------------------------
// MONTE CARLO ENGINE - Main orchestrator
// ---------------------------------------------------------------------------

export class MonteCarloEngine {
  /**
   * Run Monte Carlo simulation asynchronously
   */
  static async runAsync(opts: MonteCarloRunOptions): Promise<{
    summary: ExtendedMonteCarloSummary;
    detailedPaths: ExtendedMonteCarloPathResult[];
  }> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.run(opts);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Run Monte Carlo simulation
   */
  static run(opts: MonteCarloRunOptions): {
    summary: ExtendedMonteCarloSummary;
    detailedPaths: ExtendedMonteCarloPathResult[];
  } {
    const diagnostics = MonteCarloValidator.createDiagnostics();
    
    const {
      etfs,
      params,
      structural,
      transition,
      distributionSettings,
      rebalanceSettings = DEFAULT_REBALANCE_SETTINGS,
      portfolio,
      portfolioSnapshot,
      correlations,
      onProgress
    } = opts;

    // =========================================================================
    // 0. VALIDATE INPUT DATA
    // =========================================================================

    // Validate all ETFs have macro statistics
    for (const etf of etfs) {
      MonteCarloValidator.validateEtfMacroStatistics(etf, diagnostics);
    }

    // Validate portfolio weights
    MonteCarloValidator.validatePortfolioWeights(portfolio, diagnostics);

    // Check general statistics (requireGeneralStatistics = true by default)
    const etfsMissingGeneralStats: string[] = [];
    for (const etf of etfs) {
      if (!etf.macroStatistics?.general) {
        etfsMissingGeneralStats.push(etf.isin);
      }
    }
    if (etfsMissingGeneralStats.length > 0) {
      const missing = etfsMissingGeneralStats.join(', ');
      console.warn(`[MonteCarloEngine] ETFs missing general statistics: ${missing}. General validation will be skipped.`);
    }

    console.log(`✅ Validation passed. Diagnostics initialized:`, diagnostics);

    // =========================================================================
    // 1. PREPARE MACROECONOMIC DATA
    // =========================================================================

    // Build macro stats map from ETFs
    const macroStatsMap: Record<
      string,
      Record<MacroScenario, MacroScenarioStatistics>
    > = {};
    const missingMacroStatistics: string[] = [];

    for (const etf of etfs) {
      if (etf.macroStatistics) {
        // Normalize: EtfMacroStatistics uses 'softLanding' (camelCase)
        // but MacroScenario type uses 'soft_landing' (underscore) — remap here
        const ms = etf.macroStatistics as any;
        macroStatsMap[etf.isin] = {
          expansion:    ms.expansion,
          recession:    ms.recession,
          stagflation:  ms.stagflation,
          soft_landing: ms.soft_landing ?? ms.softLanding
        } as Record<MacroScenario, MacroScenarioStatistics>;
      } else {
        missingMacroStatistics.push(etf.isin);
      }
    }

    // Validate all portfolio positions have macro stats
    for (const pos of portfolio) {
      if (!macroStatsMap[pos.isin]) {
        throw new Error(
          `ETF ${pos.isin} missing macro statistics - cannot simulate`
        );
      }
    }

    // =========================================================================
    // 2. BUILD CORRELATION MATRICES FOR ALL SCENARIOS
    // =========================================================================

    const correlationCache: CorrelationMatrixCache = {
      expansion: CorrelationMatrixBuilder.buildForPortfolio(
        portfolio,
        'expansion',
        correlations
      ),
      softLanding: CorrelationMatrixBuilder.buildForPortfolio(
        portfolio,
        'soft_landing',
        correlations
      ),
      recession: CorrelationMatrixBuilder.buildForPortfolio(
        portfolio,
        'recession',
        correlations
      ),
      stagflation: CorrelationMatrixBuilder.buildForPortfolio(
        portfolio,
        'stagflation',
        correlations
      )
    };

    // Collect missing correlation pairs
    const missingCorrelationPairs: Array<{
      isinA: string;
      isinB: string;
      scenario: MacroScenario;
    }> = [];

    for (const [scenario, matrix] of Object.entries(correlationCache)) {
      for (const pair of matrix.missingPairs) {
        missingCorrelationPairs.push({
          isinA: pair.isinA,
          isinB: pair.isinB,
          scenario: scenario as MacroScenario
        });
      }
    }

    // =========================================================================
    // 3. RUN SIMULATIONS
    // =========================================================================

    const paths: MonteCarloPathResult[] = [];
    const horizonYears = params.horizonYears || 50;
    const rng = new SeededRandom(params.seed);

    for (let simId = 0; simId < params.simulationCount; simId++) {
      // Report progress
      if (onProgress) {
        onProgress(Math.floor((simId / params.simulationCount) * 100));
      }

      // Generate macro scenario path for this simulation
      const scenarioPath = MacroScenarioGenerator.generateScenarioPath(
        horizonYears,
        structural,
        transition,
        rng
      );

      // Run through all 50 years
      const yearResults = [];
      let capital = params.initialCapital;
      let runningPeak = capital;

      for (let year = 1; year <= horizonYears; year++) {
        const scenario = scenarioPath.years[year - 1].scenario;
        const corrMatrix =
          scenario === 'expansion'
            ? correlationCache.expansion
            : scenario === 'soft_landing'
              ? correlationCache.softLanding
              : scenario === 'recession'
                ? correlationCache.recession
                : correlationCache.stagflation;

        // Generate correlated ETF returns
        const etfReturns = EtfReturnEngine.generateCorrelatedReturns(
          portfolio,
          scenario,
          macroStatsMap,
          corrMatrix,
          distributionSettings,
          rng,
          diagnostics
        );

        // Calculate portfolio return
        let portfolioReturn =
          PortfolioReturnEngine.calculatePortfolioReturn(etfReturns);

        // Validate portfolio return is within ETF ranges
        const etfReturnValues = etfReturns.map(r => r.annualReturn);
        const minEtfReturn = Math.min(...etfReturnValues);
        const maxEtfReturn = Math.max(...etfReturnValues);

        portfolioReturn = MonteCarloValidator.validatePortfolioReturn(
          portfolioReturn,
          minEtfReturn,
          maxEtfReturn,
          diagnostics
        );

        // Validate contributions
        if (
          !PortfolioReturnEngine.validateContributions(
            etfReturns,
            portfolioReturn
          )
        ) {
          throw new Error(
            `Year ${year}: contributions don't sum to portfolio return`
          );
        }

        // Validate contributions sum
        if (
          !PortfolioReturnEngine.validateContributions(
            etfReturns,
            portfolioReturn
          )
        ) {
          console.warn(
            `Contributions mismatch at year ${year} sim ${simId}`
          );
        }

        // Calculate new capital and drawdown
        const { endingCapital, newPeak, yearData } =
          CompoundInterestEngine.calculateYearResult(
            year,
            capital,
            portfolioReturn,
            etfReturns,
            scenarioPath,
            runningPeak
          );

        yearResults.push(yearData);
        capital = endingCapital;
        runningPeak = newPeak;
      }

      // Calculate path-level statistics
      const {
        finalCapital,
        maxDrawdown,
        totalReturn,
        cagr
      } = CompoundInterestEngine.compoundOver50Years(
        params.initialCapital,
        yearResults
      );

      // Identify dominant ETF
      const { isin: domIsin, name: domName } =
        PortfolioReturnEngine.identifyDominantEtf(portfolio, rng);

      paths.push({
        simulationId: simId,
        dominantEtfIsin: domIsin,
        dominantEtfName: domName,
        initialCapital: params.initialCapital,
        finalCapital,
        totalReturn,
        cagr,
        maxDrawdown,
        scenarioPath,
        years: yearResults,
        portfolioSnapshot: portfolioSnapshot
      } as any);
    }

    // =========================================================================
    // 4. CALCULATE SUMMARY STATISTICS
    // =========================================================================

    const summary = MonteCarloStatisticsEngine.calculateSummary(
      paths,
      params.initialCapital,
      params.targetCagr,
      horizonYears,
      portfolio,
      portfolioSnapshot,
      missingMacroStatistics,
      missingCorrelationPairs
    );
    summary.representativeContributionAnalysis = this.buildRepresentativeContributionAnalysis(
      paths,
      summary.medianCagr
    );

    // =========================================================================
    // 4b. COMPUTE GENERAL VALIDATION (benchmark di lungo periodo)
    // =========================================================================
    summary.etfsMissingGeneralStats = etfsMissingGeneralStats;

    if (etfsMissingGeneralStats.length === 0) {
      const generalValidation = MonteCarloEngine.computeGeneralValidation(
        etfs,
        portfolio,
        summary
      );
      summary.generalValidation = generalValidation;
      summary.generalStatisticsSource = {
        scenarioIdentifier: 'general',
        correlationMethod: 'average_macro_matrices',
        drawdownMethod: 'weighted_approximation',
        rangeMethod: 'weighted_approximation'
      };
    }

    // =========================================================================
    // 5. SELECT SPECIAL PATHS FOR DETAIL DISPLAY
    // =========================================================================

    const detailedPaths = this.selectSpecialPaths(
      paths,
      portfolioSnapshot,
      summary.representativeContributionAnalysis?.simulationId
    );

    if (onProgress) {
      onProgress(100);
    }

    return {
      summary,
      detailedPaths
    };
  }

  /**
   * Select special paths to display details (first, best, worst, median, max DD)
   */
  private static selectSpecialPaths(
    paths: MonteCarloPathResult[],
    portfolioSnapshot: PortfolioSimulationSnapshot,
    representativeSimulationId?: number
  ): ExtendedMonteCarloPathResult[] {
    if (paths.length === 0) return [];

    if (representativeSimulationId !== undefined) {
      const representativePath = paths.find((path) => path.simulationId === representativeSimulationId);
      if (representativePath) {
        return [representativePath as ExtendedMonteCarloPathResult];
      }
    }

    const first = paths[0];
    const best = paths.reduce((max, p) =>
      p.finalCapital > max.finalCapital ? p : max
    );
    const worst = paths.reduce((min, p) =>
      p.finalCapital < min.finalCapital ? p : min
    );

    // Median by final capital
    const sortedByCapital = [...paths].sort(
      (a, b) => a.finalCapital - b.finalCapital
    );
    const median =
      sortedByCapital[Math.floor(sortedByCapital.length / 2)];

    // Max drawdown
    const maxDD = paths.reduce((max, p) =>
      p.maxDrawdown > max.maxDrawdown ? p : max
    );

    const special = [first, best, worst, median, maxDD];

    // Remove duplicates while preserving order
    const seen = new Set<number>();
    const unique = special.filter(p => {
      if (seen.has(p.simulationId)) return false;
      seen.add(p.simulationId);
      return true;
    });

    return unique as ExtendedMonteCarloPathResult[];
  }

  private static buildRepresentativeContributionAnalysis(
    paths: MonteCarloPathResult[],
    medianCagr: number
  ): MonteCarloRepresentativeContributionAnalysis | undefined {
    if (paths.length === 0) {
      return undefined;
    }

    const bucketSize = Math.max(1, Math.ceil(paths.length * 0.05));
    const worstDrawdownSubset = [...paths]
      .sort((a, b) => b.maxDrawdown - a.maxDrawdown)
      .slice(0, bucketSize);

    const representativePath = worstDrawdownSubset.reduce((best, current) => {
      const bestDistance = Math.abs(best.cagr - medianCagr);
      const currentDistance = Math.abs(current.cagr - medianCagr);

      if (currentDistance < bestDistance) {
        return current;
      }

      if (currentDistance === bestDistance && current.maxDrawdown > best.maxDrawdown) {
        return current;
      }

      return best;
    });

    return {
      simulationId: representativePath.simulationId,
      selectedFromWorstDrawdownBucketSize: bucketSize,
      selectedFromWorstDrawdownPercentile: 5,
      simulationMaxDrawdown: representativePath.maxDrawdown,
      simulationCagr: representativePath.cagr,
      medianCagrReference: medianCagr,
      years: representativePath.years.map((year) => ({
        year: year.year,
        contributions: year.etfReturns.map((etf) => ({
          isin: etf.isin,
          nickname: etf.nickname || etf.name || etf.isin,
          weight: etf.weight,
          annualReturn: etf.annualReturn,
          contribution: etf.contribution
        }))
      }))
    };
  }

  // =========================================================================
  // GENERAL VALIDATION — Confronto risultati simulati vs benchmark general
  // =========================================================================

  /**
   * Build the portfolio-level general benchmark and compare with simulation results.
   * No resampling: purely observe and report.
   */
  static computeGeneralValidation(
    etfs: Etf[],
    portfolio: PortfolioPosition[],
    summary: ExtendedMonteCarloSummary
  ): MonteCarloGeneralValidation {
    // Tolerance defaults
    const cagrTolerance = 0.002;
    const volatilityTolerance = 0.02;
    const maxDrawdownTolerance = 0.05;
    const rangeTolerance = 0.01;

    // Normalize weights
    const totalWeight = portfolio.reduce((s, p) => s + p.weight, 0) || 1;
    const normalizedPositions = portfolio.map(p => ({
      isin: p.isin,
      weight: p.weight / totalWeight
    }));

    // Build general stats lookup
    const generalMap: Record<string, MacroScenarioStatistics> = {};
    for (const etf of etfs) {
      if (etf.macroStatistics?.general) {
        generalMap[etf.isin] = etf.macroStatistics.general;
      }
    }

    // Compute portfolio-level general targets (weighted average)
    let targetMedianCagr = 0;
    let targetVolatility = 0;
    let targetMaxDrawdown = 0;
    let targetRangeMin = 0;
    let targetRangeMax = 0;

    for (const pos of normalizedPositions) {
      const g = generalMap[pos.isin];
      if (!g) continue;
      targetMedianCagr  += pos.weight * g.expectedReturn;
      targetVolatility  += pos.weight * g.volatility;
      targetMaxDrawdown += pos.weight * g.maxDrawdown;
      targetRangeMin    += pos.weight * g.returnRange.min;
      targetRangeMax    += pos.weight * g.returnRange.max;
    }

    // Simulated values from summary
    const simulatedMedianCagr       = summary.medianCagr;
    const simulatedMedianVolatility  = summary.medianAnnualizedVolatility;
    const simulatedMedianMaxDrawdown = summary.medianMaxDrawdown;
    const simulatedPercentile5Cagr   = summary.percentile5Cagr;
    const simulatedPercentile95Cagr  = summary.percentile95Cagr;

    // Differences
    const cagrDifference        = simulatedMedianCagr - targetMedianCagr;
    const volatilityDifference  = simulatedMedianVolatility - targetVolatility;
    const maxDrawdownDifference = simulatedMedianMaxDrawdown - targetMaxDrawdown;

    // Tolerance checks
    const cagrWithinTolerance        = Math.abs(cagrDifference) <= cagrTolerance;
    const volatilityWithinTolerance  = Math.abs(volatilityDifference) <= volatilityTolerance;
    const maxDrawdownWithinTolerance = Math.abs(maxDrawdownDifference) <= maxDrawdownTolerance;
    const rangeWithinTolerance       =
      simulatedPercentile5Cagr  >= targetRangeMin - rangeTolerance &&
      simulatedPercentile95Cagr <= targetRangeMax + rangeTolerance;

    // Status
    let status: 'CALIBRATED' | 'WARNING' | 'NOT_CALIBRATED';
    const allOk = cagrWithinTolerance && volatilityWithinTolerance && maxDrawdownWithinTolerance && rangeWithinTolerance;
    if (allOk) {
      status = 'CALIBRATED';
    } else if (cagrWithinTolerance && [volatilityWithinTolerance, maxDrawdownWithinTolerance, rangeWithinTolerance].filter(b => !b).length === 1) {
      status = 'WARNING';
    } else {
      status = 'NOT_CALIBRATED';
    }

    return {
      targetMedianCagr,
      simulatedMedianCagr,
      cagrDifference,
      targetVolatility,
      simulatedMedianVolatility,
      volatilityDifference,
      targetMaxDrawdown,
      simulatedMedianMaxDrawdown,
      maxDrawdownDifference,
      targetRangeMin,
      targetRangeMax,
      simulatedPercentile5Cagr,
      simulatedPercentile95Cagr,
      cagrWithinTolerance,
      volatilityWithinTolerance,
      maxDrawdownWithinTolerance,
      rangeWithinTolerance,
      status
    };
  }

  /**
   * Diagnostic run for a single ETF at 100% weight against its general benchmark.
   * Uses the same engine internals but with a simplified 1-ETF portfolio.
   */
  static runSingleEtfGeneralDiagnostic(
    etf: Etf,
    simulationCount: number,
    seed: number,
    structural: StructuralProbabilities,
    transition: TransitionMatrix,
    distributionSettings: MonteCarloDistributionSettings
  ): SingleEtfGeneralDiagnostic | null {
    const general = etf.macroStatistics?.general;
    if (!general) return null;

    const portfolio: PortfolioPosition[] = [{ isin: etf.isin, name: etf.name, weight: 1 }];
    const snapshot: PortfolioSimulationSnapshot = {
      generatedAt: new Date().toISOString(),
      positions: portfolio,
      totalWeightBeforeNormalization: 1,
      normalized: true
    };

    const result = MonteCarloEngine.run({
      etfs: [etf],
      params: { initialCapital: 100_000, simulationCount, targetCagr: general.expectedReturn, horizonYears: 50, seed },
      structural,
      transition,
      distributionSettings,
      rebalanceSettings: DEFAULT_REBALANCE_SETTINGS,
      portfolio,
      portfolioSnapshot: snapshot,
      correlations: []
    });

    const s = result.summary;
    const cagrDiff = s.medianCagr - general.expectedReturn;
    const volDiff  = s.medianAnnualizedVolatility - general.volatility;

    const cagrOk = Math.abs(cagrDiff) <= 0.002;
    const volOk  = Math.abs(volDiff) <= 0.02;
    const ddOk   = Math.abs(s.medianMaxDrawdown - general.maxDrawdown) <= 0.05;
    const rangeOk =
      s.percentile5Cagr  >= general.returnRange.min - 0.01 &&
      s.percentile95Cagr <= general.returnRange.max + 0.01;

    let status: 'CALIBRATED' | 'WARNING' | 'NOT_CALIBRATED';
    if (cagrOk && volOk && ddOk && rangeOk) {
      status = 'CALIBRATED';
    } else if (cagrOk && [volOk, ddOk, rangeOk].filter(b => !b).length === 1) {
      status = 'WARNING';
    } else {
      status = 'NOT_CALIBRATED';
    }

    return {
      isin: etf.isin,
      targetExpectedReturn: general.expectedReturn,
      simulatedMedianCagr: s.medianCagr,
      cagrDifference: cagrDiff,
      targetVolatility: general.volatility,
      simulatedMedianVolatility: s.medianAnnualizedVolatility,
      targetMaxDrawdown: general.maxDrawdown,
      simulatedMedianMaxDrawdown: s.medianMaxDrawdown,
      targetRangeMin: general.returnRange.min,
      targetRangeMax: general.returnRange.max,
      percentile5Cagr: s.percentile5Cagr,
      percentile95Cagr: s.percentile95Cagr,
      status
    };
  }
}
