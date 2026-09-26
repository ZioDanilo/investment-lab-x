export type MarketScenarioKey = 'expansion' | 'soft_landing' | 'recession' | 'stagflation' | 'general';

export interface MarketScenarioStatistics {
  expectedReturn: number | null;
  volatility: number | null;
  maxDrawdown?: number | null;
  returnRange: {
    min: number | null;
    max: number | null;
  };
}

export interface MarketAsset {
  id: string;
  isin: string;
  ticker?: string;
  name: string;
  nickname?: string;
  description?: string;
  assetClass?: string;
  subAssetClass?: string;
  category?: string;
  geography?: string;
  currency?: string;
  instrumentType?: string;
  provider?: string;
  ter?: number | null;
  distributing?: boolean;
  hedged?: boolean;
  expectedReturn: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
  returnRangeMin: number | null;
  returnRangeMax: number | null;
  expansion: MarketScenarioStatistics | null;
  soft_landing: MarketScenarioStatistics | null;
  recession: MarketScenarioStatistics | null;
  stagflation: MarketScenarioStatistics | null;
  general: MarketScenarioStatistics | null;
  source: 'backend' | 'legacy-fallback';
  legacyFallback?: boolean;
}
