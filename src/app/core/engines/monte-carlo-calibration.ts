import { EtfReturnEngine } from './etf-return.engine';
import { SeededRandom } from './seeded-random';
import {
  PreparedCorrelationMatrix,
  PortfolioPosition,
  MacroScenarioStatistics
} from '../models/monte-carlo.model';
import { MonteCarloValidator, MonteCarloDiagnostics } from './monte-carlo-validator';

/**
 * Calibration tests for Monte Carlo engine
 * Verify that:
 * - Single ETF return matches portfolio return
 * - Multi-ETF returns are within range
 * - Correlation doesn't violate marginal ranges
 */
export class MonteCarloCalibration {
  /**
   * Test 1: Single ETF - portfolio return should equal ETF return
   */
  static testSingleEtf(): {
    passed: boolean;
    message: string;
    samples?: number[];
  } {
    const diagnostics = MonteCarloValidator.createDiagnostics();
    const random = new SeededRandom(12345);

    const portfolio: PortfolioPosition[] = [
      {
        isin: 'IE00B4L5Y983',
        name: 'SINGLE ETF',
        weight: 1.0
      }
    ];

    const macroStatsMap = {
      'IE00B4L5Y983': {
        expansion: {
          expectedReturn: 0.10,
          volatility: 0.15,
          maxDrawdown: -0.20,
          returnRange: { min: -0.20, max: 0.30 }
        },
        recession: {
          expectedReturn: 0.05,
          volatility: 0.10,
          maxDrawdown: -0.15,
          returnRange: { min: -0.15, max: 0.15 }
        },
        stagflation: {
          expectedReturn: -0.02,
          volatility: 0.20,
          maxDrawdown: -0.25,
          returnRange: { min: -0.25, max: 0.10 }
        },
        soft_landing: {
          expectedReturn: 0.08,
          volatility: 0.12,
          maxDrawdown: -0.18,
          returnRange: { min: -0.18, max: 0.25 }
        }
      }
    };

    const corrMatrix: PreparedCorrelationMatrix = {
      isins: ['IE00B4L5Y983'],
      matrix: [[1.0]],
      missingPairs: [],
      repaired: false
    };

    const samples: number[] = [];
    const violations: number[] = [];

    for (let i = 0; i < 10000; i++) {
      const results = EtfReturnEngine.generateCorrelatedReturns(
        portfolio,
        'expansion',
        macroStatsMap,
        corrMatrix,
        { alphaBelow: 2, alphaBetweenAbove: 2 },
        random,
        diagnostics
      );

      const etfReturn = results[0].annualReturn;
      const portfolioReturn = results[0].contribution; // For single ETF, contribution = return * weight = return * 1

      samples.push(etfReturn);

      // Check range
      if (etfReturn < -0.20 || etfReturn > 0.30) {
        violations.push(etfReturn);
      }
    }

    const average = samples.reduce((a, b) => a + b, 0) / samples.length;
    const min = Math.min(...samples);
    const max = Math.max(...samples);

    const passed =
      violations.length === 0 &&
      Math.abs(average - 0.10) < 0.01 &&
      min >= -0.20 &&
      max <= 0.30;

    return {
      passed,
      message: `Single ETF test: ${
        passed ? 'PASSED' : 'FAILED'
      }\n  Average: ${average.toFixed(4)} (target 0.10)\n  Range: [${min.toFixed(4)}, ${max.toFixed(4)}] (expected [-0.20, 0.30])\n  Violations: ${violations.length}`,
      samples
    };
  }

  /**
   * Test 2: Two ETFs with different ranges
   */
  static testTwoEtfs(): {
    passed: boolean;
    message: string;
  } {
    const diagnostics = MonteCarloValidator.createDiagnostics();
    const random = new SeededRandom(54321);

    const portfolio: PortfolioPosition[] = [
      {
        isin: 'ETF_A',
        name: 'ETF A',
        weight: 0.6
      },
      {
        isin: 'ETF_B',
        name: 'ETF B',
        weight: 0.4
      }
    ];

    const macroStatsMap = {
      ETF_A: {
        expansion: {
          expectedReturn: 0.12,
          volatility: 0.18,
          maxDrawdown: -0.20,
          returnRange: { min: -0.20, max: 0.30 }
        },
        recession: {
          expectedReturn: 0.05,
          volatility: 0.10,
          maxDrawdown: -0.15,
          returnRange: { min: -0.15, max: 0.15 }
        },
        stagflation: {
          expectedReturn: -0.02,
          volatility: 0.20,
          maxDrawdown: -0.25,
          returnRange: { min: -0.25, max: 0.10 }
        },
        soft_landing: {
          expectedReturn: 0.10,
          volatility: 0.12,
          maxDrawdown: -0.18,
          returnRange: { min: -0.18, max: 0.25 }
        }
      },
      ETF_B: {
        expansion: {
          expectedReturn: 0.08,
          volatility: 0.12,
          maxDrawdown: -0.10,
          returnRange: { min: -0.10, max: 0.15 }
        },
        recession: {
          expectedReturn: 0.02,
          volatility: 0.08,
          maxDrawdown: -0.08,
          returnRange: { min: -0.08, max: 0.12 }
        },
        stagflation: {
          expectedReturn: 0.00,
          volatility: 0.15,
          maxDrawdown: -0.12,
          returnRange: { min: -0.12, max: 0.08 }
        },
        soft_landing: {
          expectedReturn: 0.06,
          volatility: 0.10,
          maxDrawdown: -0.10,
          returnRange: { min: -0.10, max: 0.12 }
        }
      }
    };

    // Identity correlation (independent)
    const corrMatrix: PreparedCorrelationMatrix = {
      isins: ['ETF_A', 'ETF_B'],
      matrix: [[1.0, 0.0], [0.0, 1.0]],
      missingPairs: [],
      repaired: false
    };

    let violations = 0;
    let portfolioReturns: number[] = [];

    for (let i = 0; i < 5000; i++) {
      const results = EtfReturnEngine.generateCorrelatedReturns(
        portfolio,
        'expansion',
        macroStatsMap,
        corrMatrix,
        { alphaBelow: 2, alphaBetweenAbove: 2 },
        random,
        diagnostics
      );

      const portfolioReturn = results.reduce((s, r) => s + r.contribution, 0);
      portfolioReturns.push(portfolioReturn);

      // Expected range: 0.6 * [-0.20, 0.30] + 0.4 * [-0.10, 0.15]
      // min = 0.6 * -0.20 + 0.4 * -0.10 = -0.16
      // max = 0.6 * 0.30 + 0.4 * 0.15 = 0.24

      if (portfolioReturn < -0.16 - 1e-10 || portfolioReturn > 0.24 + 1e-10) {
        violations++;
      }
    }

    const average =
      portfolioReturns.reduce((a, b) => a + b, 0) / portfolioReturns.length;
    const passed =
      violations === 0 && average >= 0.17 && average <= 0.19;

    return {
      passed,
      message: `Two ETF test: ${
        passed ? 'PASSED' : 'FAILED'
      }\n  Average portfolio return: ${average.toFixed(4)} (expected ~0.18)\n  Range: [${Math.min(...portfolioReturns).toFixed(4)}, ${Math.max(...portfolioReturns).toFixed(4)}] (expected [-0.16, 0.24])\n  Violations: ${violations}`
    };
  }

  /**
   * Test 3: Correlation impact
   */
  static testCorrelation(): {
    passed: boolean;
    message: string;
  } {
    const diagnostics = MonteCarloValidator.createDiagnostics();

    // Test with different correlations - should stay within ranges
    const correlations = [0.0, 0.5, 0.8, -0.5, 0.99];
    const results: string[] = [];

    for (const corr of correlations) {
      const random = new SeededRandom(99999);
      const portfolio: PortfolioPosition[] = [
        { isin: 'A', name: 'A', weight: 0.5 },
        { isin: 'B', name: 'B', weight: 0.5 }
      ];

      const macroStats = {
        A: {
          expansion: {
            expectedReturn: 0.10,
            volatility: 0.15,
            maxDrawdown: -0.20,
            returnRange: { min: -0.20, max: 0.30 }
          },
          recession: {
            expectedReturn: 0.05,
            volatility: 0.10,
            maxDrawdown: -0.15,
            returnRange: { min: -0.15, max: 0.15 }
          },
          stagflation: {
            expectedReturn: -0.02,
            volatility: 0.20,
            maxDrawdown: -0.25,
            returnRange: { min: -0.25, max: 0.10 }
          },
          soft_landing: {
            expectedReturn: 0.08,
            volatility: 0.12,
            maxDrawdown: -0.18,
            returnRange: { min: -0.18, max: 0.25 }
          }
        },
        B: {
          expansion: {
            expectedReturn: 0.10,
            volatility: 0.15,
            maxDrawdown: -0.20,
            returnRange: { min: -0.20, max: 0.30 }
          },
          recession: {
            expectedReturn: 0.05,
            volatility: 0.10,
            maxDrawdown: -0.15,
            returnRange: { min: -0.15, max: 0.15 }
          },
          stagflation: {
            expectedReturn: -0.02,
            volatility: 0.20,
            maxDrawdown: -0.25,
            returnRange: { min: -0.25, max: 0.10 }
          },
          soft_landing: {
            expectedReturn: 0.08,
            volatility: 0.12,
            maxDrawdown: -0.18,
            returnRange: { min: -0.18, max: 0.25 }
          }
        }
      };

      const corrMatrix: PreparedCorrelationMatrix = {
        isins: ['A', 'B'],
        matrix: [[1.0, corr], [corr, 1.0]],
        missingPairs: [],
        repaired: false
      };

      let violations = 0;
      for (let i = 0; i < 1000; i++) {
        const rets = EtfReturnEngine.generateCorrelatedReturns(
          portfolio,
          'expansion',
          macroStats,
          corrMatrix,
          { alphaBelow: 2, alphaBetweenAbove: 2 },
          random,
          diagnostics
        );

        const pReturn = rets.reduce((s, r) => s + r.contribution, 0);
        if (pReturn < -0.20 - 1e-10 || pReturn > 0.30 + 1e-10) {
          violations++;
        }
      }

      results.push(
        `  correlation=${corr.toFixed(2)}: ${violations} violations`
      );
    }

    return {
      passed: results.every(r => r.includes('0 violations')),
      message: `Correlation test:\n${results.join('\n')}`
    };
  }

  /**
   * Run all calibration tests
   */
  static runAll(): void {
    console.log('\n=== MONTE CARLO CALIBRATION TESTS ===\n');

    const test1 = this.testSingleEtf();
    console.log(test1.message);

    const test2 = this.testTwoEtfs();
    console.log('\n' + test2.message);

    const test3 = this.testCorrelation();
    console.log('\n' + test3.message);

    const allPassed = test1.passed && test2.passed && test3.passed;
    console.log(
      `\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}\n`
    );
  }
}
