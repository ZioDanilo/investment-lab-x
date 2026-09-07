import {
  MacroScenario,
  MACRO_SCENARIOS,
  EtfMacroStatistics,
  StructuralProbabilities,
  TransitionMatrix,
  MonteCarloDistributionSettings,
  PortfolioPosition
} from '../models/monte-carlo.model';
import { Etf } from '../models/etf.model';
import { MonteCarloEngine } from './monte-carlo.engine.refactored';
import { PortfolioSnapshotFactory } from './portfolio-snapshot.factory';
import { EtfReturnEngine } from './etf-return.engine';

/**
 * Calibration Engine: Automatically adjusts expected returns to align
 * simulated median CAGR with long-term target CAGR for individual ETFs.
 */
export class CalibrationEngine {
  /**
   * Run calibration for a single ETF
   * @param etf The ETF to calibrate
   * @param structural Structural probabilities for macro scenarios
   * @param transition Transition matrix
   * @param distributionSettings Distribution parameters
   * @param onProgress Optional progress callback (0-100)
   * @returns Calibrated ETF with updated macroStatistics
   */
  static calibrateEtf(
    etf: Etf,
    structural: StructuralProbabilities,
    transition: TransitionMatrix,
    distributionSettings: MonteCarloDistributionSettings,
    onProgress?: (pct: number) => void
  ): Etf {
    // Validation
    if (!etf.longTermExpectedReturn) {
      throw new Error(`ETF ${etf.isin} missing longTermExpectedReturn`);
    }

    if (!etf.macroStatistics) {
      throw new Error(`ETF ${etf.isin} missing macroStatistics`);
    }

    const targetCagr = etf.longTermExpectedReturn;
    const maxIterations = 20;
    const convergenceThreshold = 0.002; // 0.20%
    const initialCapital = 100_000;
    const horizonYears = 50;
    const simulationCount = 100_000;
    const seed = 12345; // Fixed seed for reproducibility

    let currentEtf = JSON.parse(JSON.stringify(etf)) as Etf;
    let iteration = 0;
    let lastDelta = 999;

    console.log(`🔄 Calibrating ETF ${etf.isin} (${etf.name})`);
    console.log(`   Target long-term CAGR: ${(targetCagr * 100).toFixed(2)}%`);

    while (iteration < maxIterations) {
      iteration++;
      
      if (onProgress) {
        onProgress(Math.round((iteration / maxIterations) * 100));
      }

      // Step 1: Run diagnostic Monte Carlo
      const portfolio: PortfolioPosition[] = [
        {
          isin: currentEtf.isin,
          name: currentEtf.name,
          weight: 1.0 // 100%
        }
      ];

      const portfolioSnapshot = PortfolioSnapshotFactory.create(portfolio);
      const macroStatsMap = {
        [currentEtf.isin]: currentEtf.macroStatistics as Record<MacroScenario, any>
      };

      let summary: any;
      try {
        const result = MonteCarloEngine.run({
          etfs: [currentEtf],
          params: {
            initialCapital,
            simulationCount,
            targetCagr: 0.07, // dummy value
            horizonYears,
            seed
          },
          structural,
          transition,
          distributionSettings,
          rebalanceSettings: { enabled: false, frequencyYears: 1 },
          portfolio,
          portfolioSnapshot,
          correlations: [],
          onProgress: undefined // Don't report inner progress
        });

        summary = result.summary;
      } catch (e) {
        console.error(`   ❌ Iteration ${iteration}: Monte Carlo failed:`, (e as any).message);
        break;
      }

      const medianCagr = summary.medianCagr;
      const delta = medianCagr - targetCagr;
      lastDelta = delta;

      console.log(
        `   Iteration ${iteration}: medianCagr=${(medianCagr * 100).toFixed(2)}%, ` +
        `delta=${(delta * 100).toFixed(3)}%`
      );

      // Step 2: Check convergence
      if (Math.abs(delta) < convergenceThreshold) {
        console.log(`   ✅ Converged after ${iteration} iterations`);
        break;
      }

      // Step 3: Recalibrate if needed
      if (Math.abs(delta) > convergenceThreshold) {
        const adjustment = delta; // Apply full delta as adjustment
        currentEtf = this.adjustExpectedReturns(
          currentEtf,
          adjustment,
          convergenceThreshold
        );
      }
    }

    // Finalize
    currentEtf.calibratedAt = new Date().toISOString();
    currentEtf.lastCalibrationMedianCagr = summary?.medianCagr;

    console.log(`   Final delta: ${(lastDelta * 100).toFixed(3)}%`);
    console.log(`   Calibrated at: ${currentEtf.calibratedAt}`);

    return currentEtf;
  }

  /**
   * Adjust all four expected returns while maintaining relative differentials
   */
  private static adjustExpectedReturns(
    etf: Etf,
    delta: number,
    stepSize: number
  ): Etf {
    if (!etf.macroStatistics) {
      throw new Error(`ETF ${etf.isin} missing macroStatistics`);
    }

    const stats = etf.macroStatistics as any;
    const scenarios = ['expansion', 'soft_landing', 'recession', 'stagflation'];

    // Calculate current average to understand the starting point
    const currentValues = scenarios.map(s => stats[s]?.expectedReturn || 0);
    const currentAverage = currentValues.reduce((a, b) => a + b, 0) / scenarios.length;

    // Estimate adjustment step: use delta but cap it to stepSize for stability
    const step = Math.max(Math.min(delta, stepSize), -stepSize);

    // Adjust all expected returns by the same amount (maintains differentials)
    const adjusted: any = {};
    for (const scenario of scenarios) {
      const oldValue = stats[scenario]?.expectedReturn || 0;
      adjusted[scenario] = {
        ...stats[scenario],
        expectedReturn: oldValue + step
      };
    }

    return {
      ...etf,
      macroStatistics: adjusted as EtfMacroStatistics
    };
  }

  /**
   * Validate that an ETF is calibrated (within tolerance)
   */
  static isCalibrated(
    etf: Etf,
    tolerance: number = 0.002
  ): boolean {
    if (!etf.calibratedAt || !etf.lastCalibrationMedianCagr || !etf.longTermExpectedReturn) {
      return false;
    }

    const delta = Math.abs(etf.lastCalibrationMedianCagr - etf.longTermExpectedReturn);
    return delta <= tolerance;
  }

  /**
   * Get calibration status as string
   */
  static getCalibrationStatus(etf: Etf): string {
    if (!etf.calibratedAt) {
      return 'NOT CALIBRATED';
    }

    if (!etf.lastCalibrationMedianCagr || !etf.longTermExpectedReturn) {
      return 'CALIBRATED (incomplete data)';
    }

    const delta = etf.lastCalibrationMedianCagr - etf.longTermExpectedReturn;
    if (Math.abs(delta) < 0.002) {
      return `CALIBRATED (Δ = ${(delta * 100).toFixed(2)}%)`;
    }

    return `OUT OF TOLERANCE (Δ = ${(delta * 100).toFixed(2)}%)`;
  }
}
