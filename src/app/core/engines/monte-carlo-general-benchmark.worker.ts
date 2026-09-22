import { MonteCarloSnapshot, MonteCarloUserInput } from '../models/monte-carlo-contracts.model';
import { getMonteCarloPrecomputationCacheStats } from '../precomputation/monte-carlo-precomputation';
import { DEFAULT_GENERAL_BENCHMARK_PATHS, runGeneralBenchmark } from './monte-carlo-general-benchmark';

interface GeneralBenchmarkWorkerRequest {
  type: 'RUN_GENERAL_BENCHMARK';
  executionId: string;
  workerId: number;
  input: MonteCarloUserInput;
  snapshot: MonteCarloSnapshot;
  seed?: number;
  simulationCount?: number;
}

const asWorkerScope = self as typeof globalThis & {
  postMessage: (message: any) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

asWorkerScope.onmessage = (event: MessageEvent) => {
  const message = event.data as GeneralBenchmarkWorkerRequest;
  if (!message || message.type !== 'RUN_GENERAL_BENCHMARK') {
    return;
  }

  try {
    const result = runGeneralBenchmark(
      message.snapshot,
      message.input,
      message.seed ?? Date.now(),
      message.simulationCount ?? DEFAULT_GENERAL_BENCHMARK_PATHS
    );

    asWorkerScope.postMessage({
      type: 'GENERAL_BENCHMARK_RESULT',
      executionId: message.executionId,
      workerId: message.workerId,
      result: result,
      summary: (result as any).__profilingSummary ?? {}
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    asWorkerScope.postMessage({
      type: 'GENERAL_BENCHMARK_ERROR',
      executionId: message.executionId,
      workerId: message.workerId,
      error: {
        code: 'GENERAL_BENCHMARK_ERROR',
        message: err.message,
        details: err instanceof Error && 'details' in err ? (err as any).details : {}
      }
    });
  }
};
