import { CommonModule } from '@angular/common';
import { Component, HostListener, ViewChild, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { MonteCarloStatisticsEngine } from '../../core/engines/monte-carlo-statistics.engine';
import { MarketUniverseBinaryTransport, type DecodedMarketUniverseBinary } from '../../core/market-universe/market-universe-binary-transport';
import { MonteCarloResult } from '../../core/models/monte-carlo-contracts.model';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { MontecarloPortfolioEditorComponent, type MontecarloPortfolioEditorChange } from '../../shared/components/montecarlo-portfolio-editor/montecarlo-portfolio-editor.component';
import { ToastComponent } from '../../shared/components/toast/toast.component';
import {
  buildCagrHistogramFromPaths,
  buildDrawdownDisplayGeometry,
  buildHistogramGeometry,
  buildMaxDrawdownHistogramFromPaths,
  computeHistogramTooltipPercentage,
  formatHistogramPercentage,
  resolveHistogramHoverIndex
} from './monte-carlo-cagr-histogram';

interface MacroDonutSegment {
  key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation';
  label: string;
  value: number;
  percent: number;
  color: string;
}

interface KpiCard {
  id: string;
  title: string;
  value: string;
  description: string;
  tone: 'cyan' | 'violet' | 'blue' | 'amber' | 'red' | 'teal';
}

@Component({
  selector: 'app-montecarlo-page',
  standalone: true,
  imports: [CommonModule, MontecarloPortfolioEditorComponent, ToastComponent],
  templateUrl: './montecarlo-page.component.html',
  styleUrls: ['./montecarlo-page.component.css']
})
export class MontecarloPageComponent {
  private readonly portfolioSelectionService = inject(PortfolioSelectionService);
  private readonly apiService = inject(ApiService);

  @ViewChild(ToastComponent) toast!: ToastComponent;

  readonly selectedPortfolio = this.portfolioSelectionService.selectedPortfolio;
  readonly editorState = signal<MontecarloPortfolioEditorChange | null>(null);
  private kpiConfigLoadVersion = 0;
  private loadedKpiPortfolioId: string | null = null;
  finalReturnDistribution: { label: string; subtitle: string; bins: Array<{ label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number }> } = {
    label: 'Distribuzione dei rendimenti finali',
    subtitle: 'Distribuzione simulata a 30 anni',
    bins: []
  };
  macroScenarioDistribution: Array<{ label: string; percent: number; color: string; value: number; key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation' }> = [];
  donutSegments: Array<{ path: string; color: string; percent: number; label: string; displayPercent: number; labelX: number; labelY: number; key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation' }> = this.buildDonutSegments();

  private readonly defaultKpis: KpiCard[] = [
    { id: 'expectedReturn', title: 'Rendimento annuo', value: '—', description: 'CAGR annuo', tone: 'cyan' },
    { id: 'volatility', title: 'Volatilità', value: '—', description: 'Deviazione standard annua', tone: 'violet' },
    { id: 'positiveReturnProbability', title: 'Rendimento positivo (30 anni)', value: '—', description: 'Scenari con rendimento > 0', tone: 'blue' },
    { id: 'recoveryPeriod', title: 'Periodo di recupero', value: '—', description: 'Tempo medio al break-even', tone: 'amber' },
    { id: 'averageMaxDrawdown', title: 'Drawdown', value: '—', description: 'Perdita massima media', tone: 'red' }
  ];

  private marketUniverseBinaryMetadataCache: {
    runId: string;
    transportVersion: number;
    pathCount: number;
    monthCount: number;
    scenarios: Uint8Array;
    intensities: Float64Array;
  } | null = null;

  isRunning = false;
  simulationProgress = 0;
  completionHoldActive = false;
  private completionHoldTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private progressAnimationIntervalId: ReturnType<typeof setInterval> | null = null;
  private progressAnimationStartedAt = 0;
  private progressAnimationCeiling = 60;
  isRegeneratingMarketUniverse = false;
  marketUniverseStatusMessage: string | null = null;
  kpis: KpiCard[] = [...this.defaultKpis];
  readonly kpiTargetOptions: Record<string, string[]> = {
    expectedReturn: ['2%', '3%', '4%', '5%', '6%', '7%', '8%'],
    volatility: ['6%', '8%', '10%', '12%', '14%', '16%', '18%'],
    positiveReturnProbability: ['80%', '90%', '95%', '97%', '99%', '100%'],
    recoveryPeriod: ['1 anno', '2 anni', '3 anni', '4 anni', '5 anni', '6 anni'],
    averageMaxDrawdown: ['10%', '15%', '20%', '25%', '30%', '35%', '40%']
  };
  kpiTargets: Record<string, string> = {
    expectedReturn: '–',
    volatility: '–',
    positiveReturnProbability: '–',
    recoveryPeriod: '–',
    averageMaxDrawdown: '–'
  };


  constructor() {
    effect(() => {
      const portfolioId = this.selectedPortfolio()?.id ?? null;
      void this.loadPortfolioKpiConfiguration(portfolioId);
    });
  }

  private resetPortfolioKpiConfiguration(): void {
    this.kpis = this.defaultKpis.map((kpi) => ({ ...kpi }));
    this.kpiTargets = {
      expectedReturn: '–',
      volatility: '–',
      positiveReturnProbability: '–',
      recoveryPeriod: '–',
      averageMaxDrawdown: '–'
    };
    this.openKpiTargetId = null;
  }

  private async loadPortfolioKpiConfiguration(portfolioId: string | null): Promise<void> {
    const loadVersion = ++this.kpiConfigLoadVersion;
    // Persisted targets/order are configuration only. Results belong exclusively
    // to the simulation that produced them and must never survive a portfolio load.
    this.kpiResultValues = {};
    if (!portfolioId) {
      this.loadedKpiPortfolioId = null;
      this.resetPortfolioKpiConfiguration();
      return;
    }

    try {
      const response = await firstValueFrom(this.apiService.getPortfolioKpiTargets(portfolioId));
      if (loadVersion !== this.kpiConfigLoadVersion || this.selectedPortfolio()?.id !== portfolioId) {
        return;
      }

      const rows = Array.isArray(response?.data) ? response.data : [];
      const defaultById = new Map(this.defaultKpis.map((kpi) => [kpi.id, kpi]));
      const validRows = rows
        .filter((row: any) => defaultById.has(String(row?.kpi)))
        .sort((left: any, right: any) => Number(left?.priority) - Number(right?.priority));

      if (validRows.length !== this.defaultKpis.length || new Set(validRows.map((row: any) => String(row.kpi))).size !== this.defaultKpis.length) {
        this.resetPortfolioKpiConfiguration();
        return;
      }

      this.kpis = validRows.map((row: any) => ({ ...defaultById.get(String(row.kpi))! }));
      this.kpiTargets = Object.fromEntries(
        this.defaultKpis.map((kpi) => {
          const row = validRows.find((item: any) => String(item.kpi) === kpi.id);
          return [kpi.id, row?.target == null || String(row.target).trim() === '' ? '–' : String(row.target)];
        })
      );
      this.openKpiTargetId = null;
      this.loadedKpiPortfolioId = portfolioId;
    } catch (error) {
      if (loadVersion === this.kpiConfigLoadVersion && this.selectedPortfolio()?.id === portfolioId) {
        console.error('[KPI target load]', error);
        this.resetPortfolioKpiConfiguration();
      }
    }
  }

  private async saveCurrentPortfolioKpiConfiguration(): Promise<void> {
    const portfolioId = this.editorState()?.state?.selectedPortfolioId ?? this.selectedPortfolio()?.id ?? null;
    if (!portfolioId) {
      throw new Error('Impossibile salvare i KPI: nessun portafoglio selezionato.');
    }

    const payload = this.kpis.map((kpi, index) => ({
      kpi: kpi.id,
      priority: index + 1,
      target: this.kpiTargets[kpi.id] ?? '–'
    }));

    const response = await firstValueFrom(this.apiService.savePortfolioKpiTargets(portfolioId, payload));
    if (response?.success === false) {
      throw new Error(response?.error || 'Salvataggio configurazione KPI non riuscito');
    }
  }
  openKpiTargetId: string | null = null;
  kpiResultValues: Record<string, number | null> = {};
  draggedKpiId: string | null = null;
  draggedKpiPreview: KpiCard | null = null;
  draggedKpiPreviewPosition = { left: 0, top: 0, width: 0, height: 0 };
  private draggedKpiPointerOffset = { x: 0, y: 0 };
  suppressKpiTransitions = false;
  swapTargetId: string | null = null;
  insertTargetIndex: number | null = null;
  readonly macroTotal = 360000;
  hoveredHistogramBin: { label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number } | null = null;
  histogramTooltipPercentage: string | null = null;
  histogramTooltipPosition = { left: 0, top: 0 };
  maxDrawdownDistribution: { label: string; subtitle: string; bins: Array<{ label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number }> } = {
    label: 'Distribuzione Max Drawdown',
    subtitle: 'Distribuzione del drawdown massimo nei 30 anni',
    bins: []
  };
  hoveredMaxDrawdownBin: { label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number } | null = null;
  maxDrawdownTooltipPercentage: string | null = null;
  maxDrawdownTooltipPosition = { left: 0, top: 0 };

  portfolioEvolution: Array<{ year: number; annualReturn: number }> = [];
  portfolioEvolutionHistory: Array<Array<{ year: number; annualReturn: number }>> = [];
  hoveredPortfolioEvolutionYear: number | null = null;
  portfolioEvolutionTooltipPosition = { left: 0, top: 0 };

  getHistogramTotalPaths(): number {
    return this.finalReturnDistribution.bins.reduce((sum, bin) => sum + Number(bin.value ?? 0), 0) || 0;
  }

  private getHistogramTooltipText(bin: { label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number } | null): string | null {
    if (!bin) {
      return null;
    }

    const count = Number(bin.value ?? 0);
    const total = this.getHistogramTotalPaths();

    if (!Number.isFinite(count) || total <= 0) {
      return null;
    }

    const percentage = (count / total) * 100;
    return percentage.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  private clearHistogramHover(): void {
    this.hoveredHistogramBin = null;
    this.histogramTooltipPercentage = null;
  }

  onHistogramBarPointerEnter(bin: { label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number }, event: PointerEvent): void {
    this.hoveredHistogramBin = bin;
    this.histogramTooltipPercentage = this.getHistogramTooltipText(bin);
    this.updateHistogramTooltipPosition(event);
  }

  onHistogramBarPointerLeave(): void {
    this.clearHistogramHover();
  }

  onHistogramPlotPointerLeave(): void {
    this.clearHistogramHover();
  }

  private updateHistogramTooltipPosition(event: PointerEvent): void {
    const target = event.currentTarget as SVGRectElement | null;
    const svg = target?.ownerSVGElement;
    const plot = svg?.closest('.histogram-plot') as HTMLElement | null;
    if (!svg || !plot) {
      return;
    }

    const centerX = Number(target?.dataset.centerX ?? 0);
    const viewBoxWidth = Number(svg.viewBox.baseVal.width || 520);
    const plotWidth = plot.clientWidth || 520;
    const left = ((centerX / viewBoxWidth) * plotWidth);
    const clampedLeft = Math.min(Math.max(left, 54), plotWidth - 54);

    this.histogramTooltipPosition = {
      left: clampedLeft,
      top: 20
    };
  }

  get runButtonLabel(): string {
    if (!this.isRunning && !this.completionHoldActive) {
      return 'AVVIA SIMULAZIONE';
    }

    return 'SIMULAZIONE IN CORSO';
  }

  get buttonFillWidth(): number {
    if (this.completionHoldActive) {
      return 100;
    }

    return Math.max(0, Math.min(99, this.simulationProgress));
  }

  private clearCompletionHold(): void {
    if (this.completionHoldTimeoutId) {
      clearTimeout(this.completionHoldTimeoutId);
      this.completionHoldTimeoutId = null;
    }
    this.completionHoldActive = false;
  }

  private startProgressAnimation(): void {
    this.stopProgressAnimation();
    this.simulationProgress = 1;
    this.progressAnimationCeiling = 60;
    this.progressAnimationStartedAt = performance.now();
    this.progressAnimationIntervalId = setInterval(() => {
      if (!this.isRunning) {
        return;
      }

      // Stage-aware UX progress. It moves quickly but never crosses the ceiling
      // of the current real phase, so a slow request cannot fake completion.
      const remaining = Math.max(0, this.progressAnimationCeiling - this.simulationProgress);
      const step = Math.max(0.8, remaining * 0.16);
      this.simulationProgress = Math.min(this.progressAnimationCeiling, this.simulationProgress + step);
    }, 80);
  }

  private advanceProgressStage(target: number): void {
    this.progressAnimationCeiling = Math.max(this.progressAnimationCeiling, Math.min(99, target));
    if (this.simulationProgress < target - 12) {
      this.simulationProgress = target - 12;
    }
  }

  private async completeProgressAnimation(): Promise<void> {
    this.progressAnimationCeiling = 100;
    const startedAt = performance.now();
    while (this.simulationProgress < 99 && performance.now() - startedAt < 220) {
      this.simulationProgress = Math.min(100, this.simulationProgress + Math.max(4, (100 - this.simulationProgress) * 0.35));
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
    this.simulationProgress = 100;
    await new Promise<void>((resolve) => setTimeout(resolve, 90));
  }

  private stopProgressAnimation(): void {
    if (this.progressAnimationIntervalId) {
      clearInterval(this.progressAnimationIntervalId);
      this.progressAnimationIntervalId = null;
    }
  }

  private showToast(message: string): void {
    if (this.toast) {
      this.toast.show(message);
      return;
    }
    console.error(message);
  }

  async regenerateMarketUniverse(): Promise<void> {
    if (this.isRegeneratingMarketUniverse) {
      return;
    }

    this.isRegeneratingMarketUniverse = true;
    this.marketUniverseStatusMessage = 'RIGENERAZIONE...';

    try {
      const response = await firstValueFrom(this.apiService.regenerateMarketUniverse());
      const payload = response?.data ?? response;
      const assetCount = Number(payload?.assetCount ?? payload?.assets?.length ?? 0);
      const incompleteCount = Number(payload?.incompleteAssetCount ?? 0);

      if (!payload?.success) {
        throw new Error(payload?.error || 'Market Universe regeneration failed');
      }

      this.marketUniverseStatusMessage = null;
    } catch (error: any) {
      const message = error?.error?.error || error?.message || 'Errore nella rigenerazione del Market Universe';
      this.marketUniverseStatusMessage = null;
      this.showToast(message);
    } finally {
      this.isRegeneratingMarketUniverse = false;
    }
  }

  private buildScenarioPathFromMonthEntries(
    monthEntries: Array<{ month?: number; year?: number; scenario?: string }>,
    horizonYears: number
  ): { years: Array<{ year: number; scenario: 'expansion' | 'soft_landing' | 'recession' | 'stagflation'; durationInCurrentScenario: number }>; frequencies: Record<'expansion' | 'soft_landing' | 'recession' | 'stagflation', number> } {
    const frequencies: Record<'expansion' | 'soft_landing' | 'recession' | 'stagflation', number> = {
      expansion: 0,
      recession: 0,
      stagflation: 0,
      soft_landing: 0
    };
    const yearBuckets = new Map<number, Record<'expansion' | 'soft_landing' | 'recession' | 'stagflation', number>>();

    for (const entry of [...monthEntries].sort((left: any, right: any) => Number(left?.month ?? 0) - Number(right?.month ?? 0))) {
      const month = Number(entry?.month ?? 0);
      const year = Number(entry?.year ?? (month > 0 ? Math.floor((month - 1) / 12) + 1 : 1));
      const scenario = this.normalizeScenarioKey(entry?.scenario ?? 'expansion');
      frequencies[scenario] += 1;

      const bucket = yearBuckets.get(year) ?? { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 };
      bucket[scenario] += 1;
      yearBuckets.set(year, bucket);
    }

    const years = [] as Array<{ year: number; scenario: 'expansion' | 'soft_landing' | 'recession' | 'stagflation'; durationInCurrentScenario: number }>;
    for (let yearIndex = 1; yearIndex <= horizonYears; yearIndex += 1) {
      const bucket = yearBuckets.get(yearIndex) ?? { expansion: 0, recession: 0, stagflation: 0, soft_landing: 0 };
      const candidate = (Object.entries(bucket) as Array<[ 'expansion' | 'soft_landing' | 'recession' | 'stagflation', number ]>)
        .sort((left, right) => right[1] - left[1])[0];
      const scenario = candidate?.[0] ?? 'expansion';
      const duration = Math.max(candidate?.[1] ?? 0, 1);
      years.push({ year: yearIndex, scenario, durationInCurrentScenario: duration });
    }

    return { years, frequencies };
  }

  private normalizeScenarioKey(scenario: string | null | undefined): 'expansion' | 'soft_landing' | 'recession' | 'stagflation' {
    const normalized = String(scenario ?? 'expansion').trim().toLowerCase();
    if (normalized === 'softlanding' || normalized === 'soft_landing' || normalized === 'soft landing') {
      return 'soft_landing';
    }
    if (normalized === 'recessione' || normalized === 'recession') {
      return 'recession';
    }
    if (normalized === 'stagflazione' || normalized === 'stagflation') {
      return 'stagflation';
    }
    return 'expansion';
  }

  private buildPathResultFromProjection(rawPath: any, pathIndex: number, initialCapital: number, horizonYears: number): { cagr: number; simulationId: number; maxDrawdown: number } {
    const monthlyReturns = Array.isArray(rawPath?.monthlyReturns)
      ? rawPath.monthlyReturns.map((value: any) => Number(value) || 0)
      : [];
    const monthEntries = Array.isArray(rawPath?.months) ? rawPath.months : [];
    const normalizedMonths = monthEntries.length > 0
      ? monthEntries
          .slice()
          .sort((left: any, right: any) => Number(left?.monthIndex ?? 0) - Number(right?.monthIndex ?? 0))
          .map((entry: any, monthIndex: number) => ({
            month: Number(entry?.monthIndex ?? monthIndex) + 1,
            monthWithinYear: (Number(entry?.monthIndex ?? monthIndex) % 12) + 1,
            year: Math.floor(Number(entry?.monthIndex ?? monthIndex) / 12) + 1,
            portfolioReturn: Number(entry?.weightedReturn ?? entry?.return ?? 0),
            endingCapital: 0,
            capital: 0,
            runningPeak: 0,
            drawdown: 0,
            intensity: Number(entry?.intensity ?? 0),
            scenario: entry?.scenario ?? 'expansion'
          }))
      : monthlyReturns.map((weightedReturn: number, monthIndex: number) => {
          const month = monthIndex + 1;
          const year = Math.floor((month - 1) / 12) + 1;
          return {
            month,
            monthWithinYear: ((month - 1) % 12) + 1,
            year,
            portfolioReturn: weightedReturn,
            endingCapital: 0,
            capital: 0,
            runningPeak: 0,
            drawdown: 0,
            intensity: 0,
            scenario: 'expansion'
          };
        });

    let runningCapital = initialCapital;
    let runningPeak = initialCapital;
    let maxDrawdown = 0;

    for (const monthEntry of normalizedMonths) {
      const portfolioReturn = Number(monthEntry.portfolioReturn ?? 0);
      runningCapital = runningCapital * (1 + portfolioReturn);
      runningPeak = Math.max(runningPeak, runningCapital);
      const drawdown = runningPeak > 0 ? (runningPeak - runningCapital) / runningPeak : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    const finalCapital = runningCapital;
    const cagr = Math.pow(Math.max(finalCapital / initialCapital, Number.EPSILON), 1 / Math.max(horizonYears, 1)) - 1;
    return { cagr, simulationId: Number(rawPath?.pathId ?? pathIndex + 1), maxDrawdown };
  }

  private normalizeBinaryProjectionProjection(decoded: DecodedMarketUniverseBinary): any {
    const modeScenarioCache = decoded.payloadType === 'FULL' ? decoded.scenarios : this.marketUniverseBinaryMetadataCache?.scenarios ?? null;
    const modeIntensityCache = decoded.payloadType === 'FULL' ? decoded.intensities : this.marketUniverseBinaryMetadataCache?.intensities ?? null;

    if (!modeScenarioCache || !modeIntensityCache) {
      throw new Error('Binary Market Universe payload missing scenario/intensity metadata for statistics adaptation.');
    }

    const pathEntries = [] as any[];
    const totalPaths = Number(decoded.pathCount || 0);
    const totalMonths = Number(decoded.monthCount || 0);

    for (let pathId = 0; pathId < totalPaths; pathId += 1) {
      const monthlyReturns = [] as number[];
      const months = [] as any[];
      const baseIndex = pathId * totalMonths;

      for (let monthIndex = 0; monthIndex < totalMonths; monthIndex += 1) {
        const flatIndex = baseIndex + monthIndex;
        const weightedReturn = Number(decoded.returns[flatIndex] ?? 0);
        const scenarioCode = modeScenarioCache[flatIndex] ?? 0;
        const scenario = MarketUniverseBinaryTransport.decodeScenarioCode(scenarioCode);
        const intensity = Number(modeIntensityCache[flatIndex] ?? 0);
        monthlyReturns.push(weightedReturn);
        months.push({
          monthIndex,
          scenario,
          intensity,
          weightedReturn
        });
      }

      pathEntries.push({
        pathId,
        monthlyReturns,
        months
      });
    }

    return {
      success: true,
      run: {
        runId: decoded.runId,
        pathCount: totalPaths,
        monthCount: totalMonths,
        assetCount: 0,
        status: 'ACTIVE',
        active: true,
        generatedAt: new Date().toISOString()
      },
      pathCount: totalPaths,
      monthCount: totalMonths,
      paths: pathEntries
    };
  }

  private setBinaryMetadataCacheFromDecoded(decoded: DecodedMarketUniverseBinary): void {
    if (decoded.payloadType !== 'FULL') {
      return;
    }
    if (!decoded.scenarios || !decoded.intensities) {
      throw new Error('FULL binary payload is missing required scenario or intensity arrays.');
    }

    this.marketUniverseBinaryMetadataCache = {
      runId: decoded.runId,
      transportVersion: decoded.version,
      pathCount: decoded.pathCount,
      monthCount: decoded.monthCount,
      scenarios: decoded.scenarios,
      intensities: decoded.intensities
    };
  }

  private invalidateBinaryMetadataCache(): void {
    this.marketUniverseBinaryMetadataCache = null;
  }

  private ensureBinaryMetadataCompatibility(decoded: DecodedMarketUniverseBinary): void {
    const metadata = this.marketUniverseBinaryMetadataCache;
    if (!metadata) {
      throw new Error('Binary Market Universe metadata cache is empty for RETURNS_ONLY validation.');
    }

    if (decoded.runId !== metadata.runId || decoded.version !== metadata.transportVersion || decoded.pathCount !== metadata.pathCount || decoded.monthCount !== metadata.monthCount) {
      this.invalidateBinaryMetadataCache();
      throw new Error('Binary Market Universe metadata mismatch: refusing to combine stale run metadata.');
    }
  }

  private async requestBinaryProjectionForHoldings(
    holdings: Array<{ isin: string; weight: number }>,
    options: {
      knownRunId?: string | null;
      previousRunId?: string | null;
      payloadType?: 'FULL' | 'RETURNS_ONLY';
    } = {}
  ): Promise<DecodedMarketUniverseBinary> {
    const response = await firstValueFrom(this.apiService.buildBinaryPortfolioProjectionFromActiveMarketUniverse({
      holdings,
      knownRunId: options.knownRunId ?? null,
      previousRunId: options.previousRunId ?? null,
      payloadType: options.payloadType ?? 'FULL'
    }));

    if (!response) {
      throw new Error('Binary Market Universe response was empty.');
    }

    const arrayBuffer = response instanceof ArrayBuffer
      ? response
      : (response as ArrayBufferView)?.buffer instanceof ArrayBuffer
        ? (response as ArrayBufferView).buffer
        : new Uint8Array(response as ArrayBuffer | number[]).buffer;

    return MarketUniverseBinaryTransport.decode(arrayBuffer);
  }

  private async requestBinarySimulationProjection(holdings: Array<{ isin: string; weight: number }>): Promise<any> {
    const baseKnownRunId = this.marketUniverseBinaryMetadataCache?.runId ?? null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const knownRunId = attempt === 0 ? baseKnownRunId : null;
      const payloadType = attempt === 0 && knownRunId ? 'RETURNS_ONLY' : 'FULL';
      const previousRunId = attempt === 0 && knownRunId ? knownRunId : null;

      try {
        const decoded = await this.requestBinaryProjectionForHoldings(holdings, {
          knownRunId,
          previousRunId,
          payloadType
        });

        if (decoded.payloadType === 'RETURNS_ONLY') {
          this.ensureBinaryMetadataCompatibility(decoded);
          return this.normalizeBinaryProjectionProjection(decoded);
        }

        this.setBinaryMetadataCacheFromDecoded(decoded);
        return this.normalizeBinaryProjectionProjection(decoded);
      } catch (error) {
        lastError = error;
        if (attempt === 0 && baseKnownRunId && (error instanceof Error) && /stale|mismatch|invalid|metadata/i.test(error.message)) {
          this.invalidateBinaryMetadataCache();
          continue;
        }
        break;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Binary Market Universe request failed.');
  }

  private buildOfficialResultFromProjection(projection: any, initialCapital: number, horizonYears: number): MonteCarloResult {
    const pathEntries = Array.isArray(projection?.paths) ? projection.paths : [];
    if (pathEntries.length === 0) {
      throw new Error('Nessun percorso disponibile nel Market Universe attivo.');
    }

    const buildPathResult = (rawPath: any, pathIndex: number) => {
      const monthlyReturns = Array.isArray(rawPath?.monthlyReturns)
        ? rawPath.monthlyReturns.map((value: any) => Number(value) || 0)
        : [];
      const monthEntries = Array.isArray(rawPath?.months) ? rawPath.months : [];
      const normalizedMonths = monthEntries.length > 0
        ? monthEntries
            .slice()
            .sort((left: any, right: any) => Number(left?.monthIndex ?? 0) - Number(right?.monthIndex ?? 0))
            .map((entry: any, monthIndex: number) => {
              const weightedReturn = Number(entry?.weightedReturn ?? entry?.return ?? 0);
              const month = Number(entry?.monthIndex ?? monthIndex) + 1;
              const year = Math.floor((month - 1) / 12) + 1;
              const monthWithinYear = ((month - 1) % 12) + 1;
              return {
                month,
                monthWithinYear,
                year,
                portfolioReturn: weightedReturn,
                endingCapital: 0,
                capital: 0,
                runningPeak: 0,
                drawdown: 0,
                intensity: Number(entry?.intensity ?? 0),
                scenario: entry?.scenario ?? 'expansion'
              };
            })
        : monthlyReturns.map((weightedReturn: number, monthIndex: number) => {
            const month = monthIndex + 1;
            const year = Math.floor((month - 1) / 12) + 1;
            return {
              month,
              monthWithinYear: ((month - 1) % 12) + 1,
              year,
              portfolioReturn: weightedReturn,
              endingCapital: 0,
              capital: 0,
              runningPeak: 0,
              drawdown: 0,
              intensity: 0,
              scenario: 'expansion'
            };
          });

      const persistedMaxRecoveryTimeMonths = Number.isFinite(Number(rawPath?.maxRecoveryTimeMonths)) ? Number(rawPath.maxRecoveryTimeMonths) : null;
      const persistedUnrecovered = rawPath?.unrecovered === true;
      const persistedUnrecoveredDurationMonths = Number.isFinite(Number(rawPath?.unrecoveredDurationMonths)) ? Number(rawPath.unrecoveredDurationMonths) : null;

      let runningCapital = initialCapital;
      let runningPeak = initialCapital;
      let maxDrawdown = 0;
      let recoveryStartMonth: number | null = null;
      let maxRecoveryTimeMonths = persistedMaxRecoveryTimeMonths ?? null;
      let unrecovered = persistedUnrecovered ?? false;
      let unrecoveredDurationMonths = persistedUnrecoveredDurationMonths ?? null;

      const monthly = normalizedMonths.map((monthEntry: any) => {
        const portfolioReturn = Number(monthEntry.portfolioReturn ?? 0);
        runningCapital = runningCapital * (1 + portfolioReturn);
        const priorPeak = runningPeak;
        runningPeak = Math.max(runningPeak, runningCapital);
        const drawdown = runningPeak > 0 ? (runningPeak - runningCapital) / runningPeak : 0;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        if (runningCapital < priorPeak && recoveryStartMonth === null) {
          recoveryStartMonth = Number(monthEntry.month ?? 0);
        } else if (runningCapital >= priorPeak && recoveryStartMonth !== null) {
          const recoveryDuration = Number(monthEntry.month ?? 0) - recoveryStartMonth + 1;
          maxRecoveryTimeMonths = Math.max(maxRecoveryTimeMonths ?? 0, recoveryDuration);
          recoveryStartMonth = null;
        }

        const endingCapital = runningCapital;

        return {
          month: Number(monthEntry.month ?? 0),
          year: Number(monthEntry.year ?? 1),
          endingCapital,
          capital: endingCapital,
          portfolioReturn,
          runningPeak,
          drawdown,
          intensity: Number(monthEntry.intensity ?? 0),
          positions: [],
          scenario: monthEntry.scenario ?? 'expansion'
        };
      });

      if (recoveryStartMonth !== null) {
        unrecovered = true;
        unrecoveredDurationMonths = monthly.length - recoveryStartMonth + 1;
      } else {
        unrecovered = false;
        unrecoveredDurationMonths = null;
      }

      const years: any[] = [];
      let previousEndingCapital = initialCapital;
      for (let yearIndex = 1; yearIndex <= horizonYears; yearIndex += 1) {
        const year = yearIndex;
        const entries = monthly.filter((entry: any) => Number(entry.year) === year);
        const startingCapital = year === 1 ? initialCapital : previousEndingCapital;
        const endingCapital = entries.length > 0 ? entries[entries.length - 1].endingCapital : startingCapital;
        const portfolioReturn = startingCapital > 0 ? (endingCapital / startingCapital) - 1 : 0;
        const annualYear = {
          year,
          scenario: entries[0]?.scenario ?? 'expansion',
          durationInCurrentScenario: entries.length || 1,
          etfReturns: [],
          portfolioReturn,
          startingCapital,
          endingCapital,
          runningPeak: Math.max(startingCapital, endingCapital),
          drawdown: Math.max(0, (Math.max(startingCapital, endingCapital) - endingCapital) / Math.max(startingCapital, endingCapital, 1))
        };
        years.push(annualYear);
        previousEndingCapital = endingCapital;
      }

      const scenarioPath = this.buildScenarioPathFromMonthEntries(normalizedMonths, horizonYears);
      const finalCapital = monthly.length > 0 ? monthly[monthly.length - 1].endingCapital : initialCapital;
      const totalReturn = finalCapital / initialCapital - 1;
      const cagr = Math.pow(Math.max(finalCapital / initialCapital, Number.EPSILON), 1 / Math.max(horizonYears, 1)) - 1;

      return {
        simulationId: Number(rawPath?.pathId ?? pathIndex + 1),
        dominantEtfIsin: '',
        dominantEtfName: '',
        initialCapital,
        finalCapital,
        totalReturn,
        cagr,
        maxDrawdown,
        maxRecoveryTimeMonths,
        unrecovered,
        unrecoveredDurationMonths,
        monthly,
        scenarioPath,
        years,
        portfolioSnapshot: {
          generatedAt: new Date().toISOString(),
          positions: [],
          totalWeightBeforeNormalization: 1,
          normalized: true
        },
        diagnostics: {
          scenario: {
            frequencies: { ...scenarioPath.frequencies }
          },
          performance: { redrawCount: 0, rejectRate: 0 }
        },
        performanceDiagnostics: { redrawCount: 0, rejectRate: 0 },
        matricesCoherent: true
      } as any;
    };

    const paths = pathEntries.map(buildPathResult);
    return MonteCarloStatisticsEngine.buildOfficialResult(paths, horizonYears, initialCapital, {
      performanceDiagnostics: { redrawCount: 0, rejectRate: 0 },
      matricesCoherent: true,
      advancedStatisticsEnabled: false
    });
  }

  onEditorStateChange(change: MontecarloPortfolioEditorChange): void {
    this.editorState.set(change);

    const portfolioId = change?.state?.selectedPortfolioId ?? null;
    if (portfolioId && portfolioId !== this.loadedKpiPortfolioId) {
      void this.loadPortfolioKpiConfiguration(portfolioId);
    }
  }

  async runSimulation(): Promise<void> {
    this.kpiResultValues = {};
    if (this.editorState()?.state?.isValid !== true || this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.startProgressAnimation();
    this.resetKpis();

    try {
      await this.saveCurrentPortfolioKpiConfiguration();

      // The editor is the source of truth for a simulation. Its composition can
      // intentionally differ from the persisted portfolio until the user chooses
      // "Aggiorna portafoglio"; fetching the DB portfolio here would therefore
      // simulate stale weights after every temporary edit.
      const editorChange = this.editorState();
      const editorItems = editorChange?.state?.currentItems ?? [];
      const positions = editorItems
        .map((item: any) => ({
          isin: item?.isin,
          // Editor weights are percentages (0..100); projection weights are decimals.
          weight: Number(item?.weight ?? 0) / 100
        }))
        .filter((position: { isin?: string; weight: number }) => Boolean(position.isin) && Number.isFinite(position.weight) && position.weight > 0)
        .map((position: { isin?: string; weight: number }) => ({
          isin: String(position.isin).trim().toUpperCase(),
          weight: position.weight
        }));

      if (positions.length === 0) {
        throw new Error('Nessuna posizione valida nella composizione temporanea.');
      }

      // Fast path: ETF paths are already generated in the active Market Universe.
      // A simulation click only applies the selected portfolio weights and derives
      // portfolio paths/KPIs; it must never regenerate the Monte Carlo universe.
      this.advanceProgressStage(62);
      const projection = await this.requestBinarySimulationProjection(positions);
      this.advanceProgressStage(80);
      const result = this.buildOfficialResultFromProjection(projection, 100000, 30);
      this.advanceProgressStage(92);

      this.macroScenarioDistribution = this.buildMacroSegmentsFromFrequencies(result?.statistics?.scenario?.frequencies);
      this.updateDonutSegments();
      const cagrSamples = Array.isArray(result.distributionSamples?.cagr) ? result.distributionSamples.cagr : [];
      const maxDrawdownSamples = Array.isArray(result.distributionSamples?.maxDrawdown) ? result.distributionSamples.maxDrawdown : [];
      this.finalReturnDistribution = this.buildFinalReturnDistribution(cagrSamples.map((cagr) => ({ cagr })));
      this.maxDrawdownDistribution = this.buildMaxDrawdownDistribution(maxDrawdownSamples.map((maxDrawdown) => ({ maxDrawdown })));
      const representativeCapital = Array.isArray(result.representativePath?.capital)
        ? result.representativePath.capital
        : [];
      const annualCapital = representativeCapital
        .filter((point) => Number(point.month) > 0 && Number(point.month) % 12 === 0)
        .map((point) => ({
          year: Number(point.month) / 12,
          capital: Number(point.capital)
        }))
        .filter((point) => Number.isFinite(point.year) && point.year <= 30 && Number.isFinite(point.capital));
      let previousCapital = 100000;
      const currentEvolution = annualCapital.map((point) => {
        const annualReturn = previousCapital > 0 ? (point.capital / previousCapital) - 1 : 0;
        previousCapital = point.capital;
        return { year: point.year, annualReturn };
      });
      if (this.portfolioEvolution.length > 0) {
        this.portfolioEvolutionHistory = [this.portfolioEvolution, ...this.portfolioEvolutionHistory].slice(0, 2);
      }
      this.portfolioEvolution = currentEvolution;
      this.clearHistogramHover();
      this.clearMaxDrawdownHover();
      const positiveReturnProbability = cagrSamples.length > 0
        ? cagrSamples.filter((value) => Number(value) > 0).length / cagrSamples.length
        : null;
      this.kpiResultValues = {
        expectedReturn: Number.isFinite(result.mainKpis?.robustCagr) ? Number(result.mainKpis.robustCagr) : null,
        volatility: Number.isFinite(result.mainKpis?.volatility) ? Number(result.mainKpis.volatility) : null,
        positiveReturnProbability,
        recoveryPeriod: Number.isFinite(result.mainKpis?.recoveryTimeMonths) ? Number(result.mainKpis.recoveryTimeMonths) : null,
        averageMaxDrawdown: Number.isFinite(result.mainKpis?.robustMaxDrawdown) ? Math.abs(Number(result.mainKpis.robustMaxDrawdown)) : null
      };
      const updatedKpis: KpiCard[] = [
        { id: 'expectedReturn', title: 'Rendimento annuo', value: this.formatPercent(result.mainKpis?.robustCagr), description: 'CAGR annuo', tone: 'cyan' },
        { id: 'volatility', title: 'Volatilità', value: this.formatPercent(result.mainKpis?.volatility), description: 'Deviazione standard annua', tone: 'violet' },
        { id: 'positiveReturnProbability', title: 'Rendimento positivo (30 anni)', value: this.formatPercent(positiveReturnProbability), description: 'Scenari con rendimento > 0', tone: 'blue' },
        { id: 'recoveryPeriod', title: 'Periodo di recupero', value: this.formatMonths(result.mainKpis?.recoveryTimeMonths), description: 'Tempo medio al break-even', tone: 'amber' },
        { id: 'averageMaxDrawdown', title: 'Drawdown', value: this.formatPercent(result.mainKpis?.robustMaxDrawdown), description: 'Perdita massima media', tone: 'red' }
      ];
      this.kpis = this.mergeKpiValuesPreservingOrder(updatedKpis);
      this.advanceProgressStage(97);
      await this.completeProgressAnimation();
    } catch (error) {
      console.error('[Monte Carlo fast path]', error);
      this.kpis = this.mergeKpiValuesPreservingOrder(this.defaultKpis);
    } finally {
      this.isRunning = false;
      this.stopProgressAnimation();
      this.simulationProgress = 0;
      this.clearCompletionHold();
    }
  }

  private mergeKpiValuesPreservingOrder(updatedKpis: KpiCard[]): KpiCard[] {
    const updatedById = new Map(updatedKpis.map((kpi) => [kpi.id, kpi]));
    return this.kpis.map((current) => updatedById.get(current.id) ?? current);
  }

  getKpiIcon(kpiId: string): string {
    const icons: Record<string, string> = {
      expectedReturn: 'trending_up',
      volatility: 'show_chart',
      positiveReturnProbability: 'verified',
      recoveryPeriod: 'schedule',
      averageMaxDrawdown: 'trending_down'
    };
    return icons[kpiId] ?? 'analytics';
  }

  private resetKpis(): void {
    this.kpis = this.mergeKpiValuesPreservingOrder(this.defaultKpis);
    this.hoveredPortfolioEvolutionYear = null;
    this.draggedKpiId = null;
    this.swapTargetId = null;
    this.insertTargetIndex = null;
  }

  onKpiDragStart(kpiId: string, event: DragEvent): void {
    this.draggedKpiId = kpiId;
    this.draggedKpiPreview = this.kpis.find((kpi) => kpi.id === kpiId) ?? null;
    this.swapTargetId = null;
    this.insertTargetIndex = null;

    const source = event.currentTarget as HTMLElement | null;
    if (source) {
      const rect = source.getBoundingClientRect();
      this.draggedKpiPointerOffset = {
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
      };
      this.draggedKpiPreviewPosition = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', kpiId);

      const transparentDragImage = document.createElement('div');
      transparentDragImage.style.width = '1px';
      transparentDragImage.style.height = '1px';
      transparentDragImage.style.opacity = '0';
      document.body.appendChild(transparentDragImage);
      event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
      requestAnimationFrame(() => transparentDragImage.remove());
    }
  }

  onKpiDrag(event: DragEvent): void {
    if (!this.draggedKpiId || (event.clientX === 0 && event.clientY === 0)) {
      return;
    }
    this.draggedKpiPreviewPosition = {
      ...this.draggedKpiPreviewPosition,
      left: event.clientX - this.draggedKpiPointerOffset.x,
      top: event.clientY - this.draggedKpiPointerOffset.y
    };
  }

  onKpiDragOver(kpiId: string, event: DragEvent): void {
    if (!this.draggedKpiId || this.draggedKpiId === kpiId) {
      return;
    }

    event.preventDefault();
    this.swapTargetId = kpiId;
    this.insertTargetIndex = null;
  }

  onKpiDrop(kpiId: string, event: DragEvent): void {
    event.preventDefault();
    if (!this.draggedKpiId || this.draggedKpiId === kpiId) {
      this.finishDragState();
      return;
    }

    this.swapKpis(this.draggedKpiId, kpiId);
    this.finishDragState();
  }

  onGapDragOver(index: number, event: DragEvent): void {
    if (!this.draggedKpiId) {
      return;
    }

    event.preventDefault();
    this.insertTargetIndex = index;
    this.swapTargetId = null;
  }

  onGapDrop(index: number, event: DragEvent): void {
    event.preventDefault();
    if (!this.draggedKpiId) {
      return;
    }

    this.insertKpi(this.draggedKpiId, index);
    this.finishDragState();
  }

  onKpiListDragOver(event: DragEvent): void {
    if (!this.draggedKpiId) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    const container = event.currentTarget as HTMLElement | null;
    if (!container) {
      return;
    }

    const rows = Array.from(container.querySelectorAll<HTMLElement>('.kpi-row'));
    const containerRect = container.getBoundingClientRect();
    const rowHeight = rows[0]?.offsetHeight ?? 0;
    const gap = rows.length > 1
      ? Math.max(0, rows[1].offsetTop - rows[0].offsetTop - rowHeight)
      : 8;
    const stride = Math.max(1, rowHeight + gap);
    const listPaddingTop = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
    const pointerY = event.clientY - containerRect.top - listPaddingTop + container.scrollTop;
    const contentHeight = this.kpis.length * stride - gap;

    let insertIndex: number;
    if (pointerY <= 0) {
      insertIndex = 0;
    } else if (pointerY >= contentHeight) {
      insertIndex = this.kpis.length;
    } else {
      insertIndex = Math.max(0, Math.min(this.kpis.length, Math.floor((pointerY + stride / 2) / stride)));
    }

    this.insertTargetIndex = insertIndex;
  }

  onKpiListDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const kpiId = this.draggedKpiId || event.dataTransfer?.getData('text/plain') || null;
    const insertIndex = this.insertTargetIndex ?? this.kpis.length;

    // Commit preview -> final order atomically. The preview transforms and the DOM
    // reorder must settle in the same frame with transitions disabled; otherwise
    // upward moves animate the traversed rows back toward their old slots first.
    this.suppressKpiTransitions = true;
    if (kpiId) {
      this.insertKpi(kpiId, insertIndex);
    }
    this.finishDragState();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.suppressKpiTransitions = false;
      });
    });
  }

  onKpiDragEnd(): void {
    this.finishDragState();
  }

  getKpiDragShift(index: number): 'up' | 'down' | null {
    if (!this.draggedKpiId || this.insertTargetIndex === null) {
      return null;
    }

    const sourceIndex = this.kpis.findIndex((kpi) => kpi.id === this.draggedKpiId);
    if (sourceIndex === -1) {
      return null;
    }

    let targetIndex = this.insertTargetIndex;
    if (sourceIndex < targetIndex) {
      targetIndex -= 1;
    }
    targetIndex = Math.max(0, Math.min(this.kpis.length - 1, targetIndex));

    if (targetIndex > sourceIndex && index > sourceIndex && index <= targetIndex) {
      return 'up';
    }

    if (targetIndex < sourceIndex && index >= targetIndex && index < sourceIndex) {
      return 'down';
    }

    return null;
  }

  getKpiTargetStatus(kpiId: string): 'success' | 'failure' | null {
    // A target alone has no status: green/red is meaningful only after the
    // current simulation has produced an actual KPI result for this card.
    if (!Object.prototype.hasOwnProperty.call(this.kpiResultValues, kpiId)) {
      return null;
    }

    const target = this.kpiTargets[kpiId];
    const result = this.kpiResultValues[kpiId];
    if (!target || target === '–' || result === null || result === undefined || !Number.isFinite(result)) {
      return null;
    }

    const targetNumber = Number.parseFloat(target.replace(',', '.'));
    if (!Number.isFinite(targetNumber)) {
      return null;
    }

    const displayedResult = kpiId === 'recoveryPeriod'
      ? Math.round(result)
      : Math.round(result * 1000) / 1000;
    const targetValue = kpiId === 'recoveryPeriod' ? targetNumber * 12 : targetNumber / 100;
    const higherIsBetter = kpiId === 'expectedReturn' || kpiId === 'positiveReturnProbability';
    const passed = higherIsBetter ? displayedResult >= targetValue : displayedResult <= targetValue;
    return passed ? 'success' : 'failure';
  }

  trackKpiById(_index: number, kpi: KpiCard): string {
    return kpi.id;
  }

  toggleKpiTarget(kpiId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openKpiTargetId = this.openKpiTargetId === kpiId ? null : kpiId;
  }

  @HostListener('document:click')
  closeKpiTargetOnOutsideClick(): void {
    this.openKpiTargetId = null;
  }

  selectKpiTarget(kpiId: string, value: string, event: MouseEvent): void {
    event.stopPropagation();
    this.kpiTargets[kpiId] = value;
    this.openKpiTargetId = null;
  }

  private finishDragState(): void {
    this.draggedKpiId = null;
    this.draggedKpiPreview = null;
    this.swapTargetId = null;
    this.insertTargetIndex = null;
  }

  private swapKpis(sourceId: string, targetId: string): void {
    const sourceIndex = this.kpis.findIndex((kpi) => kpi.id === sourceId);
    const targetIndex = this.kpis.findIndex((kpi) => kpi.id === targetId);

    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
      return;
    }

    const next = [...this.kpis];
    [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
    this.kpis = next;
  }

  private insertKpi(kpiId: string, insertIndex: number): void {
    const sourceIndex = this.kpis.findIndex((kpi) => kpi.id === kpiId);
    if (sourceIndex === -1) {
      return;
    }

    const next = [...this.kpis];
    const [moved] = next.splice(sourceIndex, 1);
    let targetIndex = insertIndex;

    if (sourceIndex < targetIndex) {
      targetIndex -= 1;
    }

    next.splice(targetIndex, 0, moved);
    this.kpis = next;
  }

  private updateDonutSegments(): void {
    this.donutSegments = this.buildDonutSegments();
  }

  private buildFinalReturnDistribution(paths: Array<{ cagr?: number | null }>): { label: string; subtitle: string; bins: Array<{ label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number }> } {
    const cagrValues = paths.map((path) => Number(path?.cagr ?? 0));

    if (cagrValues.length === 0) {
      return {
        label: 'Distribuzione dei rendimenti finali',
        subtitle: 'Distribuzione simulata a 30 anni',
        bins: []
      };
    }

    const histogram = buildCagrHistogramFromPaths(cagrValues.map((cagr) => ({ cagr })));
    const bins = histogram.bins.map((bin) => ({
      label: `${bin.lowerBoundPercent}`,
      value: bin.value,
      lowerBoundPercent: bin.lowerBoundPercent,
      upperBoundPercent: bin.upperBoundPercent
    }));

    return {
      label: 'Distribuzione dei rendimenti finali',
      subtitle: 'Distribuzione simulata a 30 anni',
      bins
    };
  }

  private buildMaxDrawdownDistribution(paths: Array<{ maxDrawdown?: number | null }>): { label: string; subtitle: string; bins: Array<{ label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number }> } {
    if (paths.length === 0) {
      return {
        label: 'Distribuzione Max Drawdown',
        subtitle: 'Distribuzione del drawdown massimo nei 30 anni',
        bins: []
      };
    }

    const histogram = buildMaxDrawdownHistogramFromPaths(paths);
    const bins = histogram.bins.map((bin) => ({
      label: `${bin.upperBoundPercent}`,
      value: bin.value,
      lowerBoundPercent: bin.lowerBoundPercent,
      upperBoundPercent: bin.upperBoundPercent
    }));

    return {
      label: 'Distribuzione Max Drawdown',
      subtitle: 'Distribuzione del drawdown massimo nei 30 anni',
      bins
    };
  }

  private buildMacroSegmentsFromFrequencies(frequencies?: Record<string, number> | null): Array<{ label: string; percent: number; color: string; value: number; key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation' }> {
    const palette: Record<'expansion' | 'soft_landing' | 'recession' | 'stagflation', string> = {
      expansion: '#19E6B3',
      soft_landing: '#268CFF',
      recession: '#FF365B',
      stagflation: '#FF9F1C'
    };

    const labelMap: Record<'expansion' | 'soft_landing' | 'recession' | 'stagflation', string> = {
      expansion: 'Espansione',
      soft_landing: 'Soft Landing',
      recession: 'Recessione',
      stagflation: 'Stagflazione'
    };

    const source = frequencies ?? {};
    const orderedKeys: Array<'expansion' | 'soft_landing' | 'recession' | 'stagflation'> = ['expansion', 'soft_landing', 'recession', 'stagflation'];

    return orderedKeys.map((key) => {
      const rawValue = Number(source[key] ?? 0);
      const normalizedValue = this.normalizeScenarioValue(rawValue);
      const displayPercent = Math.round(this.toDisplayPercent(normalizedValue));

      return {
        key,
        label: labelMap[key],
        value: normalizedValue,
        percent: displayPercent,
        color: palette[key]
      };
    });
  }

  private normalizeScenarioValue(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return value > 1 ? value / 100 : value;
  }

  private toDisplayPercent(value: number): number {
    const normalizedValue = this.normalizeScenarioValue(value);
    return normalizedValue * 100;
  }

  private mapLabelToScenarioKey(label: string): 'expansion' | 'soft_landing' | 'recession' | 'stagflation' {
    const labelMap: Record<string, 'expansion' | 'soft_landing' | 'recession' | 'stagflation'> = {
      Espansione: 'expansion',
      'Soft Landing': 'soft_landing',
      Recessione: 'recession',
      Stagflazione: 'stagflation'
    };

    return labelMap[label] ?? 'expansion';
  }

  private formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '—';
    }

    return `${(value * 100).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  private formatMonths(value: number | null | undefined): string {
    if (!Number.isFinite(value)) {
      return '—';
    }

    const totalMonths = Math.round(Number(value));
    const years = Math.floor(Math.abs(totalMonths) / 12);
    const months = Math.abs(totalMonths) % 12;

    if (totalMonths === 0) {
      return '0 mesi';
    }

    const yearLabel = years === 1 ? 'anno' : 'anni';
    const monthLabel = months === 1 ? 'mese' : 'mesi';

    if (years > 0 && months > 0) {
      return `${years} ${yearLabel} e ${months} ${monthLabel}`;
    }

    if (years > 0) {
      return `${years} ${yearLabel}`;
    }

    return `${months} ${monthLabel}`;
  }

  getHistogramYTicks(data: Array<{ value: number }>, baselineY: number, plotHeight: number, axisX: number): Array<{ label: string; y: number; x: number }> {
    const maxValue = Math.max(...data.map((item) => Number(item.value ?? 0)), 1);
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      label: (maxValue * ratio / 10).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      y: baselineY - (plotHeight * ratio),
      x: axisX
    }));
  }

  getHistogramXAxisTicks(): Array<{ label: string; x: number; lowerBoundPercent: number; upperBoundPercent: number }> {
    const bins = this.finalReturnDistribution.bins;
    if (!bins.length) {
      return [];
    }

    return buildHistogramGeometry(bins).map((geometry) => ({
      label: `${geometry.bin.lowerBoundPercent}`,
      x: geometry.centerX,
      lowerBoundPercent: geometry.bin.lowerBoundPercent,
      upperBoundPercent: geometry.bin.upperBoundPercent
    }));
  }

  getMaxDrawdownXAxisTicks(): Array<{ label: string; x: number; lowerBoundPercent: number; upperBoundPercent: number }> {
    const bins = this.maxDrawdownDistribution.bins;
    if (!bins.length) {
      return [];
    }

    const geometry = buildDrawdownDisplayGeometry(bins, 30, 330, 0);
    return geometry.ticks.map((tick) => ({
      label: `${tick.upperBoundPercent}`,
      x: tick.x,
      lowerBoundPercent: tick.lowerBoundPercent,
      upperBoundPercent: tick.upperBoundPercent
    }));
  }

  buildHistogramBars(data: Array<{ label: string; value: number; lowerBoundPercent?: number; upperBoundPercent?: number }>, height = 120, width = 440, plotLeft = 40, barGap = 8): Array<{ x: number; y: number; width: number; height: number; opacity: number; centerX: number; index: number }> {
    const maxValue = Math.max(...data.map((item) => item.value), 1);
    const geometry = buildHistogramGeometry(data.map((item) => ({
      label: item.label,
      value: item.value,
      lowerBoundPercent: Number(item.lowerBoundPercent ?? 0),
      upperBoundPercent: Number(item.upperBoundPercent ?? 0),
      lowerInclusive: true,
      upperInclusive: false
    })), plotLeft, width, barGap);

    return geometry.map((entry) => {
      const h = (entry.bin.value / maxValue) * height;
      const baselineY = 195;
      const y = baselineY - h;
      return {
        x: entry.x,
        y,
        width: entry.width,
        height: h,
        opacity: 0.82,
        centerX: entry.centerX,
        index: entry.index
      };
    });
  }

  buildMaxDrawdownHistogramBars(data: Array<{ label: string; value: number; lowerBoundPercent?: number; upperBoundPercent?: number }>, height = 100, width = 350, plotLeft = 30, barGap = 0): Array<{ x: number; y: number; width: number; height: number; opacity: number; centerX: number; index: number }> {
    if (data.length === 0) {
      return [];
    }

    const maxValue = Math.max(...data.map((item) => item.value), 1);
    const geometry = buildDrawdownDisplayGeometry(data.map((item) => ({
      label: item.label,
      value: item.value,
      lowerBoundPercent: Number(item.lowerBoundPercent ?? 0),
      upperBoundPercent: Number(item.upperBoundPercent ?? 0),
      lowerInclusive: true,
      upperInclusive: false
    })), plotLeft, 330, barGap);

    return geometry.bars.map((entry) => {
      const h = (Number(entry.bin.value ?? 0) / maxValue) * height;
      const baselineY = 190;
      const y = baselineY - h;
      return {
        x: entry.x,
        y,
        width: entry.width,
        height: h,
        opacity: 0.82,
        centerX: entry.centerX,
        index: entry.index
      };
    });
  }

  getMaxDrawdownTotalPaths(): number {
    return this.maxDrawdownDistribution.bins.reduce((sum, bin) => sum + Number(bin.value ?? 0), 0) || 0;
  }

  private clearMaxDrawdownHover(): void {
    this.hoveredMaxDrawdownBin = null;
    this.maxDrawdownTooltipPercentage = null;
  }

  onMaxDrawdownBarPointerEnter(bin: { label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number }, event: PointerEvent): void {
    this.hoveredMaxDrawdownBin = bin;
    this.maxDrawdownTooltipPercentage = computeHistogramTooltipPercentage(bin.value, this.getMaxDrawdownTotalPaths());
    this.maxDrawdownTooltipPosition = {
      left: Number((event.currentTarget as SVGRectElement | null)?.dataset?.centerX ?? 0),
      top: 20
    };
  }

  onMaxDrawdownBarPointerLeave(): void {
    this.clearMaxDrawdownHover();
  }

  onMaxDrawdownPlotPointerLeave(): void {
    this.clearMaxDrawdownHover();
  }

  getPortfolioEvolutionSeries(): Array<{ label: string; className: string; points: Array<{ year: number; annualReturn: number }> }> {
    const series = [
      { label: 'T0', className: 'evolution-line--t0', points: this.portfolioEvolution },
      { label: 'T-1', className: 'evolution-line--t1', points: this.portfolioEvolutionHistory[0] ?? [] },
      { label: 'T-2', className: 'evolution-line--t2', points: this.portfolioEvolutionHistory[1] ?? [] }
    ];
    return series.filter((item) => item.points.length > 0);
  }

  getPortfolioAnnualReturnScale(): number {
    const allPoints = this.getPortfolioEvolutionSeries().flatMap((series) => series.points);
    const maxAbsoluteReturn = Math.max(...allPoints.map((point) => Math.abs(point.annualReturn)), 0.1);
    return Math.ceil((maxAbsoluteReturn * 1.12) / 0.05) * 0.05;
  }

  buildPortfolioEvolutionPoints(points: Array<{ year: number; annualReturn: number }>): string {
    if (points.length < 2) {
      return '';
    }
    return points
      .map((point) => `${this.getPortfolioEvolutionX(point.year).toFixed(2)},${this.getPortfolioEvolutionY(point.annualReturn).toFixed(2)}`)
      .join(' ');
  }

  getPortfolioEvolutionYTicks(): Array<{ value: number; y: number }> {
    const scale = this.getPortfolioAnnualReturnScale();
    return Array.from({ length: 5 }, (_, index) => {
      const value = scale - (index * scale / 2);
      return { value, y: this.getPortfolioEvolutionY(value) };
    });
  }

  getPortfolioEvolutionX(year: number): number {
    return 52 + ((Math.max(1, Math.min(30, year)) - 1) / 29) * (640 - 52 - 6);
  }

  getPortfolioEvolutionY(annualReturn: number): number {
    const scale = this.getPortfolioAnnualReturnScale();
    const top = 18;
    const plotHeight = 250 - 18 - 38;
    return top + ((scale - annualReturn) / (scale * 2)) * plotHeight;
  }

  getPortfolioEvolutionHoverX(year: number): number {
    const plotLeft = 52;
    const plotRight = 634;
    const step = (plotRight - plotLeft) / 29;
    return Math.max(plotLeft, this.getPortfolioEvolutionX(year) - step / 2);
  }

  getPortfolioEvolutionHoverWidth(year: number): number {
    const plotLeft = 52;
    const plotRight = 634;
    const step = (plotRight - plotLeft) / 29;
    const left = this.getPortfolioEvolutionHoverX(year);
    const right = Math.min(plotRight, this.getPortfolioEvolutionX(year) + step / 2);
    return right - left;
  }

  onPortfolioEvolutionYearEnter(year: number, event: MouseEvent): void {
    this.hoveredPortfolioEvolutionYear = year;
    this.updatePortfolioEvolutionTooltipPosition(event);
  }

  onPortfolioEvolutionPointMove(event: MouseEvent): void {
    this.updatePortfolioEvolutionTooltipPosition(event);
  }

  onPortfolioEvolutionPointLeave(): void {
    this.hoveredPortfolioEvolutionYear = null;
  }

  getPortfolioEvolutionTooltipRows(year: number): Array<{ label: string; className: string; value: number }> {
    return this.getPortfolioEvolutionSeries()
      .map((series) => ({
        label: series.label,
        className: series.className.replace('evolution-line--', 'evolution-tooltip-row--'),
        value: series.points.find((point) => point.year === year)?.annualReturn
      }))
      .filter((row): row is { label: string; className: string; value: number } => Number.isFinite(row.value));
  }

  private updatePortfolioEvolutionTooltipPosition(event: MouseEvent): void {
    const chart = (event.currentTarget as SVGElement | null)?.closest('.portfolio-evolution-chart') as HTMLElement | null;
    if (!chart) {
      return;
    }
    const bounds = chart.getBoundingClientRect();
    this.portfolioEvolutionTooltipPosition = {
      left: event.clientX - bounds.left + 8,
      top: event.clientY - bounds.top - 8
    };
  }

  formatAnnualReturn(value: number): string {
    return new Intl.NumberFormat('it-IT', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value);
  }

  buildLinePath(values: number[], width = 510, height = 150, padding = 18): string {
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = Math.max(max - min, 1);

    return values
      .map((value, index) => {
        const x = padding + (index / (values.length - 1)) * (width - padding * 2);
        const y = height - padding - ((value - min) / span) * (height - padding * 2);
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }

  buildDonutSegments(): Array<{ path: string; color: string; percent: number; label: string; displayPercent: number; labelX: number; labelY: number; key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation'; gradientId: string }> {
    const cx = 200;
    const cy = 200;
    const innerRadius = 77;
    const outerRadius = 170;

    const normalizedSegments = this.macroScenarioDistribution.map((segment) => ({
      ...segment,
      normalizedValue: this.normalizeScenarioValue(segment.value)
    }));

    const total = normalizedSegments.reduce((sum, segment) => sum + segment.normalizedValue, 0) || 1;
    let currentStartAngle = -90;

    return normalizedSegments.map((segment) => {
      const share = segment.normalizedValue / total;
      const startAngle = currentStartAngle;
      const endAngle = currentStartAngle + share * 360;
      const path = this.buildAnnularSectorPath(cx, cy, innerRadius, outerRadius, startAngle, endAngle);
      const midAngle = (startAngle + endAngle) / 2;
      const labelRadius = innerRadius + ((outerRadius - innerRadius) * 0.50);
      const labelX = cx + Math.cos(this.toRadians(midAngle)) * labelRadius;
      const labelY = cy + Math.sin(this.toRadians(midAngle)) * labelRadius;
      const result = {
        key: segment.key,
        color: segment.color,
        percent: segment.percent,
        label: segment.label,
        displayPercent: Math.round(this.toDisplayPercent(segment.value)),
        labelX,
        labelY,
        path,
        gradientId: this.getGradientId(segment.key)
      };
      currentStartAngle = endAngle;
      return result;
    });
  }

  private getGradientId(key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation'): string {
    const gradientMap: Record<'expansion' | 'soft_landing' | 'recession' | 'stagflation', string> = {
      expansion: 'expansionGradient',
      soft_landing: 'softLandingGradient',
      recession: 'recessionGradient',
      stagflation: 'stagflationGradient'
    };

    return gradientMap[key];
  }

  private buildAnnularSectorPath(
    cx: number,
    cy: number,
    innerRadius: number,
    outerRadius: number,
    startAngle: number,
    endAngle: number
  ): string {
    const outerStart = this.polarToCartesian(cx, cy, outerRadius, startAngle);
    const outerEnd = this.polarToCartesian(cx, cy, outerRadius, endAngle);
    const innerStart = this.polarToCartesian(cx, cy, innerRadius, startAngle);
    const innerEnd = this.polarToCartesian(cx, cy, innerRadius, endAngle);
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
      'Z'
    ].join(' ');
  }

  private polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number): { x: number; y: number } {
    const angleInRadians = this.toRadians(angleInDegrees);
    return {
      x: cx + radius * Math.cos(angleInRadians),
      y: cy + radius * Math.sin(angleInRadians)
    };
  }

  private toRadians(angleInDegrees: number): number {
    return (angleInDegrees * Math.PI) / 180;
  }
}
