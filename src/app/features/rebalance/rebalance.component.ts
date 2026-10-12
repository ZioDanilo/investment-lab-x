import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { ApiService } from '../../core/api/api.service';
import { RebalanceInputService } from '../../core/services/rebalance-input.service';
import { RebalanceRow } from '../../core/models/rebalance.model';
import { optimizeRebalance } from './rebalance-optimizer';

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
  readonly targetHoldings = signal<Array<{isin:string;etfName:string;targetWeight:number}>>([]);
  readonly targetLoading = signal(false);
  readonly targetError = signal(false);
  readonly pricesByIsin = signal<Record<string,number>>({});
  private targetRequestVersion = 0;
  readonly holdingsError = signal(false);
  private requestVersion = 0;

  constructor() {
    effect((onCleanup) => {
      const target = this.targetHoldings();
      this.pricesByIsin.set({});
      if (!target.length) return;
      const subscription = forkJoin(target.map(t =>
        this.api.getLatestStoredQuotation(t.isin).pipe(
          map((response:any) => ({isin:t.isin,price:Number(response?.data?.[0]?.quotation)})),
          catchError(() => of({isin:t.isin,price:0}))
        )
      )).subscribe(prices => {
        const byIsin:Record<string,number>={};
        for(const quote of prices)if(Number.isFinite(quote.price)&&quote.price>0)byIsin[quote.isin]=quote.price;
        this.pricesByIsin.set(byIsin);
      });
      onCleanup(() => subscription.unsubscribe());
    }, {allowSignalWrites:true});
    effect((onCleanup) => {
      const id = this.selection.lastLaboratoryPortfolioId();
      const version = ++this.targetRequestVersion;
      this.targetHoldings.set([]);
      this.targetError.set(false);
      if (!id) { this.targetLoading.set(false); return; }
      const working = this.selection.workingPortfolio();
      if (working?.id === id) {
        this.targetHoldings.set(this.normalizeTargetHoldings(working.holdings));
        this.targetLoading.set(false);
        return;
      }
      this.targetLoading.set(true);
      const subscription = this.api.getPortfolioById(id).subscribe({
        next: (response: any) => {
          if (version !== this.targetRequestVersion) return;
          const raw = response?.data ?? response;
          this.targetHoldings.set(this.normalizeTargetHoldings(raw?.holdings ?? raw?.etfs ?? raw?.Etfs ?? raw?.portfolioEtfs ?? []));
          this.targetLoading.set(false);
        },
        error: () => {
          if (version !== this.targetRequestVersion) return;
          this.targetHoldings.set([]);
          this.targetError.set(true);
          this.targetLoading.set(false);
        }
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });
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

  private normalizeTargetHoldings(raw: any): Array<{isin:string;etfName:string;targetWeight:number}> {
    const items = Array.isArray(raw) ? raw : [];
    const weights = items.map((item:any) => Number(item.weight ?? item.peso ?? item.PortfolioEtf?.weight ?? 0));
    const totalWeight = weights.reduce((sum:number, weight:number) => sum + (Number.isFinite(weight) ? weight : 0), 0);
    const divisor = totalWeight > 1.001 ? 100 : 1;
    return items.map((item: any) => {
      const etf = item.etf ?? item.ETF ?? item;
      const isin = String(item.isin ?? etf.isin ?? '').trim().toUpperCase();
      const weight = Number(item.weight ?? item.peso ?? item.PortfolioEtf?.weight ?? 0);
      return {
        isin,
        etfName: String(item.nickname ?? etf.nickname ?? item.fullName ?? etf.name ?? etf.ticker ?? isin),
        targetWeight: Number.isFinite(weight) ? weight / divisor : 0
      };
    }).filter((item: {isin:string}) => !!item.isin);
  }

  readonly rows = computed<RebalanceRow[]>(() => {
    if (!this.selectedRealPortfolio()) return [];
    const positions = this.holdings().filter(h => Number(h.quantity) > 0);
    const total = positions.reduce((sum, h) => sum + (Number(h.marketValue) || 0), 0);
    const targetByIsin = new Map(this.targetHoldings().map(t => [t.isin, t]));
    const realIsins = new Set(positions.map(h => h.isin.toUpperCase()));
    const realRows = positions.map(h => {
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
        targetWeight: targetByIsin.get(h.isin.toUpperCase())?.targetWeight ?? 0,
        targetValue: 0,
        deltaEur: 0,
        deltaQuantity: 0
      };
    });
    const missingTargetRows: RebalanceRow[] = this.targetHoldings()
      .filter(t => !realIsins.has(t.isin))
      .map(t => ({
        etfName: t.etfName, isin: t.isin, quantity: 0, marketPrice: this.pricesByIsin()[t.isin] ?? 0,
        marketValue: 0, currentWeight: 0, targetWeight: t.targetWeight,
        targetValue: 0, deltaEur: 0, deltaQuantity: 0
      }));
    return [...realRows, ...missingTargetRows];
  });
  readonly feePerOperation = 20;
  readonly selectionTargetReady = computed(() => !!this.selection.lastLaboratoryPortfolioId());
  readonly optimization = computed(() => {
    if(!this.selectedRealPortfolio() || !this.selection.lastLaboratoryPortfolioId() ||
       this.loadingHoldings() || this.targetLoading() || this.holdingsError() || this.targetError()) return null;
    const rows=this.rows();
    if(!rows.length)return null;
    return optimizeRebalance(rows.map(r=>({
      isin:r.isin,quantity:r.quantity,price:r.marketPrice,targetWeight:r.targetWeight
    })),this.cashToAdd(),this.feePerOperation);
  });
  readonly missingPrices = computed(() => this.rows().filter(r=>r.marketPrice<=0).map(r=>r.isin));
  readonly optimizedRows = computed<RebalanceRow[]>(() => {
    const result=this.optimization();
    const rows=this.rows();
    if(!result)return rows;
    const net=this.totalValue()+this.cashToAdd()-result.transactionCosts;
    return rows.map((r,i)=>{
      const deltaQuantity=result.quantities[i]-r.quantity;
      const targetValue=r.targetWeight*net;
      return {...r,targetValue,deltaQuantity,deltaEur:deltaQuantity*r.marketPrice};
    });
  });
  readonly operationCount = computed(() => this.optimization()?.operationCount ?? 0);
  readonly transactionCosts = computed(() => this.optimization()?.transactionCosts ?? 0);
  readonly remainingCash = computed(() => this.optimization()?.cashRemaining ?? 0);
  readonly totalValue = computed(() => this.rows().reduce((sum, row) => sum + row.marketValue, 0));
  readonly totalInvestable = computed(() => this.totalValue() + this.cashToAdd());
}
