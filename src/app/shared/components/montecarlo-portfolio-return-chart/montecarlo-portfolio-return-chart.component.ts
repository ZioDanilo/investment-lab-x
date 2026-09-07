import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, ViewChild, computed, signal } from '@angular/core';
import { MonteCarloPathResult } from '../../../core/models/monte-carlo.model';

interface ChartPoint {
  year: number;
  value: number;
  nickname: string;
  x: number;
  y: number;
}

interface ChartSeries {
  nickname: string;
  color: string;
  points: ChartPoint[];
}

@Component({
  selector: 'app-montecarlo-portfolio-return-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './montecarlo-portfolio-return-chart.component.html',
  styleUrls: ['./montecarlo-portfolio-return-chart.component.css']
})
export class MontecarloPortfolioReturnChartComponent {
  private readonly pathState = signal<MonteCarloPathResult | null>(null);
  @ViewChild('frameRef') private frameRef?: ElementRef<HTMLDivElement>;
  @ViewChild('tooltipRef') private tooltipRef?: ElementRef<HTMLDivElement>;
  readonly currentPath = computed(() => this.pathState());
  readonly hoveredPoint = signal<ChartPoint | null>(null);
  readonly tooltipLeft = signal(0);
  readonly tooltipTop = signal(0);

  readonly width = 920;
  readonly height = 320;
  readonly padding = { top: 18, right: 16, bottom: 34, left: 58 };
  private readonly tooltipOffset = 6;
  private readonly frameMargin = 8;
  private readonly palette = ['#18d9f6'];

  @Input() set path(value: MonteCarloPathResult | null | undefined) {
    this.pathState.set(value ?? null);
  }

  readonly maxAbsReturn = computed(() => {
    const path = this.pathState();
    if (!path) {
      return 0.01;
    }

    const values = path.years.map((entry) => Math.abs(entry.portfolioReturn));
    return Math.max(0.01, ...values);
  });

  readonly yearCount = computed(() => this.pathState()?.years.length ?? 0);

  readonly yTicks = computed(() => {
    const maxAbs = this.maxAbsReturn();
    return [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs];
  });

  readonly series = computed<ChartSeries[]>(() => {
    const path = this.pathState();
    if (!path || path.years.length === 0) {
      return [];
    }

    const yearCount = path.years.length;
    const usableWidth = this.width - this.padding.left - this.padding.right;
    const usableHeight = this.height - this.padding.top - this.padding.bottom;
    const maxAbs = this.maxAbsReturn();

    const points: ChartPoint[] = path.years.map((yearEntry, index) => {
      const x = this.padding.left + (yearCount === 1 ? usableWidth / 2 : (index / (yearCount - 1)) * usableWidth);
      const y = this.padding.top + ((maxAbs - yearEntry.portfolioReturn) / (2 * maxAbs)) * usableHeight;
      return {
        year: yearEntry.year,
        value: yearEntry.portfolioReturn,
        nickname: 'Portafoglio',
        x,
        y
      };
    });

    return [{
      nickname: 'Portafoglio',
      color: this.palette[0],
      points
    }];
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
    const tooltipWidth = tooltipEl?.offsetWidth ?? 220;
    const tooltipHeight = tooltipEl?.offsetHeight ?? 98;
    const cursorX = event.clientX - frameRect.left;
    const cursorY = event.clientY - frameRect.top;

    const rightSideLeft = cursorX + this.tooltipOffset;
    const leftSideLeft = cursorX - this.tooltipOffset - tooltipWidth;
    const aboveTop = cursorY - this.tooltipOffset - tooltipHeight;
    const belowTop = cursorY + this.tooltipOffset;

    let left = rightSideLeft;
    let top = aboveTop;

    if (rightSideLeft + tooltipWidth + this.frameMargin > frameWidth) {
      left = leftSideLeft;
    }
    if (left < this.frameMargin) {
      left = this.frameMargin;
    }
    if (left + tooltipWidth + this.frameMargin > frameWidth) {
      left = frameWidth - tooltipWidth - this.frameMargin;
    }

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
}
