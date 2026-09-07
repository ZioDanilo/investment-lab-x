import {
  MacroScenario,
  MACRO_SCENARIOS,
  PortfolioPosition,
  PreparedCorrelationMatrix,
  EtfCorrelation
} from '../models/monte-carlo.model';

/**
 * Builds and validates correlation matrices for a portfolio within a specific scenario.
 * Handles missing data, repairs positive semi-definite issues, and supports Cholesky decomposition.
 */
export class CorrelationMatrixBuilder {
  /**
   * Build correlation matrix for a portfolio in a specific scenario
   */
  static buildForPortfolio(
    activePortfolio: PortfolioPosition[],
    scenario: MacroScenario,
    correlations: EtfCorrelation[]
  ): PreparedCorrelationMatrix {
    const isins = activePortfolio.map(p => p.isin);
    const n = isins.length;
    const missingPairs: Array<{ isinA: string; isinB: string }> = [];
    let repaired = false;

    // Initialize n x n matrix with 1 on diagonal
    const matrix = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
    }

    // Populate correlation values
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const isinA = isins[i];
        const isinB = isins[j];

        // Look for correlation A->B or B->A
        let corrValue: number | null = null;

        const corrAB = correlations.find(
          c => c.etfAIsin === isinA && c.etfBIsin === isinB
        );
        if (corrAB) {
          corrValue = this.getScenarioCorrelation(corrAB, scenario);
        }

        if (corrValue === null) {
          const corrBA = correlations.find(
            c => c.etfAIsin === isinB && c.etfBIsin === isinA
          );
          if (corrBA) {
            corrValue = this.getScenarioCorrelation(corrBA, scenario);
          }
        }

        if (corrValue === null) {
          // Missing pair
          missingPairs.push({ isinA, isinB });
          // Default to 0.5 (moderate positive correlation)
          corrValue = 0.5;
        } else {
          // Validate range [-1, 1]
          if (corrValue < -1 || corrValue > 1) {
            console.warn(
              `Correlation ${isinA}-${isinB} out of range [${corrValue}], clamped`
            );
            corrValue = Math.max(-1, Math.min(1, corrValue));
          }
        }

        // Set symmetric values
        matrix[i][j] = corrValue;
        matrix[j][i] = corrValue;
      }
    }

    // Validate and repair if necessary
    if (!this.isPositiveSemiDefinite(matrix)) {
      this.repairMatrix(matrix);
      repaired = true;
    }

    return {
      isins,
      matrix,
      missingPairs,
      repaired
    };
  }

  /**
   * Get correlation value for a specific scenario
   */
  private static getScenarioCorrelation(
    correlation: EtfCorrelation,
    scenario: MacroScenario
  ): number | null {
    const value =
      scenario === 'expansion'
        ? correlation.expansion
        : scenario === 'soft_landing'
          ? correlation.softLanding
          : scenario === 'recession'
            ? correlation.recession
            : correlation.stagflation;

    return value ?? null;
  }

  /**
   * Check if matrix is positive semi-definite
   */
  private static isPositiveSemiDefinite(matrix: number[][]): boolean {
    // Quick check: all eigenvalues should be >= 0
    // For simplicity, use Sylvester criterion on minor determinants
    // This is a simplified check
    for (let i = 0; i < matrix.length; i++) {
      if (matrix[i][i] <= 0) return false;
    }

    // For a 2x2 matrix: det = a*d - b*c
    if (matrix.length >= 2) {
      const det2x2 =
        matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
      if (det2x2 < -1e-10) return false;
    }

    return true;
  }

  /**
   * Repair matrix to be positive semi-definite
   * Uses jitter on diagonal to shift eigenvalues
   */
  private static repairMatrix(matrix: number[][]): void {
    const n = matrix.length;
    let jitter = 1e-6;

    // Try increasingly larger jitters
    for (let attempt = 0; attempt < 10; attempt++) {
      const testMatrix = matrix.map(row => [...row]);

      // Add jitter to diagonal
      for (let i = 0; i < n; i++) {
        testMatrix[i][i] += jitter;
      }

      if (this.isPositiveSemiDefinite(testMatrix)) {
        // Apply jitter to original
        for (let i = 0; i < n; i++) {
          matrix[i][i] += jitter;
        }
        console.warn(
          `Correlation matrix repaired with diagonal jitter: ${jitter}`
        );
        return;
      }

      jitter *= 10;
    }

    console.warn(
      'Failed to repair correlation matrix to positive semi-definite'
    );
  }

  /**
   * Compute Cholesky decomposition L such that L * L^T = matrix
   */
  static choleskyDecomposition(
    matrix: number[][]
  ): { L: number[][]; success: boolean } {
    const n = matrix.length;
    const L = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));

    try {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
          let sum = 0;
          for (let k = 0; k < j; k++) {
            sum += L[i][k] * L[j][k];
          }

          if (i === j) {
            const diag = matrix[i][i] - sum;
            if (diag < 1e-10) {
              console.warn(`Cholesky failed: negative diagonal at (${i},${i})`);
              return { L, success: false };
            }
            L[i][j] = Math.sqrt(diag);
          } else {
            L[i][j] = (matrix[i][j] - sum) / L[j][j];
          }
        }
      }

      return { L, success: true };
    } catch (e) {
      console.error('Cholesky decomposition failed:', e);
      return { L, success: false };
    }
  }
}
