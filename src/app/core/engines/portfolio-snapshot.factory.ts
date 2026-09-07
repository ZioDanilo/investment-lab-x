import {
  PortfolioPosition,
  PortfolioSimulationSnapshot
} from '../models/monte-carlo.model';

/**
 * Creates an immutable snapshot of the portfolio for simulation.
 * Handles filtering, normalization, and validation of portfolio positions.
 */
export class PortfolioSnapshotFactory {
  /**
   * Create a snapshot from raw portfolio data
   */
  static createSnapshot(
    etfs: any[], // Etf[]
    weights: Record<string, number>
  ): PortfolioSimulationSnapshot {
    // Filter to active positions (weight > 0)
    const activePositions: PortfolioPosition[] = [];
    let totalWeightBeforeNormalization = 0;

    for (const etf of etfs) {
      const weight = weights[etf.isin] || 0;

      if (weight > 0) {
        activePositions.push({
          isin: etf.isin,
          name: etf.name,
          weight
        });
        totalWeightBeforeNormalization += weight;
      }
    }

    // Normalize weights to sum to 1
    let normalized = false;
    if (
      Math.abs(totalWeightBeforeNormalization - 1.0) > 1e-6 &&
      totalWeightBeforeNormalization > 0
    ) {
      for (const pos of activePositions) {
        pos.weight /= totalWeightBeforeNormalization;
      }
      normalized = true;
    }

    return {
      generatedAt: new Date().toISOString(),
      positions: activePositions,
      totalWeightBeforeNormalization,
      normalized
    };
  }

  /**
   * Validate that all positions have required data
   */
  static validatePositions(
    positions: PortfolioPosition[],
    macroStatisticsMap: Record<string, any>
  ): { valid: boolean; missingIsins: string[] } {
    const missingIsins: string[] = [];

    for (const pos of positions) {
      if (!macroStatisticsMap[pos.isin]) {
        missingIsins.push(pos.isin);
      }
    }

    return {
      valid: missingIsins.length === 0,
      missingIsins
    };
  }
}
