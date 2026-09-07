import { performance } from 'node:perf_hooks';
import {
  MONTE_CARLO_GLOBAL_PROPERTY_KEYS,
  MONTE_CARLO_SCENARIOS,
  MonteCarloScenario,
  MonteCarloSnapshot
} from '../src/app/core/models/monte-carlo-contracts.model';
import { prepareMonteCarloPrecomputation } from '../src/app/core/precomputation/monte-carlo-precomputation';
import {
  __debugAcceptTrace,
  __debugAllAttemptTrace,
  __debugRejectTrace,
  calculateEffectiveMonthlyParameters,
  generateMonthlyReturnVector
} from '../src/app/core/returns/monte-carlo-return-engine';
import {
  COPULA_EPSILON,
  sampleChiSquare5,
  sampleStandardNormal,
  studentTCdf,
  studentTQuantile,
  STUDENT_T_STANDARDIZATION,
  UniformRandomSource
} from '../src/app/core/probability/monte-carlo-probability';

const TIMEOUT_MS = 10_000;

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const makeLcg = (seed: number): UniformRandomSource => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const clampCopulaProbability = (probability: number): number => {
  if (!Number.isFinite(probability)) throw new Error('INVALID_COPULA_PROBABILITY');
  return Math.min(1 - COPULA_EPSILON, Math.max(COPULA_EPSILON, probability));
};

const createSnapshot = (): MonteCarloSnapshot => ({
  etfs: [
    {
      isin: 'ETF-A',
      name: 'ETF-A',
      nickname: null,
      statistics: {
        expansion: { expectedReturn: 0.08, volatility: 0.13, returnRange: { min: -0.2, max: 0.25 } },
        recession: { expectedReturn: -0.05, volatility: 0.17, returnRange: { min: -0.35, max: 0.1 } },
        stagflation: { expectedReturn: -0.02, volatility: 0.18, returnRange: { min: -0.3, max: 0.12 } },
        soft_landing: { expectedReturn: 0.06, volatility: 0.12, returnRange: { min: -0.15, max: 0.2 } },
        general: { expectedReturn: 0.06, volatility: 0.15, returnRange: { min: -0.25, max: 0.2 } }
      }
    },
    {
      isin: 'ETF-B',
      name: 'ETF-B',
      nickname: null,
      statistics: {
        expansion: { expectedReturn: 0.09, volatility: 0.15, returnRange: { min: -0.18, max: 0.26 } },
        recession: { expectedReturn: -0.04, volatility: 0.18, returnRange: { min: -0.32, max: 0.11 } },
        stagflation: { expectedReturn: -0.01, volatility: 0.17, returnRange: { min: -0.28, max: 0.13 } },
        soft_landing: { expectedReturn: 0.07, volatility: 0.13, returnRange: { min: -0.12, max: 0.22 } },
        general: { expectedReturn: 0.07, volatility: 0.16, returnRange: { min: -0.24, max: 0.22 } }
      }
    },
    {
      isin: 'ETF-C',
      name: 'ETF-C',
      nickname: null,
      statistics: {
        expansion: { expectedReturn: 0.07, volatility: 0.14, returnRange: { min: -0.16, max: 0.24 } },
        recession: { expectedReturn: -0.03, volatility: 0.16, returnRange: { min: -0.3, max: 0.1 } },
        stagflation: { expectedReturn: -0.01, volatility: 0.16, returnRange: { min: -0.29, max: 0.11 } },
        soft_landing: { expectedReturn: 0.05, volatility: 0.11, returnRange: { min: -0.14, max: 0.18 } },
        general: { expectedReturn: 0.05, volatility: 0.14, returnRange: { min: -0.22, max: 0.18 } }
      }
    }
  ],
  structuralProbabilities: {
    expansion: 0.45,
    recession: 0.2,
    stagflation: 0.15,
    soft_landing: 0.2
  },
  transitionMatrix: {
    expansion: { expansion: 0.6, recession: 0.1, stagflation: 0.1, soft_landing: 0.2 },
    recession: { expansion: 0.25, recession: 0.2, stagflation: 0.1, soft_landing: 0.45 },
    stagflation: { expansion: 0.2, recession: 0.2, stagflation: 0.3, soft_landing: 0.3 },
    soft_landing: { expansion: 0.35, recession: 0.25, stagflation: 0.1, soft_landing: 0.3 }
  },
  inertiaConfigurations: {
    expansion: { entryProbability: 0.2, persistenceProbability: 0.75, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    recession: { entryProbability: 0.25, persistenceProbability: 0.7, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    stagflation: { entryProbability: 0.3, persistenceProbability: 0.68, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 },
    soft_landing: { entryProbability: 0.2, persistenceProbability: 0.8, entryMonths: 3, exitStartMonth: 12, exitDecay: 0.9 }
  },
  intensityConfigurations: {
    expansion: { meanIntensity: 0.35, stdDevIntensity: 0.12 },
    recession: { meanIntensity: 0.55, stdDevIntensity: 0.15 },
    stagflation: { meanIntensity: 0.47, stdDevIntensity: 0.14 },
    soft_landing: { meanIntensity: 0.3, stdDevIntensity: 0.1 }
  },
  globalProperties: Object.fromEntries(MONTE_CARLO_GLOBAL_PROPERTY_KEYS.map((key) => [key, 0.4])) as MonteCarloSnapshot['globalProperties'],
  correlations: [
    { isin1: 'ETF-A', isin2: 'ETF-B', expansion: 0.35, recession: 0.42, stagflation: 0.4, soft_landing: 0.38 },
    { isin1: 'ETF-A', isin2: 'ETF-C', expansion: 0.3, recession: 0.36, stagflation: 0.34, soft_landing: 0.32 },
    { isin1: 'ETF-B', isin2: 'ETF-C', expansion: 0.32, recession: 0.38, stagflation: 0.36, soft_landing: 0.34 }
  ]
});

const toMb = (bytes: number): number => bytes / (1024 * 1024);

const currentLookupEquivalent = (curve: Array<{ intensity: number; muMonthly: number }>, intensity: number): number => {
  const clampedIntensity = Math.min(1, Math.max(0, intensity));
  if (clampedIntensity === 0) return curve[0].muMonthly;
  if (clampedIntensity === 1) return curve[curve.length - 1].muMonthly;

  let left = curve[0];
  let right = curve[curve.length - 1];
  for (let index = 1; index < curve.length; index += 1) {
    const current = curve[index];
    if (current.intensity >= clampedIntensity) {
      left = curve[index - 1];
      right = current;
      break;
    }
  }
  const span = right.intensity - left.intensity || 1;
  const weight = (clampedIntensity - left.intensity) / span;
  return left.muMonthly + weight * (right.muMonthly - left.muMonthly);
};

const measure = (label: string, callback: () => void): number => {
  const start = performance.now();
  callback();
  return performance.now() - start;
};

const makeDeterministicProbabilities = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => ((index + 1) / (count + 1)));

const makeDeterministicNormals = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => ((index * 0.6180339887498949) % 1));

const logRatio = (name: string, early: number, later: number): void => {
  const ratio = early === 0 ? Number.POSITIVE_INFINITY : later / early;
  print(`[CONTROL] ${name} 10N/N = ${ratio.toFixed(6)}`);
};

const phaseA = (): void => {
  const snapshot = createSnapshot();
  const ms = measure('A', () => {
    prepareMonteCarloPrecomputation(snapshot);
  });
  print(`[A] PRECOMPUTATION_MS = ${ms.toFixed(3)}`);
  print('[A] DONE');
  if (ms > TIMEOUT_MS) {
    print('PRIMARY_SUSPECT = PRECOMPUTATION');
    process.exit(0);
  }
};

const phaseB = (): boolean => {
  const snapshot = createSnapshot();
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const firstEtf = snapshot.etfs[0];
  const etfParameters = precompute.etfParameters[firstEtf.isin]?.expansion;
  if (!etfParameters) throw new Error('Missing ETF expansion precomputation for fixture');
  const curve = etfParameters.muCalibrationByIntensity;

  const scales = [1000, 10_000, 100_000, 1_000_000];
  for (const scale of scales) {
    const intensities = Array.from({ length: scale }, (_, index) => (index % 1000) / 999 || 0.5);
    const ms = measure('B', () => {
      for (let index = 0; index < intensities.length; index += 1) {
        currentLookupEquivalent(curve, intensities[index]);
      }
    });
    print(`[B] LOOKUP_${scale.toLocaleString()}_MS = ${ms.toFixed(3)}`);
    if (ms > TIMEOUT_MS) {
      print(`[B] STOP_AT_SCALE = ${scale.toLocaleString()}`);
      return true;
    }
  }
  return false;
};

const phaseC = (): void => {
  const functions: Array<{ name: string; callback: (count: number) => void; values: number[] }> = [
    {
      name: 'sampleStandardNormal',
      values: makeDeterministicNormals(100_000),
      callback: (count: number) => {
        const rng = makeLcg(7);
        for (let index = 0; index < count; index += 1) {
          sampleStandardNormal(rng);
        }
      }
    },
    {
      name: 'sampleChiSquare5',
      values: makeDeterministicNormals(100_000),
      callback: (count: number) => {
        const rng = makeLcg(11);
        for (let index = 0; index < count; index += 1) {
          sampleChiSquare5(rng);
        }
      }
    },
    {
      name: 'studentTCdf',
      values: Array.from({ length: 100_000 }, (_, index) => (index % 2000) / 1999 * 4 - 2),
      callback: (count: number) => {
        for (let index = 0; index < count; index += 1) {
          const value = ((index * 0.85721) % 4) - 2;
          studentTCdf(value);
        }
      }
    },
    {
      name: 'studentTQuantile',
      values: makeDeterministicProbabilities(100_000),
      callback: (count: number) => {
        for (let index = 0; index < count; index += 1) {
          const probability = ((index + 1) / (count + 1)) * 0.999998 + 0.000001;
          studentTQuantile(probability);
        }
      }
    }
  ];

  for (const fn of functions) {
    let lastMs = 0;
    const scales = [1000, 10_000, 100_000];
    for (const scale of scales) {
      const ms = measure(fn.name, () => fn.callback(scale));
      lastMs = ms;
      print(`[C] ${fn.name} ${scale.toLocaleString()} = ${ms.toFixed(3)} ms`);
      if (scale > 1000 && lastMs > 0) {
        const ratio = (scale / (scale / 10)) || 1;
        const scaledRatio = (ms / lastMs) || 1;
        if (scale === 10_000) {
          logRatio(`${fn.name} ${scale} vs ${scale / 10}`, ms / 10, ms);
        }
        void ratio;
        void scaledRatio;
      }
      if (ms > TIMEOUT_MS) {
        print(`[C] STOP_${fn.name}_AT_SCALE = ${scale.toLocaleString()}`);
        break;
      }
    }
  }
};

const phaseD = (): void => {
  const scales = [100, 1000, 10_000, 100_000];
  for (const scale of scales) {
    const ms = measure('D', () => {
      const random = makeLcg(13);
      for (let index = 0; index < scale; index += 1) {
        const independentNormals = [sampleStandardNormal(random), sampleStandardNormal(random), sampleStandardNormal(random)];
        const commonChiSquare = sampleChiSquare5(random);
        const shocks = independentNormals.map((normal) => {
          const correlatedT = normal / Math.sqrt(commonChiSquare / 5);
          const probability = clampCopulaProbability(studentTCdf(correlatedT));
          return studentTQuantile(probability) * STUDENT_T_STANDARDIZATION;
        });
        void shocks;
      }
    });
    print(`[D] COPULA_${scale.toLocaleString()}_MS = ${ms.toFixed(3)}`);
    if (ms > TIMEOUT_MS) {
      print(`[D] STOP_AT_SCALE = ${scale.toLocaleString()}`);
      break;
    }
  }
};

const phaseE = (): void => {
  const snapshot = createSnapshot();
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const firstEtf = snapshot.etfs[0];
  const etfParameters = precompute.etfParameters[firstEtf.isin]?.expansion;
  if (!etfParameters) throw new Error('Missing ETF expansion precomputation for fixture');

  const scales = [1000, 10_000, 100_000, 1_000_000];
  for (const scale of scales) {
    const ms = measure('E', () => {
      for (let index = 0; index < scale; index += 1) {
        const intensity = ((index % 101) / 100) * 0.85 + 0.05;
        calculateEffectiveMonthlyParameters(etfParameters, intensity, firstEtf.isin);
      }
    });
    print(`[E] EFFECTIVE_${scale.toLocaleString()}_MS = ${ms.toFixed(3)}`);
    if (ms > TIMEOUT_MS) {
      print(`[E] STOP_AT_SCALE = ${scale.toLocaleString()}`);
      break;
    }
  }
};

const phaseF = (): void => {
  const snapshot = createSnapshot();
  const precompute = prepareMonteCarloPrecomputation(snapshot);

  const beforeHeap = process.memoryUsage().heapUsed;
  const beforeReject = __debugRejectTrace.length;
  const beforeAccept = __debugAcceptTrace.length;
  const beforeAll = __debugAllAttemptTrace.length;
  print(`[G] BEFORE_F_HEAP_MB = ${(toMb(beforeHeap)).toFixed(3)}`);
  print(`[G] BEFORE_F_TRACE_LENGTHS = reject=${beforeReject}, accept=${beforeAccept}, all=${beforeAll}`);

  const scales = [1, 10, 100, 1000, 10_000, 100_000];
  for (const scale of scales) {
    __debugRejectTrace.length = 0;
    __debugAcceptTrace.length = 0;
    __debugAllAttemptTrace.length = 0;

    const random = makeLcg(19 + scale);
    const start = performance.now();
    for (let index = 0; index < scale; index += 1) {
      generateMonthlyReturnVector(snapshot, precompute, 'expansion', 0.55, random);
    }
    const elapsed = performance.now() - start;
    const microsecondsPerVector = (elapsed * 1000) / Math.max(scale, 1);
    const heap = process.memoryUsage().heapUsed;

    print(`[F] VECTOR_${scale.toLocaleString()}_MS = ${elapsed.toFixed(3)}`);
    print(`[F] VECTOR_${scale.toLocaleString()}_MICROSECONDS_PER_VECTOR = ${microsecondsPerVector.toFixed(3)}`);
    print(`[G] AFTER_${scale.toLocaleString()}_HEAP_MB = ${(toMb(heap)).toFixed(3)}`);
    print(`[G] AFTER_${scale.toLocaleString()}_TRACE_LENGTHS = reject=${__debugRejectTrace.length}, accept=${__debugAcceptTrace.length}, all=${__debugAllAttemptTrace.length}`);

    if (elapsed > TIMEOUT_MS) {
      print(`[F] STOP_AT_SCALE = ${scale.toLocaleString()}`);
      break;
    }
  }
};

const main = (): void => {
  print('[A] START');
  phaseA();
  print('[B] START');
  phaseB();
  print('[C] START');
  phaseC();
  print('[D] START');
  phaseD();
  print('[E] START');
  phaseE();
  print('[F] START');
  phaseF();

  print('FIRST_MAJOR_SLOWDOWN = UNKNOWN');
  print('SCALING_BEHAVIOR = UNKNOWN');
  print('MEMORY_GROWTH = UNKNOWN');
  print('TRACE_GROWTH = UNKNOWN');
  print('FUNCTION_RESPONSIBLE = UNKNOWN');
  print('WAS_FUNCTION_PRESENT_BEFORE_CAGR_PATCH = unknown');
  print('WAS_CALL_FREQUENCY_CHANGED = unknown');
  print('PRIMARY_REGRESSION_CAUSE = UNKNOWN');
  print('CONFIDENCE = LOW');
  print('FILES_CHANGED_PRODUCTION = NONE');
};

main();
