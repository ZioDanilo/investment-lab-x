import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, ViewChild, computed, signal } from '@angular/core';
import {
  MonteCarloRepresentativeContributionAnalysis,
  MonteCarloRepresentativeEtfContribution
} from '../../../core/models/monte-carlo.model';

interface ChartPoint extends MonteCarloRepresentativeEtfContribution {
  year: number;
  x: number;
  y: number;
}

interface ChartSeries {
  isin: string;
  nickname: string;
  color: string;
  points: ChartPoint[];
}

@Component({
  selector: 'app-montecarlo-contribution-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './montecarlo-contribution-chart.component.html',
  styleUrls: ['./montecarlo-contribution-chart.component.css']
})
export class MontecarloContributionChartComponent {
  private readonly analysisState = signal<MonteCarloRepresentativeContributionAnalysis | null>(null);
  @ViewChild('frameRef') private frameRef?: ElementRef<HTMLDivElement>;
  @ViewChild('tooltipRef') private tooltipRef?: ElementRef<HTMLDivElement>;
  readonly currentAnalysis = computed(() => this.analysisState());
  readonly hoveredPoint = signal<ChartPoint | null>(null);
  readonly tooltipLeft = signal(0);
  readonly tooltipTop = signal(0);

  readonly width = 920;
  readonly height = 320;
  readonly padding = { top: 18, right: 16, bottom: 34, left: 58 };
  private readonly tooltipOffset = 6;
  private readonly frameMargin = 8;
  private readonly palette = [
    '#00bcd4',
    '#ff5252',
    '#7cb342',
    '#ffb300',
    '#8e24aa',
    '#f4511e',
    '#1e88e5',
    '#43a047',
    '#d81b60',
    '#6d4c41',
    '#3949ab',
    '#c0ca33',
    '#00897b',
    '#fb8c00'
  ];

  @Input() set analysis(value: MonteCarloRepresentativeContributionAnalysis | null | undefined) {
    this.analysisState.set(value ?? null);
  }

  readonly maxAbsContribution = computed(() => {
    const analysis = this.analysisState();
    if (!analysis) {
      return 0.01;
    }

    const values = analysis.years.flatMap((year) => year.contributions.map((entry) => Math.abs(entry.contribution)));
    return Math.max(0.01, ...values);
  });

  readonly yearCount = computed(() => this.analysisState()?.years.length ?? 0);

  readonly yTicks = computed(() => {
    const maxAbs = this.maxAbsContribution();
    return [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs];
  });

  readonly series = computed<ChartSeries[]>(() => {
    const analysis = this.analysisState();
    if (!analysis || analysis.years.length === 0) {
      return [];
    }

    const yearCount = analysis.years.length;
    const usableWidth = this.width - this.padding.left - this.padding.right;
    const usableHeight = this.height - this.padding.top - this.padding.bottom;
    const maxAbs = this.maxAbsContribution();
    const bucket = new Map<string, ChartSeries>();

    analysis.years.forEach((yearEntry, index) => {
      const x = this.padding.left + (yearCount === 1 ? usableWidth / 2 : (index / (yearCount - 1)) * usableWidth);

      yearEntry.contributions.forEach((contribution) => {
        const y = this.padding.top + ((maxAbs - contribution.contribution) / (2 * maxAbs)) * usableHeight;
        const existing = bucket.get(contribution.isin);
        const point: ChartPoint = {
          ...contribution,
          year: yearEntry.year,
          x,
          y
        };

        if (existing) {
          existing.points.push(point);
          return;
        }

        bucket.set(contribution.isin, {
          isin: contribution.isin,
          nickname: contribution.nickname,
          color: this.resolveColor(contribution.isin),
          points: [point]
        });
      });
    });

    return Array.from(bucket.values()).map((entry) => ({
      ...entry,
      points: entry.points.sort((a, b) => a.year - b.year)
    }));
  });

  readonly zeroLineY = computed(() => {
    const usableHeight = this.height - this.padding.top - this.padding.bottom;
    return this.padding.top + usableHeight / 2;
  });

  showTooltip(point: ChartPoint, event: MouseEvent): void {
    this.hoveredPoint.set(point);
    this.updateTooltipPosition(event);
    requestAnimationFrame(() => this.updateTooltipPosition(event));
  }

  moveTooltip(event: MouseEvent): void {
    if (!this.hoveredPoint()) {
      return;
    }

    this.updateTooltipPosition(event);
  }

  hideTooltip(): void {
    this.hoveredPoint.set(null);
  }

  buildPolyline(points: ChartPoint[]): string {
    return points.map((point) => `${point.x},${point.y}`).join(' ');
  }

  formatPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
  }

  private updateTooltipPosition(event: MouseEvent): void {
    const frameEl = this.frameRef?.nativeElement;
    if (!frameEl) {
      return;
    }

    const frameRect = frameEl.getBoundingClientRect();
    const frameWidth = frameRect.width;
    const frameHeight = frameRect.height;
    const tooltipEl = this.tooltipRef?.nativeElement;
    const tooltipWidth = tooltipEl?.offsetWidth ?? 230;
    const tooltipHeight = tooltipEl?.offsetHeight ?? 130;
    const cursorX = event.clientX - frameRect.left;
    const cursorY = event.clientY - frameRect.top;

    const rightSideLeft = cursorX + this.tooltipOffset;
    const leftSideLeft = cursorX - this.tooltipOffset - tooltipWidth;
    const aboveTop = cursorY - this.tooltipOffset - tooltipHeight;
    const belowTop = cursorY + this.tooltipOffset;

    let left = rightSideLeft;
    let top = aboveTop;

    // Keep tooltip close to cursor near right edge by switching side.
    if (rightSideLeft + tooltipWidth + this.frameMargin > frameWidth) {
      left = leftSideLeft;
    }
    if (left < this.frameMargin) {
      left = this.frameMargin;
    }
    if (left + tooltipWidth + this.frameMargin > frameWidth) {
      left = frameWidth - tooltipWidth - this.frameMargin;
    }

    // Keep tooltip close to cursor near top edge by switching below cursor.
    if (aboveTop < this.frameMargin) {
      top = belowTop;
    }
    if (top + tooltipHeight + this.frameMargin > frameHeight) {
      top = aboveTop;
    }
    if (top < this.frameMargin) {
      top = this.frameMargin;
    }
    if (top + tooltipHeight + this.frameMargin > frameHeight) {
      top = frameHeight - tooltipHeight - this.frameMargin;
    }

    this.tooltipLeft.set(left);
    this.tooltipTop.set(top);
  }

  private resolveColor(isin: string): string {
    const hash = Array.from(isin).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return this.palette[hash % this.palette.length];
  }
}
