import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-chart-tooltip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-tooltip.component.html',
  styleUrls: ['./chart-tooltip.component.css']
})
export class ChartTooltipComponent {
  @Input() label: string | null = null;
  @Input() value = '';
  @Input() variant: 'default' | 'drawdown' = 'default';
}
