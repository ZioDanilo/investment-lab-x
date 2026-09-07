import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';
import { MonteCarloStateService } from '../../core/services/monte-carlo-state.service';
import { PortfolioStateService } from '../../core/services/portfolio-state.service';
import { TastoConfermaComponent } from '../../shared/components/tasto-conferma/tasto-conferma.component';
import { DropdownComponent, DropdownOption } from '../../shared/components/dropdown/dropdown.component';
import { SpinnerComponent } from '../../shared/components/spinner/spinner.component';
import { MontecarloPortfolioEditorComponent, MontecarloPortfolioEditorChange } from '../../shared/components/montecarlo-portfolio-editor/montecarlo-portfolio-editor.component';
import { MontecarloContributionChartComponent } from '../../shared/components/montecarlo-contribution-chart/montecarlo-contribution-chart.component';
import { MontecarloPortfolioReturnChartComponent } from '../../shared/components/montecarlo-portfolio-return-chart/montecarlo-portfolio-return-chart.component';
import {
  MacroScenario,
  MACRO_SCENARIOS,
  SCENARIO_LABELS,
  ExtendedMonteCarloSummary,
  MonteCarloPathResult,
  MonteCarloGeneralValidation
} from '../../core/models/monte-carlo.model';

interface MonteCarloHistoryEntry {
  id: string;
  label: string;
  createdAt: string;
  summary: ExtendedMonteCarloSummary;
}

@Component({
  selector: 'app-montecarlo-page',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe, TastoConfermaComponent, DropdownComponent, SpinnerComponent, MontecarloPortfolioEditorComponent, MontecarloContributionChartComponent, MontecarloPortfolioReturnChartComponent],
  templateUrl: './montecarlo-page.component.html',
  styleUrls: ['./montecarlo-page.component.css']
})
export class MontecarloPageComponent implements OnInit {
  private apiService = inject(ApiService);
  readonly mc = inject(MonteCarloStateService);
  private portfolioState = inject(PortfolioStateService);

  // --- Portafogli dal backend ---
  portafogli = signal<any[]>([]);
  selectedPortfolio = signal<any | null>(null);
  loadingPortafogli = signal(false);
  editorState = signal<MontecarloPortfolioEditorChange | null>(null);
  readonly resultHistory = signal<MonteCarloHistoryEntry[]>([]);

  // --- Scenari esposti al template ---
  readonly scenarios = MACRO_SCENARIOS;
  readonly scenarioLabels = SCENARIO_LABELS;

  // --- Dettaglio simulazione selezionata ---
  readonly selectedPathLabel = computed(() => {
    const id = this.mc.selectedSimId();
    if (id === null) return '-';
    return `Simulazione #${id}`;
  });

  // --- Params locali per i binding del form ---
  get params() { return this.mc.params(); }

  readonly horizonYearsOptions = [5, 10, 20, 30, 50, 100];
  readonly initialCapitalOptions = [10_000, 50_000, 100_000, 250_000, 1_000_000];
  readonly simulationCountOptions = [
    { value: 1,       label: '1' },
    { value: 1_000,   label: '1.000' },
    { value: 10_000,  label: '10.000' },
  ];

  readonly portfolioDropdownOptions = computed<DropdownOption[]>(() =>
    this.portafogli().map((portfolio) => ({
      value: portfolio.id,
      label: portfolio.name ?? portfolio.nome ?? portfolio.id
    }))
  );

  readonly horizonDropdownOptions: DropdownOption[] = this.horizonYearsOptions.map((years) => ({
    value: String(years),
    label: `${years} anni`
  }));

  readonly initialCapitalDropdownOptions: DropdownOption[] = this.initialCapitalOptions.map((value) => ({
    value: String(value),
    label: `${value.toLocaleString('it-IT')} €`
  }));

  readonly simulationDropdownOptions: DropdownOption[] = this.simulationCountOptions.map((option) => ({
    value: String(option.value),
    label: option.label
  }));

  onHorizonYearsChange(event: Event): void {
    const v = parseInt((event.target as HTMLSelectElement).value, 10);
    if (!isNaN(v)) this.mc.updateParam('horizonYears', v);
  }

  onSimulationCountChange(event: Event): void {
    const v = parseInt((event.target as HTMLSelectElement).value, 10);
    if (!isNaN(v)) this.mc.updateParam('simulationCount', v);
  }

  onHorizonYearsSelected(value: string): void {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      this.mc.updateParam('horizonYears', parsed);
    }
  }

  onInitialCapitalSelected(value: string): void {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      this.mc.updateParam('initialCapital', parsed);
    }
  }

  onSimulationCountSelected(value: string): void {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      this.mc.updateParam('simulationCount', parsed);
    }
  }

  // --- KPI risultato (dal summary) ---
  readonly summary = this.mc.summary;
  readonly displayedSummary = computed<ExtendedMonteCarloSummary | null>(() => this.resultHistory()[0]?.summary ?? this.mc.summary());
  readonly historicalResults = computed(() => this.resultHistory().slice(1, 3));
  readonly representativeContributionAnalysis = computed(() => this.displayedSummary()?.representativeContributionAnalysis ?? null);

  readonly generalValidation = computed<MonteCarloGeneralValidation | null>(() =>
    this.mc.summary()?.generalValidation ?? null
  );

  readonly etfsMissingGeneralStats = computed<string[]>(() =>
    this.mc.summary()?.etfsMissingGeneralStats ?? []
  );

  readonly generalValidationStatusClass = computed(() => {
    const v = this.generalValidation();
    if (!v) return '';
    return v.status === 'CALIBRATED' ? 'status-calibrated'
         : v.status === 'WARNING'    ? 'status-warning'
         : 'status-not-calibrated';
  });
  readonly kpiCards = computed(() => this.buildKpiCards(this.displayedSummary()));

  ngOnInit(): void {
    this.loadPortafogli();
  }

  loadPortafogli(): void {
    this.loadingPortafogli.set(true);
    this.apiService.getPortfolios().subscribe({
      next: (res: any) => {
        if (res.success && Array.isArray(res.data)) {
          this.portafogli.set(res.data);
        }
        this.loadingPortafogli.set(false);
      },
      error: () => this.loadingPortafogli.set(false)
    });
  }

  onPortfolioSelected(portfolioId: string): void {
    const portfolio = this.portafogli().find(p => p.id === portfolioId);
    this.selectedPortfolio.set(portfolio ?? null);
    this.editorState.set(null);
    this.mc.hasValidPortfolio.set(false);

    if (portfolio) {
      this.portfolioState.loadPortfolioEtfs(portfolio.id, (etfs) => {
        this.mc.setPortfolioSelected(etfs);
      });
    }
  }

  onEditorStateChange(change: MontecarloPortfolioEditorChange): void {
    this.editorState.set(change);
    this.mc.hasValidPortfolio.set(change.state.isValid && change.effectiveEtfs.every((etf) => !!etf.macroStatistics));
  }

  async runSimulation(): Promise<void> {
    const composition = this.editorState()?.effectiveEtfs ?? [];
    if (composition.length === 0) {
      return;
    }

    await this.mc.run(composition);

    const latestSummary = this.mc.summary();
    if (latestSummary) {
      this.addResultToHistory(latestSummary);
    }
  }

  updateStructural(scenario: MacroScenario, event: Event): void {
    const v = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.mc.updateStructuralProb(scenario, isNaN(v) ? 0 : v);
  }

  updateTransition(from: MacroScenario, to: MacroScenario, event: Event): void {
    const v = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.mc.updateTransitionCell(from, to, isNaN(v) ? 0 : v);
  }

  updateParam(key: string, event: Event): void {
    const v = parseFloat((event.target as HTMLInputElement).value);
    if (!isNaN(v)) {
      this.mc.updateParam(key as any, key === 'seed' ? (v || undefined) : v);
    }
  }

  updateTargetCagr(event: Event): void {
    const v = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.mc.updateParam('targetCagr', isNaN(v) ? 0.07 : v);
  }

  structuralDisplayPct(scenario: MacroScenario): number {
    return Math.round(this.mc.structuralProbabilities()[scenario] * 1000) / 10;
  }

  transitionDisplayPct(from: MacroScenario, to: MacroScenario): number {
    return Math.round(this.mc.transitionMatrix()[from][to] * 1000) / 10;
  }

  transitionRowSumPct(row: MacroScenario): number {
    return Math.round(this.mc.transitionRowSums()[row] * 100);
  }

  rowValid(row: MacroScenario): boolean {
    return Math.abs(this.mc.transitionRowSums()[row] - 1) < 0.001;
  }

  selectPath(id: number): void {
    this.mc.selectedSimId.set(id);
    this.expandedYears.clear();
  }

  // --- Espansione righe anno ---
  expandedYears = new Set<number>();

  toggleYear(year: number): void {
    if (this.expandedYears.has(year)) {
      this.expandedYears.delete(year);
    } else {
      this.expandedYears.add(year);
    }
    // Forza re-render di Angular (il Set non è reactive di default)
    this.expandedYears = new Set(this.expandedYears);
  }

  getDetailedPathLabel(path: MonteCarloPathResult): string {
    const sorted = [...this.mc.detailedPaths()].sort((a, b) => a.finalCapital - b.finalCapital);
    if (sorted.length === 0) return `#${path.simulationId}`;
    const ids = {
      worst: sorted[0].simulationId,
      best: sorted[sorted.length - 1].simulationId,
      median: sorted[Math.floor(sorted.length / 2)].simulationId,
      maxDd: this.mc.detailedPaths().reduce((p, c) => c.maxDrawdown < p.maxDrawdown ? c : p).simulationId
    };
    if (path.simulationId === ids.best) return 'Migliore';
    if (path.simulationId === ids.worst) return 'Peggiore';
    if (path.simulationId === ids.median) return 'Mediana';
    if (path.simulationId === ids.maxDd) return 'Max Drawdown';
    return `Prima (#${path.simulationId})`;
  }

  // --- Formattatori ---
  buildKpiCards(summary: ExtendedMonteCarloSummary | null): Array<{ name: string; value: number | null; format: string; description?: string; sub: string }> | null {
    if (!summary) return null;
    return [
      {
        name: 'CAGR mediano',
        value: summary.medianCagr,
        format: 'percent',
        description: 'Rendimento annuo composto del percorso centrale tra tutte le simulazioni valide.',
        sub: `P5: ${this.fmtPct(summary.percentile5Cagr)} | P25: ${this.fmtPct(summary.percentile25Cagr)} | P75: ${this.fmtPct(summary.percentile75Cagr)} | P95: ${this.fmtPct(summary.percentile95Cagr)}`
      },
      {
        name: 'Capitale Finale Mediano',
        value: summary.medianFinalCapital,
        format: 'currency',
        sub: `P5: ${this.fmtEur(summary.percentile5FinalCapital)} – P95: ${this.fmtEur(summary.percentile95FinalCapital)}`
      },
      {
        name: 'Media 5% Peggiori Drawdown',
        value: summary.averageWorst5PercentMaxDrawdown,
        format: 'percent',
        sub: `Peggior: ${this.fmtPct(summary.worstMaxDrawdown)}`
      },
      {
        name: 'Prob. Perdita',
        value: summary.probabilityOfLoss,
        format: 'percent',
        sub: `P(CAGR≥${this.fmtPct(this.params.targetCagr)}): ${this.fmtPct(summary.probabilityCagrAboveTarget)}`
      },
      {
        name: 'Simulazioni valide',
        value: summary.validSimulationCount,
        format: 'count',
        sub: `${summary.validSimulationCount} / ${summary.simulationCount}${summary.failedPathCount > 0 ? ` (${summary.failedPathCount} fallite)` : ''}`
      }
    ];
  }

  private addResultToHistory(summary: ExtendedMonteCarloSummary): void {
    const entry: MonteCarloHistoryEntry = {
      id: `${Date.now()}-${this.resultHistory().length}`,
      label: `Simulazione ${this.resultHistory().length + 1}`,
      createdAt: new Date().toLocaleString('it-IT'),
      summary
    };

    this.resultHistory.update((items) => [entry, ...items].slice(0, 3));
  }

  trackByHistoryEntry(index: number, entry: MonteCarloHistoryEntry): string {
    return entry.id;
  }

  fmtPct(v: number | null | undefined): string {
    if (v === null || v === undefined) return '-';
    return `${(v * 100).toFixed(2)}%`;
  }

  fmtEur(v: number | null | undefined): string {
    if (v === null || v === undefined) return '-';
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  }

  fmtKpiValue(value: number | null, format: string): string {
    if (value === null || value === undefined) return '-';
    if (format === 'percent') return this.fmtPct(value);
    if (format === 'currency') {
      return new Intl.NumberFormat('it-IT', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    }
    if (format === 'count') {
      return Math.round(value).toLocaleString('it-IT');
    }
    return value.toFixed(2);
  }
}
