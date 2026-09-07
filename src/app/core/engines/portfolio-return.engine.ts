import {
  MonteCarloEtfYearResult,
  PortfolioPosition
} from '../models/monte-carlo.model';

/**
 * Aggregates individual ETF returns into portfolio-level returns.
 * Validates that contributions sum to portfolio return.
 */
export class PortfolioReturnEngine {
  /**
   * Calculate portfolio return from ETF returns
   */
  static calculatePortfolioReturn(
    etfReturns: MonteCarloEtfYearResult[]
  ): number {
    return etfReturns.reduce((sum, result) => sum + result.contribution, 0);
  }

  /**
   * Identify the dominant ETF (highest weight, with tiebreaker)
   */
  static identifyDominantEtf(
    portfolio: PortfolioPosition[],
    random?: any
  ): { isin: string; name: string } {
    if (portfolio.length === 0) {
      throw new Error('Portfolio is empty');
    }

    const maxWeight = Math.max(...portfolio.map(p => p.weight));
    const candidates = portfolio.filter(p => p.weight === maxWeight);

    if (candidates.length === 1) {
      return {
        isin: candidates[0].isin,
        name: candidates[0].name
      };
    }

    // Multiple ETFs with same max weight - use random selection if available
    if (random && random.nextInt) {
      const chosen =
        candidates[random.nextInt(0, candidates.length - 1)];
      return {
        isin: chosen.isin,
        name: chosen.name
      };
    }

    // Fallback: first one
    return {
      isin: candidates[0].isin,
      name: candidates[0].name
    };
  }

  /**
   * Validate that contributions sum to portfolio return
   */
  static validateContributions(
    etfReturns: MonteCarloEtfYearResult[],
    portfolioReturn: number,
    tolerance: number = 1e-10
  ): boolean {
    const sumContributions = etfReturns.reduce(
      (sum, r) => sum + r.contribution,
      0
    );
    return Math.abs(sumContributions - portfolioReturn) < tolerance;
  }
}
