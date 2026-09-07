import { MonteCarloUserInput } from '../models/monte-carlo-contracts.model';
import { MonthlyReturnVector } from '../returns/monte-carlo-return-engine';
import {
  evolveMonteCarloPortfolioPath,
  MonteCarloPortfolioPathError
} from './monte-carlo-portfolio-path-engine';

const assertClose = (actual: number, expected: number, tolerance: number, label: string): void => {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) throw new Error(`${label}: ${actual} is not within ${tolerance} of ${expected}`);
};

const input = (positions: MonteCarloUserInput['positions'], horizonYears = 1): MonteCarloUserInput => ({ positions, initialCapital: 100, horizonYears });

const vector = (returns: Record<string, number>): MonthlyReturnVector => ({
  scenario: 'expansion',
  intensity: 0.5,
  etfReturns: Object.entries(returns).map(([isin, monthlyReturn]) => ({
    isin,
    effectiveParameters: {
      effectiveMu: 0,
      effectiveSigma: 0,
      scenarioMonthlyReturnRange: { min: -2, max: 2 },
      reconstructedReturnRange: { min: -2, max: 2 },
      effectiveReturnRange: { min: -2, max: 2 }
    },
    standardizedShock: 0,
    monthlyReturn
  })),
  diagnostics: {
    attempts: 1,
    rejectedAttempts: 0,
    acceptedChiSquare: 5,
    rejectedChiSquares: [],
    targetCorrelation: [[1]],
    operationalCorrelation: [[1]],
    latentCorrelation: [[1]]
  }
});

const repeat = (months: number, returns: Record<string, number>): MonthlyReturnVector[] => Array.from({ length: months }, () => vector(returns));

const singlePath = evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 1 }]), [vector({ A: 0.1 }), ...repeat(11, { A: 0 })]);
assertClose(singlePath.finalCapital, 110, 1e-12, '100% single ETF capital');
assertClose(singlePath.monthly[0].portfolioReturn, 0.1, 1e-12, '100% single ETF return');

const balancedPath = evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 0.5 }, { isin: 'B', targetWeight: 0.5 }]), [vector({ A: 0.1, B: -0.1 }), ...repeat(11, { A: 0, B: 0 })]);
assertClose(balancedPath.monthly[0].portfolioReturn, 0, 1e-12, '50/50 weighted return');
assertClose(balancedPath.monthly[0].positions[0].contribution + balancedPath.monthly[0].positions[1].contribution, 0, 1e-12, 'Contributions identity');
assertClose(balancedPath.monthly[0].endingCapital, 100, 1e-12, 'Position-value accounting identity');
assertClose(balancedPath.monthly[0].positions[0].currentWeightEnd ?? NaN, 0.55, 1e-12, 'Natural weight drift');

const compoundPath = evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 1 }]), repeat(12, { A: 0.1 }));
assertClose(compoundPath.finalCapital, 100 * 1.1 ** 12, 1e-9, 'Monthly compounding');
assertClose(compoundPath.annual[0].annualPortfolioReturn, 1.1 ** 12 - 1, 1e-12, 'Geometric annual portfolio return');
assertClose(compoundPath.annual[0].etfs[0].annualContributionAtTargetWeight, 1.1 ** 12 - 1, 1e-12, 'Annual ETF contribution at target weight');

const zeroPositionPath = evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 0.5 }, { isin: 'B', targetWeight: 0.5 }], 2), [vector({ A: -1, B: 0 }), ...repeat(11, { A: 0.1, B: 0 }), ...repeat(12, { A: 0, B: 0 })]);
assertClose(zeroPositionPath.monthly[0].positions[0].endingValue, 0, 1e-12, 'Minus 100% ETF return zeros a position');
assertClose(zeroPositionPath.monthly[1].positions[0].endingValue, 0, 1e-12, 'Zero position remains zero before rebalance');
assertClose(zeroPositionPath.rebalances[0].etfs[0].positionValueAfter, 25, 1e-12, 'Rebalance repurchases zero position');

const zeroCapitalPath = evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 1 }], 2), [vector({ A: -1 }), ...repeat(23, { A: 0.1 })]);
if (zeroCapitalPath.monthly.slice(1).some((entry) => entry.endingCapital !== 0 || entry.portfolioReturn !== 0) || zeroCapitalPath.rebalances[0].portfolioValueAfter !== 0) {
  throw new Error('Zero capital must persist and annual rebalance must not resurrect it');
}
assertClose(zeroCapitalPath.maxDrawdown, 1, 1e-12, 'Zero capital maximum drawdown');

const recoveredPath = evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 1 }]), [vector({ A: -0.2 }), vector({ A: 0.25 }), ...repeat(10, { A: 0 })]);
assertClose(recoveredPath.maxDrawdown, 0.2, 1e-12, 'Known maximum drawdown');
if (recoveredPath.maxRecoveryTimeMonths !== 2 || recoveredPath.unrecovered) throw new Error('Return to the exact peak must complete the two-month recovery');

const unrecoveredPath = evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 1 }]), [vector({ A: -0.2 }), ...repeat(11, { A: 0 })]);
if (!unrecoveredPath.unrecovered || unrecoveredPath.unrecoveredDurationMonths !== 12 || unrecoveredPath.maxRecoveryTimeMonths !== null) {
  throw new Error('Open recovery must remain technical and excluded from completed recovery duration');
}

const rebalancePath = evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 0.5 }, { isin: 'B', targetWeight: 0.5 }], 2), [vector({ A: 1, B: 0 }), ...repeat(11, { A: 0, B: 0 }), ...repeat(12, { A: 0, B: 0 })]);
if (rebalancePath.rebalances.length !== 1 || rebalancePath.rebalances[0].year !== 1 || rebalancePath.rebalances[0].portfolioValueBefore !== rebalancePath.rebalances[0].portfolioValueAfter) {
  throw new Error('Rebalance must occur after December only and preserve capital');
}
assertClose(rebalancePath.rebalances[0].turnover ?? NaN, 1 / 6, 1e-12, 'Known turnover');
assertClose(rebalancePath.rebalances[0].etfs[0].positionValueAfter, 75, 1e-12, 'Rebalance restores first target');
assertClose(rebalancePath.rebalances[0].etfs[1].positionValueAfter, 75, 1e-12, 'Rebalance restores second target');

try {
  evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 1 }]), [vector({ A: Number.NaN }), ...repeat(11, { A: 0 })]);
  throw new Error('Expected invalid non-finite ETF return failure');
} catch (error) {
  if (!(error instanceof MonteCarloPortfolioPathError) || error.code !== 'INVALID_ETF_RETURN') throw error;
}
try {
  evolveMonteCarloPortfolioPath(input([{ isin: 'A', targetWeight: 1 }]), [vector({ A: -1.0001 }), ...repeat(11, { A: 0 })]);
  throw new Error('Expected negative-capital prevention failure');
} catch (error) {
  if (!(error instanceof MonteCarloPortfolioPathError) || error.code !== 'INVALID_ETF_RETURN') throw error;
}

console.log('Monte Carlo Step 7 portfolio path tests passed.');