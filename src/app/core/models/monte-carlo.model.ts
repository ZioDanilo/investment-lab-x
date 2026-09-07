export type MacroScenario = 'expansion' | 'recession' | 'stagflation' | 'soft_landing';
export type EtfStatisticsScenario = MacroScenario | 'general';

export const MACRO_SCENARIOS: MacroScenario[] = ['expansion', 'recession', 'stagflation', 'soft_landing'];

export const SCENARIO_LABELS: Record<MacroScenario, string> = {
  expansion: 'Espansione',
  recession: 'Recessione',
  stagflation: 'Stagflazione',
  soft_landing: 'Soft Landing'
};

export interface MacroScenarioStatistics {
  expectedReturn: number;
  volatility: number;
  maxDrawdown: number;
  returnRange: {
    min: number;
    max: number;
  };
}

export interface EtfMacroStatistics {
  expansion: MacroScenarioStatistics;
  recession: MacroScenarioStatistics;
  stagflation: MacroScenarioStatistics;
  softLanding: MacroScenarioStatistics;
  /** Long-term benchmark statistics (scenario = 'general' in DB) */
  general?: MacroScenarioStatistics;
}

/** Flat representation of statistics for a single ETF + scenario, as returned by the DB */
export interface EtfScenarioStatistics {
  isin: string;
  scenario: EtfStatisticsScenario;
  expectedReturn: number;
  volatility: number;
  maxDrawdown: number;
  returnRangeMin: number;
  returnRangeMax: number;
}

/** Validation result comparing simulated Monte Carlo output vs general long-term benchmark */
export interface MonteCarloGeneralValidation {
  targetMedianCagr: number;
  simulatedMedianCagr: number;
  cagrDifference: number;
  targetVolatility: number;
  simulatedMedianVolatility: number;
  volatilityDifference: number;
  targetMaxDrawdown: number;
  simulatedMedianMaxDrawdown: number;
  maxDrawdownDifference: number;
  targetRangeMin: number;
  targetRangeMax: number;
  simulatedPercentile5Cagr: number;
  simulatedPercentile95Cagr: number;
  cagrWithinTolerance: boolean;
  volatilityWithinTolerance: boolean;
  maxDrawdownWithinTolerance: boolean;
  rangeWithinTolerance: boolean;
  status: 'CALIBRATED' | 'WARNING' | 'NOT_CALIBRATED';
}

/** Metadata about how the general benchmark was built */
export interface GeneralStatisticsSource {
  scenarioIdentifier: 'general';
  correlationMethod: 'general_matrix' | 'average_macro_matrices' | 'fallback';
  drawdownMethod: 'diagnostic_simulation' | 'weighted_approximation';
  rangeMethod: 'weighted_approximation';
}

/** Diagnostic result for a single ETF run against its general benchmark */
export interface SingleEtfGeneralDiagnostic {
  isin: string;
  targetExpectedReturn: number;
  simulatedMedianCagr: number;
  cagrDifference: number;
  targetVolatility: number;
  simulatedMedianVolatility: number;
  targetMaxDrawdown: number;
  simulatedMedianMaxDrawdown: number;
  targetRangeMin: number;
  targetRangeMax: number;
  percentile5Cagr: number;
  percentile95Cagr: number;
  status: 'CALIBRATED' | 'WARNING' | 'NOT_CALIBRATED';
}

export interface MonteCarloEtfYearResult {
  isin: string;
  name: string;
  nickname?: string;
  weight: number;
  expectedReturn: number;
  annualReturn: number;
  contribution: number;
  intensity: number;
  deviationDirection: 'above_expected' | 'below_expected';
}

export interface MonteCarloRepresentativeEtfContribution {
  isin: string;
  nickname: string;
  weight: number;
  annualReturn: number;
  contribution: number;
}

export interface MonteCarloRepresentativeContributionYear {
  year: number;
  contributions: MonteCarloRepresentativeEtfContribution[];
}

export interface MonteCarloRepresentativeContributionAnalysis {
  simulationId: number;
  selectedFromWorstDrawdownBucketSize: number;
  selectedFromWorstDrawdownPercentile: number;
  simulationMaxDrawdown: number;
  simulationCagr: number;
  medianCagrReference: number;
  years: MonteCarloRepresentativeContributionYear[];
}

export interface MonteCarloYearResult {
  year: number;
  scenario: MacroScenario;
  durationInCurrentScenario: number;
  etfReturns: MonteCarloEtfYearResult[];
  portfolioReturn: number;
  startingCapital: number;
  endingCapital: number;
  runningPeak: number;
  drawdown: number;
}

export interface MonteCarloPathResult {
  simulationId: number;
  dominantEtfIsin: string;
  dominantEtfName: string;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  monthly?: Array<{
    month: number;
    year: number;
    endingCapital?: number;
    capital?: number;
    portfolioReturn?: number;
    runningPeak?: number;
    drawdown?: number;
    intensity?: number;
    positions?: Array<{ isin: string; value?: number; contribution?: number; weight?: number; targetWeight?: number; }>;
  }>;
  maxRecoveryTimeMonths?: number | null;
  unrecovered?: boolean;
  unrecoveredDurationMonths?: number | null;
  scenarioPath: MacroScenarioPath;
  years: MonteCarloYearResult[];
  portfolioSnapshot: PortfolioSimulationSnapshot;
  diagnostics?: MonteCarloPathDiagnostics;
  returnDiagnostics?: {
    candidateVectors: number;
    acceptedVectors: number;
    rejectedVectors: number;
    physicalFloorRejectedVectors: number;
    oldRangeViolationCount: number;
    effectiveRangeRejectedVectors: number;
    byEtfScenario?: Record<string, {
      candidateReturnCount: number;
      belowEffectiveMinCount: number;
      aboveEffectiveMaxCount: number;
      lowerRejectRate: number;
      upperRejectRate: number;
      totalOutOfRangeRate: number;
      meanLowerDistanceSigma: number | null;
      meanUpperDistanceSigma: number | null;
    }>;
  };
  correlationDiagnostics?: MonteCarloCorrelationDiagnostics;
  performanceDiagnostics?: {
    redrawCount?: number;
    rejectRate?: number;
  };
  generalBenchmark?: MonteCarloGeneralBenchmark;
}

export interface MonteCarloSummary {
  simulationCount: number;
  validSimulationCount: number;
  failedPathCount: number;
  horizonYears: number;
  initialCapital: number;
  averageFinalCapital: number;
  medianFinalCapital: number;
  percentile5FinalCapital: number;
  percentile25FinalCapital: number;
  percentile75FinalCapital: number;
  percentile95FinalCapital: number;
  /** @deprecated Use medianCagr as primary metric */
  averageCagr: number;
  /** PRIMARY METRIC: CAGR mediano dei percorsi validi */
  medianCagr: number;
  percentile5Cagr: number;
  percentile25Cagr: number;
  percentile75Cagr: number;
  percentile95Cagr: number;
  medianConsistencyDifference: number;
  averageMaxDrawdown: number;
  averageWorst5PercentMaxDrawdown: number;
  worstMaxDrawdown: number;
  probabilityOfLoss: number;
  probabilityCagrAboveTarget: number;
  scenarioFrequencies: Record<MacroScenario, number>;
}

export interface MonteCarloParams {
  initialCapital: number;
  simulationCount: number;
  targetCagr: number;
  horizonYears: number;
  seed?: number;
}

export type TransitionMatrix = Record<MacroScenario, Record<MacroScenario, number>>;
export type StructuralProbabilities = Record<MacroScenario, number>;

export const DEFAULT_STRUCTURAL_PROBABILITIES: StructuralProbabilities = {
  expansion: 0.55,
  recession: 0.15,
  stagflation: 0.10,
  soft_landing: 0.20
};

export const DEFAULT_TRANSITION_MATRIX: TransitionMatrix = {
  expansion:   { expansion: 0.60, recession: 0.10, stagflation: 0.10, soft_landing: 0.20 },
  recession:   { expansion: 0.25, recession: 0.20, stagflation: 0.05, soft_landing: 0.50 },
  stagflation: { expansion: 0.20, recession: 0.20, stagflation: 0.30, soft_landing: 0.30 },
  soft_landing:{ expansion: 0.40, recession: 0.20, stagflation: 0.10, soft_landing: 0.30 }
};

export interface MonteCarloState {
  params: MonteCarloParams;
  structuralProbabilities: StructuralProbabilities;
  transitionMatrix: TransitionMatrix;
  summary: MonteCarloSummary | null;
  detailedPaths: MonteCarloPathResult[];
  running: boolean;
  progress: number; // 0..100
}

export interface MonteCarloDistributionSettings {
  betaAlpha: number;
  betaBeta: number;
}

export const DEFAULT_DISTRIBUTION_SETTINGS: MonteCarloDistributionSettings = {
  betaAlpha: 2,
  betaBeta: 5
};

export interface SampledEtfReturn {
  annualReturn: number;
  expectedReturn: number;
  intensity: number;
  magnitude: number;
  deviationDirection: 'above_expected' | 'below_expected';
}

export interface DistributionDiagnostic {
  sampleCount: number;
  configuredExpectedReturn: number;
  simulatedAverageReturn: number;
  simulatedMedianReturn: number;
  simulatedMinReturn: number;
  simulatedMaxReturn: number;
  differenceFromExpected: number;
}

// ============================================================================
// NEW INTERFACES FOR REFACTORED ARCHITECTURE
// ============================================================================

/**
 * Portfolio Position for simulation
 */
export interface PortfolioPosition {
  isin: string;
  name: string;
  weight: number;
}

/**
 * Snapshot of portfolio at simulation start
 */
export interface PortfolioSimulationSnapshot {
  generatedAt: string;
  positions: PortfolioPosition[];
  totalWeightBeforeNormalization: number;
  normalized: boolean;
}

/**
 * Single year in the macro scenario path
 */
export interface ScenarioYear {
  year: number;
  scenario: MacroScenario;
  durationInCurrentScenario: number;
}

/**
 * Generated path of macro scenarios for 50 years
 */
export interface MacroScenarioPath {
  years: ScenarioYear[];
  frequencies: Record<MacroScenario, number>;
}

export interface MonteCarloCorrelationDiagnostics {
  target?: number[][] | null;
  operational?: number[][] | null;
  latent?: number[][] | null;
  empiricalLatentShock?: number[][] | null;
  empiricalReturn?: number[][] | null;
  pearsonPrimary?: number[][] | null;
  spearmanDiagnostic?: number[][] | null;
  lowerTailDependence5?: number[][] | null;
  upperTailDependence5?: number[][] | null;
  deltas?: number[][] | null;
  absoluteDeltas?: number[][] | null;
  maeByScenario?: Record<string, number>;
  rmseByScenario?: Record<string, number>;
  maxAbsoluteErrorByScenario?: Record<string, number>;
}

export interface MonteCarloGeneralBenchmark {
  expectedReturn: number;
  volatility: number;
  maxDrawdown?: number;
  returnRange?: { min: number; max: number };
  simulatedLongTermReturn?: number;
  simulatedVolatility?: number;
  targetExpectedReturnDelta?: number;
  targetVolatilityDelta?: number;
}

export interface MonteCarloPathDiagnostics {
  scenario?: {
    frequencies?: Record<MacroScenario, number>;
    duration?: { averageMonthsPerScenario?: number; observed?: Record<MacroScenario, number> };
    transitions?: { empiricalMatrix?: Record<MacroScenario, Record<MacroScenario, number>>; source?: string };
    persistence?: Record<MacroScenario, number>;
  };
  intensity?: {
    distribution?: { mean?: number; volatility?: number; bands?: Record<string, number> };
    persistence?: { observed?: boolean };
  };
  returns?: {
    mean?: number;
    volatility?: number;
    sampleCount?: number;
    lowerTailDependence5?: number[][] | null;
    upperTailDependence5?: number[][] | null;
  };
  correlations?: MonteCarloCorrelationDiagnostics;
  generalBenchmark?: MonteCarloGeneralBenchmark;
  performance?: {
    redrawCount?: number;
    rejectRate?: number;
  };
  matricesCoherent?: boolean;
}

/**
 * Prepared correlation matrix for a portfolio and scenario
 */
export interface PreparedCorrelationMatrix {
  isins: string[];
  matrix: number[][];
  missingPairs: Array<{ isinA: string; isinB: string }>;
  repaired: boolean;
}

/**
 * Cache of correlation matrices for all scenarios
 */
export interface CorrelationMatrixCache {
  expansion: PreparedCorrelationMatrix;
  softLanding: PreparedCorrelationMatrix;
  recession: PreparedCorrelationMatrix;
  stagflation: PreparedCorrelationMatrix;
}

/**
 * Rebalancing settings for simulations
 */
export interface SimulationRebalanceSettings {
  enabled: boolean;
  frequencyYears: number;
  transactionCostRate?: number;
}

export const DEFAULT_REBALANCE_SETTINGS: SimulationRebalanceSettings = {
  enabled: true,
  frequencyYears: 1,
  transactionCostRate: 0
};

/**
 * Correlation data from database
 */
export interface EtfCorrelation {
  etfAIsin: string;
  etfBIsin: string;
  expansion: number;
  softLanding: number;
  recession: number;
  stagflation: number;
  confidence?: number;
  drivers?: string[];
}

/**
 * Extended summary with ETF contributions
 */
export interface EtfContributionStats {
  isin: string;
  name: string;
  averageAnnualContribution: number;
  cumulativeContribution: number;
}

/**
 * Extended MonteCarloSummary with new fields
 */
export interface ExtendedMonteCarloSummary extends MonteCarloSummary {
  averageEtfContribution: EtfContributionStats[];
  missingMacroStatistics: string[];
  missingCorrelationPairs: Array<{
    isinA: string;
    isinB: string;
    scenario: MacroScenario;
  }>;
  portfolioSnapshot: PortfolioSimulationSnapshot;
  /** Median of per-path annualized volatilities (std dev of annual returns) */
  medianAnnualizedVolatility: number;
  /** Median of per-path max drawdowns */
  medianMaxDrawdown: number;
  /** Validation of simulated results vs general long-term benchmark */
  generalValidation?: MonteCarloGeneralValidation;
  /** Metadata about how the general benchmark was constructed */
  generalStatisticsSource?: GeneralStatisticsSource;
  /** ETFs missing the general scenario record */
  etfsMissingGeneralStats: string[];
  /** Representative negative simulation selected for ETF annual contribution analysis */
  representativeContributionAnalysis?: MonteCarloRepresentativeContributionAnalysis;
}

/**
 * Extended path result with scenario path
 */
export interface ExtendedMonteCarloPathResult extends MonteCarloPathResult {
  scenarioPath: MacroScenarioPath;
  portfolioSnapshot: PortfolioSimulationSnapshot;
}

/**
 * Options for running Monte Carlo simulation
 */
export interface MonteCarloRunOptions {
  etfs: any[]; // Will be Etf[]
  params: MonteCarloParams;
  structural: StructuralProbabilities;
  transition: TransitionMatrix;
  distributionSettings: MonteCarloDistributionSettings;
  rebalanceSettings: SimulationRebalanceSettings;
  portfolio: PortfolioPosition[];
  portfolioSnapshot: PortfolioSimulationSnapshot;
  correlations: EtfCorrelation[];
  onProgress?: (percentage: number) => void;
}
