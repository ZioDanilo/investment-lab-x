export const MACRO_SCENARIOS = ['expansion', 'recession', 'stagflation', 'soft_landing'];
export const SCENARIO_LABELS = {
    expansion: 'Espansione',
    recession: 'Recessione',
    stagflation: 'Stagflazione',
    soft_landing: 'Soft Landing'
};
export const DEFAULT_STRUCTURAL_PROBABILITIES = {
    expansion: 0.55,
    recession: 0.15,
    stagflation: 0.10,
    soft_landing: 0.20
};
export const DEFAULT_TRANSITION_MATRIX = {
    expansion: { expansion: 0.60, recession: 0.10, stagflation: 0.10, soft_landing: 0.20 },
    recession: { expansion: 0.25, recession: 0.20, stagflation: 0.05, soft_landing: 0.50 },
    stagflation: { expansion: 0.20, recession: 0.20, stagflation: 0.30, soft_landing: 0.30 },
    soft_landing: { expansion: 0.40, recession: 0.20, stagflation: 0.10, soft_landing: 0.30 }
};
export const DEFAULT_DISTRIBUTION_SETTINGS = {
    betaAlpha: 2,
    betaBeta: 5
};
export const DEFAULT_REBALANCE_SETTINGS = {
    enabled: true,
    frequencyYears: 1,
    transactionCostRate: 0
};
