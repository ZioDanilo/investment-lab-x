import {
  MonteCarloYearResult,
  MonteCarloEtfYearResult,
  MacroScenarioPath,
  ScenarioYear,
  MacroScenario
} from '../models/monte-carlo.model';

/**
 * Manages compound interest calculations and capital tracking throughout simulation.
 * Tracks running peak for drawdown calculation.
 */
export class CompoundInterestEngine {
  /**
   * Calculate ending capital and drawdown for a year
   */
  static calculateYearResult(
    year: number,
    startingCapital: number,
    portfolioReturn: number,
    etfReturns: MonteCarloEtfYearResult[],
    scenarioPath: MacroScenarioPath,
    runningPeak: number
  ): {
    endingCapital: number;
    drawdown: number;
    newPeak: number;
    yearData: MonteCarloYearResult;
  } {
    // Calculate ending capital with compound interest
    const endingCapital = startingCapital * (1 + portfolioReturn);

    // Update running peak
    const newPeak = Math.max(runningPeak, endingCapital);

    // Calculate drawdown
    const drawdown = newPeak > 0 ? (newPeak - endingCapital) / newPeak : 0;

    // Get scenario info for this year
    const scenarioYear = scenarioPath.years[year - 1];

    const yearData: MonteCarloYearResult = {
      year,
      scenario: scenarioYear.scenario,
      durationInCurrentScenario: scenarioYear.durationInCurrentScenario,
      etfReturns,
      portfolioReturn,
      startingCapital,
      endingCapital,
      runningPeak: newPeak,
      drawdown
    };

    return {
      endingCapital,
      drawdown,
      newPeak,
      yearData
    };
  }

  /**
   * Run full 50-year compounding for a path
   */
  static compoundOver50Years(
    initialCapital: number,
    yearResults: MonteCarloYearResult[]
  ): {
    finalCapital: number;
    maxDrawdown: number;
    totalReturn: number;
    cagr: number;
  } {
    if (yearResults.length === 0) {
      return {
        finalCapital: initialCapital,
        maxDrawdown: 0,
        totalReturn: 0,
        cagr: 0
      };
    }

    const finalCapital =
      yearResults[yearResults.length - 1].endingCapital;
    const maxDrawdown = Math.max(
      ...yearResults.map(yr => yr.drawdown)
    );
    const totalReturn = finalCapital / initialCapital - 1;
    const years = yearResults.length;

    // CAGR = (Final / Initial)^(1/years) - 1
    const cagr = Math.pow(finalCapital / initialCapital, 1 / years) - 1;

    return {
      finalCapital,
      maxDrawdown,
      totalReturn,
      cagr
    };
  }
}
