import { FactorProjectionError, projectEtfReturnFromFactors } from './factor-projection.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const FACTOR_RETURN_MODES = Object.freeze({
  COMPOUNDED_RETURN: 'compounded_return',
  ADDITIVE_SHOCK: 'additive_shock'
});

const monthlyFactorLocation = (annualValue, returnMode) => {
  if (returnMode === FACTOR_RETURN_MODES.ADDITIVE_SHOCK) return annualValue / 12;
  if (annualValue <= -1) {
    throw new FactorProjectionError('INVALID_ANNUAL_FACTOR_RETURN', 'Compounded factor expected return must be greater than -100%', { annualValue, returnMode });
  }
  return Math.pow(1 + annualValue, 1 / 12) - 1;
};

export const validateFactorCorrelationMatrix = (matrix) => cholesky(matrix);

const cholesky = (matrix) => {
  const n = matrix.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i=0; i<n; i+=1) {
    for (let j=0; j<=i; j+=1) {
      let sum = matrix[i][j];
      for (let k=0; k<j; k+=1) sum -= out[i][k] * out[j][k];
      if (i === j) {
        if (sum < -1e-8) throw new FactorProjectionError('NON_PSD_FACTOR_CORRELATION', 'Factor correlation matrix is not positive semidefinite', { index: i, value: sum });
        out[i][j] = Math.sqrt(Math.max(sum, 1e-12));
      } else {
        out[i][j] = sum / out[j][j];
      }
    }
  }
  return out;
};

const standardNormal = (random) => {
  const u1 = Math.max(Number.EPSILON, random());
  const u2 = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

export const buildFactorCorrelationMatrix = (snapshot, scenario) => {
  const ids = snapshot.factorOrder || [];
  const persisted = snapshot.correlations?.[scenario] || {};
  return ids.map((left, i) => ids.map((right, j) => {
    if (i === j) return 1;
    const key = [String(left), String(right)].sort().join(':');
    const value = Number(persisted[key]);
    if (!Number.isFinite(value) || value < -1 || value > 1) {
      throw new FactorProjectionError('MISSING_FACTOR_CORRELATION', 'Missing or invalid factor correlation', { scenario, left, right });
    }
    return value;
  }));
};

export const generateMonthlyFactorReturns = (snapshot, scenario, intensity, random = Math.random) => {
  const normalizedIntensity = clamp(Number(intensity) || 0, 0, 1);
  const factors = snapshot.factors || [];
  const matrix = buildFactorCorrelationMatrix(snapshot, scenario);
  const lower = cholesky(matrix);
  const independent = factors.map(() => standardNormal(random));
  const correlated = lower.map((row, i) => row.slice(0, i + 1).reduce((sum, coefficient, j) => sum + coefficient * independent[j], 0));
  const factorReturns = {};

  factors.forEach((factor, index) => {
    const general = factor.statistics?.general;
    const stressed = factor.statistics?.[scenario];
    if (!general || !stressed) throw new FactorProjectionError('MISSING_FACTOR_STATISTICS', 'Factor statistics are incomplete', { factorId: factor.id, scenario });
    const annualMean = Number(general.expectedReturn) + (Number(stressed.expectedReturn) - Number(general.expectedReturn)) * normalizedIntensity;
    const annualVol = Math.max(0, Number(general.volatility) + (Number(stressed.volatility) - Number(general.volatility)) * normalizedIntensity);
    const returnMode = factor.returnMode || FACTOR_RETURN_MODES.COMPOUNDED_RETURN;
    if (!Object.values(FACTOR_RETURN_MODES).includes(returnMode)) {
      throw new FactorProjectionError('INVALID_FACTOR_RETURN_MODE', 'Unsupported factor return mode', { factorId: factor.id, returnMode });
    }
    const monthlyMean = monthlyFactorLocation(annualMean, returnMode);
    const monthlyVol = annualVol / Math.sqrt(12);
    factorReturns[factor.id] = monthlyMean + correlated[index] * monthlyVol;
  });
  return factorReturns;
};

export const generateMonthlyEtfReturnsFromFactors = (snapshot, scenario, intensity, random = Math.random) => {
  const factorReturns = generateMonthlyFactorReturns(snapshot, scenario, intensity, random);
  const etfReturns = (snapshot.etfs || []).filter(etf => etf.ready).map(etf => {
    const annualSpecificVol = Number(etf.specificRisk?.residualVolatility ?? etf.specificRisk?.annualizedVolatility ?? 0);
    const monthlySpecificVol = Math.max(0, annualSpecificVol) / Math.sqrt(12);
    return {
      etfId: etf.id,
      isin: etf.isin,
      monthlyReturn: projectEtfReturnFromFactors({
        factorReturns,
        exposures: etf.exposures,
        alpha: (Number(etf.specificRisk?.alpha) || 0) / 12,
        specificShock: standardNormal(random),
        specificVolatility: monthlySpecificVol
      })
    };
  });
  return { factorReturns, etfReturns };
};

/**
 * Pre-generation audit. Returns scenario-level theoretical annual risk without
 * rescaling betas or forcing historical ETF volatility targets.
 * All factor style premia must be incremental, not total equity returns.
 */
export const auditFactorMarketUniverse = (snapshot, scenarios = ['expansion','soft_landing','recession','stagflation']) => {
  const errors = [];
  const warnings = [];
  const etfs = [];
  const factors = snapshot.factors || [];
  const ids = snapshot.factorOrder || [];
  const factorById = new Map(factors.map(f => [String(f.id), f]));
  if (ids.length !== factors.length || new Set(ids.map(String)).size !== ids.length ||
      ids.some((id, i) => String(id) !== String(factors[i]?.id))) {
    errors.push({ code: 'FACTOR_ORDER_MISMATCH' });
  }
  for (const scenario of scenarios) {
    let matrix;
    try {
      matrix = buildFactorCorrelationMatrix(snapshot, scenario);
      cholesky(matrix);
    } catch (error) {
      errors.push({ code: error.code || 'INVALID_CORRELATION_MATRIX', scenario, message: error.message, details: error.details });
      continue;
    }
    for (const etf of (snapshot.etfs || []).filter(e => e.ready)) {
      let factorVariance = 0;
      const contributions = [];
      let invalid = false;
      for (const exposure of etf.exposures || []) {
        const factor = factorById.get(String(exposure.factorId));
        const beta = Number(exposure.beta);
        if (!factor || !Number.isFinite(beta)) {
          errors.push({ code: 'INVALID_ETF_EXPOSURE', isin: etf.isin, scenario, factorId: exposure.factorId });
          invalid = true;
          break;
        }
      }
      if (invalid) continue;
      const exposures = etf.exposures || [];
      for (let i = 0; i < exposures.length; i++) {
        const left = exposures[i];
        const li = ids.findIndex(id => String(id) === String(left.factorId));
        const lf = factorById.get(String(left.factorId));
        const ls = lf.statistics?.[scenario];
        const lg = lf.statistics?.general;
        if (!ls || !lg || !Number.isFinite(Number(ls.volatility)) || !Number.isFinite(Number(lg.volatility)) || Number(ls.volatility) < 0 || Number(lg.volatility) < 0) {
          errors.push({ code: 'INVALID_FACTOR_VOLATILITY', isin: etf.isin, scenario, factorId: left.factorId });
          invalid = true;
          break;
        }
        const volLeft = Number(ls.volatility);
        let contribution = 0;
        for (const right of exposures) {
          const ri = ids.findIndex(id => String(id) === String(right.factorId));
          const rf = factorById.get(String(right.factorId));
          const rs = rf.statistics?.[scenario];
          if (!rs || ri < 0 || li < 0 || !Number.isFinite(Number(rs.volatility))) {
            errors.push({ code: 'INVALID_FACTOR_VOLATILITY', isin: etf.isin, scenario, factorId: right.factorId });
            invalid = true;
            break;
          }
          contribution += Number(left.beta) * Number(right.beta) * volLeft * Number(rs.volatility) * matrix[li][ri];
        }
        if (invalid) break;
        contributions.push({ factorCode: lf.code, beta: Number(left.beta), varianceContribution: contribution });
        factorVariance += contribution;
      }
      if (invalid) continue;
      const residual = Number(etf.specificRisk?.residualVolatility ?? etf.specificRisk?.annualizedVolatility ?? 0);
      const target = Number(etf.specificRisk?.annualizedVolatility);
      if (!Number.isFinite(residual) || residual < 0) {
        errors.push({ code: 'INVALID_RESIDUAL_VOLATILITY', isin: etf.isin, scenario });
        continue;
      }
      if (factorVariance < -1e-8) {
        errors.push({ code: 'NEGATIVE_FACTOR_VARIANCE', isin: etf.isin, scenario, factorVariance });
        continue;
      }
      const totalVolatility = Math.sqrt(Math.max(0, factorVariance) + residual * residual);
      if (Number.isFinite(target) && target > 0 && Math.abs(totalVolatility - target) / target > 0.25) {
        warnings.push({ code: 'ETF_VOLATILITY_TARGET_DEVIATION', isin: etf.isin, scenario, implied: totalVolatility, reference: target });
      }
      etfs.push({ isin: etf.isin, scenario, factorVolatility: Math.sqrt(Math.max(0, factorVariance)), residualVolatility: residual, totalVolatility, annualizedVolatilityReference: Number.isFinite(target) ? target : null, contributions });
    }
  }
  // This is a semantic warning, not a claim that stored premia are double-counted.
  const styleCodes = new Set(['MOMENTUM','VALUE','QUALITY','LOW_VOLATILITY','GROWTH','SMALL_CAP']);
  for (const factor of factors) {
    if (styleCodes.has(String(factor.code)) && factor.returnMode === 'compounded_return') {
      warnings.push({ code: 'VERIFY_INCREMENTAL_STYLE_PREMIUM', factorCode: factor.code, message: 'Confirm that expected returns represent incremental style premia, not total equity returns.' });
    }
  }
  return { valid: errors.length === 0, errors, warnings, etfs, scenarios };
};
