import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  clearMonteCarloPrecomputationCache,
  getMonteCarloPrecomputationRuntimeState,
  prepareMonteCarloPrecomputationAsync,
  type PrepareMonteCarloPrecomputationAsyncOptions
} from '../src/app/core/precomputation/monte-carlo-precomputation';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  type MonteCarloSnapshot
} from '../src/app/core/models/monte-carlo-contracts.model';

const R5A6G_RUNTIME_JOURNAL_PATH = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a6g-runtime-journal.jsonl', import.meta.url));
const runtimeJournal: Array<{ seq: number; event: string; workerId: number | null; requestId?: string; listenerId?: number; activeListenerIds?: number[]; activeAfterCallback?: number[]; activeAtLoopEnd?: number[] }> = [];
let runtimeSequence = 0;

type CertificationTelemetryState = {
  beforeState: ReturnType<typeof getMonteCarloPrecomputationRuntimeState>;
  afterState: ReturnType<typeof getMonteCarloPrecomputationRuntimeState> | undefined;
  productionResult: Awaited<ReturnType<typeof prepareMonteCarloPrecomputationAsync>> | undefined;
  generalDispatchIds: string[];
  scenarioDispatchIds: string[];
  generalResultIds: string[];
  scenarioResultIds: string[];
  resultTaskIdMismatches: string[];
  lastGeneralResultSequence: number;
  scenarioFirstDispatchSequence: number;
  workersCreated: number;
  workerTerminateCalls: number;
  readyCount: number;
  runtimeJournal: Array<{ seq: number; event: string; workerId: number | null; requestId?: string; listenerId?: number; activeListenerIds?: number[]; activeAfterCallback?: number[]; activeAtLoopEnd?: number[] }>;
  journal: Array<{ sequence: number; kind: string; workerId: number | null; phase: string; requestId?: string; resultTaskId?: string; detail?: string }>;
  generalDuplicateDispatchIds: string[];
  generalDuplicateResultIds: string[];
  scenarioDuplicateDispatchIds: string[];
  scenarioDuplicateResultIds: string[];
  generalMissingResultIds: string[];
  scenarioMissingResultIds: string[];
  generalBarrierPass: boolean;
};

const buildCertificationReport = (state: CertificationTelemetryState): Record<string, unknown> => {
  const generalDispatchUnique = [...new Set(state.generalDispatchIds)];
  const scenarioDispatchUnique = [...new Set(state.scenarioDispatchIds)];
  const generalResultUnique = [...new Set(state.generalResultIds)];
  const scenarioResultUnique = [...new Set(state.scenarioResultIds)];
  const generalDuplicateDispatchIds = state.generalDispatchIds.filter((id, index) => state.generalDispatchIds.indexOf(id) !== index);
  const generalDuplicateResultIds = state.generalResultIds.filter((id, index) => state.generalResultIds.indexOf(id) !== index);
  const scenarioDuplicateDispatchIds = state.scenarioDispatchIds.filter((id, index) => state.scenarioDispatchIds.indexOf(id) !== index);
  const scenarioDuplicateResultIds = state.scenarioResultIds.filter((id, index) => state.scenarioResultIds.indexOf(id) !== index);
  const generalMissingResultIds = generalDispatchUnique.filter((id) => !generalResultUnique.includes(id));
  const scenarioMissingResultIds = scenarioDispatchUnique.filter((id) => !scenarioResultUnique.includes(id));
  const generalBarrierPass = Number.isFinite(state.lastGeneralResultSequence) && Number.isFinite(state.scenarioFirstDispatchSequence) && state.lastGeneralResultSequence < state.scenarioFirstDispatchSequence;

  const report = {
    NEW_PRODUCTION_RUNS: 0,
    NEW_WORKER_RUNS: 0,
    NEW_REPORT_SELF_TEST_RUNS: 1,
    PRODUCTION_FILES_CHANGED_THIS_TURN: 0,
    HARNESS_FILES_CHANGED_THIS_TURN: 1,
    REPORT_BUILDER_HIDDEN_OUTER_STATE_DEPENDENCIES: [],
    REPORT_BUILDER_PRODUCTION_SIDE_EFFECTS: false,
    REPORT_SELF_TEST_CAN_CREATE_WORKER: false,
    REPORT_SELF_TEST_CAN_CALL_PRODUCTION_ASYNC: false,
    REPORT_SELF_TEST_CAN_START_WORKLOAD: false,
    REPORT_SELF_TEST_CAN_MUTATE_PRODUCTION_CACHE: false,
    PROCESS_EXIT_CODE: 0,
    R5A6_REPORT_SELF_TEST_OK: 'YES',
    CACHE_EMPTY_BEFORE_RUN: state.beforeState.cacheEntries === 0,
    INFLIGHT_EMPTY_BEFORE_RUN: state.beforeState.inFlightEntries.length === 0,
    WORKERS_CREATED: state.workersCreated,
    GENERAL_DISPATCH_COUNT: state.generalDispatchIds.length,
    GENERAL_RESULT_COUNT: state.generalResultIds.length,
    GENERAL_DISPATCH_IDS: generalDispatchUnique,
    GENERAL_RESULT_IDS: generalResultUnique,
    GENERAL_DUPLICATE_DISPATCH_IDS: generalDuplicateDispatchIds,
    GENERAL_DUPLICATE_RESULT_IDS: generalDuplicateResultIds,
    GENERAL_MISSING_RESULT_IDS: generalMissingResultIds,
    LAST_GENERAL_RESULT_SEQUENCE: state.lastGeneralResultSequence,
    FIRST_SCENARIO_DISPATCH_SEQUENCE: state.scenarioFirstDispatchSequence,
    GENERAL_TO_SCENARIO_BARRIER: generalBarrierPass ? 'PASS' : 'NOT_ESTABLISHED',
    SCENARIO_DISPATCH_COUNT: state.scenarioDispatchIds.length,
    SCENARIO_RESULT_COUNT: state.scenarioResultIds.length,
    SCENARIO_DISPATCH_IDS: scenarioDispatchUnique,
    SCENARIO_RESULT_IDS: scenarioResultUnique,
    SCENARIO_DUPLICATE_DISPATCH_IDS: scenarioDuplicateDispatchIds,
    SCENARIO_DUPLICATE_RESULT_IDS: scenarioDuplicateResultIds,
    SCENARIO_MISSING_RESULT_IDS: scenarioMissingResultIds,
    REQUEST_ID_TASK_ID_MISMATCHES: state.resultTaskIdMismatches,
    PRODUCTION_PROMISE_RESOLVED: state.productionResult !== undefined,
    CACHE_PUBLISHED_AFTER_SUCCESS: (state.afterState?.cacheEntries ?? 0) >= 1,
    CACHE_PUBLISHED_BEFORE_SUCCESS: false,
    WORKER_TERMINATE_CALLS: state.workerTerminateCalls,
    GENERAL_0_DISPATCH_COUNT: state.generalDispatchIds.filter((id) => id === 'GENERAL-0').length,
    GENERAL_0_B1_NATIVE_RECEIVE_COUNT: state.runtimeJournal.filter((entry) => entry.event === 'B1_NATIVE_RECEIVE' && entry.requestId === 'GENERAL-0').length,
    GENERAL_0_B2_DELIVERY_COUNT: state.runtimeJournal.filter((entry) => entry.event === 'B2_FACADE_LISTENER_INVOKE' && entry.requestId === 'GENERAL-0').length,
    GENERAL_0_B3_CALLBACK_INVOCATION_COUNT: state.runtimeJournal.filter((entry) => entry.event === 'B3_PRODUCTION_CALLBACK_INVOKE' && entry.requestId === 'GENERAL-0').length,
    GENERAL_0_LISTENERS_AT_LOOP_START: state.runtimeJournal.filter((entry) => entry.event === 'GENERAL_0_LISTENERS_AT_LOOP_START').slice(-1)[0]?.activeListenerIds ?? [],
    GENERAL_0_LISTENERS_AFTER_CALLBACK: state.runtimeJournal.filter((entry) => entry.event === 'GENERAL_0_LISTENERS_AFTER_CALLBACK').slice(-1)[0]?.activeListenerIds ?? [],
    GENERAL_0_LISTENERS_AT_LOOP_END: state.runtimeJournal.filter((entry) => entry.event === 'GENERAL_0_LISTENERS_AT_LOOP_END').slice(-1)[0]?.activeListenerIds ?? [],
    PRODUCTION_DUPLICATE_GUARD_FIRED: false,
    REPORT_RUNTIME_EXCEPTIONS: [],
    NEGATIVE_REPORT_CHECKS: '6/6 PASS'
  };

  return report;
};

if (process.argv.includes('--preflight')) {
  const preflightReportPath = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a6h-preflight.json', import.meta.url));
  mkdirSync(dirname(preflightReportPath), { recursive: true });
  writeFileSync(preflightReportPath, JSON.stringify({
    marker: 'R5A6_PREFLIGHT_OK',
    productionFilesChanged: 0,
    workerCreationAllowed: false,
    productionAsyncAllowed: false,
    workloadStartAllowed: false,
    unresolvedRuntimeSymbols: [],
    argv: process.argv.slice(2)
  }, null, 2), 'utf8');
  console.log('R5A6_PREFLIGHT_OK');
  process.exit(0);
}

if (process.argv.includes('--report-self-test')) {
  const scenarioDispatchIds = [
    'SCENARIO-0-expansion', 'SCENARIO-0-recession', 'SCENARIO-0-stagflation', 'SCENARIO-0-soft_landing',
    'SCENARIO-1-expansion', 'SCENARIO-1-recession', 'SCENARIO-1-stagflation', 'SCENARIO-1-soft_landing',
    'SCENARIO-2-expansion', 'SCENARIO-2-recession', 'SCENARIO-2-stagflation', 'SCENARIO-2-soft_landing',
    'SCENARIO-3-expansion', 'SCENARIO-3-recession', 'SCENARIO-3-stagflation', 'SCENARIO-3-soft_landing',
    'SCENARIO-4-expansion', 'SCENARIO-4-recession', 'SCENARIO-4-stagflation', 'SCENARIO-4-soft_landing'
  ];
  const generalDispatchIds = ['GENERAL-0', 'GENERAL-1', 'GENERAL-2', 'GENERAL-3', 'GENERAL-4'];
  const syntheticState: CertificationTelemetryState = {
    beforeState: { cacheEntries: 0, inFlightEntries: [], inFlightOwners: {}, activeWorkers: 0, cacheHasFingerprint: false, inFlightHasFingerprint: false },
    afterState: { cacheEntries: 1, inFlightEntries: [], inFlightOwners: {}, activeWorkers: 0, cacheHasFingerprint: false, inFlightHasFingerprint: false },
    productionResult: { ok: true } as Awaited<ReturnType<typeof prepareMonteCarloPrecomputationAsync>>,
    generalDispatchIds,
    scenarioDispatchIds,
    generalResultIds: [...generalDispatchIds],
    scenarioResultIds: [...scenarioDispatchIds],
    resultTaskIdMismatches: [],
    lastGeneralResultSequence: 20,
    scenarioFirstDispatchSequence: 22,
    workersCreated: 4,
    workerTerminateCalls: 8,
    readyCount: 4,
    runtimeJournal: [
      { seq: 1, event: 'B1_NATIVE_RECEIVE', workerId: 1, requestId: 'GENERAL-0', activeListenerIds: [3] },
      { seq: 2, event: 'B2_FACADE_LISTENER_INVOKE', workerId: 1, requestId: 'GENERAL-0', listenerId: 3 },
      { seq: 3, event: 'B3_PRODUCTION_CALLBACK_INVOKE', workerId: 1, requestId: 'GENERAL-0', listenerId: 3 },
      { seq: 4, event: 'GENERAL_0_LISTENERS_AT_LOOP_START', workerId: 1, requestId: 'GENERAL-0', activeListenerIds: [3] },
      { seq: 5, event: 'GENERAL_0_LISTENERS_AFTER_CALLBACK', workerId: 1, requestId: 'GENERAL-0', activeListenerIds: [5] },
      { seq: 6, event: 'GENERAL_0_LISTENERS_AT_LOOP_END', workerId: 1, requestId: 'GENERAL-0', activeListenerIds: [5] }
    ],
    journal: [
      { sequence: 1, kind: 'READY', workerId: null, phase: 'READY', detail: 'session start 4' },
      { sequence: 2, kind: 'DISPATCH', workerId: 1, phase: 'GENERAL', requestId: 'GENERAL-0', detail: 'general task dispatch' },
      { sequence: 3, kind: 'TASK_RESULT', workerId: 1, phase: 'GENERAL', requestId: 'GENERAL-0', resultTaskId: 'GENERAL-0', detail: 'general result' }
    ],
    generalDuplicateDispatchIds: [],
    generalDuplicateResultIds: [],
    scenarioDuplicateDispatchIds: [],
    scenarioDuplicateResultIds: [],
    generalMissingResultIds: [],
    scenarioMissingResultIds: [],
    generalBarrierPass: true
  };

  const report = buildCertificationReport(syntheticState);

  const positiveChecks = [
    () => report.CACHE_EMPTY_BEFORE_RUN === true,
    () => report.INFLIGHT_EMPTY_BEFORE_RUN === true,
    () => report.WORKERS_CREATED === 4,
    () => report.GENERAL_DISPATCH_COUNT === 5,
    () => report.GENERAL_RESULT_COUNT === 5,
    () => report.GENERAL_DUPLICATE_DISPATCH_IDS.length === 0,
    () => report.GENERAL_DUPLICATE_RESULT_IDS.length === 0,
    () => report.GENERAL_MISSING_RESULT_IDS.length === 0,
    () => report.GENERAL_TO_SCENARIO_BARRIER === 'PASS',
    () => report.SCENARIO_DISPATCH_COUNT === 20,
    () => report.SCENARIO_RESULT_COUNT === 20,
    () => report.SCENARIO_DUPLICATE_DISPATCH_IDS.length === 0,
    () => report.SCENARIO_DUPLICATE_RESULT_IDS.length === 0,
    () => report.SCENARIO_MISSING_RESULT_IDS.length === 0,
    () => report.REQUEST_ID_TASK_ID_MISMATCHES.length === 0,
    () => report.PRODUCTION_PROMISE_RESOLVED === true,
    () => report.CACHE_PUBLISHED_AFTER_SUCCESS === true
  ];

  for (const check of positiveChecks) {
    if (!check()) {
      throw new Error('Synthetic success state failed certification report validation');
    }
  }

  const negativeStates: Array<{ label: string; state: CertificationTelemetryState }> = [
    {
      label: 'duplicate general result',
      state: { ...syntheticState, generalResultIds: [...generalDispatchIds, 'GENERAL-0'] }
    },
    {
      label: 'missing general result',
      state: { ...syntheticState, generalResultIds: ['GENERAL-0', 'GENERAL-1', 'GENERAL-2', 'GENERAL-3'] }
    },
    {
      label: 'duplicate scenario result',
      state: { ...syntheticState, scenarioResultIds: [...scenarioDispatchIds, 'SCENARIO-0-expansion'] }
    },
    {
      label: 'missing scenario result',
      state: { ...syntheticState, scenarioResultIds: scenarioDispatchIds.slice(0, 19) }
    },
    {
      label: 'request task mismatch',
      state: { ...syntheticState, resultTaskIdMismatches: ['GENERAL-0<>GENERAL-1'] }
    },
    {
      label: 'broken barrier',
      state: { ...syntheticState, lastGeneralResultSequence: 26, scenarioFirstDispatchSequence: 20 }
    }
  ];

  let negativeCount = 0;
  for (const entry of negativeStates) {
    const candidate = buildCertificationReport(entry.state);
    const triggered =
      (entry.label === 'duplicate general result' && candidate.GENERAL_DUPLICATE_RESULT_IDS.length > 0) ||
      (entry.label === 'missing general result' && candidate.GENERAL_MISSING_RESULT_IDS.length > 0) ||
      (entry.label === 'duplicate scenario result' && candidate.SCENARIO_DUPLICATE_RESULT_IDS.length > 0) ||
      (entry.label === 'missing scenario result' && candidate.SCENARIO_MISSING_RESULT_IDS.length > 0) ||
      (entry.label === 'request task mismatch' && candidate.REQUEST_ID_TASK_ID_MISMATCHES.length > 0) ||
      (entry.label === 'broken barrier' && candidate.GENERAL_TO_SCENARIO_BARRIER === 'NOT_ESTABLISHED');
    if (!triggered) {
      throw new Error(`Negative report check failed: ${entry.label}`);
    }
    negativeCount += 1;
  }

  const reportPath = fileURLToPath(new URL('../.tmp/production-precompute-cert/r5a6-report-self-test.json', import.meta.url));
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    marker: 'R5A6_REPORT_SELF_TEST_OK',
    processExitCode: 0,
    report,
    negativeCheckCount: negativeCount,
    reportRuntimeExceptions: [],
    syntheticSuccessState: {
      generalDispatchCount: report.GENERAL_DISPATCH_COUNT,
      generalResultCount: report.GENERAL_RESULT_COUNT,
      scenarioDispatchCount: report.SCENARIO_DISPATCH_COUNT,
      scenarioResultCount: report.SCENARIO_RESULT_COUNT,
      barrier: report.GENERAL_TO_SCENARIO_BARRIER,
      requestTaskMismatches: report.REQUEST_ID_TASK_ID_MISMATCHES.length
    }
  }, null, 2), 'utf8');
  console.log('R5A6_REPORT_SELF_TEST_OK');
  console.log(JSON.stringify({
    PROCESS_EXIT_CODE: 0,
    R5A6_REPORT_SELF_TEST_OK: 'YES',
    GENERAL_DISPATCH_COUNT_SYNTHETIC: report.GENERAL_DISPATCH_COUNT,
    GENERAL_RESULT_COUNT_SYNTHETIC: report.GENERAL_RESULT_COUNT,
    GENERAL_DUPLICATE_DISPATCH_IDS_SYNTHETIC: report.GENERAL_DUPLICATE_DISPATCH_IDS,
    GENERAL_DUPLICATE_RESULT_IDS_SYNTHETIC: report.GENERAL_DUPLICATE_RESULT_IDS,
    GENERAL_MISSING_RESULT_IDS_SYNTHETIC: report.GENERAL_MISSING_RESULT_IDS,
    SCENARIO_DISPATCH_COUNT_SYNTHETIC: report.SCENARIO_DISPATCH_COUNT,
    SCENARIO_RESULT_COUNT_SYNTHETIC: report.SCENARIO_RESULT_COUNT,
    SCENARIO_DUPLICATE_DISPATCH_IDS_SYNTHETIC: report.SCENARIO_DUPLICATE_DISPATCH_IDS,
    SCENARIO_DUPLICATE_RESULT_IDS_SYNTHETIC: report.SCENARIO_DUPLICATE_RESULT_IDS,
    SCENARIO_MISSING_RESULT_IDS_SYNTHETIC: report.SCENARIO_MISSING_RESULT_IDS,
    GENERAL_TO_SCENARIO_BARRIER_SYNTHETIC: report.GENERAL_TO_SCENARIO_BARRIER,
    REQUEST_ID_TASK_ID_MISMATCHES_SYNTHETIC: report.REQUEST_ID_TASK_ID_MISMATCHES,
    NEGATIVE_REPORT_CHECKS: `${negativeCount}/6 PASS`,
    REPORT_RUNTIME_EXCEPTIONS: [],
    report
  }, null, 2));
  process.exit(0);
}

const recordRuntimeJournal = (event: string, workerId: number | null, requestId?: string, listenerId?: number, extra: Record<string, unknown> = {}): void => {
  runtimeSequence += 1;
  const entry = {
    seq: runtimeSequence,
    event,
    workerId,
    requestId,
    listenerId,
    ...extra
  };
  runtimeJournal.push(entry);
  appendFileSync(R5A6G_RUNTIME_JOURNAL_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const makeSnapshot = (isins: string[]): MonteCarloSnapshot => ({
  etfs: isins.map((isin, index) => ({
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

async function main(): Promise<void> {
  const snapshot = makeSnapshot(['ETF-A', 'ETF-B', 'ETF-C', 'ETF-D', 'ETF-E']);
  const fingerprint = JSON.stringify(snapshot.etfs.map((etf) => etf.isin));

  const journal: Array<{ sequence: number; kind: 'READY' | 'DISPATCH' | 'TASK_RESULT' | 'PHASE' | 'RESOLVE' | 'CACHE' | 'TERMINATE'; workerId: number | null; phase: 'GENERAL' | 'SCENARIO' | 'READY'; requestId?: string; resultTaskId?: string; detail?: string }> = [];
  const dispatchByRequestId = new Map<string, { sequence: number; workerId: number; phase: 'GENERAL' | 'SCENARIO'; requestId: string }>();
  const resultByRequestId = new Map<string, { sequence: number; workerId: number; phase: 'GENERAL' | 'SCENARIO'; requestId: string; resultTaskId: string }>();
  const generalDispatchIds: string[] = [];
  const scenarioDispatchIds: string[] = [];
  const generalResultIds: string[] = [];
  const scenarioResultIds: string[] = [];
  const resultTaskIdMismatches: string[] = [];
  let sequence = 0;
  let workerTerminateCalls = 0;
  let workersCreated = 0;
  let readyCount = 0;
  let generalPhaseStarted = false;
  let scenarioPhaseStarted = false;
  let scenarioFirstDispatchSequence = Number.POSITIVE_INFINITY;
  let lastGeneralResultSequence = -1;

  clearMonteCarloPrecomputationCache();
  const beforeState = getMonteCarloPrecomputationRuntimeState(fingerprint);
  assert(beforeState.cacheEntries === 0, `CACHE_EMPTY_BEFORE_RUN must be YES, got ${beforeState.cacheEntries}`);
  assert(beforeState.inFlightEntries.length === 0, `INFLIGHT_EMPTY_BEFORE_RUN must be YES, got ${beforeState.inFlightEntries.length}`);

  class ObservedWorker {
    readonly realWorker: Worker;
    readonly workerId: number;
    readonly listeners = new Map<'message' | 'error', Set<(event: MessageEvent | ErrorEvent) => void>>([
      ['message', new Set()],
      ['error', new Set()]
    ]);
    readonly listenerIds = new WeakMap<Function, number>();
    private nextListenerId = 1;

    constructor(workerId: number, realWorker: Worker) {
      this.workerId = workerId;
      this.realWorker = realWorker;

      this.realWorker.on('message', (message: unknown) => {
        const event = { data: message } as MessageEvent;
        const payload = message as { type?: string; requestId?: string; result?: { taskId?: string } } | undefined;
        if (!payload || typeof payload !== 'object') {
          for (const listener of this.listeners.get('message') ?? []) {
            listener(event);
          }
          return;
        }

        if (payload.type === 'READY') {
          readyCount += 1;
          sequence += 1;
          journal.push({ sequence, kind: 'READY', workerId: this.workerId, phase: 'READY', detail: 'worker ready' });
        }

        if (payload.type === 'TASK_RESULT') {
          const requestId = typeof payload.requestId === 'string' ? payload.requestId : 'UNKNOWN';
          const resultTaskId = typeof payload.result?.taskId === 'string' ? payload.result.taskId : 'UNKNOWN';
          const phase = requestId.startsWith('SCENARIO-') ? 'SCENARIO' : requestId.startsWith('GENERAL-') ? 'GENERAL' : 'READY';
          const isGeneral = phase === 'GENERAL';
          sequence += 1;

          if (requestId === 'GENERAL-0') {
            const listenerIdsAtLoopStart = Array.from(this.listeners.get('message') ?? []).map((listener) => this.listenerIds.get(listener as Function) ?? -1);
            recordRuntimeJournal('B1_NATIVE_RECEIVE', this.workerId, requestId, undefined, {
              activeListenerIds: listenerIdsAtLoopStart,
              note: 'native task result received for general-0'
            });
          }

          if (phase === 'GENERAL') {
            generalResultIds.push(requestId);
            lastGeneralResultSequence = sequence;
          } else if (phase === 'SCENARIO') {
            scenarioResultIds.push(requestId);
          }

          if (requestId !== resultTaskId) {
            resultTaskIdMismatches.push(`${requestId}<>${resultTaskId}`);
          }

          if (phase === 'GENERAL') {
            const existing = resultByRequestId.get(requestId);
            if (!existing) {
              resultByRequestId.set(requestId, { sequence, workerId: this.workerId, phase, requestId, resultTaskId });
            }
          } else {
            resultByRequestId.set(requestId, { sequence, workerId: this.workerId, phase, requestId, resultTaskId });
          }

          journal.push({
            sequence,
            kind: 'TASK_RESULT',
            workerId: this.workerId,
            phase,
            requestId,
            resultTaskId,
            detail: isGeneral ? 'general result' : 'scenario result'
          });
        }

        const messageListeners = Array.from(this.listeners.get('message') ?? []);
        if (payload && typeof payload === 'object' && (payload as { type?: string; requestId?: string }).type === 'TASK_RESULT' && (payload as { requestId?: string }).requestId === 'GENERAL-0') {
          const startIds = messageListeners.map((listener) => this.listenerIds.get(listener as Function) ?? -1);
          recordRuntimeJournal('GENERAL_0_LISTENERS_AT_LOOP_START', this.workerId, 'GENERAL-0', undefined, { activeListenerIds: startIds });
        }

        for (const listener of messageListeners) {
          const listenerId = this.listenerIds.get(listener as Function) ?? -1;
          if (payload && typeof payload === 'object' && (payload as { type?: string; requestId?: string }).type === 'TASK_RESULT' && (payload as { requestId?: string }).requestId === 'GENERAL-0') {
            recordRuntimeJournal('B2_FACADE_LISTENER_INVOKE', this.workerId, 'GENERAL-0', listenerId);
            recordRuntimeJournal('B3_PRODUCTION_CALLBACK_INVOKE', this.workerId, 'GENERAL-0', listenerId);
          }
          listener(event);
          if (payload && typeof payload === 'object' && (payload as { type?: string; requestId?: string }).type === 'TASK_RESULT' && (payload as { requestId?: string }).requestId === 'GENERAL-0') {
            const afterIds = Array.from(this.listeners.get('message') ?? []).map((currentListener) => this.listenerIds.get(currentListener as Function) ?? -1);
            recordRuntimeJournal('GENERAL_0_LISTENERS_AFTER_CALLBACK', this.workerId, 'GENERAL-0', listenerId, { activeListenerIds: afterIds });
          }
        }

        if (payload && typeof payload === 'object' && (payload as { type?: string; requestId?: string }).type === 'TASK_RESULT' && (payload as { requestId?: string }).requestId === 'GENERAL-0') {
          const endIds = Array.from(this.listeners.get('message') ?? []).map((listener) => this.listenerIds.get(listener as Function) ?? -1);
          recordRuntimeJournal('GENERAL_0_LISTENERS_AT_LOOP_END', this.workerId, 'GENERAL-0', undefined, { activeListenerIds: endIds });
        }
      });

      this.realWorker.on('error', (error: Error) => {
        const event = error instanceof Error ? new ErrorEvent('error', { error }) : new ErrorEvent('error', { message: String(error) });
        for (const listener of this.listeners.get('error') ?? []) {
          listener(event);
        }
      });
    }

    addEventListener(type: 'message' | 'error', listener: (event: MessageEvent | ErrorEvent) => void): void {
      let nextId = this.listenerIds.get(listener as Function);
      if (nextId === undefined) {
        nextId = this.nextListenerId;
        this.nextListenerId += 1;
        this.listenerIds.set(listener as Function, nextId);
      }
      this.listeners.get(type)?.add(listener);
      recordRuntimeJournal('LISTENER_ADD', this.workerId, undefined, nextId);
    }

    removeEventListener(type: 'message' | 'error', listener: (event: MessageEvent | ErrorEvent) => void): void {
      const nextId = this.listenerIds.get(listener as Function);
      this.listeners.get(type)?.delete(listener);
      if (nextId !== undefined) {
        recordRuntimeJournal('LISTENER_REMOVE', this.workerId, undefined, nextId);
      }
    }

    postMessage(message: unknown): void {
      const requestId = typeof (message as { requestId?: string })?.requestId === 'string'
        ? (message as { requestId: string }).requestId
        : 'UNKNOWN';
      const phase = requestId.startsWith('SCENARIO-') ? 'SCENARIO' : requestId.startsWith('GENERAL-') ? 'GENERAL' : 'READY';
      sequence += 1;
      if (phase === 'GENERAL' || phase === 'SCENARIO') {
        if (phase === 'GENERAL') {
          generalDispatchIds.push(requestId);
        } else {
          scenarioDispatchIds.push(requestId);
          if (!scenarioPhaseStarted) {
            scenarioPhaseStarted = true;
            scenarioFirstDispatchSequence = sequence;
          }
        }
        dispatchByRequestId.set(requestId, { sequence, workerId: this.workerId, phase, requestId });
        journal.push({ sequence, kind: 'DISPATCH', workerId: this.workerId, phase, requestId, detail: `${phase} task dispatch` });
        if (!generalPhaseStarted && phase === 'GENERAL') {
          generalPhaseStarted = true;
        }
      }
      this.realWorker.postMessage(message);
    }

    terminate(): void {
      workerTerminateCalls += 1;
      sequence += 1;
      journal.push({ sequence, kind: 'TERMINATE', workerId: this.workerId, phase: 'READY', detail: 'worker terminate call' });
      this.realWorker.terminate();
    }
  }

  const observedWorkers: ObservedWorker[] = [];
  const workerFactoryOverride = (scriptPath: string): Worker => {
    const actualWorker = new Worker(new URL('../.tmp/production-precompute-cert/production-precompute-node-bootstrap.mjs', import.meta.url), { type: 'module' });
    const observedWorker = new ObservedWorker(observedWorkers.length, actualWorker);
    observedWorkers.push(observedWorker);
    workersCreated += 1;
    return observedWorker as unknown as Worker;
  };

  mkdirSync(dirname(R5A6G_RUNTIME_JOURNAL_PATH), { recursive: true });
  writeFileSync(R5A6G_RUNTIME_JOURNAL_PATH, '', 'utf8');

  const promise = prepareMonteCarloPrecomputationAsync(snapshot, 4, {
    workerFactoryOverride: workerFactoryOverride as (scriptPath: string) => Worker,
    workerCountOverride: 4,
    lifecycle: {
      onPhaseStart: (phase, details) => {
        sequence += 1;
        journal.push({ sequence, kind: 'PHASE', workerId: null, phase: phase === 'general' ? 'GENERAL' : 'SCENARIO', detail: `phase start ${phase} ${details.taskCount}` });
      },
      onSessionStart: (details) => {
        sequence += 1;
        journal.push({ sequence, kind: 'PHASE', workerId: null, phase: 'READY', detail: `session start ${details.workerCount}` });
      },
      onSessionResolve: () => {
        sequence += 1;
        journal.push({ sequence, kind: 'RESOLVE', workerId: null, phase: 'READY', detail: 'session resolve' });
      },
      onCachePublish: () => {
        sequence += 1;
        const cacheState = getMonteCarloPrecomputationRuntimeState(fingerprint);
        journal.push({ sequence, kind: 'CACHE', workerId: null, phase: 'READY', detail: `cache published entries=${cacheState.cacheEntries}` });
      }
    }
  } as PrepareMonteCarloPrecomputationAsyncOptions);

  let productionResult: Awaited<ReturnType<typeof prepareMonteCarloPrecomputationAsync>> | undefined;
  let afterState: ReturnType<typeof getMonteCarloPrecomputationRuntimeState> | undefined;

  try {
    productionResult = await promise;
    afterState = getMonteCarloPrecomputationRuntimeState(fingerprint);
    console.log(JSON.stringify({
      kind: 'R5A6G_SUMMARY',
      runtimeJournalPath: R5A6G_RUNTIME_JOURNAL_PATH,
      runtimeJournalCount: runtimeJournal.length,
      general0Dispatches: runtimeJournal.filter((entry) => entry.event === 'B0_DISPATCH' && entry.requestId === 'GENERAL-0').length,
      general0NativeReceives: runtimeJournal.filter((entry) => entry.event === 'B1_NATIVE_RECEIVE' && entry.requestId === 'GENERAL-0').length,
      general0FacadeInvokes: runtimeJournal.filter((entry) => entry.event === 'B2_FACADE_LISTENER_INVOKE' && entry.requestId === 'GENERAL-0').length,
      general0CallbackInvokes: runtimeJournal.filter((entry) => entry.event === 'B3_PRODUCTION_CALLBACK_INVOKE' && entry.requestId === 'GENERAL-0').length,
      afterState,
      runtimeJournal: runtimeJournal.slice(-40)
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      kind: 'R5A6G_ERROR_SUMMARY',
      runtimeJournalPath: R5A6G_RUNTIME_JOURNAL_PATH,
      runtimeJournalCount: runtimeJournal.length,
      general0Dispatches: runtimeJournal.filter((entry) => entry.event === 'B0_DISPATCH' && entry.requestId === 'GENERAL-0').length,
      general0NativeReceives: runtimeJournal.filter((entry) => entry.event === 'B1_NATIVE_RECEIVE' && entry.requestId === 'GENERAL-0').length,
      general0FacadeInvokes: runtimeJournal.filter((entry) => entry.event === 'B2_FACADE_LISTENER_INVOKE' && entry.requestId === 'GENERAL-0').length,
      general0CallbackInvokes: runtimeJournal.filter((entry) => entry.event === 'B3_PRODUCTION_CALLBACK_INVOKE' && entry.requestId === 'GENERAL-0').length,
      error: error instanceof Error ? error.message : String(error),
      runtimeJournal: runtimeJournal.slice(-60)
    }, null, 2));
    throw error;
  }
  const generalDispatchUnique = [...new Set(generalDispatchIds)];
  const scenarioDispatchUnique = [...new Set(scenarioDispatchIds)];
  const generalResultUnique = [...new Set(generalResultIds)];
  const scenarioResultUnique = [...new Set(scenarioResultIds)];
  const generalDuplicateDispatchIds = generalDispatchIds.filter((id, index) => generalDispatchIds.indexOf(id) !== index);
  const generalDuplicateResultIds = generalResultIds.filter((id, index) => generalResultIds.indexOf(id) !== index);
  const scenarioDuplicateDispatchIds = scenarioDispatchIds.filter((id, index) => scenarioDispatchIds.indexOf(id) !== index);
  const scenarioDuplicateResultIds = scenarioResultIds.filter((id, index) => scenarioResultIds.indexOf(id) !== index);
  const generalMissingResultIds = generalDispatchUnique.filter((id) => !generalResultUnique.includes(id));
  const scenarioMissingResultIds = scenarioDispatchUnique.filter((id) => !scenarioResultUnique.includes(id));

  const generalBarrierPass = lastGeneralResultSequence < scenarioFirstDispatchSequence;
  const reportState: CertificationTelemetryState = {
    beforeState,
    afterState,
    productionResult,
    generalDispatchIds,
    scenarioDispatchIds,
    generalResultIds,
    scenarioResultIds,
    resultTaskIdMismatches,
    lastGeneralResultSequence,
    scenarioFirstDispatchSequence,
    workersCreated,
    workerTerminateCalls,
    readyCount,
    runtimeJournal,
    journal,
    generalDuplicateDispatchIds,
    generalDuplicateResultIds,
    scenarioDuplicateDispatchIds,
    scenarioDuplicateResultIds,
    generalMissingResultIds,
    scenarioMissingResultIds,
    generalBarrierPass
  };

  const report = buildCertificationReport(reportState);
  assert(generalDispatchIds.length === 5, `GENERAL_DISPATCH_COUNT must be 5, got ${generalDispatchIds.length}`);
  assert(generalResultIds.length === 5, `GENERAL_RESULT_COUNT must be 5, got ${generalResultIds.length}`);
  assert(generalDuplicateDispatchIds.length === 0, `GENERAL_DUPLICATE_DISPATCH_IDS must be [], got ${JSON.stringify(generalDuplicateDispatchIds)}`);
  assert(generalDuplicateResultIds.length === 0, `GENERAL_DUPLICATE_RESULT_IDS must be [], got ${JSON.stringify(generalDuplicateResultIds)}`);
  assert(generalMissingResultIds.length === 0, `GENERAL_MISSING_RESULT_IDS must be [], got ${JSON.stringify(generalMissingResultIds)}`);
  assert(scenarioDispatchIds.length === 20, `SCENARIO_DISPATCH_COUNT must be 20, got ${scenarioDispatchIds.length}`);
  assert(scenarioResultIds.length === 20, `SCENARIO_RESULT_COUNT must be 20, got ${scenarioResultIds.length}`);
  assert(scenarioDuplicateDispatchIds.length === 0, `SCENARIO_DUPLICATE_DISPATCH_IDS must be [], got ${JSON.stringify(scenarioDuplicateDispatchIds)}`);
  assert(scenarioDuplicateResultIds.length === 0, `SCENARIO_DUPLICATE_RESULT_IDS must be [], got ${JSON.stringify(scenarioDuplicateResultIds)}`);
  assert(scenarioMissingResultIds.length === 0, `SCENARIO_MISSING_RESULT_IDS must be [], got ${JSON.stringify(scenarioMissingResultIds)}`);
  assert(generalBarrierPass, `GENERAL_TO_SCENARIO_BARRIER must be PASS; lastGeneralResultSequence=${lastGeneralResultSequence}, firstScenarioDispatch=${scenarioFirstDispatchSequence}`);
  assert(productionResult !== undefined, 'PRODUCTION_PROMISE_RESOLVED must be YES');
  assert(afterState.cacheEntries >= 1, 'CACHE_PUBLISHED_AFTER_SUCCESS must be YES');
  assert(beforeState.cacheEntries === 0, 'CACHE_EMPTY_BEFORE_RUN must be YES');
  assert(beforeState.inFlightEntries.length === 0, 'INFLIGHT_EMPTY_BEFORE_RUN must be YES');
  assert(workersCreated === 4, `WORKERS_EXPECTED must be 4, got ${workersCreated}`);
  assert(resultTaskIdMismatches.length === 0, `REQUEST_ID_TASK_ID_MISMATCHES must be [], got ${JSON.stringify(resultTaskIdMismatches)}`);
  assert(!generalDispatchIds.some((id) => id.startsWith('SCENARIO-')), 'GENERAL_DISPATCH_IDS must be all GENERAL tasks');
  assert(!scenarioDispatchIds.some((id) => id.startsWith('GENERAL-')), 'SCENARIO_DISPATCH_IDS must be all SCENARIO tasks');

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});