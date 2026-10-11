import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-trend-following-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="page-panel">
      <div class="page-header page-header-compact">
        <h2>Trend Following</h2>
        <p>Seleziona una strategia da analizzare.</p>
      </div>
      <div class="strategy-grid" role="group" aria-label="Strategie Trend Following">
        <button *ngFor="let strategy of strategies; let i = index"
                type="button"
                class="strategy-button"
                [class.is-selected]="selectedStrategy === i"
                [attr.aria-pressed]="selectedStrategy === i"
                (click)="selectedStrategy = i">
          {{ strategy }}
        </button>
      </div>
    </section>
  `,
  styles: [`
    .strategy-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; margin-top: 12px; }
    .strategy-button { min-height: 46px; padding: 6px 7px; border-radius: 8px; font-size: 11px; line-height: 1.2; border: 1px solid rgba(125,150,190,.35); background: rgba(35,55,90,.45); color: inherit; font-family: inherit; font-weight: 600; cursor: pointer; transition: background .2s, border-color .2s, transform .2s; }
    .strategy-button:hover { border-color: #66b8ff; transform: translateY(-2px); }
    .strategy-button.is-selected { background: rgba(43,119,204,.32); border: 2px solid #66b8ff; }
    .strategy-button:focus-visible { outline: 3px solid #66b8ff; outline-offset: 3px; }
    @media (max-width: 850px) { .strategy-grid { overflow-x: auto; grid-template-columns: repeat(8, minmax(115px, 1fr)); padding-bottom: 6px; } }
  `]
})
export class TrendFollowingPageComponent {
  readonly strategies = [
    'Buy & Hold Momentum',
    'Media mobile 200 giorni',
    'Time Series Momentum 12 mesi',
    'Doppia media mobile 50/200',
    'Momentum → World → XEON',
    'Momentum → XEON con rientro rapido',
    'Trend Following + Volatility Targeting',
    'Momentum → World → XEON + Volatility Targeting'
  ];
  selectedStrategy: number | null = null;
}
