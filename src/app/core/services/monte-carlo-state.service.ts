import { Injectable, signal, computed } from '@angular/core';
import {
  MonteCarloState,
  MonteCarloParams,
  MonteCarloSummary,
  MonteCarloPathResult,
  StructuralProbabilities,
  TransitionMatrix,
  MacroScenario,
  MACRO_SCENARIOS,
  DEFAULT_STRUCTURAL_PROBABILITIES,
  DEFAULT_TRANSITION_MATRIX,
  MonteCarloDistributionSettings,
  DEFAULT_DISTRIBUTION_SETTINGS,
  SimulationRebalanceSettings,
  DEFAULT_REBALANCE_SETTINGS,
  PortfolioPosition,
  ExtendedMonteCarloSummary,
  ExtendedMonteCarloPathResult,
  MonteCarloRunOptions,
  EtfCorrelation
} from '../models/monte-carlo.model';
import { MonteCarloEngine } from '../engines/monte-carlo.engine.refactored';
import { PortfolioStateService } from './portfolio-state.service';
import { ApiService } from '../api/api.service';
import { PortfolioSnapshotFactory } from '../engines/portfolio-snapshot.factory';
import { Etf } from '../models/etf.model';

interface TemporaryMonteCarloCompositionItem {
  id: string;
  name: string;
  isin: string;
  ticker?: string;
  weight: number;
}

@Injectable({ providedIn: 'root' })
export class MonteCarloStateService {
  // -----------------------------------------------------------------------
  // Parametri della simulazione
  // -----------------------------------------------------------------------
  readonly params = signal<MonteCarloParams>({
    initialCapital: 10_000,
    simulationCount: 1_000,
    targetCagr: 0.07,
    horizonYears: 100,
    seed: undefined
  });

  readonly structuralProbabilities = signal<StructuralProbabilities>({ ...DEFAULT_STRUCTURAL_PROBABILITIES });
  readonly transitionMatrix = signal<TransitionMatrix>(
    JSON.parse(JSON.stringify(DEFAULT_TRANSITION_MATRIX))
  );
  readonly distributionSettings = signal<MonteCarloDistributionSettings>({ ...DEFAULT_DISTRIBUTION_SETTINGS });
  readonly rebalanceSettings = signal<SimulationRebalanceSettings>({ ...DEFAULT_REBALANCE_SETTINGS });

  // -----------------------------------------------------------------------
  // Stato di esecuzione
  // -----------------------------------------------------------------------
  readonly running = signal(false);
  readonly progress = signal(0);
  readonly summary = signal<ExtendedMonteCarloSummary | null>(null);
  readonly detailedPaths = signal<ExtendedMonteCarloPathResult[]>([]);
  readonly selectedSimId = signal<number | null>(null);

  // -----------------------------------------------------------------------
  // Portfolio tracking for UI state
  // -----------------------------------------------------------------------
  readonly hasValidPortfolio = signal(false);

  // -----------------------------------------------------------------------
  // Validazione
  // -----------------------------------------------------------------------
  readonly structuralProbsSum = computed(() =>
    MACRO_SCENARIOS.reduce((s, k) => s + this.structuralProbabilities()[k], 0)
  );
  readonly structuralProbsValid = computed(() =>
    Math.abs(this.structuralProbsSum() - 1) < 0.001
  );
  readonly transitionRowSums = computed<Record<MacroScenario, number>>(() => {
    const matrix = this.transitionMatrix();
    const result = {} as Record<MacroScenario, number>;
    MACRO_SCENARIOS.forEach(row => {
      result[row] = MACRO_SCENARIOS.reduce((s, col) => s + matrix[row][col], 0);
    });
    return result;
  });
  readonly transitionMatrixValid = computed(() =>
    MACRO_SCENARIOS.every(row => Math.abs(this.transitionRowSums()[row] - 1) < 0.001)
  );
  readonly canRun = computed(() =>
    this.structuralProbsValid() && this.transitionMatrixValid() && !this.running() && this.hasValidPortfolio()
  );

  selectedPath = computed<MonteCarloPathResult | null>(() => {
    const id = this.selectedSimId();
    if (id === null) return null;
    return this.detailedPaths().find(p => p.simulationId === id) ?? null;
  });

  /**
   * Notifies service that a portfolio is selected with ETFs that have macro statistics
   */
  setPortfolioSelected(etfs: Etf[]): void {
    // Check if all ETFs have macro statistics
    const allHaveMacroStats = etfs.every(etf => etf.macroStatistics !== undefined);
    const hasPositiveWeights = etfs.some(etf => etf.weight > 0);
    this.hasValidPortfolio.set(allHaveMacroStats && hasPositiveWeights);
  }

  constructor(
    private portfolioState: PortfolioStateService,
    private apiService: ApiService
  ) {
    this.loadConfigFromAPI();
  }

  // -----------------------------------------------------------------------
  // Caricamento configurazione dal database
  // -----------------------------------------------------------------------
  private loadConfigFromAPI(): void {
    this.apiService.getMonteCarloConfig().subscribe({
      next: (response) => {
        if (response?.data) {
          // Update structural probabilities from API
          if (response.data.structuralProbabilities) {
            this.structuralProbabilities.set(response.data.structuralProbabilities);
          }

          // Update transition matrix from API
          if (response.data.transitionMatrix) {
            this.transitionMatrix.set(response.data.transitionMatrix);
          }

          console.log('✅ Monte Carlo configuration loaded from API');
        }
      },
      error: (err) => {
        console.warn('⚠️  Failed to load Monte Carlo config from API, using defaults:', err.message);
        // Keep using default values
      }
    });
  }

  // -----------------------------------------------------------------------
  // Metodi di aggiornamento
  // -----------------------------------------------------------------------
  updateParam<K extends keyof MonteCarloParams>(key: K, value: MonteCarloParams[K]): void {
    this.params.update(p => ({ ...p, [key]: value }));
  }

  updateStructuralProb(scenario: MacroScenario, value: number): void {
    this.structuralProbabilities.update(p => ({ ...p, [scenario]: value }));
  }

  updateTransitionCell(from: MacroScenario, to: MacroScenario, value: number): void {
    this.transitionMatrix.update(m => {
      const next = JSON.parse(JSON.stringify(m)) as TransitionMatrix;
      next[from][to] = value;
      return next;
    });
  }

  // -----------------------------------------------------------------------
  // Esecuzione simulazione
  // -----------------------------------------------------------------------
  async run(overrideEtfs?: Etf[] | TemporaryMonteCarloCompositionItem[]): Promise<void> {
    if (!this.canRun()) return;

    this.running.set(true);
    this.progress.set(0);
    this.summary.set(null);
    this.detailedPaths.set([]);

    // Let Angular flush the running state so loading indicators become visible
    // before the heavy simulation loop starts.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const etfs = overrideEtfs ?? this.portfolioState.etfs();
    const etfWeights: Record<string, number> = {};

    const normalizedEtfs = Array.isArray(etfs) && etfs.length > 0 && 'isin' in etfs[0]
      ? etfs as Etf[]
      : (etfs as TemporaryMonteCarloCompositionItem[]).map((item) => ({
          id: item.id,
          name: item.name,
          isin: item.isin,
          ticker: item.ticker,
          description: item.name,
          compartment: 'ETF',
          mission: item.name,
          weight: item.weight / 100,
          expectedReturn: 0,
          volatility: 0,
          maxDrawdown: 0,
          ter: 0,
          liquidity: 5,
          recession: 0,
          stagflation: 0,
          macroStatistics: undefined
        }));

    // Collect weights from ETFs
    for (const etf of normalizedEtfs) {
      etfWeights[etf.isin] = etf.weight || 0;
    }

    try {
      // Create portfolio snapshot from current portfolio state
      const portfolio: PortfolioPosition[] = [];
      let totalWeight = 0;

      for (const etf of normalizedEtfs) {
        const weight = etfWeights[etf.isin] || 0;
        if (weight > 0) {
          portfolio.push({
            isin: etf.isin,
            name: etf.name,
            weight
          });
          totalWeight += weight;
        }
      }

      // Normalize weights
      if (Math.abs(totalWeight - 1.0) > 1e-6 && totalWeight > 0) {
        for (const pos of portfolio) {
          pos.weight /= totalWeight;
        }
      }

      // Create immutable snapshot
      const portfolioSnapshot = PortfolioSnapshotFactory.createSnapshot(
        normalizedEtfs,
        etfWeights
      );

      // Load correlations from API (stub for now - will need to fetch real data)
      const correlations: EtfCorrelation[] = [];

      // Run simulation with new architecture
      const result = await MonteCarloEngine.runAsync({
        etfs: normalizedEtfs,
        params: this.params(),
        structural: this.structuralProbabilities(),
        transition: this.transitionMatrix(),
        distributionSettings: this.distributionSettings(),
        rebalanceSettings: this.rebalanceSettings(),
        portfolio,
        portfolioSnapshot,
        correlations,
        onProgress: pct => this.progress.set(pct)
      } as MonteCarloRunOptions);

      this.summary.set(result.summary);
      this.detailedPaths.set(result.detailedPaths);
      if (result.detailedPaths.length > 0) {
        this.selectedSimId.set(result.detailedPaths[0].simulationId);
      }
    } catch (error) {
      console.error('Monte Carlo simulation failed:', error);
      this.summary.set(null);
      this.detailedPaths.set([]);
    } finally {
      this.running.set(false);
      this.progress.set(100);
    }
  }
}
