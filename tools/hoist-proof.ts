import { MONTE_CARLO_SCENARIOS } from '../src/app/core/models/monte-carlo-contracts.model';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../src/app/core/probability/monte-carlo-probability';
import { precomputeEtfScenarioParameters } from '../src/app/core/precomputation/monte-carlo-precomputation';

const buildDeterministicStudentTShockGrid = (sampleSize: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + 0.5) / (sampleSize + 1);
    shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
  }
  return shocks;
};

const buildScaledShockGrid = (sigmaMonthly: number, shockGrid: number[]): number[] => shockGrid.map((shock) => sigmaMonthly * shock);

const conditionalLogGrowthExpectationOld = (muMonthly: number, sigmaMonthly: number, shockGrid: number[]): number => {
  const scaledShock = buildScaledShockGrid(sigmaMonthly, shockGrid);
  let accepted = 0;
  let total = 0;
  for (let index=0; index < shockGrid.length; index += 1) {
    const grossReturn = 1 + muMonthly + scaledShock[index];
    if (grossReturn <= 0) continue;
    total += Math.log(grossReturn);
    accepted += 1;
  }
  if (accepted === 0) {
    throw new Error('UNACHIEVABLE_TARGET_LOG_GROWTH');
  }
  return total / accepted;
};

const calibrateTargetLogAndSigmaOld = (
  targetLogGrowthMonthly: number,
  sigmaMonthly: number,
  shockGrid: number[] = buildDeterministicStudentTShockGrid(8193)
): number => {
  let lower = -0.9999;
  let lowerValue = conditionalLogGrowthExpectationOld(lower, sigmaMonthly, shockGrid);
  while (Number.isFinite(lowerValue) && lowerValue > targetLogGrowthMonthly) {
    lower -= 0.5;
    lowerValue = conditionalLogGrowthExpectationOld(lower, sigmaMonthly, shockGrid);
    if (!Number.isFinite(lowerValue)) {
      throw new Error('CALIBRATION_LOW_BRACKET_FAILED');
    }
  }

  let upper = 0.25;
  let upperValue = conditionalLogGrowthExpectationOld(upper, sigmaMonthly, shockGrid);
  while (upperValue < targetLogGrowthMonthly) {
    upper *= 2;
    upperValue = conditionalLogGrowthExpectationOld(upper, sigmaMonthly, shockGrid);
    if (!Number.isFinite(upperValue) || upper > 10) {
      throw new Error('CALIBRATION_HIGH_BRACKET_FAILED');
    }
  }

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const midpointValue = conditionalLogGrowthExpectationOld(midpoint, sigmaMonthly, shockGrid);
    if (Math.abs(midpointValue - targetLogGrowthMonthly) <= 1e-10) {
      return midpoint;
    }
    if (midpointValue < targetLogGrowthMonthly) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
    if (Math.abs(upper - lower) <= 1e-10) {
      return (lower + upper) / 2;
    }
  }

  throw new Error('CALIBRATION_DID_NOT_CONVERGE');
};

const makeSnapshot = () => {
  const etfs = ['A', 'B', 'C', 'D', 'E'].map((tag, index) => {
    const expectedReturn = 0.12 - index * 0.005;
    const volatility = 0.18 + index * 0.015;
    return {
      isin: `ETF-${tag}`,
      name: `ETF-${tag}`,
      nickname: null,
      statistics: {
        general: {
          expectedReturn,
          volatility,
          returnRange: { min: -0.28 + index * 0.02, max: 0.52 + index * 0.02 }
        },
        expansion: {
          expectedReturn: expectedReturn + 0.01,
          volatility: volatility + 0.01,
          returnRange: { min: -0.30 + index * 0.02, max: 0.55 + index * 0.02 }
        },
        recession: {
          expectedReturn: expectedReturn - 0.02,
          volatility: volatility + 0.04,
          returnRange: { min: -0.35 + index * 0.02, max: 0.50 + index * 0.02 }
        },
        stagflation: {
          expectedReturn: expectedReturn - 0.03,
          volatility: volatility + 0.08,
          returnRange: { min: -0.40 + index * 0.02, max: 0.46 + index * 0.02 }
        },
        soft_landing: {
          expectedReturn: expectedReturn + 0.02,
          volatility: volatility + 0.02,
          returnRange: { min: -0.26 + index * 0.02, max: 0.58 + index * 0.02 }
        }
      }
    };
  });

  const correlations: Array<{ isin1: string; isin2: string; expansion: number; recession: number; stagflation: number; soft_landing: number }> = [];
  for (let i = 0; i < etfs.length; i += 1) {
    for (let j = i + 1; j < etfs.length; j += 1) {
      const value = 0.12 + ((i + j) % 5) * 0.04;
      correlations.push({
        isin1: etfs[i].isin,
        isin2: etfs[j].isin,
        expansion: value,
        recession: value + 0.04,
        stagflation: value - 0.02,
        soft_landing: value + 0.02
      });
    }
  }

  return {
    etfs,
    correlations
  };
};

const snapshot = makeSnapshot();
const shockGrid = buildDeterministicStudentTShockGrid(8193);

let grossReturnComparisons = 0;
let grossReturnObjectIsExact = 0;
let grossReturnMismatches = 0;
let maxAbsGrossReturnDiff = 0;
let branchDecisionMismatches = 0;
let muStableInsideLoop = true;

for (const etf of snapshot.etfs) {
  for (const scenario of MONTE_CARLO_SCENARIOS) {
    const params = precomputeEtfScenarioParameters(etf.statistics[scenario]);
    const sigmaMonthly = params.monthlyVolatility;
    const target = params.targetLogGrowthMonthly;

    const muValues: number[] = [];
    let lower = -0.9999;
    let lowerValue = conditionalLogGrowthExpectationOld(lower, sigmaMonthly, shockGrid); 
    while (Number.isFinite(lowerValue) && lowerValue > target) {
      muValues.push(lower);
      lower -= 0.5;
      lowerValue = conditionalLogGrowthExpectationOld(lower, sigmaMonthly, shockGrid);
      if (!Number.isFinite(lowerValue)) break;
    }

    let upper = 0.25;
    let upperValue = conditionalLogGrowthExpectationOld(upper, sigmaMonthly, shockGrid);
    while (upperValue < target) {
      muValues.push(upper);
      upper *= 2;
      upperValue = conditionalLogGrowthExpectationOld(upper, sigmaMonthly, shockGrid);
      if (!Number.isFinite(upperValue) || upper > 10) break;
    }

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const midpoint = (lower + upper) / 2;
      const midpointValue = conditionalLogGrowthExpectationOld(midpoint, sigmaMonthly, shockGrid);
      muValues.push(midpoint);
      if (Math.abs(midpointValue - target) <= 1e-10) break;
      if (midpointValue < target) {
        lower = midpoint;
      } else {
        upper = midpoint;
      }
      if (Math.abs(upper - lower) <= 1e-10) break;
    }

    for (const muMonthly of muValues) {
      const scaledShocks = buildScaledShockGrid(sigmaMonthly, shockGrid);
      for (let index = 0; index < shockGrid.length; index += 1) {
        const scaledShock = scaledShocks[index];
        const oldGrossReturn = 1 + muMonthly + scaledShock;
        const baseGrossReturn = 1 + muMonthly;
        const newGrossReturn = baseGrossReturn + scaledShock;

        grossReturnComparisons += 1;

        if (Object.is(oldGrossReturn, newGrossReturn)) {
          grossReturnObjectIsExact += 1;
        } else {
          grossReturnMismatches += 1;
          const diff = Math.abs(oldGrossReturn - newGrossReturn);
          if (diff > maxAbsGrossReturnDiff) {
            maxAbsGrossReturnDiff = diff;
          }
        }

        if ((oldGrossReturn <= 0) !== (newGrossReturn <= 0)) {
          branchDecisionMismatches += 1;
        }

        if (muStableInsideLoop && !Number.isFinite(muMonthly)) {
          muStableInsideLoop = false;
        }
      }
    }
  }
}

console.log(JSON.stringify({
  GROSS_RETURN_COMPARISONS: grossReturnComparisons,
  GROSS_RETURN_OBJECT_IS_EXACT: grossReturnObjectIsExact,
  GROSS_RETURN_MISMATCHES: grossReturnMismatches,
  MAX_ABS_GROSS_RETURN_DIFF: maxAbsGrossReturnDiff,
  BRANCH_DECISION_MISMATCHES: branchDecisionMismatches,
  MU_STABLE_INSIDE_LOOP: muStableInsideLoop,
  ARITHMETIC_GROUPING_MATCHES_CANDIDATE: grossReturnMismatches === 0 && branchDecisionMismatches === 0 ? 'YES' : 'NO',
}, null, 2));
