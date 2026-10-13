import { Component, effect, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/api/api.service';
import { QuotationService } from '../../core/services/quotation.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { Subscription } from 'rxjs';

interface TrendEtf { isin: string; label: string; }
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
        <button *ngFor="let strategy of strategies; let i = index" type="button"
          class="strategy-button" [class.is-selected]="selectedStrategy === i"
          [attr.aria-pressed]="selectedStrategy === i" (click)="selectStrategy(i)">
          {{ strategy }}
        </button>
      </div>
      <div *ngIf="selectedStrategy === 1" class="strategy-content">
        <label for="trend-etf">ETF del portafoglio</label>
        <select id="trend-etf" [value]="selectedIsin" (change)="selectEtf($any($event.target).value)"
          [disabled]="loadingPortfolio || !etfs.length">
          <option value="">Seleziona ETF</option>
          <option *ngFor="let etf of etfs" [value]="etf.isin">{{ etf.label }}</option>
        </select>
        <p *ngIf="!portfolioSelection.selectedPortfolio()">Seleziona un portafoglio dalla barra superiore.</p>
        <p *ngIf="loadingPortfolio || loadingPrices">Caricamento...</p>
        <p *ngIf="error" class="error">{{ error }}</p>
        <div *ngIf="price !== null && average !== null && !loadingPrices" class="results">
          <div class="result"><span>Prezzo</span><strong>{{ formatPrice(price) }} €</strong></div>
          <div class="result"><span>Media mobile 200 giorni</span><strong>{{ formatPrice(average) }} €</strong></div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .strategy-grid { display:grid; grid-template-columns:repeat(8,minmax(0,1fr)); gap:6px; margin-top:12px; }
    .strategy-button { min-height:46px; padding:6px 7px; border-radius:8px; font-size:11px; line-height:1.2; border:1px solid rgba(125,150,190,.35); background:rgba(35,55,90,.45); color:inherit; font-family:inherit; font-weight:600; cursor:pointer; transition:background .2s,border-color .2s,transform .2s; }
    .strategy-button:hover { border-color:#66b8ff; transform:translateY(-2px); }
    .strategy-button.is-selected { background:rgba(43,119,204,.32); border:2px solid #66b8ff; }
    .strategy-button:focus-visible { outline:3px solid #66b8ff; outline-offset:3px; }
    .strategy-content { display:flex; flex-direction:column; align-items:center; gap:14px; padding:30px 12px; text-align:center; }
    .strategy-content label { font-weight:600; }
    .strategy-content select { width:min(440px,100%); padding:10px 12px; border-radius:8px; background:#203554; color:white; border:1px solid #6085b5; }
    .results { display:flex; justify-content:center; flex-wrap:wrap; gap:16px; width:100%; }
    .result { display:flex; flex-direction:column; gap:8px; padding:20px 28px; min-width:190px; border:1px solid rgba(125,150,190,.35); border-radius:12px; background:rgba(35,55,90,.45); }
    .result strong { font-size:23px; }
    .error { color:#ff9292; }
    @media(max-width:850px) { .strategy-grid { overflow-x:auto; grid-template-columns:repeat(8,minmax(115px,1fr)); padding-bottom:6px; } }
  `]
})
export class TrendFollowingPageComponent implements OnDestroy {
  readonly portfolioSelection = inject(PortfolioSelectionService);
  private readonly api = inject(ApiService);
  private readonly quotations = inject(QuotationService);
  private portfolioRequest?: Subscription;
  private priceRequest?: Subscription;
  private requestId = 0;
  private currentPortfolioId: string | null = null;
  readonly strategies = [
    'Buy & Hold Momentum', 'Media mobile 200 giorni', 'Time Series Momentum 12 mesi',
    'Doppia media mobile 50/200', 'Momentum → World → XEON',
    'Momentum → XEON con rientro rapido', 'Trend Following + Volatility Targeting',
    'Momentum → World → XEON + Volatility Targeting'
  ];
  selectedStrategy: number | null = null;
  etfs: TrendEtf[] = [];
  selectedIsin = '';
  loadingPortfolio = false;
  loadingPrices = false;
  error = '';
  price: number | null = null;
  average: number | null = null;

  constructor() {
    effect(() => {
      const selected = this.portfolioSelection.selectedPortfolio();
      this.portfolioSelection.refreshVersion();
      if (selected?.id !== this.currentPortfolioId) {
        this.currentPortfolioId = selected?.id ?? null;
        this.loadPortfolio();
      }
    });
  }
  selectStrategy(index: number): void {
    this.selectedStrategy = index;
    if (index === 1 && this.currentPortfolioId && !this.etfs.length) this.loadPortfolio();
  }
  private resetPrices(): void {
    this.priceRequest?.unsubscribe();
    this.requestId++;
    this.selectedIsin = '';
    this.price = null;
    this.average = null;
    this.loadingPrices = false;
    this.error = '';
  }
  private loadPortfolio(): void {
    this.portfolioRequest?.unsubscribe();
    this.resetPrices();
    this.etfs = [];
    const selected = this.portfolioSelection.selectedPortfolio();
    if (!selected || selected.tipo !== 'reale') { this.loadingPortfolio = false; return; }
    const working = this.portfolioSelection.workingPortfolio();
    if (this.portfolioSelection.currentWorkingPortfolioId() === selected.id && working) {
      this.setEtfs(working.holdings);
      return;
    }
    this.loadingPortfolio = true;
    const source = selected.tipo === 'reale'
      ? this.api.getRealPortfolioHoldings(selected.id)
      : this.api.getPortfolioById(selected.id);
    this.portfolioRequest = source.subscribe({
      next: (response: any) => {
        if (this.portfolioSelection.selectedPortfolio()?.id !== selected.id) return;
        const holdings = selected.tipo === 'reale' ? response?.data : response?.data?.holdings;
        this.setEtfs(Array.isArray(holdings) ? holdings : []);
      },
      error: () => { this.loadingPortfolio = false; this.error = 'Impossibile caricare gli ETF del portafoglio.'; }
    });
  }
  private setEtfs(holdings: any[]): void {
    const unique = new Map<string, TrendEtf>();
    for (const holding of holdings) {
      const isin = String(holding?.isin ?? holding?.etf?.isin ?? '').trim();
      if (!isin) continue;
      const label = holding?.nickname || holding?.etf?.nickname || holding?.fullName ||
        holding?.etf?.name || holding?.name || holding?.ticker || isin;
      unique.set(isin, { isin, label: `${label} (${isin})` });
    }
    this.etfs = [...unique.values()];
    this.loadingPortfolio = false;
  }
  selectEtf(isin: string): void {
    this.resetPrices();
    this.selectedIsin = isin;
    if (!isin) return;
    this.loadingPrices = true;
    const requestId = this.requestId;
    this.priceRequest = this.quotations.getQuotationHistory(isin, 250).subscribe({
      next: (response: any) => {
        if (requestId !== this.requestId) return;
        const rows = (Array.isArray(response?.data) ? response.data : [])
          .filter((row: any) => row?.quotation !== null && row?.quotation !== undefined &&
            Number.isFinite(Number(row.quotation)) && Number(row.quotation) > 0)
          .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))
          .slice(0, 200);
        if (!rows.length) { this.error = 'Nessuna quotazione disponibile.'; this.loadingPrices = false; return; }
        this.price = Number(rows[0].quotation);
        this.average = rows.reduce((sum: number, row: any) => sum + Number(row.quotation), 0) / rows.length;
        this.loadingPrices = false;
      },
      error: () => { if (requestId === this.requestId) { this.loadingPrices = false; this.error = 'Impossibile leggere le quotazioni.'; } }
    });
  }
  formatPrice(value: number | null): string {
    return value === null ? '—' : new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
  }
  ngOnDestroy(): void { this.portfolioRequest?.unsubscribe(); this.priceRequest?.unsubscribe(); }
}
