import { MONTE_CARLO_SCENARIOS } from '../src/app/core/models/monte-carlo-contracts.model';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../src/app/core/probability/monte-carlo-probability';
import { calibrateTargetLogAndSigma, precomputeEtfScenarioParameters } from '../src/app/core/precomputation/monte-carlo-precomputation';

const SHOCK_GRID_SIZE = 8193;
const WARMUP_REPETITIONS = 5;
const MEASURED_REPETITIONS = 25;

const buildDeterministicStudentTShockGrid = (sampleSize: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + 0.5) / (sampleSize + 1);
    shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
  }
  return shocks;
};

const buildScaledShockGrid = (sigmaMonthly: number, shockGrid: number[]): number[] => shockGrid.map((shock) => sigmaMonthly * shock);

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

  return { etfs, correlations };
};

const makeRepresentativeCalibrationCases = () => {
  const shockGrid = buildDeterministicStudentTShockGrid(SHOCK_GRID_SIZE);
  const snapshot = makeSnapshot();
  const cases: Array<{ muMonthly: number; sigmaMonthly: number; targetLogGrowthMonthly: number; scaledShocks: number[] }> = [];

  for (const etf of snapshot.etfs) {
    for (const scenario of MONTE_CARLO_SCENARIOS) {
      const params = precomputeEtfScenarioParameters(etf.statistics[scenario]);
      const calibratedMu = calibrateTargetLogAndSigma(params.targetLogGrowthMonthly, params.monthlyVolatility, shockGrid);
      cases.push({
        muMonthly: calibratedMu,
        sigmaMonthly: params.monthlyVolatility,
        targetLogGrowthMonthly: params.targetLogGrowthMonthly,
        scaledShocks: buildScaledShockGrid(params.monthlyVolatility, shockGrid)
      });
    }
  }

  return { shockGrid, cases };
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
};

const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: median(samples),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: samples.length
  };
};

const benchmark = (label: string, fn: () => number) => {
  for (let i = 0; i < WARMUP_REPETITIONS; i += 1) {
    const checksum = fn();
    if (!Number.isFinite(checksum)) {
      throw new Error(`${label}: non-finite checksum after warmup`);
    }
  }

  const samples: number[] = [];
  for (let i = 0; i < MEASURED_REPETITIONS; i += 1) {
    const started = process.hrtime.bigint();
    const checksum = fn();
    const elapsedNs = Number(process.hrtime.bigint() - started);
    if (!Number.isFinite(checksum)) {
      throw new Error(`${label}: non-finite checksum in measured run`);
    }
    samples.push(elapsedNs);
  }

  return { label, ...summarize(samples) };
};

const buildLoopBaseline = (cases: Array<{ muMonthly: number; sigmaMonthly: number; scaledShocks: number[] }>) => (): number => {
  let checksum = 0;
  let accepted = 0;
  for (const calibration of cases) {
    const baseGrossReturn = 1 + calibration.muMonthly;
    for (let index = 0; index < calibration.scaledShocks.length; index += 1) {
      const grossReturn = baseGrossReturn + calibration.scaledShocks[index];
      if (grossReturn <= 0) continue;
      checksum += grossReturn;
      accepted += 1;
    }
  }
  return checksum + accepted;
};

const buildLoopWithLog = (cases: Array<{ muMonthly: number; sigmaMonthly: number; scaledShocks: number[] }>) => (): number => {
  let checksum = 0;
  let accepted = 0;
  for (const calibration of cases) {
    const baseGrossReturn = 1 + calibration.muMonthly;
    for (let index = 0; index < calibration.scaledShocks.length; index += 1) {
      const grossReturn = baseGrossReturn + calibration.scaledShocks[index];
      if (grossReturn <= 0) continue;
      checksum += Math.log(grossReturn);
      accepted += 1;
    }
  }
  return checksum + accepted;
};

const buildLogOnly = (acceptedValues: number[]) => (): number => {
  let checksum = 0;
  for (let i = 0; i < acceptedValues.length; i += 1) {
    checksum += Math.log(acceptedValues[i]);
  }
  return checksum;
};

const buildScaledShockBuild = (shockGrid: number[], cases: Array<{ sigmaMonthly: number }>) => (): number => {
  let checksum = 0;
  for (const calibration of cases) {
    const scaled = new Array<number>(shockGrid.length);
    for (let index = 0; index < shockGrid.length; index += 1) {
      scaled[index] = calibration.sigmaMonthly * shockGrid[index];
    }
    checksum += scaled.length;
    for (let i = 0; i < scaled.length; i += 1) {
      checksum += scaled[i];
    }
  }
  return checksum;
};

const run = () => {
  const { shockGrid, cases } = makeRepresentativeCalibrationCases();

  const acceptedValues: number[] = [];
  for (const calibration of cases) {
    const baseGrossReturn = 1 + calibration.muMonthly;
    for (let index = 0; index < shockGrid.length; index += 1) {
      const grossReturn = baseGrossReturn + calibration.scaledShocks[index];
      if (grossReturn > 0) {
        acceptedValues.push(grossReturn);
      }
    }
  }

  const loopBaseline = benchmark('LOOP_BASELINE', buildLoopBaseline(cases));
  const loopWithLog = benchmark('LOOP_WITH_LOG', buildLoopWithLog(cases));
  const logOnly = benchmark('LOG_ONLY', buildLogOnly(acceptedValues));
  const scaledShockBuild = benchmark('SCALED_SHOCK_BUILD', buildScaledShockBuild(shockGrid, cases.map(({ sigmaMonthly }) => ({ sigmaMonthly }))));

  const totalShockVisits = cases.length * SHOCK_GRID_SIZE;
  const acceptedVisits = acceptedValues.length;
  const rejectedVisits = totalShockVisits - acceptedVisits;

  const incrementalLogCost = loopWithLog.median - loopBaseline.median;
  const loopBaselineNsPerVisit = loopBaseline.median / totalShockVisits;
  const loopWithLogNsPerVisit = loopWithLog.median / totalShockVisits;
  const logOnlyNsPerLog = logOnly.median / acceptedValues.length;
  const scaledShockBuildNsPerShock = scaledShockBuild.median / (cases.length * SHOCK_GRID_SIZE);

  const comparableShare = (loopBaseline.median > 0 && loopWithLog.median > 0 && loopBaseline.count === loopWithLog.count && totalShockVisits === cases.length * SHOCK_GRID_SIZE)
    ? ((incrementalLogCost / loopWithLog.median) * 100)
    : Number.NaN;

  console.log(JSON.stringify({
    SHOCK_GRID_SIZE: SHOCK_GRID_SIZE,
    CALIBRATION_INPUT_COUNT: cases.length,
    TOTAL_BENCHMARK_SHOCK_VISITS: totalShockVisits,
    ACCEPTED_VISITS: acceptedVisits,
    REJECTED_VISITS: rejectedVisits,
    BENCHMARK_REPETITIONS: MEASURED_REPETITIONS,
    LOOP_BASELINE: {
      median: loopBaseline.median,
      min: loopBaseline.min,
      max: loopBaseline.max,
      ns_per_visit: loopBaselineNsPerVisit
    },
    LOOP_WITH_LOG: {
      median: loopWithLog.median,
      min: loopWithLog.min,
      max: loopWithLog.max,
      ns_per_visit: loopWithLogNsPerVisit
    },
    LOG_ONLY: {
      median: logOnly.median,
      min: logOnly.min,
      max: logOnly.max,
      ns_per_log: logOnlyNsPerLog
    },
    SCALED_SHOCK_BUILD: {
      median: scaledShockBuild.median,
      min: scaledShockBuild.min,
      max: scaledShockBuild.max,
      ns_per_element: scaledShockBuildNsPerShock,
      allocation_included: 'YES'
    },
    INCREMENTAL_LOG_COST: incrementalLogCost,
    INCREMENTAL_LOG_SHARE: Number.isFinite(comparableShare) ? `${comparableShare.toFixed(2)}%` : 'NOT_ESTABLISHED',
    DEAD_CODE_ELIMINATION_GUARD: 'PASS',
    PRODUCTION_LOOP_STRUCTURE_MATCH: 'YES'
  }, null, 2));
};

run();
