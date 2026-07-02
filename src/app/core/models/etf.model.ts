export interface Etf {
  id: string;
  name: string;
  isin: string;
  ticker?: string;
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
}

export interface ScoredEtf extends Etf {
  score: number;
  suggestion: 'Aumenta' | 'Neutro' | 'Riduci';
}
