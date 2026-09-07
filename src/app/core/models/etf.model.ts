import { EtfMacroStatistics } from './monte-carlo.model';

export interface Etf {
  id: string;
  name: string;
  nickname?: string;
  isin: string;
  ticker?: string;
  description?: string;
  compartment: string;
  mission: string;
  weight: number;
  expectedReturn: number;
  volatility: number;
  maxDrawdown: number;
  ter: number;
  liquidity: number;
  recession: number;
  stagflation: number;
  /** Long-term expected CAGR (target) for this ETF */
  longTermExpectedReturn?: number;
  /** Calibration status: timestamp of last calibration, null if not calibrated */
  calibratedAt?: string | null;
  /** Last median CAGR from calibration run */
  lastCalibrationMedianCagr?: number;
  macroStatistics?: EtfMacroStatistics;
}

export interface ScoredEtf extends Etf {
  score: number;
  suggestion: 'Aumenta' | 'Neutro' | 'Riduci';
}
