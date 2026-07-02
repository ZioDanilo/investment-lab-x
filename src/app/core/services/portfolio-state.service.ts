import { Injectable, computed, signal } from '@angular/core';
import { INITIAL_ETFS } from '../data/etf-data';
import { Etf, ScoredEtf } from '../models/etf.model';
import { KpiName, KpiTarget, PortfolioSummary } from '../models/kpi.model';
import { PortfolioEngine } from '../engines/portfolio.engine';

export interface MonteCarloSummary {
  simulatedValue: number;
  probabilityPositive: number;
  scenarios: number;
}

const DEFAULT_KPIS: KpiTarget[] = [
  { priority: 1, name: 'Rendimento atteso', target: 0.09, direction: 'higher' },
  { priority: 2, name: 'Volatilità', target: 0.12, direction: 'lower' },
  { priority: 3, name: 'Max Drawdown', target: -0.25, direction: 'higher' },
  { priority: 4, name: 'Numero ETF', target: 8, direction: 'lower' },
  { priority: 5, name: 'Recessione', target: -0.02, direction: 'higher' },
  { priority: 6, name: 'Stagflazione', target: 0.02, direction: 'higher' },
  { priority: 7, name: 'PQS', target: 80, direction: 'higher' },
  { priority: 8, name: 'TER medio', target: 0.003, direction: 'lower' },
  { priority: 9, name: 'Sharpe', target: 0.8, direction: 'higher' },
  { priority: 10, name: 'Diversificazione', target: 75, direction: 'higher' }
];

@Injectable({ providedIn: 'root' })
export class PortfolioStateService {
  etfs = signal<Etf[]>(INITIAL_ETFS);
  riskFree = signal(0.02);
  simulationSeed = signal(1);

  kpis = signal<KpiTarget[]>(DEFAULT_KPIS.map(kpi => ({ ...kpi })));

  portfolioSummary = computed<PortfolioSummary>(() => PortfolioEngine.calculateSummary(this.etfs(), this.riskFree()));
  firstKo = computed(() => PortfolioEngine.firstKo(this.portfolioSummary(), this.kpis()));
  scoredEtfs = computed<ScoredEtf[]>(() => PortfolioEngine.scoreEtfs(this.etfs(), this.firstKo()));
  kpiValues = computed(() => PortfolioEngine.kpiValues(this.portfolioSummary()));
  monteCarloSummary = computed<MonteCarloSummary>(() => this.calculateMonteCarloSummary());

  updateEtfWeight(index: number, weightPercent: number): void {
    const next = [...this.etfs()];
    next[index] = { ...next[index], weight: weightPercent / 100 };
    this.etfs.set(next);
    this.runMonteCarloSimulation();
  }

  updateKpiTarget(index: number, target: number): void {
    const next = [...this.kpis()];
    next[index] = { ...next[index], target };
    this.kpis.set(next);
    this.runMonteCarloSimulation();
  }

  updateKpiName(index: number, name: KpiName): void {
    const next = [...this.kpis()];
    const baseKpi = DEFAULT_KPIS.find(kpi => kpi.name === name);
    next[index] = {
      ...next[index],
      name,
      target: baseKpi?.target ?? next[index].target,
      direction: baseKpi?.direction ?? next[index].direction
    };
    this.kpis.set(next);
    this.runMonteCarloSimulation();
  }

  moveKpi(fromIndex: number, toIndex: number): void {
    const next = [...this.kpis()];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    this.kpis.set(next);
    this.runMonteCarloSimulation();
  }

  resetKpis(): void {
    this.kpis.set(DEFAULT_KPIS.map(kpi => ({ ...kpi })));
    this.runMonteCarloSimulation();
  }

  availableKpiNames(index: number): KpiName[] {
    const selectedAbove = this.kpis().slice(0, index).map(kpi => kpi.name);
    const currentName = this.kpis()[index]?.name;
    return DEFAULT_KPIS.map(kpi => kpi.name).filter((name): name is KpiName => (!selectedAbove.includes(name) || name === currentName));
  }

  runMonteCarloSimulation(): void {
    const nextSeed = this.simulationSeed() + 1;
    this.simulationSeed.set(nextSeed);
  }

  private calculateMonteCarloSummary(): MonteCarloSummary {
    const summary = this.portfolioSummary();
    const baseValue = 1 + summary.expectedReturn;
    const seed = this.simulationSeed();
    const scenarios = 200 + seed * 7;
    const simulatedValue = baseValue + (seed % 11 - 5) * 0.003 + summary.volatility * 0.15;
    const probabilityPositive = Math.min(1, Math.max(0, 0.5 + (summary.expectedReturn - summary.volatility) * 3 + (seed % 7) * 0.01));

    return {
      simulatedValue,
      probabilityPositive,
      scenarios
    };
  }
}
