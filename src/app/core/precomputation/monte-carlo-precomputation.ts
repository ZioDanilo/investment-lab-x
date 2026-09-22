import {
  MONTE_CARLO_SCENARIOS,
  MonteCarloEtfStatistics,
  MonteCarloScenario,
  MonteCarloSnapshot
} from '../models/monte-carlo-contracts.model';
import { STUDENT_T_STANDARDIZATION, studentTQuantile } from '../probability/monte-carlo-probability';

export const PSD_EPSILON = 1e-6;
export const CORRELATION_EPSILON = 1e-6;
export const MAX_CORRELATION_CELL_DELTA = 0.02;
export const NEAREST_CORRELATION_TOLERANCE = 1e-10;
export const NEAREST_CORRELATION_MAX_ITERATIONS = 100;

export class MonteCarloPrecomputationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'MonteCarloPrecomputationError';
  }
}

export interface MuCalibrationNode {
  intensity: number;
  targetLogGrowthMonthly: number;
  sigmaMonthly: number;
  muMonthly: number;
  impliedAnnualCagr: number;
}

export interface PreparedEtfScenarioParameters {
  monthlyExpectedReturn: number;
  calibratedMonthlyLocation: number;
  targetLogGrowthMonthly: number;
  generalMonthlyExpectedReturn?: number;
  generalMonthlyVolatility?: number;
  muCalibrationByIntensity: MuCalibrationNode[];
  monthlyVolatility: number;
  zMin: number | null;
  zMax: number | null;
  monthlyRangeMin: number;
  monthlyRangeMax: number;
}

export interface CorrelationMatrixPreparation {
  scenario: MonteCarloScenario;
  assetIsins: string[];
  originalMatrix: number[][];
  correctedMatrix: number[][] | null;
  operationalMatrix: number[][];
  correctionApplied: boolean;
  minimumEigenvalueBefore: number;
  minimumEigenvalueAfter: number;
  eigenvalues: number[];
  maxCellDelta: number;
  frobeniusDelta: number;
  conditionNumberBefore: number | null;
  conditionNumberAfter: number | null;
  correctionIterations: number;
  factor: number[][];
  factorReconstructionError: number;
}

export interface MonteCarloPrecomputationDiagnostics {
  totalMs: number;
  fingerprintMs: number;
  cacheLookupMs: number;
  cacheResult: 'HIT' | 'MISS';
  shockGridMs?: number;
  generalParamsMs?: number;
  scenarioParamsMs?: number;
  muCurvesMs?: number;
  correlationsMs?: number;
  assemblyMs?: number;
}

export interface MonteCarloPrecomputation {
  etfParameters: Record<string, Record<MonteCarloScenario, PreparedEtfScenarioParameters>>;
  correlationMatrices: Record<MonteCarloScenario, CorrelationMatrixPreparation>;
}

export interface MonteCarloPrecomputationCacheStats {
  hits: number;
  misses: number;
  entries: number;
  precomputationCacheHit: boolean;
  precomputationMs: number;
}

export type CalibrationCategory = 'GENERAL' | 'SCENARIO' | 'MU_CURVE_INTERIOR';

export interface CalibrationCategoryCounters {
  calibrationCalls: number;
  expectationEvaluations: number;
  lowerInitialEvaluations: number;
  lowerExpansionEvaluations: number;
  upperInitialEvaluations: number;
  upperExpansionEvaluations: number;
  bisectionEvaluations: number;
  shockVisits: number;
  acceptedShocks: number;
  rejectedShocks: number;
  mathLogCalls: number;
  convergedByTargetTolerance: number;
  convergedByBracketTolerance: number;
  failedCalibrations: number;
}

export interface CalibrationWorkDiagnostics extends CalibrationCategoryCounters {
  byCategory: Record<CalibrationCategory, CalibrationCategoryCounters>;
  minExpectationEvaluationsPerCalibration: number;
  maxExpectationEvaluationsPerCalibration: number;
  sumExpectationEvaluationsPerCalibration: number;
}

interface EigenDecomposition {
  eigenvalues: number[];
  eigenvectors: number[][];
}

const EMPTY_CATEGORY_DIAGNOSTICS = (): CalibrationCategoryCounters => ({
  calibrationCalls: 0,
  expectationEvaluations: 0,
  lowerInitialEvaluations: 0,
  lowerExpansionEvaluations: 0,
  upperInitialEvaluations: 0,
  upperExpansionEvaluations: 0,
  bisectionEvaluations: 0,
  shockVisits: 0,
  acceptedShocks: 0,
  rejectedShocks: 0,
  mathLogCalls: 0,
  convergedByTargetTolerance: 0,
  convergedByBracketTolerance: 0,
  failedCalibrations: 0
});

const createEmptyCalibrationWorkDiagnostics = (): CalibrationWorkDiagnostics => ({
  ...EMPTY_CATEGORY_DIAGNOSTICS(),
  byCategory: {
    GENERAL: EMPTY_CATEGORY_DIAGNOSTICS(),
    SCENARIO: EMPTY_CATEGORY_DIAGNOSTICS(),
    MU_CURVE_INTERIOR: EMPTY_CATEGORY_DIAGNOSTICS()
  },
  minExpectationEvaluationsPerCalibration: Number.POSITIVE_INFINITY,
  maxExpectationEvaluationsPerCalibration: 0,
  sumExpectationEvaluationsPerCalibration: 0
});

const CALIBRATION_WORK_DIAGNOSTICS: CalibrationWorkDiagnostics = {
  ...EMPTY_CATEGORY_DIAGNOSTICS(),
  byCategory: {
    GENERAL: EMPTY_CATEGORY_DIAGNOSTICS(),
    SCENARIO: EMPTY_CATEGORY_DIAGNOSTICS(),
    MU_CURVE_INTERIOR: EMPTY_CATEGORY_DIAGNOSTICS()
  },
  minExpectationEvaluationsPerCalibration: Number.POSITIVE_INFINITY,
  maxExpectationEvaluationsPerCalibration: 0,
  sumExpectationEvaluationsPerCalibration: 0
};

let CALIBRATION_DIAGNOSTICS_ENABLED = false;

let ACTIVE_CALIBRATION_DIAGNOSTIC: {
  category: CalibrationCategory;
  local: CalibrationCategoryCounters;
} | null = null;

export const enableCalibrationWorkDiagnostics = (): void => {
  CALIBRATION_DIAGNOSTICS_ENABLED = true;
};

export const disableCalibrationWorkDiagnostics = (): void => {
  CALIBRATION_DIAGNOSTICS_ENABLED = false;
  ACTIVE_CALIBRATION_DIAGNOSTIC = null;
};

const beginCalibrationDiagnostic = (category: CalibrationCategory): void => {
  ACTIVE_CALIBRATION_DIAGNOSTIC = { category, local: EMPTY_CATEGORY_DIAGNOSTICS() };
};

const endCalibrationDiagnostic = (): void => {
  if (!ACTIVE_CALIBRATION_DIAGNOSTIC) return;
  const active = ACTIVE_CALIBRATION_DIAGNOSTIC;
  const categoryCounters = CALIBRATION_WORK_DIAGNOSTICS.byCategory[active.category];
  categoryCounters.calibrationCalls += 1;
  categoryCounters.expectationEvaluations += active.local.expectationEvaluations;
  categoryCounters.lowerInitialEvaluations += active.local.lowerInitialEvaluations;
  categoryCounters.lowerExpansionEvaluations += active.local.lowerExpansionEvaluations;
  categoryCounters.upperInitialEvaluations += active.local.upperInitialEvaluations;
  categoryCounters.upperExpansionEvaluations += active.local.upperExpansionEvaluations;
  categoryCounters.bisectionEvaluations += active.local.bisectionEvaluations;
  categoryCounters.shockVisits += active.local.shockVisits;
  categoryCounters.acceptedShocks += active.local.acceptedShocks;
  categoryCounters.rejectedShocks += active.local.rejectedShocks;
  categoryCounters.mathLogCalls += active.local.mathLogCalls;
  categoryCounters.convergedByTargetTolerance += active.local.convergedByTargetTolerance;
  categoryCounters.convergedByBracketTolerance += active.local.convergedByBracketTolerance;
  categoryCounters.failedCalibrations += active.local.failedCalibrations;

  CALIBRATION_WORK_DIAGNOSTICS.calibrationCalls += 1;
  CALIBRATION_WORK_DIAGNOSTICS.expectationEvaluations += active.local.expectationEvaluations;
  CALIBRATION_WORK_DIAGNOSTICS.lowerInitialEvaluations += active.local.lowerInitialEvaluations;
  CALIBRATION_WORK_DIAGNOSTICS.lowerExpansionEvaluations += active.local.lowerExpansionEvaluations;
  CALIBRATION_WORK_DIAGNOSTICS.upperInitialEvaluations += active.local.upperInitialEvaluations;
  CALIBRATION_WORK_DIAGNOSTICS.upperExpansionEvaluations += active.local.upperExpansionEvaluations;
  CALIBRATION_WORK_DIAGNOSTICS.bisectionEvaluations += active.local.bisectionEvaluations;
  CALIBRATION_WORK_DIAGNOSTICS.shockVisits += active.local.shockVisits;
  CALIBRATION_WORK_DIAGNOSTICS.acceptedShocks += active.local.acceptedShocks;
  CALIBRATION_WORK_DIAGNOSTICS.rejectedShocks += active.local.rejectedShocks;
  CALIBRATION_WORK_DIAGNOSTICS.mathLogCalls += active.local.mathLogCalls;
  CALIBRATION_WORK_DIAGNOSTICS.convergedByTargetTolerance += active.local.convergedByTargetTolerance;
  CALIBRATION_WORK_DIAGNOSTICS.convergedByBracketTolerance += active.local.convergedByBracketTolerance;
  CALIBRATION_WORK_DIAGNOSTICS.failedCalibrations += active.local.failedCalibrations;
  CALIBRATION_WORK_DIAGNOSTICS.sumExpectationEvaluationsPerCalibration += active.local.expectationEvaluations;
  CALIBRATION_WORK_DIAGNOSTICS.minExpectationEvaluationsPerCalibration = Math.min(
    CALIBRATION_WORK_DIAGNOSTICS.minExpectationEvaluationsPerCalibration,
    active.local.expectationEvaluations
  );
  CALIBRATION_WORK_DIAGNOSTICS.maxExpectationEvaluationsPerCalibration = Math.max(
    CALIBRATION_WORK_DIAGNOSTICS.maxExpectationEvaluationsPerCalibration,
    active.local.expectationEvaluations
  );

  ACTIVE_CALIBRATION_DIAGNOSTIC = null;
};

export const clearCalibrationWorkDiagnostics = (): void => {
  Object.assign(CALIBRATION_WORK_DIAGNOSTICS, EMPTY_CATEGORY_DIAGNOSTICS());
  CALIBRATION_WORK_DIAGNOSTICS.byCategory = {
    GENERAL: EMPTY_CATEGORY_DIAGNOSTICS(),
    SCENARIO: EMPTY_CATEGORY_DIAGNOSTICS(),
    MU_CURVE_INTERIOR: EMPTY_CATEGORY_DIAGNOSTICS()
  };
  CALIBRATION_WORK_DIAGNOSTICS.minExpectationEvaluationsPerCalibration = Number.POSITIVE_INFINITY;
  CALIBRATION_WORK_DIAGNOSTICS.maxExpectationEvaluationsPerCalibration = 0;
  CALIBRATION_WORK_DIAGNOSTICS.sumExpectationEvaluationsPerCalibration = 0;
  ACTIVE_CALIBRATION_DIAGNOSTIC = null;
};

export const isCalibrationWorkDiagnosticsEnabled = (): boolean => CALIBRATION_DIAGNOSTICS_ENABLED;

export const getCalibrationWorkDiagnostics = (): CalibrationWorkDiagnostics => ({
  ...CALIBRATION_WORK_DIAGNOSTICS,
  byCategory: {
    GENERAL: { ...CALIBRATION_WORK_DIAGNOSTICS.byCategory.GENERAL },
    SCENARIO: { ...CALIBRATION_WORK_DIAGNOSTICS.byCategory.SCENARIO },
    MU_CURVE_INTERIOR: { ...CALIBRATION_WORK_DIAGNOSTICS.byCategory.MU_CURVE_INTERIOR }
  }
});

const mergeCalibrationCategoryCounters = (
  left: CalibrationCategoryCounters,
  right: CalibrationCategoryCounters
): CalibrationCategoryCounters => ({
  calibrationCalls: left.calibrationCalls + right.calibrationCalls,
  expectationEvaluations: left.expectationEvaluations + right.expectationEvaluations,
  lowerInitialEvaluations: left.lowerInitialEvaluations + right.lowerInitialEvaluations,
  lowerExpansionEvaluations: left.lowerExpansionEvaluations + right.lowerExpansionEvaluations,
  upperInitialEvaluations: left.upperInitialEvaluations + right.upperInitialEvaluations,
  upperExpansionEvaluations: left.upperExpansionEvaluations + right.upperExpansionEvaluations,
  bisectionEvaluations: left.bisectionEvaluations + right.bisectionEvaluations,
  shockVisits: left.shockVisits + right.shockVisits,
  acceptedShocks: left.acceptedShocks + right.acceptedShocks,
  rejectedShocks: left.rejectedShocks + right.rejectedShocks,
  mathLogCalls: left.mathLogCalls + right.mathLogCalls,
  convergedByTargetTolerance: left.convergedByTargetTolerance + right.convergedByTargetTolerance,
  convergedByBracketTolerance: left.convergedByBracketTolerance + right.convergedByBracketTolerance,
  failedCalibrations: left.failedCalibrations + right.failedCalibrations
});

const mergeCalibrationWorkDiagnostics = (
  left: CalibrationWorkDiagnostics,
  right: CalibrationWorkDiagnostics
): CalibrationWorkDiagnostics => {
  const merged: CalibrationWorkDiagnostics = createEmptyCalibrationWorkDiagnostics();
  const categoryKeys: CalibrationCategory[] = ['GENERAL', 'SCENARIO', 'MU_CURVE_INTERIOR'];

  for (const category of categoryKeys) {
    merged.byCategory[category] = mergeCalibrationCategoryCounters(left.byCategory[category], right.byCategory[category]);
  }

  merged.calibrationCalls = left.calibrationCalls + right.calibrationCalls;
  merged.expectationEvaluations = left.expectationEvaluations + right.expectationEvaluations;
  merged.lowerInitialEvaluations = left.lowerInitialEvaluations + right.lowerInitialEvaluations;
  merged.lowerExpansionEvaluations = left.lowerExpansionEvaluations + right.lowerExpansionEvaluations;
  merged.upperInitialEvaluations = left.upperInitialEvaluations + right.upperInitialEvaluations;
  merged.upperExpansionEvaluations = left.upperExpansionEvaluations + right.upperExpansionEvaluations;
  merged.bisectionEvaluations = left.bisectionEvaluations + right.bisectionEvaluations;
  merged.shockVisits = left.shockVisits + right.shockVisits;
  merged.acceptedShocks = left.acceptedShocks + right.acceptedShocks;
  merged.rejectedShocks = left.rejectedShocks + right.rejectedShocks;
  merged.mathLogCalls = left.mathLogCalls + right.mathLogCalls;
  merged.convergedByTargetTolerance = left.convergedByTargetTolerance + right.convergedByTargetTolerance;
  merged.convergedByBracketTolerance = left.convergedByBracketTolerance + right.convergedByBracketTolerance;
  merged.failedCalibrations = left.failedCalibrations + right.failedCalibrations;
  merged.minExpectationEvaluationsPerCalibration = Math.min(
    left.minExpectationEvaluationsPerCalibration,
    right.minExpectationEvaluationsPerCalibration
  );
  merged.maxExpectationEvaluationsPerCalibration = Math.max(
    left.maxExpectationEvaluationsPerCalibration,
    right.maxExpectationEvaluationsPerCalibration
  );
  merged.sumExpectationEvaluationsPerCalibration = left.sumExpectationEvaluationsPerCalibration + right.sumExpectationEvaluationsPerCalibration;

  return merged;
};

const fail = (code: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new MonteCarloPrecomputationError(code, message, details);
};

const requireGeneralParameters = (
  value: PreparedEtfScenarioParameters | undefined,
  context: Record<string, unknown>
): PreparedEtfScenarioParameters => {
  if (value !== undefined) {
    return value;
  }
  return fail('MISSING_GENERAL_ETF_STATISTICS', 'general expectedReturn is required and must be finite for every ETF', context);
};

const cloneMatrix = (matrix: number[][]): number[][] => matrix.map((row) => [...row]);

const createMatrix = (size: number, value = 0): number[][] => Array.from({ length: size }, () => Array<number>(size).fill(value));

const assertFiniteNumber = (value: number, field: string, details: Record<string, unknown>): void => {
  if (!Number.isFinite(value)) {
    fail('INVALID_NUMERIC_VALUE', `${field} must be finite`, details);
  }
};

const buildDeterministicStudentTShockGrid = (sampleSize: number): number[] => {
  const shocks: number[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const probability = (index + 0.5) / (sampleSize + 1);
    shocks.push(studentTQuantile(probability) * STUDENT_T_STANDARDIZATION);
  }
  return shocks;
};

const buildScaledShockGrid = (sigmaMonthly: number, shockGrid: number[]): number[] => shockGrid.map((shock) => sigmaMonthly * shock);

const conditionalLogGrowthExpectation = (
  muMonthly: number,
  sigmaMonthly: number,
  shockGrid: number[] = buildDeterministicStudentTShockGrid(8193),
  scaledShock: number[] | undefined = undefined
): number => {
  const effectiveScaledShock = scaledShock ?? buildScaledShockGrid(sigmaMonthly, shockGrid);
  const baseGrossReturn = 1 + muMonthly;
  let accepted = 0;
  let total = 0;
  for (let index = 0; index < shockGrid.length; index += 1) {
    const grossReturn = baseGrossReturn + effectiveScaledShock[index];
    if (grossReturn <= 0) continue;
    total += Math.log(grossReturn);
    accepted += 1;
  }
  if (accepted === 0) {
    fail('UNACHIEVABLE_TARGET_LOG_GROWTH', 'no admissible Student-t shock produced a positive gross return under the floor rule', { muMonthly, sigmaMonthly });
  }
  if (ACTIVE_CALIBRATION_DIAGNOSTIC) {
    const local = ACTIVE_CALIBRATION_DIAGNOSTIC.local;
    local.shockVisits += shockGrid.length;
    local.acceptedShocks += accepted;
    local.rejectedShocks += shockGrid.length - accepted;
    local.mathLogCalls += accepted;
  }
  return total / accepted;
};

export const calibrateTargetLogAndSigma = (
  targetLogGrowthMonthly: number,
  sigmaMonthly: number,
  shockGrid: number[] = buildDeterministicStudentTShockGrid(8193),
  category: CalibrationCategory | null = null
): number => {
  if (!Number.isFinite(targetLogGrowthMonthly) || !Number.isFinite(sigmaMonthly)) {
    throw new Error('CALIBRATION_INVALID_INPUT');
  }

  const shouldOwnDiagnostic = CALIBRATION_DIAGNOSTICS_ENABLED && category !== null;
  if (shouldOwnDiagnostic) {
    beginCalibrationDiagnostic(category);
  }

  try {
    const scaledShock = buildScaledShockGrid(sigmaMonthly, shockGrid);
    const trackExpectation = (phase: 'lowerInitial' | 'lowerExpansion' | 'upperInitial' | 'upperExpansion' | 'bisection') => {
      if (!ACTIVE_CALIBRATION_DIAGNOSTIC) return;
      const local = ACTIVE_CALIBRATION_DIAGNOSTIC.local;
      local.expectationEvaluations += 1;
      switch (phase) {
        case 'lowerInitial': local.lowerInitialEvaluations += 1; break;
        case 'lowerExpansion': local.lowerExpansionEvaluations += 1; break;
        case 'upperInitial': local.upperInitialEvaluations += 1; break;
        case 'upperExpansion': local.upperExpansionEvaluations += 1; break;
        case 'bisection': local.bisectionEvaluations += 1; break;
        default: break;
      }
    };

    let lower = -0.9999;
    let lowerValue = conditionalLogGrowthExpectation(lower, sigmaMonthly, shockGrid, scaledShock);
    trackExpectation('lowerInitial');
    while (Number.isFinite(lowerValue) && lowerValue > targetLogGrowthMonthly) {
      lower -= 0.5;
      lowerValue = conditionalLogGrowthExpectation(lower, sigmaMonthly, shockGrid, scaledShock);
      trackExpectation('lowerExpansion');
      if (!Number.isFinite(lowerValue)) {
        throw new Error('CALIBRATION_LOW_BRACKET_FAILED');
      }
    }

    let upper = 0.25;
    let upperValue = conditionalLogGrowthExpectation(upper, sigmaMonthly, shockGrid, scaledShock);
    trackExpectation('upperInitial');
    while (upperValue < targetLogGrowthMonthly) {
      upper *= 2;
      upperValue = conditionalLogGrowthExpectation(upper, sigmaMonthly, shockGrid, scaledShock);
      trackExpectation('upperExpansion');
      if (!Number.isFinite(upperValue) || upper > 10) {
        throw new Error('CALIBRATION_HIGH_BRACKET_FAILED');
      }
    }

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const midpoint = (lower + upper) / 2;
      const midpointValue = conditionalLogGrowthExpectation(midpoint, sigmaMonthly, shockGrid, scaledShock);
      trackExpectation('bisection');
      if (Math.abs(midpointValue - targetLogGrowthMonthly) <= 1e-10) {
        if (ACTIVE_CALIBRATION_DIAGNOSTIC) {
          ACTIVE_CALIBRATION_DIAGNOSTIC.local.convergedByTargetTolerance += 1;
        }
        return midpoint;
      }
      if (midpointValue < targetLogGrowthMonthly) {
        lower = midpoint;
      } else {
        upper = midpoint;
      }
      if (Math.abs(upper - lower) <= 1e-10) {
        if (ACTIVE_CALIBRATION_DIAGNOSTIC) {
          ACTIVE_CALIBRATION_DIAGNOSTIC.local.convergedByBracketTolerance += 1;
        }
        return (lower + upper) / 2;
      }
    }

    if (ACTIVE_CALIBRATION_DIAGNOSTIC) {
      ACTIVE_CALIBRATION_DIAGNOSTIC.local.failedCalibrations += 1;
    }
    throw new Error('CALIBRATION_DID_NOT_CONVERGE');
  } finally {
    if (shouldOwnDiagnostic) {
      endCalibrationDiagnostic();
    }
  }
};

export const calibrateMonthlyLocation = (targetAnnualCagr: number, annualVolatility: number, category: CalibrationCategory | null = null): number => {
  if (!Number.isFinite(targetAnnualCagr) || !Number.isFinite(annualVolatility) || targetAnnualCagr <= -1 || annualVolatility < 0) {
    throw new Error('CALIBRATION_INVALID_TARGET_OR_VOLATILITY');
  }
  const targetLogGrowthMonthly = Math.log(1 + targetAnnualCagr) / 12;
  const sigmaMonthly = annualVolatility / Math.sqrt(12);
  return calibrateTargetLogAndSigma(targetLogGrowthMonthly, sigmaMonthly, buildDeterministicStudentTShockGrid(8193), category);
};

const multiplyMatrices = (left: number[][], right: number[][]): number[][] => {
  const rows = left.length;
  const columns = right[0]?.length ?? 0;
  const shared = right.length;
  const result = createMatrix(rows, 0);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      for (let index = 0; index < shared; index += 1) {
        result[row][column] += left[row][index] * right[index][column];
      }
    }
  }
  return result;
};

const transpose = (matrix: number[][]): number[][] => matrix[0].map((_, column) => matrix.map((row) => row[column]));

const subtractMatrices = (left: number[][], right: number[][]): number[][] => left.map((row, rowIndex) => row.map((value, columnIndex) => value - right[rowIndex][columnIndex]));

const frobeniusNorm = (matrix: number[][]): number => Math.sqrt(matrix.reduce((total, row) => total + row.reduce((rowTotal, value) => rowTotal + value * value, 0), 0));

const maximumAbsoluteDifference = (left: number[][], right: number[][]): number => {
  let maximum = 0;
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < left.length; column += 1) {
      maximum = Math.max(maximum, Math.abs(left[row][column] - right[row][column]));
    }
  }
  return maximum;
};

const assertCorrelationMatrixStructure = (matrix: number[][], scenario: MonteCarloScenario): void => {
  if (matrix.length === 0) {
    fail('EMPTY_CORRELATION_MATRIX', 'correlation matrix must not be empty', { scenario });
  }
  for (let row = 0; row < matrix.length; row += 1) {
    if (matrix[row].length !== matrix.length) {
      fail('INVALID_CORRELATION_MATRIX_DIMENSION', 'correlation matrix must be square', { scenario, row });
    }
    for (let column = 0; column < matrix.length; column += 1) {
      const value = matrix[row][column];
      assertFiniteNumber(value, 'correlation', { scenario, row, column });
      if (value < -1 - CORRELATION_EPSILON || value > 1 + CORRELATION_EPSILON) {
        fail('INVALID_ETF_CORRELATION_VALUE', 'correlation must be in [-1, 1]', { scenario, row, column, value });
      }
      if (Math.abs(value - matrix[column][row]) > CORRELATION_EPSILON) {
        fail('ASYMMETRIC_CORRELATION_MATRIX', 'correlation matrix must be symmetric', { scenario, row, column });
      }
    }
    if (Math.abs(matrix[row][row] - 1) > CORRELATION_EPSILON) {
      fail('INVALID_CORRELATION_DIAGONAL', 'correlation matrix diagonal must equal 1', { scenario, row, value: matrix[row][row] });
    }
  }
};

/** Jacobi eigendecomposition for finite symmetric matrices. */
const symmetricEigenDecomposition = (matrix: number[][], scenario: MonteCarloScenario): EigenDecomposition => {
  const size = matrix.length;
  const working = cloneMatrix(matrix);
  const eigenvectors = createMatrix(size, 0);
  for (let index = 0; index < size; index += 1) eigenvectors[index][index] = 1;

  const maximumIterations = Math.max(1, size * size * NEAREST_CORRELATION_MAX_ITERATIONS);
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    let pivotRow = 0;
    let pivotColumn = 1;
    let maximumOffDiagonal = 0;
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const magnitude = Math.abs(working[row][column]);
        if (magnitude > maximumOffDiagonal) {
          maximumOffDiagonal = magnitude;
          pivotRow = row;
          pivotColumn = column;
        }
      }
    }
    if (maximumOffDiagonal <= NEAREST_CORRELATION_TOLERANCE || size === 1) {
      const eigenvalues = working.map((row, index) => row[index]);
      eigenvalues.forEach((value, index) => assertFiniteNumber(value, 'eigenvalue', { scenario, index }));
      return { eigenvalues, eigenvectors };
    }

    const app = working[pivotRow][pivotRow];
    const aqq = working[pivotColumn][pivotColumn];
    const apq = working[pivotRow][pivotColumn];
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) continue;
      const aip = working[index][pivotRow];
      const aiq = working[index][pivotColumn];
      working[index][pivotRow] = cosine * aip - sine * aiq;
      working[pivotRow][index] = working[index][pivotRow];
      working[index][pivotColumn] = sine * aip + cosine * aiq;
      working[pivotColumn][index] = working[index][pivotColumn];
    }
    working[pivotRow][pivotRow] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    working[pivotColumn][pivotColumn] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    working[pivotRow][pivotColumn] = 0;
    working[pivotColumn][pivotRow] = 0;

    for (let index = 0; index < size; index += 1) {
      const vip = eigenvectors[index][pivotRow];
      const viq = eigenvectors[index][pivotColumn];
      eigenvectors[index][pivotRow] = cosine * vip - sine * viq;
      eigenvectors[index][pivotColumn] = sine * vip + cosine * viq;
    }
  }
  return fail('EIGENDECOMPOSITION_FAILED', 'symmetric eigendecomposition did not converge', { scenario });
};

const reconstructSymmetricMatrix = (eigenvectors: number[][], eigenvalues: number[]): number[][] => {
  const size = eigenvalues.length;
  const result = createMatrix(size, 0);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let value = 0;
      for (let index = 0; index < size; index += 1) {
        value += eigenvectors[row][index] * eigenvalues[index] * eigenvectors[column][index];
      }
      result[row][column] = value;
    }
  }
  return result;
};

const projectToPsd = (matrix: number[][], scenario: MonteCarloScenario): number[][] => {
  const { eigenvalues, eigenvectors } = symmetricEigenDecomposition(matrix, scenario);
  return reconstructSymmetricMatrix(eigenvectors, eigenvalues.map((value) => Math.max(0, value)));
};

const projectToUnitDiagonal = (matrix: number[][]): number[][] => matrix.map((row, rowIndex) => row.map((value, columnIndex) => rowIndex === columnIndex ? 1 : value));

const nearestCorrelationMatrix = (matrix: number[][], scenario: MonteCarloScenario): { matrix: number[][]; iterations: number } => {
  let current = cloneMatrix(matrix);
  let dykstraCorrection = createMatrix(matrix.length, 0);
  for (let iteration = 1; iteration <= NEAREST_CORRELATION_MAX_ITERATIONS; iteration += 1) {
    const previous = current;
    const residual = subtractMatrices(previous, dykstraCorrection);
    const projectedPsd = projectToPsd(residual, scenario);
    dykstraCorrection = subtractMatrices(projectedPsd, residual);
    current = projectToUnitDiagonal(projectedPsd);
    if (maximumAbsoluteDifference(current, previous) <= NEAREST_CORRELATION_TOLERANCE) {
      return { matrix: current, iterations: iteration };
    }
  }
  return fail('CORRELATION_MATRIX_CORRECTION_FAILED', 'nearest correlation matrix algorithm did not converge', { scenario });
};

const getMinimumEigenvalue = (matrix: number[][], scenario: MonteCarloScenario): number => Math.min(...symmetricEigenDecomposition(matrix, scenario).eigenvalues);

const getConditionNumber = (matrix: number[][], scenario: MonteCarloScenario): number | null => {
  const eigenvalues = symmetricEigenDecomposition(matrix, scenario).eigenvalues.map(Math.abs);
  const positive = eigenvalues.filter((value) => value > CORRELATION_EPSILON);
  return positive.length === eigenvalues.length ? Math.max(...positive) / Math.min(...positive) : null;
};

const calculateMaxCellDelta = (original: number[][], corrected: number[][]): number => {
  let maximum = 0;
  for (let row = 0; row < original.length; row += 1) {
    for (let column = row + 1; column < original.length; column += 1) {
      maximum = Math.max(maximum, Math.abs(corrected[row][column] - original[row][column]));
    }
  }
  return maximum;
};

const buildFactor = (matrix: number[][], scenario: MonteCarloScenario): {
  factor: number[][];
  eigenvalues: number[];
  operationalMatrix: number[][];
  reconstructionError: number;
  rebuiltOperationalMatrix: boolean;
} => {
  const { eigenvalues, eigenvectors } = symmetricEigenDecomposition(matrix, scenario);
  const hasNegativeEigenvalue = eigenvalues.some((eigenvalue) => eigenvalue < 0);
  const roots = eigenvalues.map((eigenvalue, index) => {
    if (eigenvalue < -PSD_EPSILON) {
      fail('CORRELATION_MATRIX_NOT_PSD', 'operational correlation matrix is not PSD', { scenario, eigenvalue, index, epsilon: PSD_EPSILON });
    }
    return Math.sqrt(Math.max(0, eigenvalue));
  });
  const factor = eigenvectors.map((row) => row.map((value, index) => value * roots[index]));
  if (hasNegativeEigenvalue) {
    for (let row = 0; row < factor.length; row += 1) {
      const rowVariance = factor[row].reduce((total, value) => total + value * value, 0);
      if (!Number.isFinite(rowVariance) || rowVariance <= 0) {
        fail('CORRELATION_FACTOR_RECONSTRUCTION_FAILED', 'factor cannot be normalized to a correlation matrix', { scenario, row, rowVariance });
      }
      const scale = Math.sqrt(rowVariance);
      factor[row] = factor[row].map((value) => value / scale);
    }
  }
  for (const row of factor) {
    for (const value of row) assertFiniteNumber(value, 'correlation factor', { scenario });
  }
  const factorProduct = multiplyMatrices(factor, transpose(factor));
  const operationalMatrix = hasNegativeEigenvalue ? factorProduct : matrix;
  const reconstructionError = maximumAbsoluteDifference(factorProduct, operationalMatrix);
  if (reconstructionError > CORRELATION_EPSILON) {
    fail('CORRELATION_FACTOR_RECONSTRUCTION_FAILED', 'correlation factor reconstruction error exceeds epsilon', {
      scenario,
      reconstructionError,
      epsilon: CORRELATION_EPSILON
    });
  }
  return { factor, eigenvalues, operationalMatrix, reconstructionError, rebuiltOperationalMatrix: hasNegativeEigenvalue };
};

export const precomputeEtfScenarioParameters = (
  statistics: MonteCarloEtfStatistics,
  calibrationCategory: CalibrationCategory | null = null
): PreparedEtfScenarioParameters => {
  const { expectedReturn, volatility, returnRange } = statistics;
  assertFiniteNumber(expectedReturn, 'expectedReturn', {});
  assertFiniteNumber(volatility, 'volatility', {});
  assertFiniteNumber(returnRange.min, 'returnRange.min', {});
  assertFiniteNumber(returnRange.max, 'returnRange.max', {});
  if (expectedReturn <= -1 || volatility < 0 || returnRange.min < -1 || returnRange.min > expectedReturn || expectedReturn > returnRange.max) {
    fail('INVALID_ETF_SCENARIO_PARAMETERS', 'ETF annual parameters violate the precomputation contract');
  }

  const targetLogGrowthMonthly = Math.log(1 + expectedReturn) / 12;
  const calibratedMonthlyLocation = calibrateMonthlyLocation(expectedReturn, volatility, calibrationCategory);
  const monthlyExpectedReturn = calibratedMonthlyLocation;
  const monthlyVolatility = volatility / Math.sqrt(12);
  if (volatility === 0) {
    if (returnRange.min !== expectedReturn || returnRange.max !== expectedReturn) {
      fail('INVALID_ZERO_VOLATILITY_RANGE', 'zero volatility requires a deterministic return range');
    }
    return {
      monthlyExpectedReturn,
      calibratedMonthlyLocation,
      targetLogGrowthMonthly,
      generalMonthlyExpectedReturn: undefined,
      generalMonthlyVolatility: undefined,
      muCalibrationByIntensity: [{ intensity: 0, targetLogGrowthMonthly, sigmaMonthly: monthlyVolatility, muMonthly: monthlyExpectedReturn, impliedAnnualCagr: expectedReturn }],
      monthlyVolatility,
      zMin: null,
      zMax: null,
      monthlyRangeMin: monthlyExpectedReturn,
      monthlyRangeMax: monthlyExpectedReturn
    };
  }

  const zMin = (returnRange.min - expectedReturn) / volatility;
  const zMax = (returnRange.max - expectedReturn) / volatility;
  return {
    monthlyExpectedReturn,
    calibratedMonthlyLocation,
    targetLogGrowthMonthly,
    generalMonthlyExpectedReturn: undefined,
    generalMonthlyVolatility: undefined,
    muCalibrationByIntensity: [{ intensity: 0, targetLogGrowthMonthly, sigmaMonthly: monthlyVolatility, muMonthly: monthlyExpectedReturn, impliedAnnualCagr: expectedReturn }],
    monthlyVolatility,
    zMin,
    zMax,
    monthlyRangeMin: monthlyExpectedReturn + zMin * monthlyVolatility,
    monthlyRangeMax: monthlyExpectedReturn + zMax * monthlyVolatility
  };
};

export const prepareCorrelationMatrix = (snapshot: MonteCarloSnapshot, scenario: MonteCarloScenario): CorrelationMatrixPreparation => {
  const assetIsins = snapshot.etfs.map((etf) => etf.isin);
  const indexByIsin = new Map(assetIsins.map((isin, index) => [isin, index]));
  const originalMatrix = createMatrix(assetIsins.length, 0);
  for (let index = 0; index < assetIsins.length; index += 1) originalMatrix[index][index] = 1;

  for (const correlation of snapshot.correlations) {
    const left = indexByIsin.get(correlation.isin1);
    const right = indexByIsin.get(correlation.isin2);
    if (left === undefined || right === undefined) {
      fail('INVALID_ETF_CORRELATION', 'correlation cannot be mapped to snapshot ETFs', { scenario, correlation });
    }
    if (left === right) {
      fail('INVALID_ETF_CORRELATION', 'correlation cannot be mapped to distinct snapshot ETFs', { scenario, correlation });
    }
    const leftIndex = left as number;
    const rightIndex = right as number;
    const value = correlation[scenario];
    assertFiniteNumber(value, 'correlation', { scenario, isin1: correlation.isin1, isin2: correlation.isin2 });
    if (value < -1 || value > 1) {
      fail('INVALID_ETF_CORRELATION_VALUE', 'correlation must be in [-1, 1]', { scenario, isin1: correlation.isin1, isin2: correlation.isin2, value });
    }
    originalMatrix[leftIndex][rightIndex] = value;
    originalMatrix[rightIndex][leftIndex] = value;
  }

  assertCorrelationMatrixStructure(originalMatrix, scenario);
  const minimumEigenvalueBefore = getMinimumEigenvalue(originalMatrix, scenario);
  const conditionNumberBefore = getConditionNumber(originalMatrix, scenario);
  let candidateMatrix = originalMatrix;
  let correctionApplied = false;
  let operationalMatrix = originalMatrix;
  let correctionIterations = 0;
  let maxCellDelta = 0;
  let frobeniusDelta = 0;

  if (minimumEigenvalueBefore < -PSD_EPSILON) {
    const correction = nearestCorrelationMatrix(originalMatrix, scenario);
    candidateMatrix = correction.matrix;
    correctionIterations = correction.iterations;
    correctionApplied = true;
  }

  assertCorrelationMatrixStructure(candidateMatrix, scenario);
  const factorResult = buildFactor(candidateMatrix, scenario);
  operationalMatrix = factorResult.operationalMatrix;
  correctionApplied ||= factorResult.rebuiltOperationalMatrix;
  if (correctionApplied) {
    assertCorrelationMatrixStructure(operationalMatrix, scenario);
    maxCellDelta = calculateMaxCellDelta(originalMatrix, operationalMatrix);
    frobeniusDelta = frobeniusNorm(subtractMatrices(operationalMatrix, originalMatrix));
    if (maxCellDelta > MAX_CORRELATION_CELL_DELTA) {
      fail('CORRELATION_MATRIX_CORRECTION_TOO_LARGE', 'nearest correlation matrix correction exceeds maximum cell delta', {
        scenario,
        maxCellDelta,
        maximum: MAX_CORRELATION_CELL_DELTA
      });
    }
  }

  const minimumEigenvalueAfter = getMinimumEigenvalue(operationalMatrix, scenario);
  if (minimumEigenvalueAfter < -PSD_EPSILON) {
    fail('CORRELATION_MATRIX_NOT_PSD', 'operational correlation matrix is not PSD', { scenario, minimumEigenvalueAfter, epsilon: PSD_EPSILON });
  }
  return {
    scenario,
    assetIsins,
    originalMatrix,
    correctedMatrix: correctionApplied ? operationalMatrix : null,
    operationalMatrix,
    correctionApplied,
    minimumEigenvalueBefore,
    minimumEigenvalueAfter,
    eigenvalues: factorResult.eigenvalues,
    maxCellDelta,
    frobeniusDelta,
    conditionNumberBefore,
    conditionNumberAfter: getConditionNumber(operationalMatrix, scenario),
    correctionIterations,
    factor: factorResult.factor,
    factorReconstructionError: factorResult.reconstructionError
  };
};

const PRECOMPUTATION_CACHE = new Map<string, { value: MonteCarloPrecomputation; computedAt: number; elapsedMs: number }>();
const PRECOMPUTATION_WORKERS = new Map<string, Worker[]>();
const PRECOMPUTATION_INFLIGHT = new Map<string, { promise: Promise<MonteCarloPrecomputation>; activeOwnerId: string | null; abortController: AbortController; owners: Set<string> }>();
const PRECOMPUTATION_CACHE_STATS = {
  hits: 0,
  misses: 0,
  lastCacheHit: false,
  lastPrecomputationMs: 0
};
const LAST_PRECOMPUTATION_DIAGNOSTICS: MonteCarloPrecomputationDiagnostics = {
  totalMs: 0,
  fingerprintMs: 0,
  cacheLookupMs: 0,
  cacheResult: 'MISS',
  shockGridMs: 0,
  generalParamsMs: 0,
  scenarioParamsMs: 0,
  muCurvesMs: 0,
  correlationsMs: 0,
  assemblyMs: 0
};

export const getLastMonteCarloPrecomputationDiagnostics = (): MonteCarloPrecomputationDiagnostics => ({
  ...LAST_PRECOMPUTATION_DIAGNOSTICS
});

const normalizeScenarioStatistics = (statistics: MonteCarloEtfStatistics | undefined) => statistics ? {
  expectedReturn: statistics.expectedReturn,
  volatility: statistics.volatility,
  returnRange: {
    min: statistics.returnRange.min,
    max: statistics.returnRange.max
  }
} : null;

const buildPrecomputationFingerprint = (snapshot: MonteCarloSnapshot): string => {
  const etfs = snapshot.etfs.map((etf) => ({
    isin: etf.isin,
    statistics: {
      general: normalizeScenarioStatistics(etf.statistics.general),
      expansion: normalizeScenarioStatistics(etf.statistics.expansion),
      recession: normalizeScenarioStatistics(etf.statistics.recession),
      stagflation: normalizeScenarioStatistics(etf.statistics.stagflation),
      soft_landing: normalizeScenarioStatistics(etf.statistics.soft_landing)
    }
  }));
  const correlations = [...snapshot.correlations]
    .map((entry) => ({
      isin1: entry.isin1,
      isin2: entry.isin2,
      expansion: entry.expansion,
      recession: entry.recession,
      stagflation: entry.stagflation,
      soft_landing: entry.soft_landing
    }))
    .sort((left, right) => `${left.isin1}:${left.isin2}`.localeCompare(`${right.isin1}:${right.isin2}`));

  return JSON.stringify({ etfs, correlations });
};

export const buildMuCalibrationCurve = (
  generalParameters: PreparedEtfScenarioParameters,
  scenarioParameters: PreparedEtfScenarioParameters,
  step: number,
  shockGrid: number[]
): MuCalibrationNode[] => {
  const generalTargetLogGrowthMonthly = generalParameters.targetLogGrowthMonthly;
  const scenarioTargetLogGrowthMonthly = scenarioParameters.targetLogGrowthMonthly;
  const curve: MuCalibrationNode[] = [];
  for (let intensity = 0; intensity <= 1 + 1e-12; intensity += step) {
    const clampedIntensity = Math.min(1, Math.max(0, intensity));
    const targetLogGrowthMonthly = generalTargetLogGrowthMonthly + clampedIntensity * (scenarioTargetLogGrowthMonthly - generalTargetLogGrowthMonthly);
    const sigmaMonthly = generalParameters.monthlyVolatility + clampedIntensity * (scenarioParameters.monthlyVolatility - generalParameters.monthlyVolatility);
    const muMonthly = clampedIntensity === 0
      ? generalParameters.calibratedMonthlyLocation
      : clampedIntensity === 1
        ? scenarioParameters.calibratedMonthlyLocation
        : calibrateTargetLogAndSigma(targetLogGrowthMonthly, sigmaMonthly, shockGrid, 'MU_CURVE_INTERIOR');
    const impliedAnnualCagr = Math.exp(12 * targetLogGrowthMonthly) - 1;
    if (curve.length > 0 && Math.abs(curve[curve.length - 1].intensity - clampedIntensity) <= 1e-12) {
      curve[curve.length - 1] = { intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr };
      continue;
    }
    curve.push({ intensity: clampedIntensity, targetLogGrowthMonthly, sigmaMonthly, muMonthly, impliedAnnualCagr });
  }
  return curve;
};

export const clearMonteCarloPrecomputationCache = (): void => {
  for (const workers of PRECOMPUTATION_WORKERS.values()) {
    for (const worker of workers) {
      try {
        worker.terminate();
      } catch {
        // ignore shutdown errors during teardown
      }
    }
  }
  PRECOMPUTATION_WORKERS.clear();
  PRECOMPUTATION_CACHE.clear();
  PRECOMPUTATION_INFLIGHT.clear();
  PRECOMPUTATION_CACHE_STATS.hits = 0;
  PRECOMPUTATION_CACHE_STATS.misses = 0;
  PRECOMPUTATION_CACHE_STATS.lastCacheHit = false;
  PRECOMPUTATION_CACHE_STATS.lastPrecomputationMs = 0;
};

export const getMonteCarloPrecomputationCacheStats = (): MonteCarloPrecomputationCacheStats => ({
  hits: PRECOMPUTATION_CACHE_STATS.hits,
  misses: PRECOMPUTATION_CACHE_STATS.misses,
  entries: PRECOMPUTATION_CACHE.size,
  precomputationCacheHit: PRECOMPUTATION_CACHE_STATS.lastCacheHit,
  precomputationMs: PRECOMPUTATION_CACHE_STATS.lastPrecomputationMs
});

export const getMonteCarloPrecomputationRuntimeState = (fingerprint?: string) => ({
  cacheEntries: PRECOMPUTATION_CACHE.size,
  inFlightEntries: Array.from(PRECOMPUTATION_INFLIGHT.keys()),
  inFlightOwners: Object.fromEntries(Array.from(PRECOMPUTATION_INFLIGHT.entries()).map(([key, session]) => [key, { activeOwnerId: session.activeOwnerId, owners: Array.from(session.owners) }])),
  activeWorkers: Array.from(PRECOMPUTATION_WORKERS.values()).reduce((total, workers) => total + workers.length, 0),
  cacheHasFingerprint: fingerprint ? PRECOMPUTATION_CACHE.has(fingerprint) : false,
  inFlightHasFingerprint: fingerprint ? PRECOMPUTATION_INFLIGHT.has(fingerprint) : false
});

export const resolvePrecomputeWorkerCount = (taskCount: number): number => {
  const normalizedTaskCount = Number.isFinite(taskCount) ? Math.max(1, Math.floor(taskCount)) : 1;
  return Math.min(4, Math.max(1, normalizedTaskCount));
};

export interface PrepareMonteCarloPrecomputationAsyncOptions {
  ownerId?: string;
  signal?: AbortSignal;
  workerFactoryOverride?: (scriptPath: string) => Worker;
  workerCountOverride?: number;
  dispatchOrder?: 'canonical' | 'reverse';
  telemetry?: {
    generalTaskCount?: number;
    scenarioTaskCount?: number;
    workerStartedCount?: number;
    workerCompletedCount?: number;
  };
  lifecycle?: {
    onPhaseStart?: (phase: 'general' | 'scenario', details: {
      fingerprint: string;
      ownerId: string;
      workerCount: number;
      taskCount: number;
      etfCount: number;
      scenarioCount: number;
    }) => void | Promise<void>;
    onSessionStart?: (details: {
      fingerprint: string;
      ownerId: string;
      workerCount: number;
    }) => void | Promise<void>;
    onSessionResolve?: (details: { fingerprint: string; ownerId: string; result: MonteCarloPrecomputation }) => void | Promise<void>;
    onSessionReject?: (details: { fingerprint: string; ownerId: string; error: unknown }) => void | Promise<void>;
    onAbort?: (details: { fingerprint: string; ownerId: string; reason?: string }) => void | Promise<void>;
    onCachePublish?: (details: { fingerprint: string; ownerId: string; cacheEntries: number }) => void | Promise<void>;
    onInFlightCleanup?: (details: { fingerprint: string; ownerId: string }) => void | Promise<void>;
    onWorkerTermination?: (details: { fingerprint: string; ownerId: string; workerCount: number }) => void | Promise<void>;
  };
}

const PRODUCTION_PRECOMPUTE_TEST_HOOKS: {
  workerFactoryOverride?: (scriptPath: string) => Worker;
  workerCountOverride?: number;
  dispatchOrder?: 'canonical' | 'reverse';
  telemetry?: {
    generalTaskCount?: number;
    scenarioTaskCount?: number;
    workerStartedCount?: number;
    workerCompletedCount?: number;
  };
  lifecycle?: PrepareMonteCarloPrecomputationAsyncOptions['lifecycle'];
} = {};

export const configureProductionPrecomputeTestHooks = (hooks: Partial<PrepareMonteCarloPrecomputationAsyncOptions>): void => {
  Object.assign(PRODUCTION_PRECOMPUTE_TEST_HOOKS, hooks);
};

export const resetProductionPrecomputeTestHooks = (): void => {
  Object.keys(PRODUCTION_PRECOMPUTE_TEST_HOOKS).forEach((key) => {
    delete (PRODUCTION_PRECOMPUTE_TEST_HOOKS as Record<string, unknown>)[key];
  });
};

export const normalizeWorkerEventApi = <T extends Worker & { onmessage?: ((event: MessageEvent) => void) | null; onerror?: ((event: ErrorEvent) => void) | null }>(worker: T): T => {
  if (typeof worker.addEventListener === 'function' && typeof worker.removeEventListener === 'function') {
    return worker;
  }

  const listeners = new Map<'message' | 'error', Set<(event: MessageEvent | ErrorEvent) => void>>([
    ['message', new Set()],
    ['error', new Set()]
  ]);

  const dispatch = (type: 'message' | 'error', event: MessageEvent | ErrorEvent): void => {
    const currentListeners = [...(listeners.get(type) ?? [])];
    for (const listener of currentListeners) {
      listener(event);
    }
    const handler = type === 'message' ? worker.onmessage : worker.onerror;
    if (typeof handler === 'function') {
      handler.call(worker, event as never);
    }
  };

  const originalOnMessage = worker.onmessage;
  const originalOnError = worker.onerror;

  worker.onmessage = (event: MessageEvent) => {
    dispatch('message', event);
    if (typeof originalOnMessage === 'function') {
      originalOnMessage.call(worker, event);
    }
  };

  worker.onerror = (event: ErrorEvent) => {
    dispatch('error', event);
    if (typeof originalOnError === 'function') {
      originalOnError.call(worker, event);
    }
  };

  worker.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
    if (typeof listener !== 'function') return;
    const eventType = type as 'message' | 'error';
    const eventListeners = listeners.get(eventType);
    if (eventListeners) {
      eventListeners.add(listener as (event: MessageEvent | ErrorEvent) => void);
    }
  }) as typeof worker.addEventListener;

  worker.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
    if (typeof listener !== 'function') return;
    const eventType = type as 'message' | 'error';
    const eventListeners = listeners.get(eventType);
    if (eventListeners) {
      eventListeners.delete(listener as (event: MessageEvent | ErrorEvent) => void);
    }
  }) as typeof worker.removeEventListener;

  return worker;
};

export const prepareMonteCarloPrecomputationAsync = async (
  snapshot: MonteCarloSnapshot,
  workerCountOverride?: number,
  options: PrepareMonteCarloPrecomputationAsyncOptions = {}
): Promise<MonteCarloPrecomputation> => {
  const fingerprint = buildPrecomputationFingerprint(snapshot);
  const ownerId = options.ownerId ?? `precompute-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const testHooks = {
    ...PRODUCTION_PRECOMPUTE_TEST_HOOKS,
    ...options
  };
  const workerFactoryOverride = testHooks.workerFactoryOverride ?? options.workerFactoryOverride;
  const effectiveWorkerCountOverride = testHooks.workerCountOverride ?? workerCountOverride ?? options.workerCountOverride;
  const dispatchOrder = testHooks.dispatchOrder ?? options.dispatchOrder ?? 'canonical';
  const lifecycle = testHooks.lifecycle ?? options.lifecycle;
  const telemetry = testHooks.telemetry ?? options.telemetry ?? {
    generalTaskCount: 0,
    scenarioTaskCount: 0,
    workerStartedCount: 0,
    workerCompletedCount: 0
  };

  const cached = PRECOMPUTATION_CACHE.get(fingerprint);
  if (cached) {
    PRECOMPUTATION_CACHE_STATS.hits += 1;
    PRECOMPUTATION_CACHE_STATS.lastCacheHit = true;
    PRECOMPUTATION_CACHE_STATS.lastPrecomputationMs = cached.elapsedMs;
    return cached.value;
  }

  const existingSession = PRECOMPUTATION_INFLIGHT.get(fingerprint);
  if (existingSession) {
    existingSession.owners.add(ownerId);
    if (!existingSession.activeOwnerId || !existingSession.owners.has(existingSession.activeOwnerId)) {
      existingSession.activeOwnerId = ownerId;
    }
    if (options.signal) {
      const detachOwner = () => {
        const currentSession = PRECOMPUTATION_INFLIGHT.get(fingerprint);
        if (!currentSession) return;
        currentSession.owners.delete(ownerId);
        if (currentSession.activeOwnerId === ownerId) {
          if (currentSession.owners.size === 0) {
            currentSession.abortController.abort();
            PRECOMPUTATION_INFLIGHT.delete(fingerprint);
            return;
          }
          currentSession.activeOwnerId = [...currentSession.owners][0] ?? null;
        }
      };
      if (options.signal.aborted) {
        detachOwner();
        throw new DOMException('Precompute aborted', 'AbortError');
      }
      options.signal.addEventListener('abort', detachOwner, { once: true });
    }
    return existingSession.promise;
  }

  const abortController = new AbortController();
  const session = {
    promise: null as unknown as Promise<MonteCarloPrecomputation>,
    activeOwnerId: ownerId,
    abortController,
    owners: new Set<string>([ownerId])
  };

  const runPrecompute = async (): Promise<MonteCarloPrecomputation> => {
    PRECOMPUTATION_CACHE_STATS.misses += 1;
    PRECOMPUTATION_CACHE_STATS.lastCacheHit = false;
    await lifecycle?.onSessionStart?.({ fingerprint, ownerId, workerCount: effectiveWorkerCountOverride ?? 1 });

    if (abortController.signal.aborted) {
      throw new DOMException('Precompute aborted', 'AbortError');
    }

    const orderedEtfs = dispatchOrder === 'reverse' ? [...snapshot.etfs].reverse() : snapshot.etfs;
    const taskCount = orderedEtfs.length * (1 + MONTE_CARLO_SCENARIOS.length);
    const workerCount = resolvePrecomputeWorkerCount(effectiveWorkerCountOverride ?? taskCount);
    telemetry.generalTaskCount = orderedEtfs.length;
    telemetry.scenarioTaskCount = orderedEtfs.length * MONTE_CARLO_SCENARIOS.length;
    telemetry.workerStartedCount = workerCount;
    telemetry.workerCompletedCount = 0;
    const workerSupported = Boolean(workerFactoryOverride) || (typeof Worker !== 'undefined' && typeof URL !== 'undefined');
    if (!workerSupported || workerCount <= 1 || snapshot.etfs.length === 0) {
      const result = prepareMonteCarloPrecomputation(snapshot);
      const activeSession = PRECOMPUTATION_INFLIGHT.get(fingerprint);
      if (activeSession?.activeOwnerId !== ownerId) {
        return result;
      }
      PRECOMPUTATION_CACHE.set(fingerprint, { value: result, computedAt: Date.now(), elapsedMs: 0 });
      return result;
    }

    const shockGrid = buildDeterministicStudentTShockGrid(8193);
    const workers = Array.from({ length: workerCount }, () => {
      const workerFactory = workerFactoryOverride ?? ((scriptPath: string) => {
        void scriptPath;
        return new Worker(new URL('./monte-carlo-precomputation.worker', import.meta.url), { type: 'module' } as WorkerOptions);
      });
      return normalizeWorkerEventApi(workerFactory('./monte-carlo-precomputation.worker.ts'));
    });
    PRECOMPUTATION_WORKERS.set(fingerprint, workers);
    abortController.signal.addEventListener('abort', () => {
      void lifecycle?.onAbort?.({ fingerprint, ownerId, reason: 'ABORT_SIGNAL' });
      for (const worker of workers) {
        try {
          worker.terminate();
        } catch {
          // ignore shutdown errors during teardown
        }
      }
      PRECOMPUTATION_WORKERS.delete(fingerprint);
    }, { once: true });

    const waitForWorkerReady = async (worker: Worker): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const onMessage = (event: MessageEvent) => {
          const message = event.data as { type?: string } | undefined;
          if (!message || message.type !== 'READY') return;
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          resolve();
        };
        const onError = (error: Event) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);

          const originalMessage = typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
          const originalFilename = typeof error === 'object' && error && 'filename' in error ? String((error as { filename?: unknown }).filename ?? '') : '';
          const originalLineno = typeof error === 'object' && error && 'lineno' in error ? String((error as { lineno?: unknown }).lineno ?? '') : '';
          const originalColno = typeof error === 'object' && error && 'colno' in error ? String((error as { colno?: unknown }).colno ?? '') : '';
          const originalError = typeof error === 'object' && error && 'error' in error ? (error as { error?: unknown }).error : undefined;
          const originalStack = originalError && typeof originalError === 'object' && 'stack' in originalError ? String((originalError as { stack?: unknown }).stack ?? '') : '';
          const details = [
            originalMessage || (originalError && typeof originalError === 'object' && 'message' in originalError ? String((originalError as { message?: unknown }).message ?? '') : ''),
            originalFilename ? `filename=${originalFilename}` : '',
            originalLineno ? `lineno=${originalLineno}` : '',
            originalColno ? `colno=${originalColno}` : '',
            originalStack ? `stack=${originalStack}` : ''
          ].filter(Boolean).join(' | ');

          reject(new Error(details ? `Precompute worker ready handshake failed: ${details}` : 'Precompute worker ready handshake failed'));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({ type: 'PING' });
      });
    };

    type WorkerTask = {
      requestId: string;
      type: 'GENERAL_TASK' | 'SCENARIO_TASK';
      etfIndex: number;
      scenario?: MonteCarloScenario;
      etf: MonteCarloSnapshot['etfs'][number];
      shockGrid: number[];
      generalParameters?: PreparedEtfScenarioParameters;
      diagnosticsEnabled?: boolean;
    };

    const localDiagnosticsAccumulator = isCalibrationWorkDiagnosticsEnabled() ? createEmptyCalibrationWorkDiagnostics() : null;

    const runPhase = async (tasks: WorkerTask[]): Promise<Map<string, { taskId: string; generalParameters?: PreparedEtfScenarioParameters; scenarioParameters?: PreparedEtfScenarioParameters; scenario?: MonteCarloScenario }>> => {
      if (tasks.length === 0) {
        return new Map();
      }

      if (abortController.signal.aborted) {
        throw new DOMException('Precompute aborted', 'AbortError');
      }

      const expectedTaskIds = new Set(tasks.map((task) => task.requestId));
      const receivedTaskIds = new Set<string>();
      const outcomes = new Map<string, { taskId: string; generalParameters?: PreparedEtfScenarioParameters; scenarioParameters?: PreparedEtfScenarioParameters; scenario?: MonteCarloScenario }>();
      const queue = [...tasks];
      let activeWorkers = 0;

      const scheduleNext = (worker: Worker): void => {
        if (queue.length === 0) return;
        if (abortController.signal.aborted) {
          rejectPhase(new DOMException('Precompute aborted', 'AbortError'));
          return;
        }
        const task = queue.shift()!;
        activeWorkers += 1;

        const finalize = (event: MessageEvent): void => {
          const message = event.data as { requestId?: string; type?: string; result?: any; error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined;
          if (!message || typeof message.requestId !== 'string') return;
          const duplicateBefore = receivedTaskIds.has(message.requestId);
          if (!expectedTaskIds.has(message.requestId)) {
            rejectPhase(new Error(`Received unknown precompute task result for ${message.requestId}`));
            return;
          }
          if (duplicateBefore) {
            rejectPhase(new Error(`Duplicate precompute task result for ${message.requestId}`));
            return;
          }
          if (message.type === 'TASK_ERROR') {
            rejectPhase(new Error(message.error?.message ?? `Precompute worker task ${message.requestId} failed`));
            return;
          }
          if (message.type !== 'TASK_RESULT') {
            rejectPhase(new Error(`Unexpected precompute worker message type: ${String(message.type)}`));
            return;
          }
          const result = message.result as { taskId: string; generalParameters?: PreparedEtfScenarioParameters; scenarioParameters?: PreparedEtfScenarioParameters; scenario?: MonteCarloScenario; diagnostics?: CalibrationWorkDiagnostics };
          if (!result.taskId || result.taskId !== message.requestId) {
            rejectPhase(new Error(`Precompute worker returned mismatched task id for ${message.requestId}`));
            return;
          }
          receivedTaskIds.add(message.requestId);
          outcomes.set(result.taskId, result);
          if (localDiagnosticsAccumulator && result.diagnostics) {
            localDiagnosticsAccumulator.byCategory.GENERAL = mergeCalibrationCategoryCounters(
              localDiagnosticsAccumulator.byCategory.GENERAL,
              result.diagnostics.byCategory.GENERAL
            );
            localDiagnosticsAccumulator.byCategory.SCENARIO = mergeCalibrationCategoryCounters(
              localDiagnosticsAccumulator.byCategory.SCENARIO,
              result.diagnostics.byCategory.SCENARIO
            );
            localDiagnosticsAccumulator.byCategory.MU_CURVE_INTERIOR = mergeCalibrationCategoryCounters(
              localDiagnosticsAccumulator.byCategory.MU_CURVE_INTERIOR,
              result.diagnostics.byCategory.MU_CURVE_INTERIOR
            );
            localDiagnosticsAccumulator.calibrationCalls += result.diagnostics.calibrationCalls;
            localDiagnosticsAccumulator.expectationEvaluations += result.diagnostics.expectationEvaluations;
            localDiagnosticsAccumulator.lowerInitialEvaluations += result.diagnostics.lowerInitialEvaluations;
            localDiagnosticsAccumulator.lowerExpansionEvaluations += result.diagnostics.lowerExpansionEvaluations;
            localDiagnosticsAccumulator.upperInitialEvaluations += result.diagnostics.upperInitialEvaluations;
            localDiagnosticsAccumulator.upperExpansionEvaluations += result.diagnostics.upperExpansionEvaluations;
            localDiagnosticsAccumulator.bisectionEvaluations += result.diagnostics.bisectionEvaluations;
            localDiagnosticsAccumulator.shockVisits += result.diagnostics.shockVisits;
            localDiagnosticsAccumulator.acceptedShocks += result.diagnostics.acceptedShocks;
            localDiagnosticsAccumulator.rejectedShocks += result.diagnostics.rejectedShocks;
            localDiagnosticsAccumulator.mathLogCalls += result.diagnostics.mathLogCalls;
            localDiagnosticsAccumulator.convergedByTargetTolerance += result.diagnostics.convergedByTargetTolerance;
            localDiagnosticsAccumulator.convergedByBracketTolerance += result.diagnostics.convergedByBracketTolerance;
            localDiagnosticsAccumulator.failedCalibrations += result.diagnostics.failedCalibrations;
            localDiagnosticsAccumulator.sumExpectationEvaluationsPerCalibration += result.diagnostics.sumExpectationEvaluationsPerCalibration;
            localDiagnosticsAccumulator.minExpectationEvaluationsPerCalibration = Math.min(
              localDiagnosticsAccumulator.minExpectationEvaluationsPerCalibration,
              result.diagnostics.minExpectationEvaluationsPerCalibration
            );
            localDiagnosticsAccumulator.maxExpectationEvaluationsPerCalibration = Math.max(
              localDiagnosticsAccumulator.maxExpectationEvaluationsPerCalibration,
              result.diagnostics.maxExpectationEvaluationsPerCalibration
            );
          }
          telemetry.workerCompletedCount = receivedTaskIds.size;
          activeWorkers -= 1;
          worker.removeEventListener('message', finalize);
          worker.removeEventListener('error', rejectCurrentWorker);
          if (queue.length > 0 && !abortController.signal.aborted) {
            scheduleNext(worker);
          }
          if (receivedTaskIds.size === expectedTaskIds.size && activeWorkers === 0) {
            resolvePhase();
          }
        };

        const rejectCurrentWorker = (error: Event): void => {
          worker.removeEventListener('message', finalize);
          worker.removeEventListener('error', rejectCurrentWorker);
          activeWorkers -= 1;
          rejectPhase(error instanceof ErrorEvent ? new Error(error.message) : new Error('Precompute worker failed'));
        };

        worker.addEventListener('message', finalize);
        worker.addEventListener('error', rejectCurrentWorker);
        worker.postMessage(task);
      };

      let resolvePhase: () => void = () => undefined;
      let rejectPhase: (reason: Error | DOMException) => void = () => undefined;

      const phasePromise = new Promise<void>((resolve, reject) => {
        resolvePhase = resolve;
        rejectPhase = reject;
        for (let index = 0; index < workers.length && queue.length > 0; index += 1) {
          scheduleNext(workers[index]);
        }
      });

      await phasePromise;
      if (abortController.signal.aborted) {
        throw new DOMException('Precompute aborted', 'AbortError');
      }
      return outcomes;
    };

    try {
      for (const worker of workers) {
        await waitForWorkerReady(worker);
      }

      const generalTasks = orderedEtfs.map((etf, etfIndex) => ({
        requestId: `GENERAL-${etfIndex}`,
        type: 'GENERAL_TASK' as const,
        etfIndex,
        etf,
        shockGrid,
        diagnosticsEnabled: isCalibrationWorkDiagnosticsEnabled()
      }));
      await lifecycle?.onPhaseStart?.('general', {
        fingerprint,
        ownerId,
        workerCount,
        taskCount: generalTasks.length,
        etfCount: orderedEtfs.length,
        scenarioCount: MONTE_CARLO_SCENARIOS.length
      });
      const generalResults = await runPhase(generalTasks);

      const scenarioTasks = orderedEtfs.flatMap((etf, etfIndex) => MONTE_CARLO_SCENARIOS.map((scenario) => {
        const generalParameters = requireGeneralParameters(
          generalResults.get(`GENERAL-${etfIndex}`)?.generalParameters,
          { isin: etf.isin, scenario }
        );
        return {
          requestId: `SCENARIO-${etfIndex}-${scenario}`,
          type: 'SCENARIO_TASK' as const,
          etfIndex,
          scenario,
          etf,
          shockGrid,
          generalParameters,
          diagnosticsEnabled: isCalibrationWorkDiagnosticsEnabled()
        } satisfies WorkerTask;
      }));
      await lifecycle?.onPhaseStart?.('scenario', {
        fingerprint,
        ownerId,
        workerCount,
        taskCount: scenarioTasks.length,
        etfCount: orderedEtfs.length,
        scenarioCount: MONTE_CARLO_SCENARIOS.length
      });
      const scenarioResults = await runPhase(scenarioTasks);

      const etfParameters = Object.fromEntries(snapshot.etfs.map((etf, etfIndex) => {
        const generalParameters = requireGeneralParameters(
          generalResults.get(`GENERAL-${etfIndex}`)?.generalParameters,
          { isin: etf.isin }
        );
        const scenarioParameters = Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => {
          const scenarioResult = scenarioResults.get(`SCENARIO-${etfIndex}-${scenario}`)?.scenarioParameters;
          if (!scenarioResult) {
            fail('MISSING_SCENARIO_ETF_STATISTICS', 'scenario expectedReturn is required for all macro scenarios', { isin: etf.isin, scenario });
          }
          return [scenario, {
            ...scenarioResult,
            generalMonthlyExpectedReturn: generalParameters.monthlyExpectedReturn,
            generalMonthlyVolatility: generalParameters.monthlyVolatility
          }];
        })) as Record<MonteCarloScenario, PreparedEtfScenarioParameters>;
        return [etf.isin, scenarioParameters];
      })) as unknown as MonteCarloPrecomputation['etfParameters'];

      const correlationMatrices = Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [
        scenario,
        prepareCorrelationMatrix(snapshot, scenario)
      ])) as MonteCarloPrecomputation['correlationMatrices'];

      const result: MonteCarloPrecomputation = { etfParameters, correlationMatrices };
      const activeSession = PRECOMPUTATION_INFLIGHT.get(fingerprint);
      if (activeSession?.activeOwnerId !== ownerId) {
        return result;
      }
      if (localDiagnosticsAccumulator) {
        const publishedDiagnostics = localDiagnosticsAccumulator;
        Object.assign(CALIBRATION_WORK_DIAGNOSTICS, publishedDiagnostics);
        CALIBRATION_WORK_DIAGNOSTICS.byCategory = {
          GENERAL: { ...publishedDiagnostics.byCategory.GENERAL },
          SCENARIO: { ...publishedDiagnostics.byCategory.SCENARIO },
          MU_CURVE_INTERIOR: { ...publishedDiagnostics.byCategory.MU_CURVE_INTERIOR }
        };
      }
      const elapsedMs = performance.now() - (PRECOMPUTATION_CACHE_STATS.lastPrecomputationMs || performance.now());
      PRECOMPUTATION_CACHE.set(fingerprint, { value: result, computedAt: Date.now(), elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0 });
      await lifecycle?.onCachePublish?.({ fingerprint, ownerId, cacheEntries: PRECOMPUTATION_CACHE.size });
      PRECOMPUTATION_CACHE_STATS.lastPrecomputationMs = elapsedMs;
      return result;
    } finally {
      PRECOMPUTATION_WORKERS.delete(fingerprint);
      for (const worker of workers) {
        try {
          worker.terminate();
          void lifecycle?.onWorkerTermination?.({ fingerprint, ownerId, workerCount: workers.length });
        } catch {
          // ignore termination during shutdown
        }
      }
    }
  };

  session.promise = runPrecompute();
  PRECOMPUTATION_INFLIGHT.set(fingerprint, session);

  if (options.signal) {
    const detachOwner = () => {
      const currentSession = PRECOMPUTATION_INFLIGHT.get(fingerprint);
      if (!currentSession) return;
      currentSession.owners.delete(ownerId);
      if (currentSession.activeOwnerId === ownerId) {
        if (currentSession.owners.size === 0) {
          currentSession.abortController.abort();
          PRECOMPUTATION_INFLIGHT.delete(fingerprint);
          return;
        }
        currentSession.activeOwnerId = [...currentSession.owners][0] ?? null;
      }
    };
    if (options.signal.aborted) {
      detachOwner();
      throw new DOMException('Precompute aborted', 'AbortError');
    }
    options.signal.addEventListener('abort', detachOwner, { once: true });
  }

  try {
    try {
      const value = await session.promise;
      await lifecycle?.onSessionResolve?.({ fingerprint, ownerId, result: value });
      return value;
    } catch (error) {
      await lifecycle?.onSessionReject?.({ fingerprint, ownerId, error });
      throw error;
    }
  } finally {
    const currentSession = PRECOMPUTATION_INFLIGHT.get(fingerprint);
    if (currentSession) {
      currentSession.owners.delete(ownerId);
      if (currentSession.activeOwnerId === ownerId) {
        if (currentSession.owners.size === 0) {
          currentSession.abortController.abort();
          PRECOMPUTATION_INFLIGHT.delete(fingerprint);
          await lifecycle?.onInFlightCleanup?.({ fingerprint, ownerId });
        } else {
          currentSession.activeOwnerId = [...currentSession.owners][0] ?? null;
          await lifecycle?.onInFlightCleanup?.({ fingerprint, ownerId });
        }
      }
    }
  }
};

export const prepareMonteCarloPrecomputation = (snapshot: MonteCarloSnapshot): MonteCarloPrecomputation => {
  const fingerprintStart = performance.now();
  const fingerprint = buildPrecomputationFingerprint(snapshot);
  const fingerprintMs = performance.now() - fingerprintStart;

  const cacheLookupStart = performance.now();
  const cached = PRECOMPUTATION_CACHE.get(fingerprint);
  const cacheLookupMs = performance.now() - cacheLookupStart;

  const diagnostics: MonteCarloPrecomputationDiagnostics = {
    totalMs: fingerprintMs + cacheLookupMs,
    fingerprintMs,
    cacheLookupMs,
    cacheResult: 'MISS'
  };

  if (cached) {
    PRECOMPUTATION_CACHE_STATS.hits += 1;
    PRECOMPUTATION_CACHE_STATS.lastCacheHit = true;
    PRECOMPUTATION_CACHE_STATS.lastPrecomputationMs = cached.elapsedMs;
    Object.assign(LAST_PRECOMPUTATION_DIAGNOSTICS, {
      totalMs: fingerprintMs + cacheLookupMs,
      fingerprintMs,
      cacheLookupMs,
      cacheResult: 'HIT',
      shockGridMs: 0,
      generalParamsMs: 0,
      scenarioParamsMs: 0,
      muCurvesMs: 0,
      correlationsMs: 0,
      assemblyMs: 0
    });
    return cached.value;
  }

  PRECOMPUTATION_CACHE_STATS.misses += 1;
  PRECOMPUTATION_CACHE_STATS.lastCacheHit = false;

  const startedAt = performance.now();
  const shockGridStart = performance.now();
  const shockGrid = buildDeterministicStudentTShockGrid(8193);
  const shockGridMs = performance.now() - shockGridStart;

  let generalParamsMs = 0;
  let scenarioParamsMs = 0;
  let muCurvesMs = 0;
  const etfParameters = Object.fromEntries(snapshot.etfs.map((etf) => {
    const generalStatistics = etf.statistics.general;
    if (!generalStatistics) {
      fail('MISSING_GENERAL_ETF_STATISTICS', 'general.expectedReturn is required and must be finite for every ETF', { isin: etf.isin });
    }
    const generalParamsStart = performance.now();
    const generalParameters = precomputeEtfScenarioParameters(generalStatistics, 'GENERAL');
    generalParamsMs += performance.now() - generalParamsStart;

    const scenarioParameters = Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => {
      const scenarioStatistics = etf.statistics[scenario];
      if (!scenarioStatistics) {
        fail('MISSING_SCENARIO_ETF_STATISTICS', 'scenario expectedReturn is required for all macro scenarios', { isin: etf.isin, scenario });
      }
      const scenarioParamsStart = performance.now();
      const scenarioBaseParameters = precomputeEtfScenarioParameters(scenarioStatistics, 'SCENARIO');
      scenarioParamsMs += performance.now() - scenarioParamsStart;

      const muCurvesStart = performance.now();
      const calibrationCurve = buildMuCalibrationCurve(generalParameters, scenarioBaseParameters, 0.01, shockGrid);
      muCurvesMs += performance.now() - muCurvesStart;

      return [
        scenario,
        {
          ...scenarioBaseParameters,
          generalMonthlyExpectedReturn: generalParameters.monthlyExpectedReturn,
          generalMonthlyVolatility: generalParameters.monthlyVolatility,
          muCalibrationByIntensity: calibrationCurve
        }
      ];
    })) as Record<MonteCarloScenario, PreparedEtfScenarioParameters>;
    return [etf.isin, scenarioParameters];
  })) as unknown as MonteCarloPrecomputation['etfParameters'];

  const correlationStart = performance.now();
  const correlationMatrices = Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [
    scenario,
    prepareCorrelationMatrix(snapshot, scenario)
  ])) as MonteCarloPrecomputation['correlationMatrices'];
  const correlationMs = performance.now() - correlationStart;

  const result: MonteCarloPrecomputation = { etfParameters, correlationMatrices };
  const assemblyStart = performance.now();
  const elapsedMs = performance.now() - startedAt;
  PRECOMPUTATION_CACHE.set(fingerprint, { value: result, computedAt: Date.now(), elapsedMs });
  PRECOMPUTATION_CACHE_STATS.lastPrecomputationMs = elapsedMs;
  const assemblyMs = performance.now() - assemblyStart;

  const finalDiagnostics: MonteCarloPrecomputationDiagnostics = {
    totalMs: elapsedMs,
    fingerprintMs,
    cacheLookupMs,
    cacheResult: 'MISS',
    shockGridMs,
    generalParamsMs,
    scenarioParamsMs,
    muCurvesMs,
    correlationsMs: correlationMs,
    assemblyMs
  };

  Object.assign(LAST_PRECOMPUTATION_DIAGNOSTICS, finalDiagnostics);
  return result;
};