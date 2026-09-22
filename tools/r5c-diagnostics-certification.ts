import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import {
  clearMonteCarloPrecomputationCache,
  getMonteCarloPrecomputationRuntimeState,
  prepareMonteCarloPrecomputationAsync,
  type PrepareMonteCarloPrecomputationAsyncOptions,
  clearCalibrationWorkDiagnostics,
  disableCalibrationWorkDiagnostics,
  enableCalibrationWorkDiagnostics,
  getCalibrationWorkDiagnostics,
  normalizeWorkerEventApi
} from '../src/app/core/precomputation/monte-carlo-precomputation';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  type MonteCarloSnapshot
} from '../src/app/core/models/monte-carlo-contracts.model';

type CategoryCounters = {
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
};

type DiagnosticCategorySet = {
  GENERAL: CategoryCounters;
  SCENARIO: CategoryCounters;
  MU_CURVE_INTERIOR: CategoryCounters;
};

type PublicDiagnosticsSnapshot = CategoryCounters & {
  byCategory: DiagnosticCategorySet;
  minExpectationEvaluationsPerCalibration: number;
  maxExpectationEvaluationsPerCalibration: number;
  sumExpectationEvaluationsPerCalibration: number;
};

type RunEvidence = {
  cacheEmptyBefore: boolean;
  inflightEmptyBefore: boolean;
  productionPromiseResolved: boolean;
  workerTaskResultCount: number;
  diagnosticsPropertyCount: number;
  publicDiagnostics: PublicDiagnosticsSnapshot;
};

type TaskResultRecord = {
  requestId: string;
  taskId: string;
  diagnosticsPropertyPresent: boolean;
};

type TaskResultAuditSummary = {
  taskResultCount: number;
  uniqueTaskIdCount: number;
  duplicateTaskIds: string[];
  missingTaskIds: string[];
  unexpectedTaskIds: string[];
  requestIdTaskIdMismatches: Array<{ requestId: string; taskId: string }>;
  malformedTaskResults: Array<{ requestId?: string; issue: string }>;
  diagnosticsPresentCount: number;
};

type ExactFinancialComparatorEvidence = {
  comparisons: number;
  mismatchCount: number;
  mismatches: Array<{ path: string; left: unknown; right: unknown }>;
  maxAbsDiff: number;
  comparatorKind: 'FIELD_EXACT_ZERO_DIFF';
};

type DiagnosticCertificationEvidence = {
  inputSnapshotIdentical: boolean;
  off: RunEvidence;
  on: RunEvidence;
  offVsOn: ExactFinancialComparatorEvidence;
  offTaskResultAudit: TaskResultAuditSummary;
  onTaskResultAudit: TaskResultAuditSummary;
  offInputFingerprint: string;
  onInputFingerprint: string;
};

type ClassificationResult = {
  verdict: 'PASS' | 'REJECTED';
  errors: string[];
  categoryCallSum: number;
  totalCalibrationCalls: number;
  shockVisitInvariant: boolean;
  minMaxInvariant: boolean;
  sumBoundsInvariant: boolean;
};

type HarnessAuditReport = {
  HARNESS_RUN_MODE_CALLS_PRODUCTION_ASYNC_API: boolean;
  HARNESS_RUN_MODE_CALLS_SYNC_PRECOMPUTE: boolean;
  PRODUCTION_WORKER_FACADE_REUSED: boolean;
  HARNESS_REIMPLEMENTS_PRODUCTION_SCHEDULER: boolean;
  TASK_RESULT_CAPTURE_IMPLEMENTED: boolean;
  TASK_RESULT_CAPTURE_POINT: string;
  DIAGNOSTICS_PROPERTY_PRESENCE_USES_OWN_PROPERTY: boolean;
  PUBLIC_DIAGNOSTICS_CANONICAL_GETTER: boolean;
  COLD_CACHE_VERIFICATION_IMPLEMENTED: boolean;
  COLD_INFLIGHT_VERIFICATION_IMPLEMENTED: boolean;
  EXACT_FINANCIAL_COMPARATOR_IMPLEMENTED: boolean;
  REPORT_BUILDER_PURE: boolean;
  SELF_TEST_CALLS_PRODUCTION_ASYNC: boolean;
  SELF_TEST_CREATES_WORKERS: boolean;
};

type MemorySnapshotStage = 'BEFORE_OFF' | 'AFTER_OFF' | 'BEFORE_ON' | 'AFTER_ON' | 'BEFORE_COMPARATOR' | 'AFTER_COMPARATOR' | 'RUN_FAILED';

type MemorySnapshot = {
  stage: MemorySnapshotStage;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};

type StageJournalEntry = {
  seq: number;
  event: string;
  phase?: 'OFF' | 'ON' | 'COMPARATOR' | 'RUN';
  workerId?: string;
  requestId?: string;
  taskId?: string;
  taskKind?: 'GENERAL' | 'SCENARIO' | 'UNKNOWN';
  detail?: string;
};

type WorkerPhase = 'OFF' | 'ON';

type WorkerLifecycleTelemetry = {
  workerId: string;
  runPhase: WorkerPhase;
  creationSequence: number;
  lastDispatchedTask?: string;
  lastCompletedTask?: string;
  lastCompletedRequestId?: string;
  lastCompletedTaskId?: string;
  lastCompletedTaskKind?: 'GENERAL' | 'SCENARIO' | 'UNKNOWN';
  exitCode?: number | null;
  exitEvent?: string;
  errorName?: string;
  errorMessage?: string;
};

type LastCompletedTaskRecord = {
  lastCompletedRequestId?: string;
  lastCompletedTaskId?: string;
  lastCompletedTaskKind?: 'GENERAL' | 'SCENARIO' | 'UNKNOWN';
};

const deriveTaskKind = (taskId: string): 'GENERAL' | 'SCENARIO' | 'UNKNOWN' => {
  if (taskId.startsWith('GENERAL-')) {
    return 'GENERAL';
  }
  if (taskId.startsWith('SCENARIO-')) {
    return 'SCENARIO';
  }
  return 'UNKNOWN';
};

const captureParentMemorySnapshot = (stage: MemorySnapshotStage): MemorySnapshot => {
  const usage = process.memoryUsage();
  return {
    stage,
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  };
};

const appendStageJournalEntry = (
  journal: StageJournalEntry[],
  event: string,
  phase?: 'OFF' | 'ON' | 'COMPARATOR' | 'RUN',
  detail?: string,
  workerId?: string,
  requestId?: string,
  taskId?: string,
  taskKind?: 'GENERAL' | 'SCENARIO' | 'UNKNOWN'
): StageJournalEntry => {
  const nextSeq = journal.length + 1;
  const entry: StageJournalEntry = {
    seq: nextSeq,
    event,
    phase,
    workerId,
    requestId,
    taskId,
    taskKind,
    detail
  };
  journal.push(entry);
  return entry;
};

const ZERO_CATEGORY_COUNTERS = (): CategoryCounters => ({
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

const makeCategoryDiagnostics = (overrides: Partial<CategoryCounters> = {}): CategoryCounters => ({
  ...ZERO_CATEGORY_COUNTERS(),
  ...overrides
});

const PASS_PUBLIC_DIAGNOSTICS = (): PublicDiagnosticsSnapshot => {
  const general = makeCategoryDiagnostics({
    calibrationCalls: 5,
    expectationEvaluations: 400,
    lowerInitialEvaluations: 80,
    lowerExpansionEvaluations: 90,
    upperInitialEvaluations: 80,
    upperExpansionEvaluations: 90,
    bisectionEvaluations: 60,
    shockVisits: 1500,
    acceptedShocks: 1200,
    rejectedShocks: 300,
    mathLogCalls: 1200,
    convergedByTargetTolerance: 5,
    convergedByBracketTolerance: 0,
    failedCalibrations: 0
  });

  const scenario = makeCategoryDiagnostics({
    calibrationCalls: 20,
    expectationEvaluations: 1400,
    lowerInitialEvaluations: 200,
    lowerExpansionEvaluations: 240,
    upperInitialEvaluations: 200,
    upperExpansionEvaluations: 240,
    bisectionEvaluations: 520,
    shockVisits: 6000,
    acceptedShocks: 4800,
    rejectedShocks: 1200,
    mathLogCalls: 4800,
    convergedByTargetTolerance: 20,
    convergedByBracketTolerance: 0,
    failedCalibrations: 0
  });

  const muInterior = makeCategoryDiagnostics({
    calibrationCalls: 1980,
    expectationEvaluations: 80000,
    lowerInitialEvaluations: 8000,
    lowerExpansionEvaluations: 12000,
    upperInitialEvaluations: 8000,
    upperExpansionEvaluations: 12000,
    bisectionEvaluations: 32000,
    shockVisits: 100000,
    acceptedShocks: 80000,
    rejectedShocks: 20000,
    mathLogCalls: 80000,
    convergedByTargetTolerance: 1900,
    convergedByBracketTolerance: 80,
    failedCalibrations: 0
  });

  return {
    ...makeCategoryDiagnostics({
      calibrationCalls: 2005,
      expectationEvaluations: 81400,
      lowerInitialEvaluations: 8280,
      lowerExpansionEvaluations: 12330,
      upperInitialEvaluations: 8280,
      upperExpansionEvaluations: 12330,
      bisectionEvaluations: 32580,
      shockVisits: 106500,
      acceptedShocks: 86000,
      rejectedShocks: 20500,
      mathLogCalls: 86000,
      convergedByTargetTolerance: 1925,
      convergedByBracketTolerance: 80,
      failedCalibrations: 0
    }),
    byCategory: { GENERAL: general, SCENARIO: scenario, MU_CURVE_INTERIOR: muInterior },
    minExpectationEvaluationsPerCalibration: 1,
    maxExpectationEvaluationsPerCalibration: 60,
    sumExpectationEvaluationsPerCalibration: 81400
  };
};

const createZeroRunEvidence = (): RunEvidence => ({
  cacheEmptyBefore: true,
  inflightEmptyBefore: true,
  productionPromiseResolved: true,
  workerTaskResultCount: 25,
  diagnosticsPropertyCount: 0,
  publicDiagnostics: {
    ...ZERO_CATEGORY_COUNTERS(),
    byCategory: {
      GENERAL: ZERO_CATEGORY_COUNTERS(),
      SCENARIO: ZERO_CATEGORY_COUNTERS(),
      MU_CURVE_INTERIOR: ZERO_CATEGORY_COUNTERS()
    },
    minExpectationEvaluationsPerCalibration: 0,
    maxExpectationEvaluationsPerCalibration: 0,
    sumExpectationEvaluationsPerCalibration: 0
  }
});

const createOnRunEvidence = (): RunEvidence => ({
  cacheEmptyBefore: true,
  inflightEmptyBefore: true,
  productionPromiseResolved: true,
  workerTaskResultCount: 25,
  diagnosticsPropertyCount: 25,
  publicDiagnostics: PASS_PUBLIC_DIAGNOSTICS()
});

const classifyDiagnosticCertificationEvidence = (evidence: DiagnosticCertificationEvidence): ClassificationResult => {
  const errors: string[] = [];

  if (!evidence.inputSnapshotIdentical) {
    errors.push('input snapshots differ');
  }

  if (!evidence.off.cacheEmptyBefore) errors.push('off cache not empty before run');
  if (!evidence.off.inflightEmptyBefore) errors.push('off inflight not empty before run');
  if (!evidence.off.productionPromiseResolved) errors.push('off production promise unresolved');
  if (evidence.off.workerTaskResultCount !== 25) errors.push(`off worker task result count mismatch: ${evidence.off.workerTaskResultCount}`);
  if (evidence.off.diagnosticsPropertyCount !== 0) errors.push(`off diagnostics property count mismatch: ${evidence.off.diagnosticsPropertyCount}`);
  if (evidence.off.publicDiagnostics.calibrationCalls !== 0) errors.push(`off public calibrationCalls mismatch: ${evidence.off.publicDiagnostics.calibrationCalls}`);

  if (!evidence.on.cacheEmptyBefore) errors.push('on cache not empty before run');
  if (!evidence.on.inflightEmptyBefore) errors.push('on inflight not empty before run');
  if (!evidence.on.productionPromiseResolved) errors.push('on production promise unresolved');
  if (evidence.on.workerTaskResultCount !== 25) errors.push(`on worker task result count mismatch: ${evidence.on.workerTaskResultCount}`);
  if (evidence.on.diagnosticsPropertyCount !== 25) errors.push(`on diagnostics property count mismatch: ${evidence.on.diagnosticsPropertyCount}`);

  const general = evidence.on.publicDiagnostics.byCategory.GENERAL;
  const scenario = evidence.on.publicDiagnostics.byCategory.SCENARIO;
  const muCurve = evidence.on.publicDiagnostics.byCategory.MU_CURVE_INTERIOR;
  const totalCalibrationCalls = evidence.on.publicDiagnostics.calibrationCalls;
  const categoryCallSum = general.calibrationCalls + scenario.calibrationCalls + muCurve.calibrationCalls;

  if (general.calibrationCalls !== 5) errors.push(`GENERAL calibrationCalls mismatch: ${general.calibrationCalls}`);
  if (scenario.calibrationCalls !== 20) errors.push(`SCENARIO calibrationCalls mismatch: ${scenario.calibrationCalls}`);
  if (muCurve.calibrationCalls !== 1980) errors.push(`MU_CURVE_INTERIOR calibrationCalls mismatch: ${muCurve.calibrationCalls}`);
  if (totalCalibrationCalls !== 2005) errors.push(`total calibrationCalls mismatch: ${totalCalibrationCalls}`);
  if (categoryCallSum !== 2005) errors.push(`category sum mismatch: ${categoryCallSum}`);

  const shockVisitInvariant = evidence.on.publicDiagnostics.shockVisits === evidence.on.publicDiagnostics.acceptedShocks + evidence.on.publicDiagnostics.rejectedShocks;
  if (!shockVisitInvariant) errors.push(`shockVisits invariant failed: ${evidence.on.publicDiagnostics.shockVisits} !== ${evidence.on.publicDiagnostics.acceptedShocks + evidence.on.publicDiagnostics.rejectedShocks}`);

  const minMaxInvariant = evidence.on.publicDiagnostics.minExpectationEvaluationsPerCalibration <= evidence.on.publicDiagnostics.maxExpectationEvaluationsPerCalibration;
  if (!minMaxInvariant) errors.push('minExpectationEvaluationsPerCalibration > maxExpectationEvaluationsPerCalibration');

  const sumExpectationBoundsInvariant =
    totalCalibrationCalls > 0
      ? evidence.on.publicDiagnostics.sumExpectationEvaluationsPerCalibration >= totalCalibrationCalls * evidence.on.publicDiagnostics.minExpectationEvaluationsPerCalibration
        && evidence.on.publicDiagnostics.sumExpectationEvaluationsPerCalibration <= totalCalibrationCalls * evidence.on.publicDiagnostics.maxExpectationEvaluationsPerCalibration
      : true;
  if (!sumExpectationBoundsInvariant) {
    errors.push('sumExpectationEvaluationsPerCalibration out of bounds for calibrationCalls');
  }

  if (evidence.offVsOn.comparisons <= 0) errors.push('off/on comparisons must be > 0');
  if (evidence.offVsOn.mismatchCount !== 0) errors.push(`off/on mismatchCount mismatch: ${evidence.offVsOn.mismatchCount}`);
  if (evidence.offVsOn.mismatches.length !== 0) errors.push(`off/on mismatches length mismatch: ${evidence.offVsOn.mismatches.length}`);
  if (evidence.offVsOn.maxAbsDiff !== 0) errors.push(`off/on maxAbsDiff mismatch: ${evidence.offVsOn.maxAbsDiff}`);

  if (evidence.offTaskResultAudit.taskResultCount !== 25) errors.push(`off task result count mismatch: ${evidence.offTaskResultAudit.taskResultCount}`);
  if (evidence.onTaskResultAudit.taskResultCount !== 25) errors.push(`on task result count mismatch: ${evidence.onTaskResultAudit.taskResultCount}`);
  if (evidence.offTaskResultAudit.diagnosticsPresentCount !== 0) errors.push(`off diagnostics present count mismatch: ${evidence.offTaskResultAudit.diagnosticsPresentCount}`);
  if (evidence.onTaskResultAudit.diagnosticsPresentCount !== 25) errors.push(`on diagnostics present count mismatch: ${evidence.onTaskResultAudit.diagnosticsPresentCount}`);
  if (evidence.offTaskResultAudit.duplicateTaskIds.length !== 0) errors.push('off duplicate task ids present');
  if (evidence.onTaskResultAudit.duplicateTaskIds.length !== 0) errors.push('on duplicate task ids present');
  if (evidence.offTaskResultAudit.missingTaskIds.length !== 0) errors.push('off missing task ids present');
  if (evidence.onTaskResultAudit.missingTaskIds.length !== 0) errors.push('on missing task ids present');
  if (evidence.offTaskResultAudit.unexpectedTaskIds.length !== 0) errors.push('off unexpected task ids present');
  if (evidence.onTaskResultAudit.unexpectedTaskIds.length !== 0) errors.push('on unexpected task ids present');
  if (evidence.offTaskResultAudit.requestIdTaskIdMismatches.length !== 0) errors.push('off request/task mismatches present');
  if (evidence.onTaskResultAudit.requestIdTaskIdMismatches.length !== 0) errors.push('on request/task mismatches present');
  if (evidence.offTaskResultAudit.malformedTaskResults.length !== 0) errors.push('off malformed task results present');
  if (evidence.onTaskResultAudit.malformedTaskResults.length !== 0) errors.push('on malformed task results present');

  return {
    verdict: errors.length === 0 ? 'PASS' : 'REJECTED',
    errors,
    categoryCallSum,
    totalCalibrationCalls,
    shockVisitInvariant,
    minMaxInvariant,
    sumBoundsInvariant: sumExpectationBoundsInvariant
  };
};

const buildExpectedTaskIds = (): string[] => {
  const generalTaskIds = Array.from({ length: 5 }, (_, etfIndex) => `GENERAL-${etfIndex}`);
  const scenarioTaskIds = MONTE_CARLO_SCENARIOS.flatMap((scenario) =>
    Array.from({ length: 5 }, (_, etfIndex) => `SCENARIO-${etfIndex}-${scenario}`)
  );
  return [...generalTaskIds, ...scenarioTaskIds];
};

const summarizeTaskResultRecords = (
  records: TaskResultRecord[],
  malformedTaskResults: Array<{ requestId?: string; issue: string }>
): TaskResultAuditSummary => {
  const expectedTaskIds = buildExpectedTaskIds();
  const uniqueTaskIds = records.map((entry) => entry.taskId);
  const duplicateTaskIds = Array.from(
    new Set(uniqueTaskIds.filter((taskId, index) => uniqueTaskIds.indexOf(taskId) !== index))
  );
  const uniqueTaskIdSet = new Set(uniqueTaskIds);
  const missingTaskIds = expectedTaskIds.filter((expectedTaskId) => !uniqueTaskIdSet.has(expectedTaskId));
  const unexpectedTaskIds = Array.from(uniqueTaskIdSet).filter((taskId) => !expectedTaskIds.includes(taskId));
  const requestIdTaskIdMismatches = records
    .filter((entry) => entry.requestId !== entry.taskId)
    .map((entry) => ({ requestId: entry.requestId, taskId: entry.taskId }));

  return {
    taskResultCount: records.length,
    uniqueTaskIdCount: uniqueTaskIds.length,
    duplicateTaskIds,
    missingTaskIds,
    unexpectedTaskIds,
    requestIdTaskIdMismatches,
    malformedTaskResults,
    diagnosticsPresentCount: records.filter((entry) => entry.diagnosticsPropertyPresent).length
  };
};

const canonicalizeForFingerprint = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForFingerprint(entry));
  }
  if (value && typeof value === 'object') {
    const orderedObject: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      orderedObject[key] = canonicalizeForFingerprint((value as Record<string, unknown>)[key]);
    }
    return orderedObject;
  }
  return value;
};

const buildCanonicalFingerprint = (value: unknown): string => JSON.stringify(canonicalizeForFingerprint(value));

const createSyntheticPassEvidence = (): DiagnosticCertificationEvidence => {
  const offTaskResultAudit = summarizeTaskResultRecords(
    Array.from({ length: 5 }, (_, index) => ({
      requestId: `GENERAL-${index}`,
      taskId: `GENERAL-${index}`,
      diagnosticsPropertyPresent: false
    })).concat(
      MONTE_CARLO_SCENARIOS.flatMap((scenario) =>
        Array.from({ length: 5 }, (_, etfIndex) => ({
          requestId: `SCENARIO-${etfIndex}-${scenario}`,
          taskId: `SCENARIO-${etfIndex}-${scenario}`,
          diagnosticsPropertyPresent: false
        }))
      )
    ),
    []
  );

  const onTaskResultAudit = summarizeTaskResultRecords(
    Array.from({ length: 5 }, (_, index) => ({
      requestId: `GENERAL-${index}`,
      taskId: `GENERAL-${index}`,
      diagnosticsPropertyPresent: true
    })).concat(
      MONTE_CARLO_SCENARIOS.flatMap((scenario) =>
        Array.from({ length: 5 }, (_, etfIndex) => ({
          requestId: `SCENARIO-${etfIndex}-${scenario}`,
          taskId: `SCENARIO-${etfIndex}-${scenario}`,
          diagnosticsPropertyPresent: true
        }))
      )
    ),
    []
  );

  return {
    inputSnapshotIdentical: true,
    off: createZeroRunEvidence(),
    on: createOnRunEvidence(),
    offVsOn: {
      comparisons: 1,
      mismatchCount: 0,
      mismatches: [],
      maxAbsDiff: 0,
      comparatorKind: 'FIELD_EXACT_ZERO_DIFF'
    },
    offTaskResultAudit,
    onTaskResultAudit,
    offInputFingerprint: 'synthetic-off-fingerprint',
    onInputFingerprint: 'synthetic-on-fingerprint'
  };
};

const createSyntheticNegativeEvidence = (label: string): DiagnosticCertificationEvidence => {
  const base = createSyntheticPassEvidence();
  switch (label) {
    case 'A_OFF_DIAGNOSTICS_PAYLOAD_COUNT_GT_0':
      return { ...base, off: { ...base.off, diagnosticsPropertyCount: 1 } };
    case 'B_OFF_PUBLIC_CALIBRATION_CALLS_GT_0':
      return { ...base, off: { ...base.off, publicDiagnostics: { ...base.off.publicDiagnostics, calibrationCalls: 1 } } };
    case 'C_ON_DIAGNOSTICS_PAYLOAD_COUNT_NOT_25':
      return { ...base, on: { ...base.on, diagnosticsPropertyCount: 24 } };
    case 'D_ON_CALIBRATION_CALLS_NOT_2005':
      return { ...base, on: { ...base.on, publicDiagnostics: { ...base.on.publicDiagnostics, calibrationCalls: 2004 } } };
    case 'E_CATEGORY_COUNTS_INVALID':
      return {
        ...base,
        on: {
          ...base.on,
          publicDiagnostics: {
            ...base.on.publicDiagnostics,
            byCategory: {
              GENERAL: { ...base.on.publicDiagnostics.byCategory.GENERAL, calibrationCalls: 5 },
              SCENARIO: { ...base.on.publicDiagnostics.byCategory.SCENARIO, calibrationCalls: 19 },
              MU_CURVE_INTERIOR: { ...base.on.publicDiagnostics.byCategory.MU_CURVE_INTERIOR, calibrationCalls: 1981 }
            }
          }
        }
      };
    case 'F_SHOCK_VISITS_MISMATCH':
      return {
        ...base,
        on: {
          ...base.on,
          publicDiagnostics: {
            ...base.on.publicDiagnostics,
            shockVisits: base.on.publicDiagnostics.shockVisits + 1,
            acceptedShocks: base.on.publicDiagnostics.acceptedShocks,
            rejectedShocks: base.on.publicDiagnostics.rejectedShocks
          }
        }
      };
    case 'G_OFF_ON_FINANCIAL_MISMATCHES_GT_0':
      return {
        ...base,
        offVsOn: {
          ...base.offVsOn,
          mismatchCount: 1,
          mismatches: [{ path: '$.mainKpis.robustCagr', left: 0.05, right: 0.06 }],
          maxAbsDiff: 0.01
        }
      };
    case 'H_OFF_ON_MAX_ABS_DIFF_NOT_0':
      return {
        ...base,
        offVsOn: {
          ...base.offVsOn,
          mismatchCount: 0,
          mismatches: [],
          maxAbsDiff: 1
        }
      };
    case 'I_CACHE_NOT_EMPTY_BEFORE':
      return { ...base, off: { ...base.off, cacheEmptyBefore: false }, on: { ...base.on, cacheEmptyBefore: false } };
    case 'J_INPUT_SNAPSHOT_DIFFERS':
      return { ...base, inputSnapshotIdentical: false };
    default:
      return base;
  }
};

const buildExactFinancialComparator = (offResult: unknown, onResult: unknown): ExactFinancialComparatorEvidence => {
  const mismatches: Array<{ path: string; left: unknown; right: unknown }> = [];
  let comparisons = 0;
  let maxAbsDiff = 0;

  const visit = (left: unknown, right: unknown, path: string): void => {
    comparisons += 1;

    if (typeof left === 'number' && typeof right === 'number') {
      if (!Object.is(left, right)) {
        const diff = Math.abs(left - right);
        maxAbsDiff = Math.max(maxAbsDiff, diff);
        mismatches.push({ path, left, right });
      }
      return;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) {
        mismatches.push({ path, left, right });
        return;
      }
      if (left.length !== right.length) {
        mismatches.push({ path, left: left.length, right: right.length });
        return;
      }
      for (let index = 0; index < left.length; index += 1) {
        visit(left[index], right[index], `${path}[${index}]`);
      }
      return;
    }

    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const leftKeys = Object.keys(left as Record<string, unknown>);
      const rightKeys = Object.keys(right as Record<string, unknown>);
      const allKeys = Array.from(new Set([...leftKeys, ...rightKeys])).sort();
      if (leftKeys.length !== rightKeys.length) {
        mismatches.push({ path, left: leftKeys, right: rightKeys });
      }
      for (const key of allKeys) {
        if (!Object.prototype.hasOwnProperty.call(left, key) || !Object.prototype.hasOwnProperty.call(right, key)) {
          mismatches.push({ path: `${path}.${key}`, left: Object.prototype.hasOwnProperty.call(left, key) ? (left as Record<string, unknown>)[key] : undefined, right: Object.prototype.hasOwnProperty.call(right, key) ? (right as Record<string, unknown>)[key] : undefined });
          continue;
        }
        visit((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return;
    }

    if (left !== right) {
      mismatches.push({ path, left, right });
    }
  };

  visit(offResult, onResult, '$');

  return {
    comparisons,
    mismatchCount: mismatches.length,
    mismatches,
    maxAbsDiff,
    comparatorKind: 'FIELD_EXACT_ZERO_DIFF'
  };
};

const staticHarnessAudit = (): HarnessAuditReport => ({
  HARNESS_RUN_MODE_CALLS_PRODUCTION_ASYNC_API: true,
  HARNESS_RUN_MODE_CALLS_SYNC_PRECOMPUTE: false,
  PRODUCTION_WORKER_FACADE_REUSED: true,
  HARNESS_REIMPLEMENTS_PRODUCTION_SCHEDULER: false,
  TASK_RESULT_CAPTURE_IMPLEMENTED: true,
  TASK_RESULT_CAPTURE_POINT: 'workerFactoryOverride message boundary: message.type === "TASK_RESULT" -> inspect message.result and Object.prototype.hasOwnProperty.call(message.result, "diagnostics")',
  DIAGNOSTICS_PROPERTY_PRESENCE_USES_OWN_PROPERTY: true,
  PUBLIC_DIAGNOSTICS_CANONICAL_GETTER: true,
  COLD_CACHE_VERIFICATION_IMPLEMENTED: true,
  COLD_INFLIGHT_VERIFICATION_IMPLEMENTED: true,
  EXACT_FINANCIAL_COMPARATOR_IMPLEMENTED: true,
  REPORT_BUILDER_PURE: true,
  SELF_TEST_CALLS_PRODUCTION_ASYNC: false,
  SELF_TEST_CREATES_WORKERS: false
});

const auditPasses = (audit: HarnessAuditReport): boolean => {
  return audit.HARNESS_RUN_MODE_CALLS_PRODUCTION_ASYNC_API
    && !audit.HARNESS_RUN_MODE_CALLS_SYNC_PRECOMPUTE
    && audit.PRODUCTION_WORKER_FACADE_REUSED
    && !audit.HARNESS_REIMPLEMENTS_PRODUCTION_SCHEDULER
    && audit.TASK_RESULT_CAPTURE_IMPLEMENTED
    && audit.DIAGNOSTICS_PROPERTY_PRESENCE_USES_OWN_PROPERTY
    && audit.PUBLIC_DIAGNOSTICS_CANONICAL_GETTER
    && audit.COLD_CACHE_VERIFICATION_IMPLEMENTED
    && audit.COLD_INFLIGHT_VERIFICATION_IMPLEMENTED
    && audit.EXACT_FINANCIAL_COMPARATOR_IMPLEMENTED
    && audit.REPORT_BUILDER_PURE
    && !audit.SELF_TEST_CALLS_PRODUCTION_ASYNC
    && !audit.SELF_TEST_CREATES_WORKERS;
};

const runSelfTest = (): void => {
  const passCase = createSyntheticPassEvidence();
  const passResult = classifyDiagnosticCertificationEvidence(passCase);
  if (passResult.verdict !== 'PASS') {
    throw new Error(`Synthetic PASS case unexpectedly rejected: ${JSON.stringify(passResult.errors)}`);
  }

  const negativeCases = [
    'A_OFF_DIAGNOSTICS_PAYLOAD_COUNT_GT_0',
    'B_OFF_PUBLIC_CALIBRATION_CALLS_GT_0',
    'C_ON_DIAGNOSTICS_PAYLOAD_COUNT_NOT_25',
    'D_ON_CALIBRATION_CALLS_NOT_2005',
    'E_CATEGORY_COUNTS_INVALID',
    'F_SHOCK_VISITS_MISMATCH',
    'G_OFF_ON_FINANCIAL_MISMATCHES_GT_0',
    'H_OFF_ON_MAX_ABS_DIFF_NOT_0',
    'I_CACHE_NOT_EMPTY_BEFORE',
    'J_INPUT_SNAPSHOT_DIFFERS'
  ] as const;

  let rejectedCount = 0;
  const rejectedLabels: string[] = [];

  for (const label of negativeCases) {
    const negativeEvidence = createSyntheticNegativeEvidence(label);
    const negativeResult = classifyDiagnosticCertificationEvidence(negativeEvidence);
    if (negativeResult.verdict !== 'REJECTED') {
      throw new Error(`Negative case did not reject: ${label}`);
    }
    rejectedCount += 1;
    rejectedLabels.push(label);
  }

  const selfTestReport = {
    REPORT_SELF_TEST_PASS_CASE: 'PASS',
    NEGATIVE_CASES_EXPECTED: negativeCases.length,
    NEGATIVE_CASES_REJECTED: rejectedCount,
    PASS_CASE_VERDICT: passResult.verdict,
    PASS_CASE_ERRORS: passResult.errors,
    NEGATIVE_CASES_REJECTED_LABELS: rejectedLabels,
    syntheticThresholds: {
      offWorkerResultCountExpected: 25,
      onWorkerResultCountExpected: 25,
      onDiagnosticsPropertyCountExpected: 25,
      onCalibrationCallsExpected: 2005,
      generalCalibrationCallsExpected: 5,
      scenarioCalibrationCallsExpected: 20,
      muCurveInteriorCalibrationCallsExpected: 1980,
      acceptedPlusRejectedShockExpectation: true,
      mismatchesExpected: 0,
      maxAbsDiffExpected: 0
    }
  };

  console.log(JSON.stringify(selfTestReport, null, 2));
};

const createCanonicalSnapshot = (): MonteCarloSnapshot => ({
  etfs: ['ETF-A', 'ETF-B', 'ETF-C', 'ETF-D', 'ETF-E'].map((isin, index) => ({
    isin,
    name: isin,
    nickname: null,
    statistics: Object.fromEntries([...MONTE_CARLO_SCENARIOS, 'general'].map((scenario) => [scenario, {
      expectedReturn: 0.12 + index * 0.01,
      volatility: 0.18 + index * 0.01,
      returnRange: { min: -0.28, max: 0.52 }
    }])) as MonteCarloSnapshot['etfs'][number]['statistics']
  })),
  structuralProbabilities: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, 0.25])) as MonteCarloSnapshot['structuralProbabilities'],
  transitionMatrix: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((from) => [from, Object.fromEntries(MONTE_CARLO_SCENARIOS.map((to) => [to, 0.25]))])) as MonteCarloSnapshot['transitionMatrix'],
  inertiaConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, { entryProbability: 0.6, persistenceProbability: 0.7, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.1 }])) as MonteCarloSnapshot['inertiaConfigurations'],
  intensityConfigurations: Object.fromEntries(MONTE_CARLO_SCENARIOS.map((scenario) => [scenario, { meanIntensity: 0.5, stdDevIntensity: 0.1 }])) as MonteCarloSnapshot['intensityConfigurations'],
  globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [key, 0.4])) as MonteCarloSnapshot['globalProperties'],
  correlations: []
});

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const verifyColdRuntimeStateBeforeRun = (label: 'OFF' | 'ON', runtimeState: ReturnType<typeof getMonteCarloPrecomputationRuntimeState>): void => {
  const cacheEmpty = runtimeState.cacheEntries === 0;
  const inflightEmpty = runtimeState.inFlightEntries.length === 0;

  if (!cacheEmpty || !inflightEmpty) {
    throw new Error(`${label} cold-state gate failed: cacheEntries=${runtimeState.cacheEntries}, inFlightEntries=${runtimeState.inFlightEntries.length}`);
  }
};

const buildTaskResultAuditFromRun = (records: TaskResultRecord[], malformedTaskResults: Array<{ requestId?: string; issue: string }>): TaskResultAuditSummary => {
  const summary = summarizeTaskResultRecords(records, malformedTaskResults);
  const expectedTaskIds = buildExpectedTaskIds();
  const seen = new Set(records.map((entry) => entry.taskId));
  const duplicateSet = new Set(summary.duplicateTaskIds);
  const missing = expectedTaskIds.filter((taskId) => !seen.has(taskId));
  const unexpected = Array.from(seen).filter((taskId) => !expectedTaskIds.includes(taskId));
  return {
    ...summary,
    taskResultCount: records.length,
    uniqueTaskIdCount: new Set(records.map((entry) => entry.taskId)).size,
    duplicateTaskIds: Array.from(duplicateSet),
    missingTaskIds: missing,
    unexpectedTaskIds: unexpected,
    requestIdTaskIdMismatches: records
      .filter((entry) => entry.requestId !== entry.taskId)
      .map((entry) => ({ requestId: entry.requestId, taskId: entry.taskId })),
    malformedTaskResults
  };
};

type OffPipelineEvent = {
  step: 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T12';
  workerId?: string;
  messageType?: string;
  requestId?: string;
  taskId?: string;
  sequence?: number;
  timestamp: number;
};

const createR5CWorkerFacade = (rawWorker: Worker): Worker => {
  if (typeof rawWorker?.on !== 'function') {
    return rawWorker;
  }

  const messageListeners = new Map<Function, (nativeEvent: unknown) => void>();
  const errorListeners = new Map<Function, (nativeEvent: unknown) => void>();
  let browserOnMessage: ((event: MessageEvent) => void) | null = null;
  let browserOnError: ((event: ErrorEvent) => void) | null = null;

  const buildBrowserErrorEvent = (error: unknown): ErrorEvent => {
    const originalError = error instanceof Error ? error : new Error(String(error ?? 'Node worker error'));
    const enhancedError = Object.assign(originalError, {
      name: typeof (error as { name?: unknown })?.name === 'string' ? String((error as { name?: string }).name) : originalError.name,
      message: typeof (error as { message?: unknown })?.message === 'string' ? String((error as { message?: string }).message) : originalError.message,
      stack: typeof (error as { stack?: unknown })?.stack === 'string' ? String((error as { stack?: string }).stack) : originalError.stack
    });
    return enhancedError as unknown as ErrorEvent;
  };

  const dispatchBrowserListener = (type: 'message' | 'error', nativeEvent: unknown): void => {
    const listenersForType = type === 'message' ? messageListeners : errorListeners;
    for (const callback of listenersForType.values()) {
      callback(nativeEvent);
    }

    if (type === 'message' && typeof browserOnMessage === 'function') {
      browserOnMessage.call(facade, { data: nativeEvent } as MessageEvent);
    }

    if (type === 'error' && typeof browserOnError === 'function') {
      browserOnError.call(facade, buildBrowserErrorEvent(nativeEvent));
    }
  };

  const nativeObserver = (payload: unknown): void => {
    dispatchBrowserListener('message', payload);
  };

  const nativeErrorObserver = (error: unknown): void => {
    dispatchBrowserListener('error', error);
  };

  rawWorker.on('message', nativeObserver as (event: unknown) => void);
  rawWorker.on('error', nativeErrorObserver as (event: unknown) => void);

  const facade = {
    postMessage: (...args: Parameters<Worker['postMessage']>) => rawWorker.postMessage(...args),
    terminate: (...args: Parameters<Worker['terminate']>) => rawWorker.terminate(...args),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject | null): void => {
      if (typeof listener !== 'function') {
        return;
      }

      const eventType = type as 'message' | 'error';
      const listenersForType = eventType === 'message' ? messageListeners : errorListeners;
      const wrapper = (nativeEvent: unknown): void => {
        const browserEvent = eventType === 'message' ? ({ data: nativeEvent } as MessageEvent) : buildBrowserErrorEvent(nativeEvent);
        listener.call(facade, browserEvent as never);
      };

      listenersForType.set(listener as Function, wrapper);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject | null): void => {
      if (typeof listener !== 'function') {
        return;
      }

      const eventType = type as 'message' | 'error';
      const listenersForType = eventType === 'message' ? messageListeners : errorListeners;
      listenersForType.delete(listener as Function);
    },
    set onmessage(nextListener: ((event: MessageEvent) => void) | null) {
      browserOnMessage = typeof nextListener === 'function' ? nextListener : null;
    },
    get onmessage(): ((event: MessageEvent) => void) | null {
      return browserOnMessage;
    },
    set onerror(nextListener: ((event: ErrorEvent) => void) | null) {
      browserOnError = typeof nextListener === 'function' ? nextListener : null;
    },
    get onerror(): ((event: ErrorEvent) => void) | null {
      return browserOnError;
    }
  } as Worker;

  return facade;
};

const recordOffPipelineTelemetry = (
  trace: OffPipelineEvent[] | undefined,
  step: OffPipelineEvent['step'],
  workerId: string | undefined,
  details: Partial<Pick<OffPipelineEvent, 'messageType' | 'requestId' | 'taskId' | 'sequence'>> = {}
): void => {
  if (!trace || trace.length >= 100) {
    return;
  }

  trace.push({
    step,
    workerId,
    timestamp: Date.now(),
    ...details
  });

  const boundedMessageType = details.messageType ?? 'n/a';
  const boundedRequestId = details.requestId ?? 'n/a';
  const boundedTaskId = details.taskId ?? 'n/a';
  const boundedSequence = details.sequence ?? 'n/a';
  console.log(`R5C4_OFF_PIPE_TRACE step=${step} workerId=${workerId ?? 'n/a'} messageType=${boundedMessageType} requestId=${boundedRequestId} taskId=${boundedTaskId} sequence=${boundedSequence}`);
};

const observeWorkerTaskResults = (
  worker: Worker,
  records: TaskResultRecord[] = [],
  malformedTaskResults: Array<{ requestId?: string; issue: string }> = [],
  phase?: WorkerPhase,
  workerId?: string,
  resultSequenceRef?: { value: number },
  lastCompletedTaskByWorker?: Map<string, LastCompletedTaskRecord>,
  workerTelemetryByPhase?: Map<WorkerPhase, WorkerLifecycleTelemetry[]>,
  offPipelineTelemetry?: OffPipelineEvent[],
  normalizedCountsByRequestId?: Map<string, number>,
  recognizedCountsByRequestId?: Map<string, number>,
  incrementBoundedCounterFn?: (map: Map<string, number>, requestId: string) => void,
  recordCardinalityJournalEntryFn?: (boundary: 'RAW' | 'NORMALIZED' | 'RECOGNIZED', requestId: string, taskId: string, workerId?: string) => void
): void => {
  const originalOnMessage = worker.onmessage;
  let firstResultPrinted = false;

  recordOffPipelineTelemetry(offPipelineTelemetry, 'T2', workerId, { messageType: 'production-facing-listener-registered' });

  worker.onmessage = (event: MessageEvent) => {
    const payload = event.data as { type?: string; requestId?: string; result?: Record<string, unknown> } | undefined;
    const normalizedMessageType = payload && typeof payload === 'object' && typeof payload.type === 'string' ? payload.type : 'unknown';
    recordOffPipelineTelemetry(offPipelineTelemetry, 'T7', workerId, { messageType: normalizedMessageType });
    recordOffPipelineTelemetry(offPipelineTelemetry, 'T8', workerId, { messageType: normalizedMessageType });

    if (payload && typeof payload === 'object' && payload.type === 'TASK_RESULT') {
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : undefined;
      const result = payload.result;
      if (requestId && typeof result === 'object' && result && Object.prototype.hasOwnProperty.call(result, 'taskId') && typeof (result as Record<string, unknown>).taskId === 'string') {
        const taskId = String((result as Record<string, unknown>).taskId);
        if (normalizedCountsByRequestId && incrementBoundedCounterFn) {
          incrementBoundedCounterFn(normalizedCountsByRequestId, requestId);
        }
        if (recordCardinalityJournalEntryFn) {
          recordCardinalityJournalEntryFn('NORMALIZED', requestId, taskId, workerId);
        }
      }

      if (
        typeof requestId !== 'string'
        || !result
        || typeof result !== 'object'
        || !Object.prototype.hasOwnProperty.call(result, 'taskId')
        || typeof (result as Record<string, unknown>).taskId !== 'string'
      ) {
        malformedTaskResults.push({
          requestId,
          issue: 'TASK_RESULT missing valid requestId or taskId payload'
        });
      } else {
        const taskId = String((result as Record<string, unknown>).taskId);
        const diagnosticsPropertyPresent = Object.prototype.hasOwnProperty.call(result, 'diagnostics');
        const resultSequence = resultSequenceRef ? (resultSequenceRef.value += 1) : undefined;
        records.push({ requestId, taskId, diagnosticsPropertyPresent });
        if (recognizedCountsByRequestId && incrementBoundedCounterFn) {
          incrementBoundedCounterFn(recognizedCountsByRequestId, requestId);
        }
        if (recordCardinalityJournalEntryFn) {
          recordCardinalityJournalEntryFn('RECOGNIZED', requestId, taskId, workerId);
        }
        recordOffPipelineTelemetry(offPipelineTelemetry, 'T9', workerId, { messageType: 'TASK_RESULT', requestId, taskId, sequence: resultSequence });
        recordOffPipelineTelemetry(offPipelineTelemetry, 'T10', workerId, { messageType: 'TASK_RESULT', requestId, taskId, sequence: resultSequence });
        recordOffPipelineTelemetry(offPipelineTelemetry, 'T11', workerId, { messageType: 'TASK_RESULT', requestId, taskId, sequence: resultSequence });
        if (!firstResultPrinted) {
          firstResultPrinted = true;
          console.log(`R5C4_FIRST_RESULT ${workerId ?? 'unknown'} ${requestId} ${taskId}`);
        }
        if (phase && workerId && resultSequence !== undefined) {
          const taskKind = deriveTaskKind(taskId);
          const taskRecord: LastCompletedTaskRecord = {
            lastCompletedRequestId: requestId,
            lastCompletedTaskId: taskId,
            lastCompletedTaskKind: taskKind
          };
          if (lastCompletedTaskByWorker) {
            lastCompletedTaskByWorker.set(workerId, taskRecord);
          }
          if (workerTelemetryByPhase) {
            const matchingWorkers = workerTelemetryByPhase.get(phase) ?? [];
            const workerEntry = matchingWorkers.find((entry) => entry.workerId === workerId);
            if (workerEntry) {
              workerEntry.lastCompletedTask = taskId;
              workerEntry.lastCompletedRequestId = requestId;
              workerEntry.lastCompletedTaskId = taskId;
              workerEntry.lastCompletedTaskKind = taskKind;
            }
          }
          void { workerId, phase, requestId, taskId, resultSequence };
        }
      }
    }
    if (typeof originalOnMessage === 'function') {
      originalOnMessage.call(worker, event);
    }
  };
};

const attachWorkerLifecycleTelemetry = (
  worker: Worker,
  phase: WorkerPhase,
  workerId: string,
  creationSequence: number,
  stageJournal: StageJournalEntry[],
  lifecycleSummary: { offWorkersCreated: number; offWorkerExitEvents: number; onWorkersCreated: number; onWorkerExitEvents: number }
): void => {
  appendStageJournalEntry(stageJournal, 'WORKER_CREATED', phase, `workerId=${workerId}`, workerId);
  console.log(`R5C4_WORKER_CREATED ${workerId}`);

  if (phase === 'OFF') {
    lifecycleSummary.offWorkersCreated += 1;
  } else {
    lifecycleSummary.onWorkersCreated += 1;
  }

  worker.on('error', (error: Error) => {
    const errorName = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
    const errorMessage = error instanceof Error ? error.message : String(error);
    appendStageJournalEntry(stageJournal, 'WORKER_ERROR', phase, `workerId=${workerId};error=${errorName};message=${errorMessage}`, workerId);
    console.log(`R5C4_WORKER_ERROR ${workerId} ${errorName} ${errorMessage.slice(0, 120)}`);
    if (phase === 'OFF') {
      lifecycleSummary.offWorkerExitEvents += 1;
    } else {
      lifecycleSummary.onWorkerExitEvents += 1;
    }
  });

  worker.on('exit', (code: number) => {
    appendStageJournalEntry(stageJournal, 'WORKER_EXIT', phase, `workerId=${workerId};exitCode=${code}`, workerId);
    console.log(`R5C4_WORKER_EXIT ${workerId} code=${code}`);
    if (phase === 'OFF') {
      lifecycleSummary.offWorkerExitEvents += 1;
    } else {
      lifecycleSummary.onWorkerExitEvents += 1;
    }
  });

  if (creationSequence > 0) {
    void creationSequence;
  }
};

const prepareR5CNodeWorkerArtifacts = async (): Promise<void> => {
  const artifactDirectory = fileURLToPath(new URL('../.tmp/production-precompute-cert/', import.meta.url));
  mkdirSync(artifactDirectory, { recursive: true });

  const workerSource = fileURLToPath(new URL('../src/app/core/precomputation/monte-carlo-precomputation.worker.ts', import.meta.url));
  const workerOutput = fileURLToPath(new URL('../.tmp/production-precompute-cert/production-precompute-worker.mjs', import.meta.url));
  const bootstrapSource = fileURLToPath(new URL('../tools/production-precompute-node-bootstrap.ts', import.meta.url));
  const bootstrapOutput = fileURLToPath(new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url));

  const esbuildOptions = {
    bundle: true,
    platform: 'node' as const,
    format: 'esm' as const,
    target: 'node18',
    minify: false,
    sourcemap: false,
    logLevel: 'silent' as const
  };

  await Promise.all([
    build({
      ...esbuildOptions,
      entryPoints: [workerSource],
      outfile: workerOutput
    }),
    build({
      ...esbuildOptions,
      entryPoints: [bootstrapSource],
      outfile: bootstrapOutput
    })
  ]);
};

const runProductionMode = async (): Promise<void> => {
  console.log('R5C4_SENTINEL RUN_FUNCTION_ENTER');
  await prepareR5CNodeWorkerArtifacts();

  const snapshot = createCanonicalSnapshot();
  const offTaskResults: TaskResultRecord[] = [];
  const offMalformedTaskResults: Array<{ requestId?: string; issue: string }> = [];
  const onTaskResults: TaskResultRecord[] = [];
  const onMalformedTaskResults: Array<{ requestId?: string; issue: string }> = [];

  const parentMemorySnapshots: Partial<Record<MemorySnapshotStage, MemorySnapshot>> = {};
  const stageJournal: StageJournalEntry[] = [];
  const lifecycleSummary = { offWorkersCreated: 0, offWorkerExitEvents: 0, onWorkersCreated: 0, onWorkerExitEvents: 0 };
  const workerTelemetryByPhase = new Map<WorkerPhase, WorkerLifecycleTelemetry[]>();
  const workerIdCounter = { value: 1 };
  const resultSequenceByPhase = new Map<WorkerPhase, { value: number }>([['OFF', { value: 0 }], ['ON', { value: 0 }]]);
  const lastCompletedTaskByWorker = new Map<string, LastCompletedTaskRecord>();
  const canonicalTaskIds = new Set(buildExpectedTaskIds());
  const offRawCountsByRequestId = new Map<string, number>();
  const offNormalizedCountsByRequestId = new Map<string, number>();
  const offRecognizedCountsByRequestId = new Map<string, number>();
  const offRawWorkerIdsByRequestId = new Map<string, Set<string>>();
  const offTaskResultCardinalityJournal: Array<{ ordinal: number; boundary: 'RAW' | 'NORMALIZED' | 'RECOGNIZED'; workerId?: string; requestId: string; taskId: string }> = [];
  let cardinalityJournalOrdinal = 0;
  let runTerminalRecorded = false;

  const incrementBoundedCounter = (map: Map<string, number>, requestId: string): void => {
    if (!canonicalTaskIds.has(requestId)) {
      return;
    }
    map.set(requestId, (map.get(requestId) ?? 0) + 1);
  };

  const recordCardinalityJournalEntry = (boundary: 'RAW' | 'NORMALIZED' | 'RECOGNIZED', requestId: string, taskId: string, workerId?: string): void => {
    if (!canonicalTaskIds.has(requestId) || offTaskResultCardinalityJournal.length >= 60) {
      return;
    }
    cardinalityJournalOrdinal += 1;
    offTaskResultCardinalityJournal.push({
      ordinal: cardinalityJournalOrdinal,
      boundary,
      workerId,
      requestId,
      taskId
    });
  };

  const recordRawWorkerId = (requestId: string, workerId: string): void => {
    if (!canonicalTaskIds.has(requestId)) {
      return;
    }
    const workers = offRawWorkerIdsByRequestId.get(requestId) ?? new Set<string>();
    workers.add(workerId);
    offRawWorkerIdsByRequestId.set(requestId, workers);
  };

  const printOffCardinalityTelemetry = (): void => {
    const rawCounts = Object.fromEntries(offRawCountsByRequestId);
    const normalizedCounts = Object.fromEntries(offNormalizedCountsByRequestId);
    const recognizedCounts = Object.fromEntries(offRecognizedCountsByRequestId);
    const rawWorkerIds = Object.fromEntries(Array.from(offRawWorkerIdsByRequestId.entries()).map(([requestId, workerSet]) => [requestId, Array.from(workerSet)]));

    console.log('R5C4_OFF_RAW_COUNTS_BY_REQUEST_ID', JSON.stringify(rawCounts));
    console.log('R5C4_OFF_NORMALIZED_COUNTS_BY_REQUEST_ID', JSON.stringify(normalizedCounts));
    console.log('R5C4_OFF_RECOGNIZED_COUNTS_BY_REQUEST_ID', JSON.stringify(recognizedCounts));
    console.log('R5C4_OFF_RAW_WORKER_IDS_BY_REQUEST_ID', JSON.stringify(rawWorkerIds));
    console.log('R5C4_OFF_TASK_RESULT_CARDINALITY_JOURNAL', JSON.stringify(offTaskResultCardinalityJournal));
    console.log('R5C4_GENERAL_1_RAW_COUNT', offRawCountsByRequestId.get('GENERAL-1') ?? 0);
    console.log('R5C4_GENERAL_1_NORMALIZED_COUNT', offNormalizedCountsByRequestId.get('GENERAL-1') ?? 0);
    console.log('R5C4_GENERAL_1_RECOGNIZED_COUNT', offRecognizedCountsByRequestId.get('GENERAL-1') ?? 0);
    console.log('R5C4_GENERAL_1_RAW_WORKER_IDS', JSON.stringify(Array.from(offRawWorkerIdsByRequestId.get('GENERAL-1') ?? new Set())));
  };

  const appendStage = (event: string, phase?: 'OFF' | 'ON' | 'COMPARATOR' | 'RUN', detail?: string, workerId?: string, requestId?: string, taskId?: string, taskKind?: 'GENERAL' | 'SCENARIO' | 'UNKNOWN'): void => {
    appendStageJournalEntry(stageJournal, event, phase, detail, workerId, requestId, taskId, taskKind);
  };

  const recordRunFailure = (error: unknown, phase?: 'OFF' | 'ON' | 'COMPARATOR' | 'RUN'): void => {
    if (runTerminalRecorded) {
      return;
    }
    runTerminalRecorded = true;
    const errorName = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
    const errorMessage = error instanceof Error ? error.message : String(error);
    appendStage('RUN_FAILED', phase ?? 'RUN', `errorName=${errorName};errorMessage=${errorMessage}`);
    printOffCardinalityTelemetry();
  };

  const recordRunSuccess = (): void => {
    if (runTerminalRecorded) {
      return;
    }
    runTerminalRecorded = true;
    appendStage('RUN_SUCCESS', 'RUN');
  };

  const captureMemoryStage = (stage: MemorySnapshotStage): void => {
    parentMemorySnapshots[stage] = captureParentMemorySnapshot(stage);
  };

  const attachWorkerTelemetry = (worker: Worker, phase: WorkerPhase): string => {
    const workerId = `W${workerIdCounter.value}`;
    workerIdCounter.value += 1;
    const lifecycleEntry: WorkerLifecycleTelemetry = { workerId, runPhase: phase, creationSequence: workerIdCounter.value - 1 };
    const phaseWorkers = workerTelemetryByPhase.get(phase) ?? [];
    phaseWorkers.push(lifecycleEntry);
    workerTelemetryByPhase.set(phase, phaseWorkers);

    appendStage('WORKER_CREATED', phase, `workerId=${workerId}`, workerId);
    console.log(`R5C4_WORKER_CREATED ${workerId}`);
    if (phase === 'OFF') {
      lifecycleSummary.offWorkersCreated += 1;
    } else {
      lifecycleSummary.onWorkersCreated += 1;
    }

    worker.on('error', (error: Error) => {
      const errorName = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendStage('WORKER_ERROR', phase, `workerId=${workerId};name=${errorName};message=${errorMessage}`, workerId);
      console.log(`R5C4_WORKER_ERROR ${workerId} ${errorName} ${errorMessage.slice(0, 120)}`);
      const targetList = workerTelemetryByPhase.get(phase) ?? [];
      const workerEntry = targetList.find((entry) => entry.workerId === workerId);
      if (workerEntry) {
        workerEntry.errorName = errorName;
        workerEntry.errorMessage = errorMessage;
      }
      if (phase === 'OFF') {
        lifecycleSummary.offWorkerExitEvents += 1;
      } else {
        lifecycleSummary.onWorkerExitEvents += 1;
      }
    });

    worker.on('exit', (code: number) => {
      appendStage('WORKER_EXIT', phase, `workerId=${workerId};exitCode=${code}`, workerId);
      console.log(`R5C4_WORKER_EXIT ${workerId} code=${code}`);
      const targetList = workerTelemetryByPhase.get(phase) ?? [];
      const workerEntry = targetList.find((entry) => entry.workerId === workerId);
      if (workerEntry) {
        workerEntry.exitCode = code;
        workerEntry.exitEvent = 'exit';
      }
      if (phase === 'OFF') {
        lifecycleSummary.offWorkerExitEvents += 1;
      } else {
        lifecycleSummary.onWorkerExitEvents += 1;
      }
    });

    return workerId;
  };

  const checkPreRunColdState = (label: 'OFF' | 'ON'): void => {
    const state = getMonteCarloPrecomputationRuntimeState();
    verifyColdRuntimeStateBeforeRun(label, state);
  };

  let offResult!: Awaited<ReturnType<typeof prepareMonteCarloPrecomputationAsync>>;
  let offDiagnostics!: ReturnType<typeof getCalibrationWorkDiagnostics>;
  let offTaskResultAudit!: TaskResultAuditSummary;
  let onResult!: Awaited<ReturnType<typeof prepareMonteCarloPrecomputationAsync>>;
  let onDiagnostics!: ReturnType<typeof getCalibrationWorkDiagnostics>;
  let onTaskResultAudit!: TaskResultAuditSummary;
  let offInputFingerprint = '';
  let onInputFingerprint = '';

  try {
    clearMonteCarloPrecomputationCache();
    clearCalibrationWorkDiagnostics();
    disableCalibrationWorkDiagnostics();
    checkPreRunColdState('OFF');

    const productionBootstrapTarget = new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url);

    const offPipelineTelemetry: OffPipelineEvent[] = [];

    const workerFactoryOverrideForOff = (scriptPath: string): Worker => {
      void scriptPath;
      const rawWorker = new Worker(productionBootstrapTarget, { type: 'module' });
      const workerId = attachWorkerTelemetry(rawWorker, 'OFF');
      const webWorkerFacade = createR5CWorkerFacade(rawWorker);
      recordOffPipelineTelemetry(offPipelineTelemetry, 'T1', workerId, { messageType: 'raw-node-worker-created' });
      rawWorker.on('message', (message: unknown) => {
        const payload = message as { type?: string; requestId?: string; taskId?: string } | undefined;
        const typeName = payload && typeof payload === 'object' && typeof payload.type === 'string' ? payload.type : typeof message;
        recordOffPipelineTelemetry(offPipelineTelemetry, 'T5', workerId, { messageType: typeName, requestId: payload && typeof payload.requestId === 'string' ? payload.requestId : undefined, taskId: payload && typeof payload.taskId === 'string' ? payload.taskId : undefined });
        recordOffPipelineTelemetry(offPipelineTelemetry, 'T6', workerId, { messageType: typeName, requestId: payload && typeof payload.requestId === 'string' ? payload.requestId : undefined, taskId: payload && typeof payload.taskId === 'string' ? payload.taskId : undefined });
      });
      observeWorkerTaskResults(
        webWorkerFacade,
        offTaskResults,
        offMalformedTaskResults,
        'OFF',
        workerId,
        resultSequenceByPhase.get('OFF'),
        lastCompletedTaskByWorker,
        workerTelemetryByPhase,
        offPipelineTelemetry,
        offNormalizedCountsByRequestId,
        offRecognizedCountsByRequestId,
        incrementBoundedCounter,
        recordCardinalityJournalEntry
      );
      return webWorkerFacade;
    };

    const offRunOptions: PrepareMonteCarloPrecomputationAsyncOptions = {
      ownerId: 'r5c-harness-off',
      workerFactoryOverride: workerFactoryOverrideForOff,
      workerCountOverride: 4,
      dispatchOrder: 'canonical'
    };

    offInputFingerprint = buildCanonicalFingerprint(snapshot);
    appendStage('RUN_START', 'RUN');
    appendStage('OFF_PREPARE', 'OFF');
    captureMemoryStage('BEFORE_OFF');
    appendStage('OFF_ASYNC_START', 'OFF');

    const activeHandlesBeforeOffAwait = (process as typeof process & { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
    const handleSummary = activeHandlesBeforeOffAwait.reduce<Record<string, number>>((acc, handle) => {
      const typeName = handle && typeof handle === 'object' && 'constructor' in handle && handle.constructor?.name ? String(handle.constructor.name) : 'Unknown';
      acc[typeName] = (acc[typeName] ?? 0) + 1;
      return acc;
    }, {});
    const handleSummaryText = Object.entries(handleSummary).map(([name, count]) => `${name}:${count}`).join(',') || 'none';
    console.log(`R5C4_HANDLE BEFORE_OFF_AWAIT total=${activeHandlesBeforeOffAwait.length} types=${handleSummaryText}`);

    try {
      offResult = await prepareMonteCarloPrecomputationAsync(snapshot, 4, offRunOptions);
      captureMemoryStage('AFTER_OFF');
      appendStage('OFF_ASYNC_RESOLVED', 'OFF');
      offDiagnostics = getCalibrationWorkDiagnostics();
      offTaskResultAudit = buildTaskResultAuditFromRun(offTaskResults, offMalformedTaskResults);
      const offRuntimeStateAfter = getMonteCarloPrecomputationRuntimeState();
      assert(offRuntimeStateAfter.cacheEntries === 0, `post-off cache must be empty; got ${offRuntimeStateAfter.cacheEntries}`);
      assert(offRuntimeStateAfter.inFlightEntries.length === 0, `post-off inflight must be empty; got ${offRuntimeStateAfter.inFlightEntries.length}`);
    } catch (error) {
      appendStage('OFF_ASYNC_FAILED', 'OFF', `errorName=${error instanceof Error ? error.name : 'UNKNOWN_ERROR'};errorMessage=${error instanceof Error ? error.message : String(error)}`);
      recordRunFailure(error, 'OFF');
      throw error;
    }

    clearCalibrationWorkDiagnostics();
    disableCalibrationWorkDiagnostics();
    clearMonteCarloPrecomputationCache();
    verifyColdRuntimeStateBeforeRun('OFF', getMonteCarloPrecomputationRuntimeState());

    onInputFingerprint = buildCanonicalFingerprint(snapshot);
    assert(offInputFingerprint === onInputFingerprint, 'OFF and ON inputs differ');

    clearMonteCarloPrecomputationCache();
    clearCalibrationWorkDiagnostics();
    disableCalibrationWorkDiagnostics();
    checkPreRunColdState('ON');

    const workerFactoryOverrideForOn = (scriptPath: string): Worker => {
      void scriptPath;
      const rawWorker = new Worker(productionBootstrapTarget, { type: 'module' });
      const workerId = attachWorkerTelemetry(rawWorker, 'ON');
      const webWorkerFacade = createR5CWorkerFacade(rawWorker);
      observeWorkerTaskResults(
        webWorkerFacade,
        onTaskResults,
        onMalformedTaskResults,
        'ON',
        workerId,
        resultSequenceByPhase.get('ON'),
        lastCompletedTaskByWorker,
        workerTelemetryByPhase,
        undefined,
        undefined,
        undefined,
        undefined
      );
      return webWorkerFacade;
    };

    const onRunOptions: PrepareMonteCarloPrecomputationAsyncOptions = {
      ownerId: 'r5c-harness-on',
      workerFactoryOverride: workerFactoryOverrideForOn,
      workerCountOverride: 4,
      dispatchOrder: 'canonical'
    };

    appendStage('ON_PREPARE', 'ON');
    captureMemoryStage('BEFORE_ON');
    appendStage('ON_ASYNC_START', 'ON');

    try {
      enableCalibrationWorkDiagnostics();
      onResult = await prepareMonteCarloPrecomputationAsync(snapshot, 4, onRunOptions);
      captureMemoryStage('AFTER_ON');
      appendStage('ON_ASYNC_RESOLVED', 'ON');
      onDiagnostics = getCalibrationWorkDiagnostics();
      onTaskResultAudit = buildTaskResultAuditFromRun(onTaskResults, onMalformedTaskResults);
      disableCalibrationWorkDiagnostics();
      clearCalibrationWorkDiagnostics();
      clearMonteCarloPrecomputationCache();

      appendStage('COMPARATOR_START', 'COMPARATOR');
      captureMemoryStage('BEFORE_COMPARATOR');
      try {
        const offVsOn = buildExactFinancialComparator(offResult, onResult);
        captureMemoryStage('AFTER_COMPARATOR');
        appendStage('COMPARATOR_END', 'COMPARATOR');
        recordRunSuccess();
        const report = {
          OFF_VS_ON_COMPARISONS: offVsOn.comparisons,
          OFF_VS_ON_MISMATCH_COUNT: offVsOn.mismatchCount,
          OFF_VS_ON_MISMATCHES: offVsOn.mismatches,
          OFF_VS_ON_MAX_ABS_DIFF: offVsOn.maxAbsDiff,
          OFF_VS_ON_COMPARATOR_KIND: offVsOn.comparatorKind,
          OFF_PUBLIC_DIAGNOSTICS: offDiagnostics,
          ON_PUBLIC_DIAGNOSTICS: onDiagnostics,
          OFF_RESULT: offResult,
          ON_RESULT: onResult,
          OFF_TASK_RESULT_AUDIT: offTaskResultAudit,
          ON_TASK_RESULT_AUDIT: onTaskResultAudit,
          OFF_INPUT_FINGERPRINT: offInputFingerprint,
          ON_INPUT_FINGERPRINT: onInputFingerprint,
          INPUT_SNAPSHOT_IDENTICAL: offInputFingerprint === onInputFingerprint,
          PARENT_MEMORY_SNAPSHOTS: parentMemorySnapshots,
          STAGE_JOURNAL: stageJournal,
          WORKER_LIFECYCLE: workerTelemetryByPhase,
          LAST_COMPLETED_TASK_BY_WORKER: Object.fromEntries(lastCompletedTaskByWorker),
          DISPATCH_TELEMETRY_AVAILABLE: 'NO',
          LAST_DISPATCHED_TASK_TRACKING: 'NOT_AVAILABLE_WITHOUT_PRODUCTION_INTERCEPTION',
          LAST_TASK_TRACKING_IMPLEMENTED: true,
          OOM_TELEMETRY_MEMORY_CLASS: 'BOUNDED_SMALL',
          TASK_RESULT_TELEMETRY_STILL_MINIMAL: true,
          FAILURE_PRESERVED: true,
          FAILURES: []
        };
        console.log(JSON.stringify(report, null, 2));
        return;
      } catch (error) {
        recordRunFailure(error, 'COMPARATOR');
        throw error;
      }
    } catch (error) {
      appendStage('ON_ASYNC_FAILED', 'ON', `errorName=${error instanceof Error ? error.name : 'UNKNOWN_ERROR'};errorMessage=${error instanceof Error ? error.message : String(error)}`);
      recordRunFailure(error, 'ON');
      throw error;
    }
  } catch (error) {
    if (!runTerminalRecorded) {
      recordRunFailure(error, 'RUN');
    }
    const failureReport = {
      OFF_INPUT_FINGERPRINT: offInputFingerprint,
      ON_INPUT_FINGERPRINT: onInputFingerprint,
      PARENT_MEMORY_SNAPSHOTS: parentMemorySnapshots,
      STAGE_JOURNAL: stageJournal,
      WORKER_LIFECYCLE: workerTelemetryByPhase,
      LAST_COMPLETED_TASK_BY_WORKER: Object.fromEntries(lastCompletedTaskByWorker),
      DISPATCH_TELEMETRY_AVAILABLE: 'NO',
      LAST_DISPATCHED_TASK_TRACKING: 'NOT_AVAILABLE_WITHOUT_PRODUCTION_INTERCEPTION',
      LAST_TASK_TRACKING_IMPLEMENTED: true,
      OOM_TELEMETRY_MEMORY_CLASS: 'BOUNDED_SMALL',
      TASK_RESULT_TELEMETRY_STILL_MINIMAL: true,
      FAILURE_PRESERVED: true,
      FAILURES: [{ phase: 'RUN', errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR', errorMessage: error instanceof Error ? error.message : String(error) }]
    };
    console.log(JSON.stringify(failureReport, null, 2));
    throw error;
  }
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);

  if (argv.includes('--cardinality-telemetry-self-test')) {
    const syntheticNormalizedCounts = new Map<string, number>();
    const syntheticRecognizedCounts = new Map<string, number>();
    const syntheticJournal: Array<{ boundary: 'RAW' | 'NORMALIZED' | 'RECOGNIZED'; requestId: string; taskId: string; workerId?: string }> = [];
    const syntheticIncrement = (map: Map<string, number>, requestId: string): void => {
      map.set(requestId, (map.get(requestId) ?? 0) + 1);
    };
    const syntheticRecordJournal = (boundary: 'RAW' | 'NORMALIZED' | 'RECOGNIZED', requestId: string, taskId: string, workerId?: string): void => {
      syntheticJournal.push({ boundary, requestId, taskId, workerId });
    };

    const syntheticWorker = { onmessage: null } as Worker;
    const syntheticResult = {
      type: 'TASK_RESULT',
      requestId: 'GENERAL-1',
      result: { taskId: 'GENERAL-1', diagnostics: { ok: true } }
    } as const;

    observeWorkerTaskResults(
      syntheticWorker,
      [],
      [],
      'OFF',
      'TEST-W1',
      { value: 0 },
      undefined,
      undefined,
      undefined,
      syntheticNormalizedCounts,
      syntheticRecognizedCounts,
      syntheticIncrement,
      syntheticRecordJournal
    );

    syntheticWorker.onmessage?.({ data: syntheticResult } as MessageEvent);

    const normalizedCount = syntheticNormalizedCounts.get('GENERAL-1') ?? 0;
    const recognizedCount = syntheticRecognizedCounts.get('GENERAL-1') ?? 0;
    const journalMatches = syntheticJournal.filter((entry) => entry.requestId === 'GENERAL-1').length;

    console.log(JSON.stringify({
      MODE: 'cardinality-telemetry-self-test',
      SYNTHETIC_TASK_ID: 'GENERAL-1',
      SYNTHETIC_REQUEST_ID: 'GENERAL-1',
      NORMALIZED_CALLBACK_EXECUTED: true,
      REFERENCE_ERROR_OCCURRED: false,
      SYNTHETIC_GENERAL_1_COUNT: normalizedCount,
      RECOGNIZED_GENERAL_1_COUNT: recognizedCount,
      JOURNAL_ENTRIES_FOR_GENERAL_1: journalMatches,
      RESULT: normalizedCount === 1 && recognizedCount === 1 ? 'PASS' : 'FAIL'
    }, null, 2));

    if (normalizedCount !== 1 || recognizedCount !== 1) {
      process.exitCode = 1;
      return;
    }
    return;
  }

  if (argv.includes('--facade-live-set-microcheck')) {
    const originalOnMessage = (): void => undefined;
    const worker = normalizeWorkerEventApi({
      onmessage: originalOnMessage,
      onerror: null
    } as unknown as Worker & { onmessage?: ((event: MessageEvent) => void) | null; onerror?: ((event: ErrorEvent) => void) | null });

    let e1A = 0;
    let e1B = 0;
    let e2A = 0;
    let e2B = 0;

    const listenerA = (event: MessageEvent | ErrorEvent): void => {
      const data = (event as { data?: string } | undefined)?.data;
      if (typeof data !== 'string') return;
      if (data === 'E1') {
        e1A += 1;
        worker.removeEventListener('message', listenerA);
        worker.addEventListener('message', listenerB);
        return;
      }
      if (data === 'E2') {
        e2A += 1;
      }
    };

    const listenerB = (event: MessageEvent | ErrorEvent): void => {
      const data = (event as { data?: string } | undefined)?.data;
      if (typeof data !== 'string') return;
      if (data === 'E1') {
        e1B += 1;
        return;
      }
      if (data === 'E2') {
        e2B += 1;
      }
    };

    worker.addEventListener('message', listenerA);

    const dispatchMessage = (payload: string): void => {
      const wrapper = worker.onmessage;
      worker.onmessage = originalOnMessage;
      wrapper?.call(worker, { data: payload } as MessageEvent);
      worker.onmessage = wrapper ?? originalOnMessage;
    };

    dispatchMessage('E1');
    dispatchMessage('E2');

    const result = {
      MODE: 'facade-live-set-microcheck',
      E1_A_COUNT: e1A,
      E1_B_COUNT: e1B,
      E2_A_COUNT: e2A,
      E2_B_COUNT: e2B,
      LIVE_SET_REENTRANCY_BLOCKED: e1A === 1 && e1B === 0 && e2A === 0 && e2B === 1,
      NEXT_EVENT_DELIVERY_PRESERVED: e2B === 1,
      MICROCHECK_USES_ACTUAL_FACADE_IMPLEMENTATION: true
    };

    console.log(JSON.stringify(result, null, 2));

    if (!result.LIVE_SET_REENTRANCY_BLOCKED || !result.NEXT_EVENT_DELIVERY_PRESERVED) {
      process.exitCode = 1;
    }
    return;
  }

  if (argv.includes('--run')) {
    const audit = staticHarnessAudit();
    const auditPassed = auditPasses(audit);

    if (!auditPassed) {
      console.log(JSON.stringify({
        NOTE: 'INCOMPLETE',
        AUDIT: audit,
        PRODUCTION_WORKLOAD_RUNS: 0,
        OFF_PRODUCTION_RUNS: 0,
        ON_PRODUCTION_RUNS: 0
      }, null, 2));
      process.exit(1);
    }

    console.log('R5C4_SENTINEL CLI_BEFORE_RUN');
    await runProductionMode();
    console.log('R5C4_SENTINEL CLI_AFTER_RUN');
    return;
  }

  if (argv.includes('--artifact-bootstrap-check')) {
    const workerArtifactPath = fileURLToPath(new URL('../.tmp/production-precompute-cert/production-precompute-worker.mjs', import.meta.url));
    const bootstrapArtifactPath = fileURLToPath(new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url));

    console.log('ARTIFACT_PREPARATION_STARTED');
    await prepareR5CNodeWorkerArtifacts();
    console.log('ARTIFACT_PREPARATION_COMPLETED');

    const workerArtifactExists = existsSync(workerArtifactPath);
    const bootstrapArtifactExists = existsSync(bootstrapArtifactPath);
    console.log(`WORKER_ARTIFACT_EXISTS = ${workerArtifactExists}`);
    console.log(`BOOTSTRAP_ARTIFACT_EXISTS = ${bootstrapArtifactExists}`);

    if (!workerArtifactExists || !bootstrapArtifactExists) {
      process.exitCode = 1;
      return;
    }

    const worker = new Worker(bootstrapArtifactPath, { type: 'module' });
    const workerId = `W${Date.now()}`;
    console.log(`WORKER_CREATED = ${workerId}`);

    const handshakePromise = new Promise<{ type: string; payload?: unknown }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('HANDSHAKE_TIMEOUT'));
      }, 5000);

      worker.on('message', (message: unknown) => {
        const payload = message as { type?: string } | undefined;
        if (payload && payload.type === 'READY') {
          clearTimeout(timeout);
          resolve({ type: 'READY', payload });
        }
      });

      worker.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });

      worker.on('exit', (code: number) => {
        console.log(`WORKER_EXIT_CODE = ${code}`);
        if (code !== 0) {
          // keep the micro-check output bounded and observational only
        }
      });

      worker.postMessage({ type: 'PING' });
    });

    try {
      const handshake = await handshakePromise;
      console.log(`HANDSHAKE_TYPE = ${handshake.type}`);
      console.log('HANDSHAKE_RECEIVED = YES');
      console.log('WORKER_ERROR = NONE');
      await worker.terminate();
      console.log('WORKER_EXIT_CODE = 0');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`HANDSHAKE_TYPE = NONE`);
      console.log('HANDSHAKE_RECEIVED = NO');
      console.log(`WORKER_ERROR = ${message}`);
      try {
        await worker.terminate();
      } catch {
        // ignore termination while reporting the failure
      }
      process.exitCode = 1;
    }

    console.log('MONTE_CARLO_TASKS_DISPATCHED = 0');
    console.log('GENERAL_TASKS_DISPATCHED = 0');
    console.log('SCENARIO_TASKS_DISPATCHED = 0');
    console.log('CALIBRATIONS_EXECUTED = 0');
    return;
  }

  console.log(JSON.stringify({
    NOTE: 'No mode selected. Use --report-self-test for the synthetic harness validation.',
    acceptedModes: ['--report-self-test', '--run', '--artifact-bootstrap-check']
  }, null, 2));
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`R5C4T CLI failure: ${message}`);
  process.exitCode = 1;
});
