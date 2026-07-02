import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioStateService } from '../../core/services/portfolio-state.service';
import { RebalanceEngine } from '../../core/engines/rebalance.engine';

@Component({
  selector: 'app-rebalance',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rebalance.component.html'
})
export class RebalanceComponent {
  portfolio1Text = signal('');
  portfolio2Text = signal('');
  cashToAdd = signal(0);

  constructor(public state: PortfolioStateService) {}

  positions1 = computed(() => RebalanceEngine.parseBrokerExport(this.portfolio1Text()));
  positions2 = computed(() => RebalanceEngine.parseBrokerExport(this.portfolio2Text()));
  rows = computed(() => RebalanceEngine.buildRows(this.state.etfs(), this.positions1(), this.positions2(), this.cashToAdd()));

  totalValue = computed(() => this.rows().reduce((sum, row) => sum + row.marketValue, 0));
  totalInvestable = computed(() => this.totalValue() + this.cashToAdd());

  setCash(value: string): void {
    this.cashToAdd.set(Number(value) || 0);
  }
}
