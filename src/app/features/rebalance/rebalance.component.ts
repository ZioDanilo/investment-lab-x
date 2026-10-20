import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { ApiService } from '../../core/api/api.service';
import { ActionConfirmationService } from '../../core/services/action-confirmation.service';
import { QuotationsUpdatedService } from '../../core/services/quotations-updated.service';
import { RebalanceInputService } from '../../core/services/rebalance-input.service';
import { RebalanceRow } from '../../core/models/rebalance.model';
import { optimizeRebalance } from './rebalance-optimizer';

interface RealHolding {
  isin: string;
  name?: string;
  nickname?: string;
  ticker?: string;
  quantity: number;
  averageCost: number;
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
  private readonly actionConfirmation = inject(ActionConfirmationService);
  private readonly quotationsUpdated = inject(QuotationsUpdatedService);
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
  readonly manualPricesByIsin = signal<Record<string,number>>({});
  readonly manualPriceDrafts = signal<Record<string,string>>({});

  setManualPrice(isin: string, raw: string): void {
    const key = isin.toUpperCase();
    this.manualPriceDrafts.update(previous => ({...previous, [key]: raw}));
    const price = Number(raw.trim().replace(',', '.'));
    this.manualPricesByIsin.update(previous => {
      const next = {...previous};
      if (raw.trim() && Number.isFinite(price) && price > 0) next[key] = price;
      else delete next[key];
      return next;
    });
  }

  readonly quotationDates = signal<Record<string, string>>({});
  readonly refreshingIsins = signal<string[]>([]);
  readonly quotationErrors = signal<Record<string, string>>({});
  readonly todayRome = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Rome', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  private targetRequestVersion = 0;
  readonly holdingsError = signal(false);
  private requestVersion = 0;

  formatQuotationDate(isin: string): string {
    const raw = this.quotationDates()[isin.toUpperCase()];
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw || '');
    return match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : '';
  }

  needsQuotationRefresh(isin: string): boolean {
    return this.quotationDates()[isin.toUpperCase()] !== this.todayRome;
  }

  refreshQuotation(isin: string): void {
    const key = isin.toUpperCase();
    if (!key || this.refreshingIsins().includes(key)) return;
    this.actionConfirmation.ask('Aggiornare la quotazione dell’ETF ' + key + '?', 'Aggiorna', () => this.executeQuotationRefresh(key));
  }

  private executeQuotationRefresh(key: string): void {
    if (this.refreshingIsins().includes(key)) return;
    this.refreshingIsins.update(keys => [...keys, key]);
    this.quotationErrors.update(errors => { const next = {...errors}; delete next[key]; return next; });
    this.api.refreshSingleEodhdQuotation(key).pipe(finalize(() => this.refreshingIsins.update(keys => keys.filter(value => value !== key)))).subscribe({
      next: (response: any) => {
        const quote = response?.data;
        const price = Number(quote?.quotation);
        const date = String(quote?.date || '');
        if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          this.quotationErrors.update(errors => ({...errors, [key]: 'Quotazione non disponibile da Yahoo Finance'}));
          this.actionConfirmation.notify('Quotazione non disponibile da Yahoo Finance per ' + key, true);
          return;
        }
        this.quotationDates.update(dates => ({...dates, [key]: date}));
        this.pricesByIsin.update(prices => ({...prices, [key]: price}));
        this.holdings.update(items => items.map(h => h.isin.toUpperCase() === key ? {...h, currentPrice:price, marketValue:Number(h.quantity)*price} : h));
        if (date !== this.todayRome) this.quotationErrors.update(errors => ({...errors, [key]: `Ultima chiusura disponibile: ${date}`}));
        this.quotationsUpdated.publish();
      },
      error: (error: any) => {
        const message = error?.error?.error || 'Aggiornamento non riuscito';
        this.quotationErrors.update(errors => ({...errors, [key]: message}));
        this.actionConfirmation.notify('Aggiornamento quotazione ' + key + ' non riuscito: ' + message, true);
      }
    });
  }

  constructor() {
    // A single quotation request per ISIN supplies both price and date,
    // including ETFs present only in the simulated target portfolio.
    effect((onCleanup) => {
      this.quotationsUpdated.version();
      const isins = [...new Set([
        ...this.holdings().map(h => h.isin.toUpperCase()),
        ...this.targetHoldings().map(t => t.isin.toUpperCase())
      ])].filter(Boolean);
      if (!isins.length) {
        this.quotationDates.set({});
        this.pricesByIsin.set({});
        return;
      }
      const subscription = forkJoin(isins.map(isin =>
        this.api.getLatestStoredQuotation(isin).pipe(
          map((response: any) => ({
            isin,
            date: String(response?.data?.[0]?.date || ''),
            price: response?.data?.[0]?.quotation == null ? null : Number(response.data[0].quotation)
          })),
          catchError(() => of({ isin, date: '', price: null }))
        )
      )).subscribe(quotes => {
        const dates: Record<string, string> = {};
        const prices: Record<string, number> = {};
        for (const quote of quotes) {
          if (quote.date) dates[quote.isin] = quote.date;
          if (quote.price != null && Number.isFinite(quote.price) && quote.price > 0) {
            prices[quote.isin] = quote.price;
          }
        }
        this.quotationDates.set(dates);
        this.pricesByIsin.set(prices);
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });
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
      this.quotationsUpdated.version();
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
    const manualPrices = this.manualPricesByIsin();
    const total = positions.reduce((sum, h) => {
      const stored = Number(h.currentPrice);
      const price = manualPrices[h.isin.toUpperCase()] ?? (Number.isFinite(stored) && stored > 0 ? stored : (this.pricesByIsin()[h.isin.toUpperCase()] ?? 0));
      return sum + Number(h.quantity) * price;
    }, 0);
    const targetByIsin = new Map(this.targetHoldings().map(t => [t.isin, t]));
    const realIsins = new Set(positions.map(h => h.isin.toUpperCase()));
    const realRows = positions.map(h => {
      const quantity = Number(h.quantity);
      const storedPrice = Number(h.currentPrice);
      const marketPrice = manualPrices[h.isin.toUpperCase()] ?? (Number.isFinite(storedPrice) && storedPrice > 0 ? storedPrice : (this.pricesByIsin()[h.isin.toUpperCase()] ?? 0));
      const marketValue = marketPrice > 0 ? quantity * marketPrice : 0;
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
        etfName: t.etfName, isin: t.isin, quantity: 0, marketPrice: manualPrices[t.isin] ?? this.pricesByIsin()[t.isin] ?? 0,
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
    if (rows.some(r => !Number.isFinite(r.marketPrice) || r.marketPrice <= 0)) return null;
    // Never estimate sale taxes using an unknown or zero cost basis.
    if (this.holdings().some(h => Number(h.quantity)>0 && !(Number(h.averageCost)>0))) return null;
    return optimizeRebalance(rows.map(r=>({
      isin:r.isin,quantity:r.quantity,price:r.marketPrice,targetWeight:r.targetWeight,
      averageCost:Number(this.holdings().find(h=>h.isin.toUpperCase()===r.isin.toUpperCase())?.averageCost ?? 0)
    })),this.cashToAdd(),this.feePerOperation);
  });
  readonly missingPrices = computed(() => this.rows().filter(r=>r.marketPrice<=0).map(r=>r.isin));
  readonly optimizedRows = computed<RebalanceRow[]>(() => {
    const result=this.optimization();
    const rows=this.rows();
    if(!result)return rows;
    const net=this.totalValue()+this.cashToAdd()-result.transactionCosts-result.estimatedTax;
    return rows.map((r,i)=>{
      const deltaQuantity=result.quantities[i]-r.quantity;
      const targetValue=r.targetWeight*net;
      return {...r,targetValue,deltaQuantity,deltaEur:deltaQuantity*r.marketPrice};
    });
  });
  readonly operationCount = computed(() => this.optimization()?.operationCount ?? 0);
  readonly transactionCosts = computed(() => this.optimization()?.transactionCosts ?? 0);
  readonly estimatedTax = computed(() => this.optimization()?.estimatedTax ?? 0);
  readonly remainingCash = computed(() => this.optimization()?.cashRemaining ?? 0);
  readonly totalValue = computed(() => this.rows().reduce((sum, row) => sum + row.marketValue, 0));
  readonly totalInvestable = computed(() => this.totalValue() + this.cashToAdd());
}
