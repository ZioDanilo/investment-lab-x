export type KpiName =
  | 'Rendimento atteso'
  | 'Volatilità'
  | 'Max Drawdown'
  | 'Numero ETF'
  | 'Recessione'
  | 'Stagflazione'
  | 'PQS'
  | 'TER medio'
  | 'Sharpe'
  | 'Diversificazione';

export interface KpiTarget {
  priority: number;
  name: KpiName;
  target: number;
  direction: 'higher' | 'lower' | 'range';
  actual?: number;
  score?: number;
  status?: 'OK' | 'KO';
}

export interface PortfolioSummary {
  expectedReturn: number;
  volatility: number;
  maxDrawdown: number;
  etfCount: number;
  recession: number;
  stagflation: number;
  pqs: number;
  ter: number;
  sharpe: number;
  diversification: number;
}
