import {
  MacroScenario,
  MacroScenarioStatistics,
  PortfolioPosition,
  EtfMacroStatistics,
  EtfCorrelation
} from '../models/monte-carlo.model';

/**
 * Diagnostics collected during Monte Carlo simulation
 */
export interface MonteCarloDiagnostics {
  invalidReturnCount: number;
  clampedReturnCount: number;
  portfolioReturnAbove100Count: number;
  portfolioReturnBelow_100Count: number;
  nanCount: number;
  infinityCount: number;
  repairedCorrelationMatrices: number;
  maximumObservedEtfReturn: number;
  minimumObservedEtfReturn: number;
  maximumObservedPortfolioReturn: number;
  minimumObservedPortfolioReturn: number;
  warnings: string[];
}

/**
 * Validates and normalizes Monte Carlo input data
 */
export class MonteCarloValidator {
  static createDiagnostics(): MonteCarloDiagnostics {
    return {
      invalidReturnCount: 0,
      clampedReturnCount: 0,
      portfolioReturnAbove100Count: 0,
      portfolioReturnBelow_100Count: 0,
      nanCount: 0,
      infinityCount: 0,
      repairedCorrelationMatrices: 0,
      maximumObservedEtfReturn: -Infinity,
      minimumObservedEtfReturn: Infinity,
      maximumObservedPortfolioReturn: -Infinity,
      minimumObservedPortfolioReturn: Infinity,
      warnings: []
    };
  }

  /**
   * Validate that all values are in valid ranges (decimals, not percentages)
   */
  static validateMacroStatistics(
    isin: string,
    stats: MacroScenarioStatistics,
    diagnostics: MonteCarloDiagnostics
  ): MacroScenarioStatistics {
    const { expectedReturn, volatility, maxDrawdown, returnRange } = stats;

    // Check if values look like percentages (100x too large)
    if (expectedReturn > 3 || expectedReturn < -1) {
      const msg = `⚠️ ${isin} expectedReturn=${expectedReturn} looks like percentage? Should be ≤3 or ≥-1`;
      diagnostics.warnings.push(msg);
      console.warn(msg);
    }

    if (volatility > 2) {
      const msg = `⚠️ ${isin} volatility=${volatility} seems too high (>2)`;
      diagnostics.warnings.push(msg);
      console.warn(msg);
    }

    if (Math.abs(maxDrawdown) > 1) {
      const msg = `⚠️ ${isin} maxDrawdown=${maxDrawdown} exceeds [-1,1]`;
      diagnostics.warnings.push(msg);
      console.warn(msg);
    }

    if (returnRange.max > 5) {
      const msg = `⚠️ ${isin} returnRange.max=${returnRange.max} exceeds reasonable bounds`;
      diagnostics.warnings.push(msg);
      console.warn(msg);
    }

    if (returnRange.min < -1) {
      const msg = `⚠️ ${isin} returnRange.min=${returnRange.min} is below -100%`;
      diagnostics.warnings.push(msg);
      console.warn(msg);
    }

    if (returnRange.min >= returnRange.max) {
      throw new Error(
        `Invalid returnRange for ${isin}: min=${returnRange.min} >= max=${returnRange.max}`
      );
    }

    return stats;
  }

  /**
   * Validate ETF macro statistics for all scenarios
   */
  static validateEtfMacroStatistics(
    etf: any,
    diagnostics: MonteCarloDiagnostics
  ): void {
    const scenarios: MacroScenario[] = [
      'expansion',
      'recession',
      'stagflation',
      'soft_landing'
    ];

    if (!etf.macroStatistics) {
      throw new Error(
        `ETF ${etf.isin} missing macroStatistics - cannot simulate`
      );
    }

    for (const scenario of scenarios) {
      const key = scenario === 'soft_landing' ? 'softLanding' : scenario;
      const stats = (etf.macroStatistics as any)[key];

      if (!stats) {
        throw new Error(
          `ETF ${etf.isin} missing ${scenario} statistics`
        );
      }

      this.validateMacroStatistics(etf.isin, stats, diagnostics);
    }
  }

  /**
   * Validate portfolio weights
   */
  static validatePortfolioWeights(
    portfolio: PortfolioPosition[],
    diagnostics: MonteCarloDiagnostics
  ): PortfolioPosition[] {
    if (!portfolio || portfolio.length === 0) {
      throw new Error('Portfolio is empty');
    }

    // Normalize weights
    let totalWeight = 0;
    for (const pos of portfolio) {
      if (pos.weight < 0) {
        throw new Error(
          `Negative weight for ${pos.isin}: ${pos.weight}`
        );
      }
      if (pos.weight > 1) {
        const msg = `⚠️ Weight for ${pos.isin}=${pos.weight} exceeds 1 (100%)`;
        diagnostics.warnings.push(msg);
        console.warn(msg);
      }
      totalWeight += pos.weight;
    }

    if (totalWeight <= 0) {
      throw new Error('Total portfolio weight must be positive');
    }

    if (Math.abs(totalWeight - 1) > 1e-10) {
      const msg = `Weights sum to ${totalWeight}, normalizing...`;
      diagnostics.warnings.push(msg);
      console.log(msg);

      for (const pos of portfolio) {
        pos.weight = pos.weight / totalWeight;
      }
    }

    return portfolio;
  }

  /**
   * Validate correlation matrix
   */
  static validateCorrelationMatrix(
    matrix: number[][],
    diagnostics: MonteCarloDiagnostics
  ): void {
    const n = matrix.length;

    if (n === 0) return;

    // Check square
    for (let i = 0; i < n; i++) {
      if (matrix[i].length !== n) {
        throw new Error('Correlation matrix must be square');
      }
    }

    // Check diagonal = 1
    for (let i = 0; i < n; i++) {
      if (Math.abs(matrix[i][i] - 1) > 1e-10) {
        throw new Error(`Diagonal element [${i},${i}]=${matrix[i][i]} != 1`);
      }
    }

    // Check symmetric
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(matrix[i][j] - matrix[j][i]) > 1e-10) {
          throw new Error(
            `Matrix not symmetric: [${i},${j}]=${matrix[i][j]} != [${j},${i}]=${matrix[j][i]}`
          );
        }
      }
    }

    // Check values in [-1, 1]
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (matrix[i][j] < -1 - 1e-10 || matrix[i][j] > 1 + 1e-10) {
          throw new Error(
            `Correlation [${i},${j}]=${matrix[i][j]} outside [-1, 1]`
          );
        }
      }
    }
  }

  /**
   * Validate annual returns
   */
  static validateAnnualReturn(
    isin: string,
    annualReturn: number,
    rangeMin: number,
    rangeMax: number,
    diagnostics: MonteCarloDiagnostics
  ): number {
    if (isNaN(annualReturn)) {
      diagnostics.nanCount++;
      throw new Error(`${isin}: return is NaN`);
    }

    if (!isFinite(annualReturn)) {
      diagnostics.infinityCount++;
      throw new Error(`${isin}: return is Infinity`);
    }

    // Clamp to range with tolerance
    const tolerance = 1e-10;
    if (
      annualReturn < rangeMin - tolerance ||
      annualReturn > rangeMax + tolerance
    ) {
      diagnostics.invalidReturnCount++;
      diagnostics.clampedReturnCount++;
      console.warn(
        `${isin}: return ${annualReturn} clamped to [${rangeMin}, ${rangeMax}]`
      );
    }

    const clamped = Math.max(
      rangeMin,
      Math.min(rangeMax, annualReturn)
    );

    diagnostics.maximumObservedEtfReturn = Math.max(
      diagnostics.maximumObservedEtfReturn,
      clamped
    );
    diagnostics.minimumObservedEtfReturn = Math.min(
      diagnostics.minimumObservedEtfReturn,
      clamped
    );

    return clamped;
  }

  /**
   * Validate portfolio return
   */
  static validatePortfolioReturn(
    portfolioReturn: number,
    minEtfReturn: number,
    maxEtfReturn: number,
    diagnostics: MonteCarloDiagnostics
  ): number {
    if (isNaN(portfolioReturn)) {
      diagnostics.nanCount++;
      throw new Error('Portfolio return is NaN');
    }

    if (!isFinite(portfolioReturn)) {
      diagnostics.infinityCount++;
      throw new Error('Portfolio return is Infinity');
    }

    // Clamp to -99.9999% to prevent < -100%
    const clamped = Math.max(-0.999999, portfolioReturn);

    if (clamped !== portfolioReturn) {
      diagnostics.clampedReturnCount++;
      console.warn(
        `Portfolio return ${portfolioReturn} clamped to ${clamped}`
      );
    }

    // Check if within ETF range
    if (clamped < minEtfReturn - 1e-10 || clamped > maxEtfReturn + 1e-10) {
      const msg = `⚠️ Portfolio return ${clamped} outside ETF range [${minEtfReturn}, ${maxEtfReturn}]`;
      diagnostics.warnings.push(msg);
      console.warn(msg);
    }

    if (clamped > 1) {
      diagnostics.portfolioReturnAbove100Count++;
      console.warn(
        `Portfolio return ${clamped} exceeds 100% - verify range configuration`
      );
    }

    if (clamped < -0.99) {
      diagnostics.portfolioReturnBelow_100Count++;
      console.warn(
        `Portfolio return ${clamped} near -100% - verify range configuration`
      );
    }

    diagnostics.maximumObservedPortfolioReturn = Math.max(
      diagnostics.maximumObservedPortfolioReturn,
      clamped
    );
    diagnostics.minimumObservedPortfolioReturn = Math.min(
      diagnostics.minimumObservedPortfolioReturn,
      clamped
    );

    return clamped;
  }

  /**
   * Check if simulation has serious errors
   */
  static hasErrors(diagnostics: MonteCarloDiagnostics): boolean {
    return (
      diagnostics.invalidReturnCount > 0 ||
      diagnostics.nanCount > 0 ||
      diagnostics.infinityCount > 0
    );
  }
}
