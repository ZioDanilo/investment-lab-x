import {
  buildMuCalibrationCurve,
  clearMonteCarloPrecomputationCache,
  precomputeEtfScenarioParameters,
  prepareMonteCarloPrecomputationAsync,
  type PrepareMonteCarloPrecomputationAsyncOptions
} from '../src/app/core/precomputation/monte-carlo-precomputation';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  type MonteCarloSnapshot
} from '../src/app/core/models/monte-carlo-contracts.model';

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const toStableJson = (value: unknown): string => JSON.stringify(value);

class FakeWorker {
  readonly id: number;
  readonly listeners = new Map<'message' | 'error', Set<(event: any) => void>>([
    ['message', new Set()],
    ['error', new Set()]
  ]);
  readonly assignments: Array<{ workerId: number; requestId: string }> = [];
  readonly completionPlan: Record<string, number>;
  activeTasks = 0;
  maxSimultaneousTasks = 0;
  maxFinalizeListenerCount = 0;
  readonly transitionLog: Array<{ previousCompletedTask: string | null; previousWorker: number | null; nextQueuedTask: string | null; nextWorker: number | null }> = [];
  private lastCompletedTaskByWorker = new Map<number, string>();

  constructor(id: number, completionPlan: Record<string, number>) {
    this.id = id;
    this.completionPlan = completionPlan;
  }

  addEventListener(type: 'message' | 'error', listener: (event: any) => void): void {
    this.listeners.get(type)?.add(listener);
    if (type === 'message') {
      this.maxFinalizeListenerCount = Math.max(this.maxFinalizeListenerCount, this.listeners.get('message')?.size ?? 0);
    }
  }

  removeEventListener(type: 'message' | 'error', listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: 'message' | 'error', event: any): void {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const listener of listeners) {
      listener(event);
    }
  }

  postMessage(message: any): void {
    if (message.type === 'PING') {
      setTimeout(() => this.emit('message', { data: { type: 'READY' } }), 0);
      return;
    }

    const requestId = message.requestId ?? 'UNKNOWN';
    this.assignments.push({ workerId: this.id, requestId });
    this.activeTasks += 1;
    this.maxSimultaneousTasks = Math.max(this.maxSimultaneousTasks, this.activeTasks);

    const delay = this.completionPlan[requestId] ?? 10;
    setTimeout(() => {
      this.activeTasks = Math.max(0, this.activeTasks - 1);
      this.lastCompletedTaskByWorker.set(this.id, requestId);

      const statistics = message.etf?.statistics ?? {};
      const generalParameters = precomputeEtfScenarioParameters(statistics.general, 'GENERAL');

      if (message.type === 'GENERAL_TASK') {
        this.emit('message', {
          data: {
            type: 'TASK_RESULT',
            requestId,
            result: {
              taskId: requestId,
              etfIndex: message.etfIndex ?? 0,
              generalParameters
            }
          }
        });
        return;
      }

      if (!message.scenario) {
        throw new Error('SCENARIO_TASK requires a scenario');
      }
      const scenarioParameters = precomputeEtfScenarioParameters(statistics[message.scenario], 'SCENARIO');
      const curve = buildMuCalibrationCurve(generalParameters, scenarioParameters, 0.01, message.shockGrid ?? []);
      this.emit('message', {
        data: {
          type: 'TASK_RESULT',
          requestId,
          result: {
            taskId: requestId,
            etfIndex: message.etfIndex ?? 0,
            scenario: message.scenario,
            scenarioParameters: {
              ...scenarioParameters,
              generalMonthlyExpectedReturn: generalParameters.monthlyExpectedReturn,
              generalMonthlyVolatility: generalParameters.monthlyVolatility,
              muCalibrationByIntensity: curve
            },
            curve
          }
        }
      });
    }, delay);
  }

  terminate(): void {
    return;
  }
}

const createSnapshot = (isins: string[]): MonteCarloSnapshot => ({
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

const runHarnessSelfCheck = (): void => {
  const worker = new FakeWorker(0, {});
  const visited: string[] = [];
  const listenerB = (event: any): void => {
    visited.push(`B:${event.data}`);
  };
  const listenerA = (event: any): void => {
    visited.push(`A:${event.data}`);
    if (event.data === 'E') {
      worker.removeEventListener('message', listenerA);
      worker.addEventListener('message', listenerB);
    }
  };

  worker.addEventListener('message', listenerA);
  worker.emit('message', { data: 'E' });
  assert(visited.includes('A:E'), 'SELF_CHECK: listener A should receive E');
  assert(!visited.includes('B:E'), 'SELF_CHECK: listener B must not receive the current dispatch event');
  worker.emit('message', { data: 'E2' });
  assert(visited.includes('B:E2'), 'SELF_CHECK: listener B should receive E2 exactly once');
  assert(visited.filter((entry) => entry.startsWith('B:')).length === 1, 'SELF_CHECK: B should not receive E twice');
  console.log('EVENTTARGET_SNAPSHOT_SELF_CHECK=PASS');
};

const runWithPlan = async (
  snapshot: MonteCarloSnapshot,
  workerCount: number,
  completionPlan: Record<string, number>,
  label: string
): Promise<{ assignments: Array<{ workerId: number; requestId: string }>; result: any; maxSimultaneousTasksPerWorker: number; maxFinalizeListenersPerWorker: number; allTaskIds: string[]; workers: FakeWorker[] }> => {
  clearMonteCarloPrecomputationCache();
  const workers: FakeWorker[] = [];
  const response = await prepareMonteCarloPrecomputationAsync(snapshot, workerCount, {
    workerFactoryOverride: (scriptPath: string) => {
      const worker = new FakeWorker(workers.length, completionPlan);
      workers.push(worker);
      return worker as unknown as Worker;
    },
    workerCountOverride: workerCount
  } as PrepareMonteCarloPrecomputationAsyncOptions);

  const assignments = workers.flatMap((worker) => worker.assignments);
  const maxSimultaneousTasksPerWorker = Math.max(...workers.map((worker) => worker.maxSimultaneousTasks), 0);
  const maxFinalizeListenersPerWorker = Math.max(...workers.map((worker) => worker.maxFinalizeListenerCount), 0);
  const allTaskIds = assignments.map((assignment) => assignment.requestId);

  console.log(`${label}: assignments=${JSON.stringify(assignments)} maxSimultaneous=${maxSimultaneousTasksPerWorker} maxFinalizeListeners=${maxFinalizeListenersPerWorker}`);
  return { assignments, result: response, maxSimultaneousTasksPerWorker, maxFinalizeListenersPerWorker, allTaskIds, workers };
};

const T1 = async (): Promise<void> => {
  const snapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C']);
  const outcome = await runWithPlan(snapshot, 2, { 'GENERAL-0': 30, 'GENERAL-1': 5, 'GENERAL-2': 15 }, 'T1');
  assert(outcome.assignments.some((assignment) => assignment.workerId === 0 && assignment.requestId === 'GENERAL-0'), 'T1: GENERAL-0 must start on worker0');
  assert(outcome.assignments.some((assignment) => assignment.workerId === 1 && assignment.requestId === 'GENERAL-1'), 'T1: GENERAL-1 must start on worker1');
  assert(outcome.assignments.some((assignment) => assignment.workerId === 1 && assignment.requestId === 'GENERAL-2'), 'T1: GENERAL-2 must be reassigned to the just-freed worker1');
  assert(!outcome.assignments.some((assignment) => assignment.workerId === 0 && assignment.requestId === 'GENERAL-2'), 'T1: GENERAL-2 must not go to worker0');
  console.log('T1=PASS');
};

const T2 = async (): Promise<void> => {
  const snapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C', 'ETF-D', 'ETF-E']);
  const outcome = await runWithPlan(snapshot, 4, { 'GENERAL-0': 40, 'GENERAL-1': 40, 'GENERAL-2': 5, 'GENERAL-3': 40, 'GENERAL-4': 15 }, 'T2');
  assert(outcome.assignments.some((assignment) => assignment.workerId === 2 && assignment.requestId === 'GENERAL-4'), 'T2: GENERAL-4 must be assigned to worker2');
  assert(!outcome.assignments.some((assignment) => assignment.workerId === 0 && assignment.requestId === 'GENERAL-4'), 'T2: GENERAL-4 must not go to worker0');
  console.log('T2=PASS');
};

const T3 = async (): Promise<void> => {
  const snapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C', 'ETF-D', 'ETF-E', 'ETF-F']);
  const completionPlan: Record<string, number> = {
    'GENERAL-0': 60,
    'GENERAL-1': 10,
    'GENERAL-2': 30,
    'GENERAL-3': 20,
    'GENERAL-4': 50,
    'GENERAL-5': 40
  };
  const outcome = await runWithPlan(snapshot, 3, completionPlan, 'T3');
  const transitions: Array<{ previousCompletedTask: string | null; previousWorker: number | null; nextQueuedTask: string | null; nextWorker: number | null }> = [];
  const assignmentOrder = outcome.assignments;
  for (let index = 0; index < assignmentOrder.length - 1; index += 1) {
    const current = assignmentOrder[index];
    const next = assignmentOrder[index + 1];
    if (current.workerId === next.workerId) {
      transitions.push({
        previousCompletedTask: current.requestId,
        previousWorker: current.workerId,
        nextQueuedTask: next.requestId,
        nextWorker: next.workerId
      });
    }
  }
  assert(transitions.length > 0, 'T3: expected at least one reschedule transition');
  for (const transition of transitions) {
    assert(transition.previousWorker === transition.nextWorker, `T3: next task must be assigned to the same freed worker ${transition.nextWorker ?? 'unknown'}`);
  }
  console.log('T3=PASS');
};

const T4 = async (): Promise<void> => {
  const snapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C']);
  const outcome = await runWithPlan(snapshot, 2, { 'GENERAL-0': 50, 'GENERAL-1': 10, 'GENERAL-2': 20 }, 'T4');
  assert(outcome.maxSimultaneousTasksPerWorker <= 1, `T4: max simultaneous tasks per worker must be 1, got ${outcome.maxSimultaneousTasksPerWorker}`);
  console.log('T4=PASS');
};

const T5 = async (): Promise<void> => {
  const snapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C']);
  const outcome = await runWithPlan(snapshot, 2, { 'GENERAL-0': 40, 'GENERAL-1': 10, 'GENERAL-2': 20 }, 'T5');
  assert(outcome.maxFinalizeListenersPerWorker <= 1, `T5: finalize listener count >1 detected on a worker, got ${outcome.maxFinalizeListenersPerWorker}`);
  console.log('T5=PASS');
};

const T6 = async (): Promise<void> => {
  const snapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C']);
  const canonical = await runWithPlan(snapshot, 2, { 'GENERAL-0': 10, 'GENERAL-1': 25, 'GENERAL-2': 40 }, 'T6-A');
  const reverse = await runWithPlan(snapshot, 2, { 'GENERAL-0': 40, 'GENERAL-1': 25, 'GENERAL-2': 10 }, 'T6-B');
  const canonicalTaskIds = [...new Set(canonical.allTaskIds)].sort();
  const reverseTaskIds = [...new Set(reverse.allTaskIds)].sort();
  assert(toStableJson(canonicalTaskIds) === toStableJson(reverseTaskIds), 'T6: task sets differ across completion-order variants');
  assert(canonical.allTaskIds.length === new Set(canonical.allTaskIds).size, 'T6: canonical output has duplicates');
  assert(reverse.allTaskIds.length === new Set(reverse.allTaskIds).size, 'T6: reverse output has duplicates');
  assert(toStableJson(canonical.result) === toStableJson(reverse.result), 'T6: canonical assembled output differs across completion order');
  console.log('T6=PASS');
};

const T7 = async (): Promise<void> => {
  const baseSnapshot = createSnapshot(['ETF-A', 'ETF-B', 'ETF-C', 'ETF-D']);
  const uniqueFingerprintSeed = `T7-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const uniqueSnapshot: MonteCarloSnapshot = {
    ...baseSnapshot,
    etfs: baseSnapshot.etfs.map((etf, etfIndex) => ({
      ...etf,
      isin: `${etf.isin}-${uniqueFingerprintSeed}-${etfIndex}`,
      name: `${etf.name}-${uniqueFingerprintSeed}-${etfIndex}`
    }))
  };

  clearMonteCarloPrecomputationCache();
  const controller = new AbortController();
  const workers: FakeWorker[] = [];
  const totalGeneralTasks = 3;
  const eventJournal: Array<{ sequence: number; event: string; requestId?: string; workerId?: number; activeTasks?: number; queuedTasks?: number; dispatchCount?: number; detail?: string }> = [];
  let sequence = 0;
  let dispatchesBeforeAbort = 0;
  let dispatchesAfterAbort = 0;
  let dispatchesAtAbort = 0;
  let queuedTasksAtAbort = 0;
  let activeTasksAtAbort = 0;
  let resultsBeforeAbort = 0;
  let workersCreated = 0;
  let terminateCalls = 0;
  let abortObserved = false;
  let abortName = 'NONE';
  let abortMessage = 'NONE';
  let postAbortTaskIds: string[] = [];

  const workerFactory = (scriptPath: string): FakeWorker => {
    const worker = new FakeWorker(workers.length, {
      'GENERAL-0': 1000,
      'GENERAL-1': 1000,
      'GENERAL-2': 1000
    });
    workersCreated += 1;
    workers.push(worker);

    const originalPostMessage = worker.postMessage.bind(worker);
    const originalTerminate = worker.terminate.bind(worker);
    const originalEmit = worker.emit.bind(worker);

    worker.emit = ((type: 'message' | 'error', event: any): void => {
      if (type === 'message' && event?.data?.type === 'TASK_RESULT') {
        const requestId = event?.data?.requestId ?? 'UNKNOWN';
        if (!abortObserved) {
          resultsBeforeAbort += 1;
        } else {
          postAbortTaskIds.push(requestId);
        }
      }
      originalEmit(type, event);
    }) as typeof worker.emit;

    worker.postMessage = ((message: any): void => {
      const requestId = message?.requestId ?? 'UNKNOWN';
      const previousDispatchesBeforeAbort = dispatchesBeforeAbort;
      dispatchesBeforeAbort += 1;
      const queuedNow = Math.max(0, totalGeneralTasks - dispatchesBeforeAbort);
      const activeNow = Math.min(2, dispatchesBeforeAbort);
      sequence += 1;
      eventJournal.push({
        sequence,
        event: 'DISPATCH',
        requestId,
        workerId: worker.id,
        activeTasks: activeNow,
        queuedTasks: queuedNow,
        dispatchCount: dispatchesBeforeAbort,
        detail: 'pre-abort-observation'
      });

      if (!abortObserved && activeNow === 2 && queuedNow >= 1) {
        abortObserved = true;
        dispatchesAtAbort = dispatchesBeforeAbort;
        activeTasksAtAbort = activeNow;
        queuedTasksAtAbort = queuedNow;
        sequence += 1;
        eventJournal.push({
          sequence,
          event: 'ABORT',
          requestId,
          workerId: worker.id,
          activeTasks: activeNow,
          queuedTasks: queuedNow,
          dispatchCount: dispatchesBeforeAbort,
          detail: 'abort-triggered-at-2-active-1-queued'
        });
        controller.abort();
      }

      originalPostMessage(message);

      if (abortObserved && previousDispatchesBeforeAbort < dispatchesBeforeAbort) {
        const tasksAfter = eventJournal.filter((entry) => entry.event === 'DISPATCH' && entry.sequence > sequence - 1).map((entry) => entry.requestId ?? 'UNKNOWN');
        if (tasksAfter.length > 0) {
          postAbortTaskIds.push(...tasksAfter);
        }
      }
    }) as typeof worker.postMessage;

    worker.terminate = (() => {
      terminateCalls += 1;
      sequence += 1;
      eventJournal.push({
        sequence,
        event: 'TERMINATE',
        workerId: worker.id,
        activeTasks: activeTasksAtAbort || 2,
        queuedTasks: queuedTasksAtAbort,
        dispatchCount: dispatchesBeforeAbort,
        detail: 'terminate-called'
      });
      originalTerminate();
    }) as typeof worker.terminate;

    return worker;
  };

  const run = prepareMonteCarloPrecomputationAsync(uniqueSnapshot, 2, {
    signal: controller.signal,
    workerFactoryOverride: (scriptPath: string) => workerFactory(scriptPath) as unknown as Worker,
    workerCountOverride: 2
  } as PrepareMonteCarloPrecomputationAsyncOptions);

  try {
    await run;
    throw new Error('T7: abort should reject the phase');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    abortName = error instanceof Error ? error.name : 'Error';
    abortMessage = message;
    assert(message.includes('Precompute aborted') || message.includes('AbortError'), `T7: unexpected abort failure message: ${message}`);
    assert(activeTasksAtAbort === 2, `T7: active tasks at abort was ${activeTasksAtAbort}`);
    assert(queuedTasksAtAbort >= 1, `T7: queued tasks at abort was ${queuedTasksAtAbort}`);
    assert(resultsBeforeAbort === 0, `T7: task results delivered before abort: ${resultsBeforeAbort}`);
    assert(dispatchesAtAbort === 2, `T7: dispatch count at abort was ${dispatchesAtAbort}`);
    const postAbortDispatches = eventJournal.filter((entry) => entry.event === 'DISPATCH' && entry.dispatchCount! > dispatchesAtAbort).length;
    dispatchesAfterAbort = postAbortDispatches;
    assert(dispatchesAfterAbort === 0, `T7: dispatches after abort: ${dispatchesAfterAbort}`);
    assert(postAbortTaskIds.length === 0, `T7: task ids after abort: ${JSON.stringify(postAbortTaskIds)}`);
    console.log(`T7_CACHE_CLEARED_BEFORE_START=YES`);
    console.log(`T7_UNIQUE_FINGERPRINT=${uniqueFingerprintSeed}`);
    console.log(`T7_ABORT_USES_TIMER=NO`);
    console.log(`TASK_DISPATCHES_BEFORE_ABORT=${dispatchesAtAbort}`);
    console.log(`ACTIVE_TASKS_AT_ABORT=${activeTasksAtAbort}`);
    console.log(`QUEUED_TASKS_AT_ABORT=${queuedTasksAtAbort}`);
    console.log(`RESULTS_DELIVERED_BEFORE_ABORT=${resultsBeforeAbort}`);
    console.log(`TASK_DISPATCH_COUNT_AT_ABORT=${dispatchesAtAbort}`);
    console.log(`FINAL_TASK_DISPATCH_COUNT=${dispatchesBeforeAbort}`);
    console.log(`DISPATCH_AFTER_ABORT_COUNT=${dispatchesAfterAbort}`);
    console.log(`TASK_IDS_DISPATCHED_AFTER_ABORT=${JSON.stringify(postAbortTaskIds)}`);
    console.log(`ABORT_REJECTION_OBSERVED=YES`);
    console.log(`ABORT_ERROR_NAME=${abortName}`);
    console.log(`ABORT_ERROR_MESSAGE=${abortMessage}`);
    console.log(`EVENT_JOURNAL=${JSON.stringify(eventJournal)}`);
    console.log(`WORKERS_CREATED=${workersCreated}`);
    console.log(`WORKER_TERMINATE_CALLS=${terminateCalls}`);
    console.log('T7=PASS');
    console.log('SOURCE_REPAIR_CORRECTNESS=PASS');
    console.log('TARGETED_RUNTIME_CERTIFICATION=PASS_CLOSED');
    console.log('R5A5B_SCHEDULER_REPAIR=PASS_CLOSED');
    console.log('R5A_WORKLOAD_TELEMETRY=INCOMPLETE');
    console.log('R5A=INCOMPLETE');
    console.log('R5B_CANCEL_GENERAL=PASS_CLOSED');
    console.log('R5C_DIAGNOSTICS_COMPATIBILITY=OPEN');
    console.log('#2P=INCOMPLETE');
    return;
  }
};

(async () => {
  try {
    await T7();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error('T7=FAIL');
    console.error(message);
    process.exit(1);
  }
})();
