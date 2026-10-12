import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { ApiService } from '../../core/api/api.service';
import { RebalanceInputService } from '../../core/services/rebalance-input.service';
import { RebalanceRow } from '../../core/models/rebalance.model';

interface RealHolding {
  isin: string;
  name?: string;
  nickname?: string;
  ticker?: string;
  quantity: number;
  currentPrice: number | null;
  marketValue: number | null;
}

@Component({
  selector: 'app-rebalance',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './rebalance.component.html',
  styleUrls: ['./rebalance.component.css']
})
export class RebalanceComponent {
  private readonly selection = inject(PortfolioSelectionService);
  private readonly api = inject(ApiService);
  readonly rebalanceInputs = inject(RebalanceInputService);
  readonly cashToAdd = this.rebalanceInputs.cashToAdd;
  readonly selectedRealPortfolio = computed(() => {
    const selected = this.selection.selectedPortfolio();
    return selected?.tipo === 'reale' ? selected : null;
  });
  readonly holdings = signal<RealHolding[]>([]);
  readonly loadingHoldings = signal(false);
  readonly holdingsError = signal(false);
  private requestVersion = 0;

  constructor() {
    effect((onCleanup) => {
      const portfolio = this.selectedRealPortfolio();
      const refresh = this.selection.refreshVersion();
      void refresh;
      const version = ++this.requestVersion;
      this.holdings.set([]);
      this.holdingsError.set(false);
      if (!portfolio) { this.loadingHoldings.set(false); return; }
      this.loadingHoldings.set(true);
      const subscription = this.api.getRealPortfolioHoldings(portfolio.id).subscribe({
        next: (response: any) => {
          if (version !== this.requestVersion) return;
          this.holdings.set(Array.isArray(response?.data) ? response.data : []);
          this.loadingHoldings.set(false);
        },
        error: () => {
          if (version !== this.requestVersion) return;
          this.holdings.set([]);
          this.holdingsError.set(true);
          this.loadingHoldings.set(false);
        }
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });
  }

  readonly rows = computed<RebalanceRow[]>(() => {
    if (!this.selectedRealPortfolio()) return [];
    const positions = this.holdings().filter(h => Number(h.quantity) > 0);
    const total = positions.reduce((sum, h) => sum + (Number(h.marketValue) || 0), 0);
    return positions.map(h => {
      const quantity = Number(h.quantity);
      const marketPrice = h.currentPrice == null ? 0 : Number(h.currentPrice);
      const marketValue = h.marketValue == null ? 0 : Number(h.marketValue);
      return {
        etfName: h.nickname || h.name || h.ticker || h.isin,
        isin: h.isin,
        quantity,
        marketPrice,
        marketValue,
        currentWeight: total > 0 ? marketValue / total : 0,
        targetWeight: 0,
        targetValue: 0,
        deltaEur: 0,
        deltaQuantity: 0
      };
    });
  });
  readonly totalValue = computed(() => this.rows().reduce((sum, row) => sum + row.marketValue, 0));
  readonly totalInvestable = computed(() => this.totalValue() + this.cashToAdd());
}
