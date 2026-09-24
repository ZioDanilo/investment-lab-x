import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { MonteCarloCoordinator } from '../../core/engines/monte-carlo-coordinator';
import { buildMonteCarloSnapshotRequest, buildMonteCarloUserInput } from '../../core/monte-carlo-ui-flow';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import {
  demoFinalReturnDistribution,
  demoMacroScenarioDistribution,
  demoMaxDrawdownDistribution,
  demoPortfolioTrajectories,
  demoTargetProbabilities
} from './monte-carlo-demo-data';

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
  imports: [CommonModule],
  templateUrl: './montecarlo-page.component.html',
  styleUrls: ['./montecarlo-page.component.css']
})
export class MontecarloPageComponent {
  private readonly portfolioSelectionService = inject(PortfolioSelectionService);
  private readonly apiService = inject(ApiService);

  readonly selectedPortfolio = this.portfolioSelectionService.selectedPortfolio;
  readonly finalReturnDistribution = demoFinalReturnDistribution;
  readonly portfolioTrajectories = demoPortfolioTrajectories;
  readonly targetProbabilities = demoTargetProbabilities;
  readonly maxDrawdownDistribution = demoMaxDrawdownDistribution;
  macroScenarioDistribution: Array<{ label: string; percent: number; color: string; value: number; key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation' }> = [...demoMacroScenarioDistribution.map((segment) => ({
    key: this.mapLabelToScenarioKey(segment.label),
    label: segment.label,
    value: this.normalizeScenarioValue(segment.percent),
    percent: segment.percent,
    color: segment.color
  }))];
  donutSegments: Array<{ path: string; color: string; percent: number; label: string; displayPercent: number; labelX: number; labelY: number; key: 'expansion' | 'soft_landing' | 'recession' | 'stagflation' }> = this.buildDonutSegments();

  private readonly defaultKpis: KpiCard[] = [
    { id: 'expectedReturn', title: 'RENDIMENTO MEDIO ATTESO', value: '—', description: 'CAGR annuo', tone: 'cyan' },
    { id: 'volatility', title: 'VOLATILITÀ', value: '—', description: 'Deviazione standard annua', tone: 'violet' },
    { id: 'positiveReturnProbability', title: 'PROBABILITÀ RENDIMENTO POSITIVO', value: '—', description: 'Scenari con rendimento > 0', tone: 'blue' },
    { id: 'recoveryPeriod', title: 'PERIODO DI RECUPERO', value: '—', description: 'Tempo medio al break-even', tone: 'amber' },
    { id: 'averageMaxDrawdown', title: 'DRAWDOWN MASSIMO MEDIO', value: '—', description: 'Perdita massima media', tone: 'red' },
    { id: 'recoveryTime', title: 'RECOVERY TIME', value: '—', description: 'Tempo medio di recupero', tone: 'teal' }
  ];

  isRunning = false;
  kpis: KpiCard[] = [...this.defaultKpis];
  draggedKpiId: string | null = null;
  swapTargetId: string | null = null;
  insertTargetIndex: number | null = null;
  readonly macroTotal = 360000;

  async runSimulation(): Promise<void> {
    const portfolio = this.selectedPortfolio();
    if (!portfolio || this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.resetKpis();

    try {
      const portfolioResponse = await firstValueFrom(this.apiService.getPortfolioById(portfolio.id));
      const rawHoldings = Array.isArray(portfolioResponse?.data?.holdings)
        ? portfolioResponse.data.holdings
        : Array.isArray(portfolioResponse?.holdings)
          ? portfolioResponse.holdings
          : [];

      if (rawHoldings.length === 0) {
        throw new Error('Portfolio senza holding disponibili.');
      }

      const positions: Array<{ isin: string; weight: number }> = rawHoldings
        .map((holding: any): { isin: string; weight: number } | null => {
          const isin = holding?.isin ?? holding?.etfId ?? holding?.id ?? holding?.ticker;
          const weight = Number(holding?.weight ?? holding?.targetWeight ?? 0);
          if (!isin || !Number.isFinite(weight) || weight <= 0) {
            return null;
          }
          return { isin: String(isin), weight };
        })
        .filter((position: { isin: string; weight: number } | null): position is { isin: string; weight: number } => position !== null);

      if (positions.length === 0) {
        throw new Error('Nessuna posizione valida nel portafoglio selezionato.');
      }

      const normalizedPositions = positions.map((position: { isin: string; weight: number }) => ({
        isin: position.isin,
        weight: position.weight
      }));

      const snapshotRequest = buildMonteCarloSnapshotRequest(normalizedPositions);
      const snapshotResponse = await firstValueFrom(this.apiService.getMonteCarloSnapshot(snapshotRequest));
      const snapshot = snapshotResponse?.data ?? snapshotResponse;

      if (!snapshot || !Array.isArray(snapshot.etfs) || snapshot.etfs.length === 0) {
        throw new Error('Snapshot Monte Carlo non disponibile.');
      }

      const input = buildMonteCarloUserInput(normalizedPositions, 100000, 30);
      const coordinator = new MonteCarloCoordinator({
        input,
        snapshot,
        mode: 'COMPLETE',
        onProgress: () => undefined
      });

      const outcome = await coordinator.run();

      if (outcome.status !== 'success' || !outcome.result) {
        throw new Error(outcome.error?.message ?? 'Simulazione Monte Carlo fallita.');
      }

      const result = outcome.result;
      this.macroScenarioDistribution = this.buildMacroSegmentsFromFrequencies(result?.statistics?.scenario?.frequencies);
      this.updateDonutSegments();
      this.kpis = [
        { id: 'expectedReturn', title: 'RENDIMENTO MEDIO ATTESO', value: this.formatPercent(result.mainKpis?.robustCagr), description: 'CAGR annuo', tone: 'cyan' },
        { id: 'volatility', title: 'VOLATILITÀ', value: this.formatPercent(result.mainKpis?.volatility), description: 'Deviazione standard annua', tone: 'violet' },
        { id: 'positiveReturnProbability', title: 'PROBABILITÀ RENDIMENTO POSITIVO', value: '—', description: 'Scenari con rendimento > 0', tone: 'blue' },
        { id: 'recoveryPeriod', title: 'PERIODO DI RECUPERO', value: this.formatMonths(result.mainKpis?.recoveryTimeMonths), description: 'Tempo medio al break-even', tone: 'amber' },
        { id: 'averageMaxDrawdown', title: 'DRAWDOWN MASSIMO MEDIO', value: this.formatPercent(result.mainKpis?.robustMaxDrawdown), description: 'Perdita massima media', tone: 'red' },
        { id: 'recoveryTime', title: 'RECOVERY TIME', value: this.formatMonths(result.mainKpis?.recoveryTimeMonths), description: 'Tempo medio di recupero', tone: 'teal' }
      ];
    } catch (error) {
      this.kpis = [...this.defaultKpis];
    } finally {
      this.isRunning = false;
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

    return `${Number(value).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mesi`;
  }

  buildHistogramBars(data: { label: string; value: number }[], height = 170, width = 420): Array<{ x: number; y: number; width: number; height: number; opacity: number }> {
    const maxValue = Math.max(...data.map((item) => item.value), 1);
    const barWidth = width / data.length;

    return data.map((item, index) => {
      const h = (item.value / maxValue) * height;
      const x = index * barWidth + 6;
      const y = height - h + 4;
      return {
        x,
        y,
        width: barWidth - 10,
        height: h,
        opacity: index === 4 ? 1 : 0.8
      };
    });
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
