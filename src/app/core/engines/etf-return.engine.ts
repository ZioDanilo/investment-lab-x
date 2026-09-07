import { SeededRandom } from './seeded-random';
import {
  MacroScenario,
  PortfolioPosition,
  PreparedCorrelationMatrix,
  MonteCarloEtfYearResult,
  MonteCarloDistributionSettings,
  MacroScenarioStatistics
} from '../models/monte-carlo.model';
import { CorrelationMatrixBuilder } from './correlation-matrix.builder';
import { MonteCarloValidator, MonteCarloDiagnostics } from './monte-carlo-validator';

/**
 * Generates correlated annual returns for ETFs using Gaussian Copula.
 *
 * Correct algorithm:
 * 1. Generate N independent standard normals
 * 2. Apply Cholesky to get N correlated normals
 * 3. Convert each to uniform via normal CDF
 * 4. Use uniform to sample from each ETF's marginal distribution
 * 5. Clamp to range [min, max]
 *
 * CRITICAL: Cholesky is applied to standardized normals BEFORE sampling returns.
 * The sampled returns are NOT modified further by the correlated shocks.
 */
export class EtfReturnEngine {
  /**
   * Generate correlated returns for all ETFs in portfolio for a given scenario
   */
  static generateCorrelatedReturns(
    portfolio: PortfolioPosition[],
    scenario: MacroScenario,
    macroStatsMap: Record<string, Record<MacroScenario, MacroScenarioStatistics>>,
    correlationMatrix: PreparedCorrelationMatrix,
    distributionSettings: MonteCarloDistributionSettings,
    random: SeededRandom,
    diagnostics?: MonteCarloDiagnostics
  ): MonteCarloEtfYearResult[] {
    const n = portfolio.length;

    if (n === 0) {
      return [];
    }

    // =========================================================================
    // STEP 1: Generate independent standard normal shocks
    // =========================================================================
    const independentNormals = Array(n)
      .fill(null)
      .map(() => random.nextNormal());

    // =========================================================================
    // STEP 2: Apply Cholesky to get correlated normals
    // =========================================================================
    const { L, success } = CorrelationMatrixBuilder.choleskyDecomposition(
      correlationMatrix.matrix
    );

    let correlatedNormals: number[];
    if (success) {
      // Correlated = L * independent
      correlatedNormals = Array(n)
        .fill(0)
        .map((_, i) => {
          let sum = 0;
          for (let j = 0; j <= i; j++) {
            sum += L[i][j] * independentNormals[j];
          }
          return sum;
        });
    } else {
      // Fallback: use independent
      console.warn(
        'Cholesky decomposition failed, using independent shocks'
      );
      correlatedNormals = independentNormals;
    }

    // =========================================================================
    // STEP 3: Convert to uniforms via normal CDF
    // =========================================================================
    const correlatedUniforms = correlatedNormals.map(z => {
      const u = this.normalCDF(z);
      // Clip to [epsilon, 1-epsilon] to avoid extreme quantiles
      return Math.min(0.999999, Math.max(0.000001, u));
    });

    // =========================================================================
    // STEP 4: Generate returns from marginal distributions
    // =========================================================================
    const results: MonteCarloEtfYearResult[] = [];

    for (let i = 0; i < n; i++) {
      const position = portfolio[i];
      const macroStats = macroStatsMap[position.isin];

      if (!macroStats || !macroStats[scenario]) {
        throw new Error(
          `Missing macro statistics for ${position.isin} in scenario ${scenario}`
        );
      }

      const stats = macroStats[scenario];
      const correlatedUniform = correlatedUniforms[i];

      // Sample return from marginal distribution
      const sampledReturn = this.sampleEtfReturnFromUniform(
        stats,
        correlatedUniform,
        distributionSettings
      );

      // Validate return is within range
      if (diagnostics) {
        MonteCarloValidator.validateAnnualReturn(
          position.isin,
          sampledReturn.annualReturn,
          stats.returnRange.min,
          stats.returnRange.max,
          diagnostics
        );
      }

      results.push({
        isin: position.isin,
        name: position.name,
        nickname: (position as PortfolioPosition & { nickname?: string }).nickname || position.name,
        weight: position.weight,
        expectedReturn: stats.expectedReturn,
        annualReturn: sampledReturn.annualReturn,
        contribution: position.weight * sampledReturn.annualReturn,
        intensity: sampledReturn.intensity,
        deviationDirection: sampledReturn.deviationDirection
      });
    }

    return results;
  }

  /**
   * Sample a single ETF return from its marginal distribution
   * using a correlated uniform value.
   *
   * The uniform value has been generated via:
   * uniform = Phi(correlatedNormal)
   *
   * where correlatedNormal came from Cholesky(independentNormals).
   */
  private static sampleEtfReturnFromUniform(
    stats: MacroScenarioStatistics,
    uniformValue: number,
    settings: MonteCarloDistributionSettings
  ): {
    annualReturn: number;
    intensity: number;
    deviationDirection: 'above_expected' | 'below_expected';
  } {
    const { expectedReturn, returnRange } = stats;
    const { min, max } = returnRange;

    // Validate inputs are reasonable
    if (expectedReturn < min || expectedReturn > max) {
      console.warn(
        `expectedReturn ${expectedReturn} outside range [${min}, ${max}]`
      );
    }

    const lowerDistance = expectedReturn - min;
    const upperDistance = max - expectedReturn;
    const totalDistance = lowerDistance + upperDistance;

    if (totalDistance <= 0) {
      return {
        annualReturn: expectedReturn,
        intensity: 50,
        deviationDirection: 'above_expected'
      };
    }

    // Probability of being above expected return based on asymmetry
    const probabilityAbove = lowerDistance / totalDistance;

    // Determine which side and magnitude
    let magnitude: number;
    let deviationDirection: 'above_expected' | 'below_expected';
    let annualReturn: number;

    if (uniformValue < probabilityAbove) {
      // Below expected: map [0, probabilityAbove] to [0, 1]
      magnitude = (uniformValue / probabilityAbove) * (uniformValue / probabilityAbove);
      annualReturn = expectedReturn - magnitude * lowerDistance;
      deviationDirection = 'below_expected';
    } else {
      // Above expected: map [probabilityAbove, 1] to [0, 1]
      magnitude =
        ((uniformValue - probabilityAbove) / (1 - probabilityAbove)) *
        ((uniformValue - probabilityAbove) / (1 - probabilityAbove));
      annualReturn = expectedReturn + magnitude * upperDistance;
      deviationDirection = 'above_expected';
    }

    // Clamp to range (safety)
    annualReturn = Math.max(min, Math.min(max, annualReturn));

    return {
      annualReturn,
      intensity: Math.round(magnitude * 100) + 1,
      deviationDirection
    };
  }

  /**
   * Cumulative distribution function for standard normal
   */
  private static normalCDF(x: number): number {
    // Approximation of Phi(x) using error function
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob =
      d *
      t *
      (0.319381530 +
        t *
          (-0.356563782 +
            t *
              (1.781477937 +
                t * (-1.821255978 + t * 1.330274429))));

    return x >= 0 ? 1 - prob : prob;
  }
}

