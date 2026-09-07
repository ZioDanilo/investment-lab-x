import { MonteCarloSnapshot, MonteCarloUserInput, MonteCarloSnapshotRequest } from './models/monte-carlo-contracts.model';
import { MONTE_CARLO_EXECUTION_MODES, MonteCarloCoordinator } from './engines/monte-carlo-coordinator';
import { validateMonteCarloRunContract } from './validation/monte-carlo-contract.validator';

export interface MonteCarloUiPositionInput {
  isin: string;
  weight: number;
}

export interface MonteCarloPortfolioHoldingInput {
  isin?: string;
  etfId?: string;
  weight: number;
}

export const buildMonteCarloSnapshotRequest = (positions: MonteCarloUiPositionInput[]): MonteCarloSnapshotRequest => ({
  isins: positions.map((position) => position.isin)
});

export const buildMonteCarloUserInputFromPortfolioHoldings = (
  holdings: MonteCarloPortfolioHoldingInput[],
  initialCapital: number,
  horizonYears: number
): MonteCarloUserInput => {
  const positions = holdings
    .filter((holding) => Boolean(holding?.isin || holding?.etfId))
    .map((holding) => ({
      isin: String(holding.isin ?? holding.etfId),
      weight: Number(holding.weight)
    }));

  return buildMonteCarloUserInput(positions, initialCapital, horizonYears);
};

export const buildMonteCarloUserInput = (
  positions: MonteCarloUiPositionInput[],
  initialCapital: number,
  horizonYears: number
): MonteCarloUserInput => {
  const normalized = positions.map((position) => ({
    isin: position.isin,
    targetWeight: position.weight
  }));

  const totalWeight = normalized.reduce((sum, position) => sum + position.targetWeight, 0);
  if (normalized.length === 0) {
    throw new Error('EMPTY_PORTFOLIO');
  }
  if (Math.abs(totalWeight - 1) > 1e-6) {
    throw new Error('INVALID_TARGET_WEIGHT_SUM');
  }

  return {
    positions: normalized,
    initialCapital,
    horizonYears
  };
};

export const createCompleteExecutionMode = (): keyof typeof MONTE_CARLO_EXECUTION_MODES => 'COMPLETE';

export const createMonteCarloCoordinator = (input: MonteCarloUserInput, snapshot: MonteCarloSnapshot, mode: keyof typeof MONTE_CARLO_EXECUTION_MODES = 'COMPLETE') => {
  validateMonteCarloRunContract(input, snapshot);
  return new MonteCarloCoordinator({
    input,
    snapshot,
    mode,
    onProgress: () => undefined
  });
};
