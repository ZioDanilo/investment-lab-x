import { MONTE_CARLO_SCENARIOS } from '../src/app/core/models/monte-carlo-contracts.model';
import { precomputeEtfScenarioParameters } from '../src/app/core/precomputation/monte-carlo-precomputation';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../src/app/core/probability/monte-carlo-probability';

const SHOCK_GRID_SIZE = 8193;

const buildDeterministicStudentTShockGrid = (sampleSize: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + 0.5) / (sampleSize + 1);
    shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
  }
  return shocks;
};

const buildScaledShockGrid = (sigmaMonthly: number, shockGrid: number[]): number[] => shockGrid.map((shock) => sigmaMonthly * shock);

const toBits = (value: number): string => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += view.getUint8(i).toString(16).padStart(2, '0');
  }
  return out;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const summarize = (values: number[]) => ({
  min: Math.min(...values),
  median: median(values),
  max: Math.max(...values)
});

const snapshot = {
  etfs: ['A', 'B', 'C', 'D', 'E'].map((tag, index) => ({
    isin: `ETF-${tag}`,
    name: `ETF-${tag}`,
    nickname: null,
    statistics: {
      general: { expectedReturn: 0.12 - index * 0.005, volatility: 0.18 + index * 0.015, returnRange: { min: -0.28 + index * 0.02, max: 0.52 + index * 0.02 } },
      expansion: { expectedReturn: 0.13 - index * 0.005, volatility: 0.19 + index * 0.015, returnRange: { min: -0.30 + index * 0.02, max: 0.55 + index * 0.02 } },
      recession: { expectedReturn: 0.10 - index * 0.005, volatility: 0.22 + index * 0.015, returnRange: { min: -0.35 + index * 0.02, max: 0.50 + index * 0.02 } },
      stagflation: { expectedReturn: 0.09 - index * 0.005, volatility: 0.26 + index * 0.015, returnRange: { min: -0.40 + index * 0.02, max: 0.46 + index * 0.02 } },
      soft_landing: { expectedReturn: 0.14 - index * 0.005, volatility: 0.20 + index * 0.015, returnRange: { min: -0.26 + index * 0.02, max: 0.58 + index * 0.02 } }
    }
  }))
};

const shockGrid = buildDeterministicStudentTShockGrid(SHOCK_GRID_SIZE);
const records: Array<{
  calibrationId: string;
  initialLower: number;
  initialUpper: number;
  initialWidth: number;
  finalMu: number;
  distanceFromLower: number;
  distanceFromUpper: number;
  rootFraction: number;
  evals: number;
  uniqueCount: number;
  duplicateCount: number;
}> = [];

let totalExpectationEvaluations = 0;
let totalUniqueSameCalibration = 0;
let totalDuplicateSameCalibration = 0;

for (const etf of snapshot.etfs) {
  for (const scenario of MONTE_CARLO_SCENARIOS) {
    const params = precomputeEtfScenarioParameters(etf.statistics[scenario]);
    const sigma = params.monthlyVolatility;
    const scaledShock = buildScaledShockGrid(sigma, shockGrid);

    const evalExpectation = (mu: number): number => {
      let accepted = 0;
      let total = 0;
      for (let i = 0; i < shockGrid.length; i += 1) {
        const grossReturn = 1 + mu + scaledShock[i];
        if (grossReturn <= 0) continue;
        total += Math.log(grossReturn);
        accepted += 1;
      }
      if (accepted === 0) throw new Error('no accepted shocks');
      return total / accepted;
    };

    const initialLower = -0.9999;
    const initialUpper = 0.25;
    const seenMu = new Map<string, { count: number; mu: number }>();
    let evals = 0;

    const add = (mu: number): void => {
      evals += 1;
      const key = toBits(mu);
      const entry = seenMu.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        seenMu.set(key, { count: 1, mu });
      }
    };

    let lower = initialLower;
    let lowerValue = evalExpectation(lower);
    add(lower);
    while (Number.isFinite(lowerValue) && lowerValue > params.targetLogGrowthMonthly) {
      lower -= 0.5;
      lowerValue = evalExpectation(lower);
      add(lower);
    }

    let upper = initialUpper;
    let upperValue = evalExpectation(upper);
    add(upper);
    while (upperValue < params.targetLogGrowthMonthly) {
      upper *= 2;
      upperValue = evalExpectation(upper);
      add(upper);
    }

    let finalMu: number | null = null;
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const midpoint = (lower + upper) / 2;
      const midpointValue = evalExpectation(midpoint);
      add(midpoint);

      if (Math.abs(midpointValue - params.targetLogGrowthMonthly) <= 1e-10) {
        finalMu = midpoint;
        break;
      }
      if (midpointValue < params.targetLogGrowthMonthly) {
        lower = midpoint;
      } else {
        upper = midpoint;
      }
      if (Math.abs(upper - lower) <= 1e-10) {
        finalMu = (lower + upper) / 2;
        break;
      }
    }

    if (finalMu === null) finalMu = (lower + upper) / 2;

    const duplicateCount = Array.from(seenMu.values()).reduce((sum, item) => sum + Math.max(item.count - 1, 0), 0);
    const uniqueCount = seenMu.size;

    totalExpectationEvaluations += evals;
    totalUniqueSameCalibration += uniqueCount;
    totalDuplicateSameCalibration += duplicateCount;

    records.push({
      calibrationId: `${etf.isin}:${scenario}`,
      initialLower,
      initialUpper,
      initialWidth: initialUpper - initialLower,
      finalMu,
      distanceFromLower: Math.abs(finalMu - initialLower),
      distanceFromUpper: Math.abs(initialUpper - finalMu),
      rootFraction: (finalMu - initialLower) / (initialUpper - initialLower),
      evals,
      uniqueCount,
      duplicateCount
    });
  }
}

const widthSummary = summarize(records.map((r) => r.initialWidth));
const lowerSummary = summarize(records.map((r) => r.distanceFromLower));
const upperSummary = summarize(records.map((r) => r.distanceFromUpper));
const fractionSummary = summarize(records.map((r) => r.rootFraction));

console.log(JSON.stringify({
  representativeCalibrations: records.length,
  representativeExpectationEvaluations: totalExpectationEvaluations,
  representativeUniqueSameCalibrationMu: totalUniqueSameCalibration,
  representativeDuplicateSameCalibrationEvaluations: totalDuplicateSameCalibration,
  representativeDuplicateRate: totalExpectationEvaluations > 0 ? totalDuplicateSameCalibration / totalExpectationEvaluations : 0,
  initialBracketWidth: widthSummary,
  solutionDistanceFromInitialLower: lowerSummary,
  solutionDistanceFromInitialUpper: upperSummary,
  rootFractionOfInitialBracket: fractionSummary,
  sample: records.slice(0, 3)
}, null, 2));
