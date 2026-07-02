import { Etf, ScoredEtf } from '../models/etf.model';
import { KpiTarget, PortfolioSummary } from '../models/kpi.model';

export class PortfolioEngine {
  static calculateSummary(etfs: Etf[], riskFree = 0.02): PortfolioSummary {
    const totalWeight = etfs.reduce((sum, etf) => sum + etf.weight, 0) || 1;
    const normalized = etfs.map(etf => ({ ...etf, weight: etf.weight / totalWeight }));

    const expectedReturn = normalized.reduce((sum, etf) => sum + etf.weight * etf.expectedReturn, 0);
    const volatility = Math.sqrt(normalized.reduce((sum, etf) => sum + Math.pow(etf.weight * etf.volatility, 2), 0));
    const maxDrawdown = normalized.reduce((sum, etf) => sum + etf.weight * etf.maxDrawdown, 0);
    const etfCount = normalized.filter(etf => etf.weight > 0.001).length;
    const recession = normalized.reduce((sum, etf) => sum + etf.weight * etf.recession, 0);
    const stagflation = normalized.reduce((sum, etf) => sum + etf.weight * etf.stagflation, 0);
    const ter = normalized.reduce((sum, etf) => sum + etf.weight * etf.ter, 0);
    const sharpe = volatility > 0 ? (expectedReturn - riskFree) / volatility : 0;
    const diversification = this.calculateDiversification(etfCount, volatility);
    const pqs = this.calculatePqs(expectedReturn, volatility, maxDrawdown, diversification, etfCount);

    return { expectedReturn, volatility, maxDrawdown, etfCount, recession, stagflation, pqs, ter, sharpe, diversification };
  }

  static firstKo(summary: PortfolioSummary, kpis: KpiTarget[]): KpiTarget | null {
    const values = this.kpiValues(summary);
    return [...kpis].sort((a, b) => a.priority - b.priority).find(kpi => {
      const actual = values[kpi.name];
      return kpi.direction === 'higher' ? actual < kpi.target : actual > kpi.target;
    }) ?? null;
  }

  static kpiValues(summary: PortfolioSummary): Record<string, number> {
    return {
      'Rendimento atteso': summary.expectedReturn,
      'Volatilità': summary.volatility,
      'Max Drawdown': summary.maxDrawdown,
      'Numero ETF': summary.etfCount,
      'Recessione': summary.recession,
      'Stagflazione': summary.stagflation,
      'PQS': summary.pqs,
      'TER medio': summary.ter,
      'Sharpe': summary.sharpe,
      'Diversificazione': summary.diversification
    };
  }

  static scoreEtfs(etfs: Etf[], activeKpi: KpiTarget | null): ScoredEtf[] {
    return etfs.map(etf => {
      const score = this.scoreEtfForKpi(etf, activeKpi);
      const suggestion = score >= 70 ? 'Aumenta' : score >= 40 ? 'Neutro' : 'Riduci';
      return { ...etf, score, suggestion };
    });
  }

  private static scoreEtfForKpi(etf: Etf, kpi: KpiTarget | null): number {
    if (!kpi) return 50;
    switch (kpi.name) {
      case 'Rendimento atteso': return this.normalize(etf.expectedReturn, 0.04, 0.12);
      case 'Volatilità': return 100 - this.normalize(etf.volatility, 0.07, 0.20);
      case 'Max Drawdown': return 100 - this.normalize(Math.abs(etf.maxDrawdown), 0.15, 0.50);
      case 'Numero ETF': return 50;
      case 'Recessione': return this.normalize(etf.recession, -0.15, 0.07);
      case 'Stagflazione': return this.normalize(etf.stagflation, -0.10, 0.10);
      case 'PQS': return (this.normalize(etf.expectedReturn, 0.04, 0.12) + (100 - this.normalize(etf.volatility, 0.07, 0.20))) / 2;
      case 'TER medio': return 100 - this.normalize(etf.ter, 0.001, 0.007);
      case 'Sharpe': return this.normalize((etf.expectedReturn - 0.02) / Math.max(etf.volatility, 0.001), 0.2, 1.4);
      case 'Diversificazione': return 100 - this.normalize(etf.volatility, 0.07, 0.20);
      default: return 50;
    }
  }

  private static calculateDiversification(etfCount: number, volatility: number): number {
    const countScore = etfCount >= 5 && etfCount <= 9 ? 100 : Math.max(0, 100 - Math.abs(etfCount - 7) * 12);
    const volScore = 100 - this.normalize(volatility, 0.07, 0.20);
    return 0.6 * countScore + 0.4 * volScore;
  }

  private static calculatePqs(expectedReturn: number, volatility: number, maxDrawdown: number, diversification: number, etfCount: number): number {
    const returnScore = this.normalize(expectedReturn, 0.04, 0.12);
    const volatilityScore = 100 - this.normalize(volatility, 0.07, 0.20);
    const ddScore = 100 - this.normalize(Math.abs(maxDrawdown), 0.15, 0.50);
    const simplicityScore = etfCount >= 5 && etfCount <= 9 ? 100 : Math.max(0, 100 - Math.abs(etfCount - 7) * 12);
    return 0.25 * returnScore + 0.25 * volatilityScore + 0.25 * ddScore + 0.15 * diversification + 0.10 * simplicityScore;
  }

  private static normalize(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  }
}
