import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TrendStrategyService {
  readonly strategies = [
    'Buy & Hold Momentum', 'Media mobile 200 giorni', 'Time Series Momentum 12 mesi',
    'Doppia media mobile 50/200', 'Momentum → World → XEON',
    'Momentum → XEON con rientro rapido', 'Trend Following + Volatility Targeting',
    'Momentum → World → XEON + Volatility Targeting'
  ];
  readonly selectedStrategy = signal<number | null>(null);

  select(value: string): void {
    const index = Number(value);
    this.selectedStrategy.set(value !== '' && Number.isInteger(index) && index >= 0 && index < this.strategies.length ? index : null);
  }
}
