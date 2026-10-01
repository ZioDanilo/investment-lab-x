import { FactorProjectionError, projectEtfReturnFromFactors } from './factor-projection.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
    const monthlyMean = Math.pow(1 + annualMean, 1 / 12) - 1;
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
