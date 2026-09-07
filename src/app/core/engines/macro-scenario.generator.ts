import { SeededRandom } from './seeded-random';
import {
  MacroScenario,
  MACRO_SCENARIOS,
  StructuralProbabilities,
  TransitionMatrix,
  MacroScenarioPath,
  ScenarioYear
} from '../models/monte-carlo.model';

/**
 * Generates a path of macro scenarios for a 50-year Monte Carlo simulation.
 * 
 * Year 1: Samples from initial distribution (structural probabilities)
 * Years 2-50: Uses pure Markov transition matrix (no structural blending)
 */
export class MacroScenarioGenerator {
  /**
   * Generate a 50-year scenario path using Markov chain
   */
  static generateScenarioPath(
    years: number,
    initialDistribution: StructuralProbabilities,
    transitionMatrix: TransitionMatrix,
    random: SeededRandom
  ): MacroScenarioPath {
    const scenarioYears: ScenarioYear[] = [];
    const frequencies: Record<MacroScenario, number> = {
      expansion: 0,
      recession: 0,
      stagflation: 0,
      soft_landing: 0
    };

    let currentScenario: MacroScenario | null = null;
    let durationInCurrentScenario = 0;

    for (let year = 1; year <= years; year++) {
      let scenario: MacroScenario;

      if (year === 1) {
        // Year 1: Use initial distribution
        scenario = random.weightedChoice(initialDistribution);
      } else {
        // Years 2+: Use transition matrix from previous scenario
        if (currentScenario === null) {
          throw new Error('Current scenario is null for year > 1');
        }
        const transitionRow = transitionMatrix[currentScenario];
        scenario = random.weightedChoice(transitionRow);
      }

      // Track duration in current scenario
      if (scenario === currentScenario) {
        durationInCurrentScenario++;
      } else {
        durationInCurrentScenario = 1;
        currentScenario = scenario;
      }

      // Record the year
      scenarioYears.push({
        year,
        scenario,
        durationInCurrentScenario
      });

      // Update frequency
      frequencies[scenario]++;
    }

    return {
      years: scenarioYears,
      frequencies
    };
  }
}
