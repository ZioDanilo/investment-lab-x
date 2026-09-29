import { CommonModule } from '@angular/common';
import { Component, ViewChild, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { MonteCarloStatisticsEngine } from '../../core/engines/monte-carlo-statistics.engine';
import {
  buildMonteCarloSnapshotRequest,
  buildMonteCarloUserInput,
  createMonteCarloCoordinator
} from '../../core/monte-carlo-ui-flow';
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
  finalReturnDistribution: { label: string; subtitle: string; bins: Array<{ label: string; value: number; lowerBoundPercent: number; upperBoundPercent: number }> } = {
    label: 'Distribuzione dei rendimenti finali',
    subtitle: 'Distribuzione simulata a 30 anni',
    bins: []
  };
  macroScenarioDistribution: Array<{ label: string; percent: number; color: string; value: number; key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation' }> = [];
  donutSegments: Array<{ path: string; color: string; percent: number; label: string; displayPercent: number; labelX: number; labelY: number; key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation' }> = this.buildDonutSegments();

  private readonly defaultKpis: KpiCard[] = [
    { id: 'expectedReturn', title: 'RENDIMENTO MEDIO ATTESO', value: '—', description: 'CAGR annuo', tone: 'cyan' },
    { id: 'volatility', title: 'VOLATILITÀ', value: '—', description: 'Deviazione standard annua', tone: 'violet' },
    { id: 'positiveReturnProbability', title: 'PROBABILITÀ RENDIMENTO POSITIVO', value: '—', description: 'Scenari con rendimento > 0', tone: 'blue' },
    { id: 'recoveryPeriod', title: 'PERIODO DI RECUPERO', value: '—', description: 'Tempo medio al break-even', tone: 'amber' },
    { id: 'averageMaxDrawdown', title: 'DRAWDOWN MASSIMO MEDIO', value: '—', description: 'Perdita massima media', tone: 'red' }
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
  isRegeneratingMarketUniverse = false;
  marketUniverseStatusMessage: string | null = null;
  kpis: KpiCard[] = [...this.defaultKpis];
  draggedKpiId: string | null = null;
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
    this.progressAnimationStartedAt = performance.now();
    this.progressAnimationIntervalId = setInterval(() => {
      if (!this.isRunning) {
        return;
      }

      const elapsedSeconds = Math.max(0, (performance.now() - this.progressAnimationStartedAt) / 1000);
      // UX progress: advance smoothly through long precompute/finalization phases where
      // the engine cannot provide path-based progress. It approaches 94% but never
      // completes before the real result is available.
      const visualTarget = Math.min(94, 1 + (elapsedSeconds * 3.2));
      if (visualTarget > this.simulationProgress) {
        this.simulationProgress = visualTarget;
      }
    }, 200);
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
            month: Number(entry?.monthIndex ?? monthIndex + 1),
            monthWithinYear: ((Number(entry?.monthIndex ?? monthIndex + 1) - 1) % 12) + 1,
            year: Math.floor((Number(entry?.monthIndex ?? monthIndex + 1) - 1) / 12) + 1,
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
              const month = Number(entry?.monthIndex ?? monthIndex + 1);
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
  }

  async runSimulation(): Promise<void> {
    console.log('[MC-TRACE 01] runSimulation entered');
    const portfolio = this.selectedPortfolio();
    if (!portfolio || this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.startProgressAnimation();
    this.resetKpis();

    try {
      console.log('[MC-TRACE 02] snapshot request start');
      const portfolioResponse = await firstValueFrom(this.apiService.getPortfolioById(portfolio.id));
      const rawHoldings = Array.isArray(portfolioResponse?.data?.holdings)
        ? portfolioResponse.data.holdings
        : Array.isArray(portfolioResponse?.holdings)
          ? portfolioResponse.holdings
          : [];

      if (rawHoldings.length === 0) {
        throw new Error('Portfolio senza holding disponibili.');
      }

      const positions = rawHoldings
        .map((holding: any) => ({
          isin: holding?.isin ?? holding?.etfId ?? holding?.id ?? holding?.ticker,
          weight: Number(holding?.weight ?? holding?.targetWeight ?? 0)
        }))
        .filter((position: { isin?: string; weight: number }) => Boolean(position.isin) && Number.isFinite(position.weight) && position.weight > 0);

      if (positions.length === 0) {
        throw new Error('Nessuna posizione valida nel portafoglio selezionato.');
      }

      const normalizedPositions = positions.map((position: { isin?: string; weight: number }) => ({
        isin: String(position.isin),
        weight: position.weight
      }));

      console.log('[MC-TRACE 04] build input start');
      const snapshotRequest = buildMonteCarloSnapshotRequest(normalizedPositions);
      const snapshotResponse = await firstValueFrom(this.apiService.getMonteCarloSnapshot(snapshotRequest));
      const snapshot = snapshotResponse?.data ?? snapshotResponse;
      console.log('[MC-TRACE 03] snapshot received', {
        exists: !!snapshot,
        assetCount: Array.isArray(snapshot?.etfs) ? snapshot.etfs.length : 0
      });

      if (!snapshot || !Array.isArray(snapshot.etfs) || snapshot.etfs.length === 0) {
        throw new Error('Snapshot Monte Carlo non disponibile.');
      }

      const input = buildMonteCarloUserInput(normalizedPositions, 100000, 30);
      console.log('[MC-TRACE 05] input built', {
        totalPaths: input ? 1000 : 0,
        months: input ? input.horizonYears * 12 : 0,
        years: input ? input.horizonYears : 0,
        etfCount: input ? input.positions.length : 0
      });
      console.log('[MC-TRACE 06] coordinator creation start');
      const coordinator = createMonteCarloCoordinator(input, snapshot, 'COMPLETE', (progress) => {
        const progressValue = Number(progress);
        const progressType = typeof progress;
        const preview = typeof progress === 'number' ? progress : (progress && typeof progress === 'object' ? Object.keys(progress).slice(0, 5) : String(progress));
        console.log('[MC-TRACE PROGRESS] callback', { type: progressType, value: progressValue, preview });
        if (progressValue >= 1 && progressValue < 25 && !this.simulationProgress) {
          console.log('[MC-TRACE PROGRESS] 1');
        }
        if (progressValue >= 25 && progressValue < 50) {
          console.log('[MC-TRACE PROGRESS] 25');
        }
        if (progressValue >= 50 && progressValue < 75) {
          console.log('[MC-TRACE PROGRESS] 50');
        }
        if (progressValue >= 75 && progressValue < 99) {
          console.log('[MC-TRACE PROGRESS] 75');
        }
        if (progressValue >= 99) {
          console.log('[MC-TRACE PROGRESS] 99');
        }
        const engineProgress = Math.min(Math.max(Number(progress) || 0, 0), 99);
        // Real engine progress may move the bar forward, never backward. The visual
        // animation fills the phases that currently emit no granular progress.
        this.simulationProgress = Math.max(this.simulationProgress, engineProgress);
      });
      console.log('[MC-TRACE 07] coordinator created');
      console.log('[MC-TRACE 08] coordinator.run start');
      const outcome = await coordinator.run();
      console.log('[MC-TRACE 09] coordinator.run resolved', {
        hasOutcome: !!outcome,
        status: outcome?.status,
        hasResult: !!outcome?.result,
        errorCode: outcome?.error?.code,
        errorMessage: outcome?.error?.message ? String(outcome.error.message).slice(0, 120) : undefined
      });

      if (outcome.status !== 'success' || !outcome.result) {
        throw new Error(outcome.error?.message ?? 'Simulazione Monte Carlo fallita.');
      }

      const result = outcome.result;
      console.log('[MC-TRACE 10] applying result');
      this.macroScenarioDistribution = this.buildMacroSegmentsFromFrequencies(result?.statistics?.scenario?.frequencies);
      this.updateDonutSegments();
      const cagrSamples = Array.isArray(result.distributionSamples?.cagr) ? result.distributionSamples.cagr : [];
      const maxDrawdownSamples = Array.isArray(result.distributionSamples?.maxDrawdown) ? result.distributionSamples.maxDrawdown : [];
      this.finalReturnDistribution = this.buildFinalReturnDistribution(cagrSamples.map((cagr) => ({ cagr })));
      this.maxDrawdownDistribution = this.buildMaxDrawdownDistribution(maxDrawdownSamples.map((maxDrawdown) => ({ maxDrawdown })));
      this.clearHistogramHover();
      this.clearMaxDrawdownHover();
      this.kpis = [
        { id: 'expectedReturn', title: 'RENDIMENTO MEDIO ATTESO', value: this.formatPercent(result.mainKpis?.robustCagr), description: 'CAGR annuo', tone: 'cyan' },
        { id: 'volatility', title: 'VOLATILITÀ', value: this.formatPercent(result.mainKpis?.volatility), description: 'Deviazione standard annua', tone: 'violet' },
        { id: 'positiveReturnProbability', title: 'PROBABILITÀ RENDIMENTO POSITIVO', value: '—', description: 'Scenari con rendimento > 0', tone: 'blue' },
        { id: 'recoveryPeriod', title: 'PERIODO DI RECUPERO', value: this.formatMonths(result.mainKpis?.recoveryTimeMonths), description: 'Tempo medio al break-even', tone: 'amber' },
        { id: 'averageMaxDrawdown', title: 'DRAWDOWN MASSIMO MEDIO', value: this.formatPercent(result.mainKpis?.robustMaxDrawdown), description: 'Perdita massima media', tone: 'red' }
      ];
      console.log('[MC-TRACE 11] result applied', {
        kpis: this.kpis.length,
        returnsBins: this.finalReturnDistribution?.bins?.length ?? 0,
        drawdownBins: this.maxDrawdownDistribution?.bins?.length ?? 0,
        scenarios: this.macroScenarioDistribution?.length ?? 0
      });
    } catch (error) {
      console.error('[MC-TRACE ERROR]', error);
      this.kpis = [...this.defaultKpis];
    } finally {
      console.log('[MC-TRACE 12] runSimulation finally', {
        isRunning: this.isRunning,
        simulationProgress: this.simulationProgress
      });
      this.isRunning = false;
      this.stopProgressAnimation();
      this.simulationProgress = 0;
      this.clearCompletionHold();
    }
  }

  private resetKpis(): void {
    this.kpis = [...this.defaultKpis];
    this.draggedKpiId = null;
    this.swapTargetId = null;
    this.insertTargetIndex = null;
  }

  onKpiDragStart(kpiId: string, event: DragEvent): void {
    this.draggedKpiId = kpiId;
    this.swapTargetId = null;
    this.insertTargetIndex = null;

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', kpiId);
    }
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

  onKpiDragEnd(): void {
    this.finishDragState();
  }

  private finishDragState(): void {
    this.draggedKpiId = null;
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
      expansion: '#4DE3C6',
      soft_landing: '#5DA7FF',
      recession: '#FF6B7F',
      stagflation: '#FFB454'
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
      const baselineY = 150;
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
      const baselineY = 145;
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
