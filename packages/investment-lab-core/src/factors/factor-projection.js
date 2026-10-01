/**
 * Market Universe V2 factor projection primitives.
 *
 * The core deliberately has no knowledge of how many factors exist. Callers
 * provide factor returns and ETF exposures dynamically.
 */
export class FactorProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FactorProjectionError';
    this.code = code;
    this.details = details;
  }
}

export const exposureWeightsForUsableHistory = (years) => {
  const value = Number(years);
  if (!Number.isFinite(value) || value < 10) return { historicalWeight: 0.2, structuralWeight: 0.8 };
  if (value <= 20) return { historicalWeight: 0.6, structuralWeight: 0.4 };
  return { historicalWeight: 0.8, structuralWeight: 0.2 };
};

export const blendFactorExposure = ({ historicalBeta, structuralBeta, usableHistoryYears, historicalWeight, structuralWeight }) => {
  const defaults = exposureWeightsForUsableHistory(usableHistoryYears);
  const hw = historicalWeight ?? defaults.historicalWeight;
  const sw = structuralWeight ?? defaults.structuralWeight;
  const h = historicalBeta == null ? null : Number(historicalBeta);
  const s = structuralBeta == null ? null : Number(structuralBeta);
  if (h == null && s == null) throw new FactorProjectionError('MISSING_EXPOSURE', 'At least one beta estimate is required');
  if (h == null) return s;
  if (s == null) return h;
  if (Math.abs((hw + sw) - 1) > 1e-9) throw new FactorProjectionError('INVALID_EXPOSURE_WEIGHTS', 'Historical and structural weights must sum to 1', { historicalWeight: hw, structuralWeight: sw });
  return h * hw + s * sw;
};

export const projectEtfReturnFromFactors = ({
  factorReturns,
  exposures,
  alpha = 0,
  specificShock = 0,
  specificVolatility = 0
}) => {
  if (!factorReturns || typeof factorReturns !== 'object') {
    throw new FactorProjectionError('INVALID_FACTOR_RETURNS', 'factorReturns must be an object keyed by factor code/id');
  }
  let value = Number(alpha) || 0;
  for (const exposure of exposures || []) {
    const key = exposure.factorCode ?? exposure.factorId;
    const beta = Number(exposure.beta);
    const factorReturn = Number(factorReturns[key]);
    if (!key || !Number.isFinite(beta) || !Number.isFinite(factorReturn)) {
      throw new FactorProjectionError('INVALID_FACTOR_EXPOSURE', 'Every exposure needs a finite beta and matching factor return', { exposure });
    }
    value += beta * factorReturn;
  }
  const shock = Number(specificShock) || 0;
  const sigma = Number(specificVolatility) || 0;
  return value + shock * sigma;
};

export const projectPortfolioReturnFromFactors = ({ factorReturns, etfs }) => {
  let totalWeight = 0;
  let portfolioReturn = 0;
  for (const item of etfs || []) {
    const weight = Number(item.weight);
    if (!Number.isFinite(weight) || weight < 0) throw new FactorProjectionError('INVALID_ETF_WEIGHT', 'ETF weights must be finite and non-negative');
    totalWeight += weight;
    portfolioReturn += weight * projectEtfReturnFromFactors({ factorReturns, ...item });
  }
  if (Math.abs(totalWeight - 1) > 1e-6) {
    throw new FactorProjectionError('INVALID_PORTFOLIO_WEIGHTS', 'ETF weights must sum to 1', { totalWeight });
  }
  return portfolioReturn;
};
