import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { TastoConfermaComponent } from '../../shared/components/tasto-conferma/tasto-conferma.component';
import { DropdownComponent, DropdownOption } from '../../shared/components/dropdown/dropdown.component';
import { SpinnerComponent } from '../../shared/components/spinner/spinner.component';
import { MontecarloPortfolioEditorComponent, MontecarloPortfolioEditorChange } from '../../shared/components/montecarlo-portfolio-editor/montecarlo-portfolio-editor.component';
import { MonteCarloResult } from '../../core/models/monte-carlo-contracts.model';
import { buildMonteCarloSnapshotRequest, buildMonteCarloUserInput } from '../../core/monte-carlo-ui-flow';
import { MonteCarloCoordinator } from '../../core/engines/monte-carlo-coordinator';
import { validateMonteCarloRunContract } from '../../core/validation/monte-carlo-contract.validator';

@Component({
  selector: 'app-montecarlo-new-page',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe, TastoConfermaComponent, DropdownComponent, SpinnerComponent, MontecarloPortfolioEditorComponent],
  templateUrl: './montecarlo-new-page.component.html',
  styleUrls: ['./montecarlo-new-page.component.css']
})
export class MontecarloNewPageComponent implements OnInit {
  private apiService = inject(ApiService);
  private activeCoordinator: MonteCarloCoordinator | null = null;

  portafogli = signal<any[]>([]);
  selectedPortfolio = signal<any | null>(null);
  loadingPortafogli = signal(false);
  editorState = signal<MontecarloPortfolioEditorChange | null>(null);
  executionState = signal<'idle' | 'loadingSnapshot' | 'running' | 'aggregating' | 'completed' | 'failed' | 'cancelled'>('idle');
  progress = signal(0);
  advancedStatistics = signal(false);
  officialResult = signal<MonteCarloResult | null>(null);
  errorMessage = signal<string | null>(null);
  copiedStatistics = signal(false);

  readonly horizonYearsOptions = [5, 10, 20, 30, 50, 100];
  readonly initialCapitalOptions = [10_000, 50_000, 100_000, 250_000, 1_000_000];
  readonly selectedHorizonYears = signal(10);
  readonly selectedInitialCapital = signal(100_000);

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

  readonly officialKpiCards = computed(() => this.buildOfficialKpiCards(this.officialResult()));
  readonly capitalFan = computed(() => this.officialResult()?.capitalFan ?? []);
  readonly representativePath = computed(() => this.officialResult()?.representativePath ?? null);
  readonly statistics = computed(() => this.officialResult()?.statistics ?? null);
  readonly technicalChecks = computed(() => this.officialResult()?.technicalChecks ?? null);

  ngOnInit(): void {
    this.loadPortafogli();
  }

  loadPortafogli(): void {
    this.loadingPortafogli.set(true);
    this.apiService.getPortfolios().subscribe({
      next: (res: any) => {
        const portfolios = Array.isArray(res)
          ? res
          : Array.isArray(res?.data)
            ? res.data
            : [];

        this.portafogli.set(portfolios);
        this.loadingPortafogli.set(false);
      },
      error: () => this.loadingPortafogli.set(false)
    });
  }

  onPortfolioSelected(portfolioId: string): void {
    const portfolio = this.portafogli().find((p) => p.id === portfolioId);
    this.selectedPortfolio.set(portfolio ?? null);
    this.editorState.set(null);
    this.officialResult.set(null);
  }

  onEditorStateChange(change: MontecarloPortfolioEditorChange): void {
    this.editorState.set(change);
  }

  onHorizonYearsSelected(value: string): void {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      this.selectedHorizonYears.set(parsed);
    }
  }

  onInitialCapitalSelected(value: string): void {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      this.selectedInitialCapital.set(parsed);
    }
  }

  async runSimulation(): Promise<void> {
    const composition = this.editorState()?.effectiveEtfs ?? [];
    if (composition.length === 0) {
      return;
    }

    this.executionState.set('loadingSnapshot');
    this.progress.set(0);
    this.errorMessage.set(null);
    this.officialResult.set(null);

    try {
      const snapshotRequest = buildMonteCarloSnapshotRequest(
        composition.map((etf) => ({ isin: etf.isin, weight: Number(etf.weight ?? 0) }))
      );

      const snapshotResponse = await firstValueFrom(this.apiService.getMonteCarloSnapshot(snapshotRequest));
      const snapshot = snapshotResponse?.data;
      if (!snapshot) {
        throw new Error('Snapshot Monte Carlo non disponibile.');
      }

      const input = buildMonteCarloUserInput(
        composition.map((etf) => ({ isin: etf.isin, weight: Number(etf.weight ?? 0) })),
        this.selectedInitialCapital(),
        this.selectedHorizonYears()
      );

      validateMonteCarloRunContract(input, snapshot);

      this.executionState.set('running');
      const coordinator = new MonteCarloCoordinator({
        input,
        snapshot,
        mode: 'COMPLETE',
        advancedStatistics: this.advancedStatistics(),
        onProgress: (progress) => {
          this.progress.set(progress);
          if (progress >= 99 && this.executionState() !== 'completed' && this.executionState() !== 'failed' && this.executionState() !== 'cancelled') {
            this.executionState.set('aggregating');
          }
        }
      });
      this.activeCoordinator = coordinator;

      const outcome = await coordinator.run();
      if (outcome.status === 'cancelled') {
        this.executionState.set('cancelled');
        this.officialResult.set(null);
        this.errorMessage.set('Simulazione annullata.');
        return;
      }
      if (outcome.status === 'failed') {
        this.executionState.set('failed');
        this.officialResult.set(null);
        this.errorMessage.set(outcome.error?.message ?? 'Simulazione fallita.');
        return;
      }
      if (outcome.status === 'success' && outcome.result) {
        this.officialResult.set(outcome.result);
        this.executionState.set('completed');
        return;
      }

      throw new Error(outcome.error?.message ?? 'Simulazione Monte Carlo non completata.');
    } catch (error) {
      this.executionState.set('failed');
      this.officialResult.set(null);

      const backendMessage =
        (error as any)?.error?.error?.message ??
        (error as any)?.error?.message ??
        (error as any)?.message ??
        'Errore sconosciuto durante la simulazione.';

      this.errorMessage.set(`Impossibile costruire lo Snapshot Monte Carlo: ${backendMessage}`);
    } finally {
      this.activeCoordinator = null;
    }
  }

  cancelSimulation(): void {
    if (!this.activeCoordinator) {
      this.executionState.set('cancelled');
      this.officialResult.set(null);
      this.errorMessage.set('Simulazione annullata.');
      return;
    }
    this.activeCoordinator.cancel();
    this.executionState.set('cancelled');
    this.officialResult.set(null);
    this.errorMessage.set('Simulazione annullata.');
  }

  onAdvancedStatisticsToggle(event: Event): void {
    if (this.executionState() === 'running' || this.executionState() === 'loadingSnapshot') {
      return;
    }
    const target = event.target as HTMLInputElement | null;
    this.advancedStatistics.set(Boolean(target?.checked));
  }

  buildOfficialKpiCards(result: MonteCarloResult | null): Array<{ name: string; value: number | null; format: string; sub: string }> | null {
    if (!result) return null;
    const { mainKpis } = result;
    return [
      { name: 'CAGR robusto', value: mainKpis.robustCagr, format: 'percent', sub: `P5/P95: ${this.fmtPct(result.percentiles.cagr.p5)} / ${this.fmtPct(result.percentiles.cagr.p95)}` },
      { name: 'Max Drawdown robusto', value: mainKpis.robustMaxDrawdown, format: 'percent', sub: `P95: ${this.fmtPct(result.percentiles.maxDrawdown.p95)}` },
      { name: 'Volatilità', value: mainKpis.volatility, format: 'percent', sub: `P50 finale: ${this.fmtEur(result.percentiles.finalCapital.p50)}` },
      { name: 'Decorrelation Index', value: mainKpis.decorrelationIndex, format: 'percent', sub: `Lantieri: ${this.fmtPct(mainKpis.lantieriIndex)}` },
      { name: 'Recovery Time', value: mainKpis.recoveryTimeMonths, format: 'count', sub: `P50: ${this.fmtCount(result.percentiles.recoveryTimeMonths?.p50 ?? null)}` },
      { name: 'Capitale finale mediano', value: result.percentiles.finalCapital.p50, format: 'currency', sub: `P5/P95: ${this.fmtEur(result.percentiles.finalCapital.p5)} / ${this.fmtEur(result.percentiles.finalCapital.p95)}` }
    ];
  }

  copyStatistics(): void {
    const stats = this.statistics();
    if (!stats) return;
    this.copiedStatistics.set(true);
    void navigator.clipboard.writeText(JSON.stringify(stats, null, 2)).finally(() => {
      window.setTimeout(() => this.copiedStatistics.set(false), 1200);
    });
  }

  getProgressPathCount(): number {
    const progressRatio = Math.max(0, Math.min(100, this.progress())) / 100;
    return Math.round(progressRatio * 1000);
  }

  getExecutionStatusLabel(): string {
    switch (this.executionState()) {
      case 'loadingSnapshot':
        return 'Preparazione simulazione…';
      case 'running':
        return `Simulazione: ${this.getProgressPathCount()} / 1000`;
      case 'aggregating':
        return 'Finalizzazione risultati…';
      case 'completed':
        return 'Completato';
      default:
        return 'Simulazione';
    }
  }

  fmtPct(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return `${(value * 100).toFixed(2)}%`;
  }

  fmtEur(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
  }

  fmtCount(value: number | null | undefined): string {
    if (value === null || value === undefined) return 'Non disponibile';
    return `${Math.round(value).toLocaleString('it-IT')} mesi`;
  }

  fmtKpiValue(value: number | null | undefined, format: string): string {
    if (value === null || value === undefined) return 'Non disponibile';
    if (format === 'percent') return this.fmtPct(value);
    if (format === 'currency') return this.fmtEur(value);
    if (format === 'count') return this.fmtCount(value);
    return value.toFixed(2);
  }
}
