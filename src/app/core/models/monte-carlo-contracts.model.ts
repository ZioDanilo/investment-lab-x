export type MonteCarloScenario = 'expansion' | 'recession' | 'stagflation' | 'soft_landing';

export const MONTE_CARLO_SCENARIOS: readonly MonteCarloScenario[] = [
  'expansion',
  'recession',
  'stagflation',
  'soft_landing'
];

export const MONTE_CARLO_GLOBAL_PROPERTY_KEYS = [
  'scenario_transition_intensity_threshold',
  'new_scenario_first_month_max_intensity',
  'new_scenario_second_month_max_intensity',
  'scenario_intensity_max_monthly_variation'
] as const;

export type MonteCarloGlobalPropertyKey = (typeof MONTE_CARLO_GLOBAL_PROPERTY_KEYS)[number];

/** User-owned run input. Target weights intentionally do not belong to the API snapshot. */
export interface MonteCarloUserInput {
  positions: MonteCarloTargetPosition[];
  initialCapital: number;
  horizonYears: number;
}

export interface MonteCarloTargetPosition {
  isin: string;
  targetWeight: number;
}

/** Immutable data supplied by the backend for the active ETF ISINs. */
export interface MonteCarloSnapshot {
  etfs: MonteCarloSnapshotEtf[];
  structuralProbabilities: Record<MonteCarloScenario, number>;
  transitionMatrix: Record<MonteCarloScenario, Record<MonteCarloScenario, number>>;
  inertiaConfigurations: Record<MonteCarloScenario, MonteCarloInertiaConfiguration>;
  intensityConfigurations: Record<MonteCarloScenario, MonteCarloIntensityConfiguration>;
  globalProperties: Record<MonteCarloGlobalPropertyKey, number>;
  correlations: MonteCarloCorrelation[];
}

export interface MonteCarloSnapshotEtf {
  isin: string;
  name: string;
  nickname: string | null;
  statistics: Record<MonteCarloScenario | 'general', MonteCarloEtfStatistics>;
}

export interface MonteCarloEtfStatistics {
  expectedReturn: number;
  volatility: number;
  returnRange: {
    min: number;
    max: number;
  };
  /** Deprecated MC input retained only when available for diagnostics. */
  maxDrawdown?: number;
}

export interface MonteCarloInertiaConfiguration {
  entryProbability: number;
  persistenceProbability: number;
  entryMonths: number;
  exitStartMonth: number;
  exitDecay: number;
}

export interface MonteCarloIntensityConfiguration {
  meanIntensity: number;
  stdDevIntensity: number;
}

export interface MonteCarloCorrelation {
  isin1: string;
  isin2: string;
  expansion: number;
  recession: number;
  stagflation: number;
  soft_landing: number;
}

export interface MonteCarloSnapshotRequest {
  isins: string[];
}

export interface MonteCarloSnapshotResponse {
  success: true;
  data: MonteCarloSnapshot;
}

export interface MonteCarloPercentileSet {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

/** Official result assembly defined by the specification. */
export interface MonteCarloResult {
  mainKpis: MonteCarloMainKpis;
  percentiles: MonteCarloPercentiles;
  capitalFan: MonteCarloCapitalFanPoint[];
  representativePath: MonteCarloRepresentativePath;
  statistics: unknown;
  technicalChecks: unknown;
  performanceMetrics: unknown;
}

export interface MonteCarloMainKpis {
  robustCagr: number;
  robustMaxDrawdown: number;
  volatility: number;
  decorrelationIndex: number;
  lantieriIndex: number;
  recoveryTimeMonths: number | null;
}

export interface MonteCarloPercentiles {
  finalCapital: MonteCarloPercentileSet;
  cagr: MonteCarloPercentileSet;
  maxDrawdown: MonteCarloPercentileSet;
  recoveryTimeMonths: MonteCarloPercentileSet | null;
}

export interface MonteCarloCapitalFanPoint {
  year: number;
  capitalP5: number;
  capitalP25: number;
  capitalP50: number;
  capitalP75: number;
  capitalP95: number;
}

export interface MonteCarloRepresentativePath {
  simulationId: number;
  cagr: number;
  maxDrawdown: number;
  capital: Array<{ month: number; capital: number }>;
}