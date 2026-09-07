export interface MontecarloUiResult {
  id: number;
  timestamp: number;
  title: string;
  medianCagr: number;
  medianFinalCapital: number;
  averageWorst5PercentMaxDrawdown: number;
  probabilityOfLoss: number;
  validSimulationCount: number;
}
