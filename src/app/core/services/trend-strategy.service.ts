import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TrendStrategyService {
  readonly strategies = [
    'Media mobile 200 giorni', 'Time Series 12 mesi',
    'Doppia media mobile 50/200', 'Momentum → World → XEON',
    'Momentum → XEON con rientro rapido', 'Trend Following + Volatility Targeting',
    'Momentum → World → XEON + Volatility Targeting'
  ];
  readonly selectedStrategy = signal<number | null>(null);
  readonly strategyIndexes = [1, 2, 3, 4, 5, 6, 7];

  select(value: string): void {
    const index = Number(value);
    this.selectedStrategy.set(value !== '' && Number.isInteger(index) && this.strategyIndexes.includes(index) ? index : null);
  }
}
