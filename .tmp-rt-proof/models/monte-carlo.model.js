"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REBALANCE_SETTINGS = exports.DEFAULT_DISTRIBUTION_SETTINGS = exports.DEFAULT_TRANSITION_MATRIX = exports.DEFAULT_STRUCTURAL_PROBABILITIES = exports.SCENARIO_LABELS = exports.MACRO_SCENARIOS = void 0;
exports.MACRO_SCENARIOS = ['expansion', 'recession', 'stagflation', 'soft_landing'];
exports.SCENARIO_LABELS = {
    expansion: 'Espansione',
    recession: 'Recessione',
    stagflation: 'Stagflazione',
    soft_landing: 'Soft Landing'
};
exports.DEFAULT_STRUCTURAL_PROBABILITIES = {
    expansion: 0.55,
    recession: 0.15,
    stagflation: 0.10,
    soft_landing: 0.20
};
exports.DEFAULT_TRANSITION_MATRIX = {
    expansion: { expansion: 0.60, recession: 0.10, stagflation: 0.10, soft_landing: 0.20 },
    recession: { expansion: 0.25, recession: 0.20, stagflation: 0.05, soft_landing: 0.50 },
    stagflation: { expansion: 0.20, recession: 0.20, stagflation: 0.30, soft_landing: 0.30 },
    soft_landing: { expansion: 0.40, recession: 0.20, stagflation: 0.10, soft_landing: 0.30 }
};
exports.DEFAULT_DISTRIBUTION_SETTINGS = {
    betaAlpha: 2,
    betaBeta: 5
};
exports.DEFAULT_REBALANCE_SETTINGS = {
    enabled: true,
    frequencyYears: 1,
    transactionCostRate: 0
};
