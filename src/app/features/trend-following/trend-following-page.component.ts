import { Component, effect, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/api/api.service';
import { QuotationService } from '../../core/services/quotation.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { Subscription } from 'rxjs';

interface TrendEtf { isin: string; label: string; }
interface TrendSlot {
  isin: string;
  price: number | null;
  average: number | null;
  loading: boolean;
  error: string;
  requestId: number;
  subscription?: Subscription;
}
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
      <div *ngIf="selectedStrategy === 1" class="strategy-row">
        <article *ngFor="let slot of slots; let i = index" class="strategy-card">
          <label [for]="'trend-etf-' + i">ETF del portafoglio</label>
          <select [id]="'trend-etf-' + i" [value]="slot.isin"
            (change)="selectEtf(i, $any($event.target).value)"
            [disabled]="loadingPortfolio || !etfs.length">
            <option value="">Seleziona ETF</option>
            <option *ngFor="let etf of availableEtfs(i)" [value]="etf.isin">{{ etf.label }}</option>
          </select>
          <p *ngIf="loadingPortfolio || slot.loading">Caricamento...</p>
          <p *ngIf="slot.error" class="error">{{ slot.error }}</p>
          <div *ngIf="slot.price !== null && slot.average !== null && !slot.loading" class="results">
            <div class="result"><span>Prezzo</span><strong>{{ formatPrice(slot.price) }} €</strong></div>
            <div class="result"><span>Media mobile 200 giorni</span><strong>{{ formatPrice(slot.average) }} €</strong></div>
          </div>
        </article>
        <p *ngIf="!portfolioSelection.selectedPortfolio()" class="portfolio-hint">Seleziona un portafoglio dalla barra superiore.</p>
      </div>
    </section>
  `,
  styles: [`
    .strategy-grid { display:grid; grid-template-columns:repeat(8,minmax(0,1fr)); gap:6px; margin-top:12px; }
    .strategy-button { min-height:46px; padding:6px 7px; border-radius:8px; font-size:11px; line-height:1.2; border:1px solid rgba(125,150,190,.35); background:rgba(35,55,90,.45); color:inherit; font-family:inherit; font-weight:600; cursor:pointer; transition:background .2s,border-color .2s,transform .2s; }
    .strategy-button:hover { border-color:#66b8ff; transform:translateY(-2px); }
    .strategy-button.is-selected { background:rgba(43,119,204,.32); border:2px solid #66b8ff; }
    .strategy-button:focus-visible { outline:3px solid #66b8ff; outline-offset:3px; }
    .strategy-row { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin-top:24px; align-items:stretch; }
    .strategy-card { display:flex; flex-direction:column; align-items:stretch; gap:14px; padding:24px 18px; text-align:center; min-width:0; border:1px solid rgba(125,150,190,.45); border-radius:14px; background:rgba(35,55,90,.30); }
    .strategy-card label { font-weight:600; }
    .strategy-card select { width:100%; min-width:0; padding:10px 12px; border-radius:8px; background:#203554; color:white; border:1px solid #6085b5; }
    .results { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; width:100%; }
    .result { display:flex; flex-direction:column; justify-content:center; gap:8px; padding:16px 8px; min-width:0; border:1px solid rgba(125,150,190,.35); border-radius:12px; background:rgba(35,55,90,.45); }
    .result strong { font-size:clamp(15px,1.5vw,23px); overflow-wrap:anywhere; }
    .result span { font-size:12px; }
    .error { color:#ff9292; }
    .portfolio-hint { grid-column:1/-1; text-align:center; }
    @media(max-width:1100px) { .strategy-row { grid-template-columns:1fr; } .result strong { font-size:23px; } }
    @media(max-width:850px) { .strategy-grid { overflow-x:auto; grid-template-columns:repeat(8,minmax(115px,1fr)); padding-bottom:6px; } }
  `]
})
export class TrendFollowingPageComponent implements OnDestroy {
  readonly portfolioSelection = inject(PortfolioSelectionService);
  private readonly api = inject(ApiService);
  private readonly quotations = inject(QuotationService);
  private portfolioRequest?: Subscription;
  private currentPortfolioId: string | null = null;
  readonly strategies = [
    'Buy & Hold Momentum', 'Media mobile 200 giorni', 'Time Series Momentum 12 mesi',
    'Doppia media mobile 50/200', 'Momentum → World → XEON',
    'Momentum → XEON con rientro rapido', 'Trend Following + Volatility Targeting',
    'Momentum → World → XEON + Volatility Targeting'
  ];
  selectedStrategy: number | null = null;
  etfs: TrendEtf[] = [];
  loadingPortfolio = false;
  readonly slots: TrendSlot[] = Array.from({ length: 3 }, () => ({
    isin: '', price: null, average: null, loading: false, error: '', requestId: 0
  }));

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
  availableEtfs(slotIndex: number): TrendEtf[] {
    const taken = new Set(this.slots.filter((_, i) => i !== slotIndex).map(slot => slot.isin).filter(Boolean));
    return this.etfs.filter(etf => !taken.has(etf.isin));
  }
  private clearSlot(slot: TrendSlot): void {
    slot.subscription?.unsubscribe();
    slot.requestId++;
    slot.isin = '';
    slot.price = null;
    slot.average = null;
    slot.loading = false;
    slot.error = '';
  }
  private loadPortfolio(): void {
    this.portfolioRequest?.unsubscribe();
    this.slots.forEach(slot => this.clearSlot(slot));
    this.etfs = [];
    const selected = this.portfolioSelection.selectedPortfolio();
    if (!selected || selected.tipo !== 'reale') { this.loadingPortfolio = false; return; }
    this.loadingPortfolio = true;
    this.portfolioRequest = this.api.getRealPortfolioHoldings(selected.id).subscribe({
      next: (response: any) => {
        if (this.portfolioSelection.selectedPortfolio()?.id !== selected.id) return;
        this.setEtfs(Array.isArray(response?.data) ? response.data : []);
      },
      error: () => { this.loadingPortfolio = false; this.slots[0].error = 'Impossibile caricare gli ETF del portafoglio.'; }
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
  selectEtf(slotIndex: number, isin: string): void {
    const slot = this.slots[slotIndex];
    if (!slot || (isin && this.slots.some((other, i) => i !== slotIndex && other.isin === isin))) return;
    this.clearSlot(slot);
    slot.isin = isin;
    if (!isin) return;
    slot.loading = true;
    const requestId = slot.requestId;
    slot.subscription = this.quotations.getQuotationHistory(isin, 250).subscribe({
      next: (response: any) => {
        if (requestId !== slot.requestId) return;
        const rows = (Array.isArray(response?.data) ? response.data : [])
          .filter((row: any) => row?.quotation !== null && row?.quotation !== undefined &&
            Number.isFinite(Number(row.quotation)) && Number(row.quotation) > 0)
          .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))
          .slice(0, 200);
        if (!rows.length) { slot.error = 'Nessuna quotazione disponibile.'; slot.loading = false; return; }
        slot.price = Number(rows[0].quotation);
        slot.average = rows.reduce((sum: number, row: any) => sum + Number(row.quotation), 0) / rows.length;
        slot.loading = false;
      },
      error: () => { if (requestId === slot.requestId) { slot.loading = false; slot.error = 'Impossibile leggere le quotazioni.'; } }
    });
  }
  formatPrice(value: number | null): string {
    return value === null ? '—' : new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  ngOnDestroy(): void {
    this.portfolioRequest?.unsubscribe();
    this.slots.forEach(slot => slot.subscription?.unsubscribe());
  }
}
