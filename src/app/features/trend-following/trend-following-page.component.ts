import { Component, effect, inject, OnDestroy, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/api/api.service';
import { QuotationService } from '../../core/services/quotation.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { Subscription } from 'rxjs';
import { TrendStrategyService } from '../../core/services/trend-strategy.service';

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
      <p *ngIf="saveError" class="error" role="alert">{{ saveError }}</p>
      <p *ngIf="portfolioMessage" class="portfolio-hint" role="status">{{ portfolioMessage }}</p>
      <div *ngIf="trendStrategy.selectedStrategy() === 1" class="strategy-row">
        <article *ngFor="let slot of slots; let i = index" class="strategy-card" [class.trend-positive]="slot.price !== null && slot.average !== null && slot.price > slot.average && !slot.loading" [class.trend-negative]="slot.price !== null && slot.average !== null && slot.price < slot.average && !slot.loading">
          <label [for]="'trend-etf-' + i">ETF del portafoglio</label>
          <select [id]="'trend-etf-' + i" [value]="slot.isin"
            (change)="selectEtf(i, $any($event.target).value)"
            [disabled]="loadingPortfolio || !etfs.length">
            <option value="">Seleziona ETF</option>
            <option *ngFor="let etf of availableEtfs(i)" [value]="etf.isin">{{ etf.label }}</option>
          </select>
          <p *ngIf="loadingPortfolio || slot.loading">Caricamento...</p>
          <p *ngIf="slot.error" class="error">{{ slot.error }}</p>
          <div class="results">
            <div class="result"><span>Prezzo</span><strong>{{ slot.price !== null && !slot.loading ? formatPrice(slot.price) + " €" : "—" }}</strong></div>
            <div class="result"><span>Media mobile 200 giorni</span><strong>{{ slot.average !== null && !slot.loading ? formatPrice(slot.average) + " €" : "—" }}</strong></div>
            <div class="price-delta" [class.positive]="slot.price !== null && slot.average !== null && !slot.loading && slot.price > slot.average" [class.negative]="slot.price !== null && slot.average !== null && !slot.loading && slot.price < slot.average"><span *ngIf="slot.price !== null && slot.average !== null && !slot.loading; else emptyDelta">{{ formatSigned(slot.price - slot.average) }} € ({{ formatSignedPercentage(slot.price, slot.average) }})</span><ng-template #emptyDelta>—</ng-template></div>
          </div>
        </article>
        <p *ngIf="!portfolioSelection.selectedPortfolio()" class="portfolio-hint">Seleziona un portafoglio dalla barra superiore.</p>
      </div>
      <article *ngIf="trendStrategy.selectedStrategy() !== null" class="trend-suggestions-panel">
        <h3><span class="material-symbols-rounded trend-suggestions-icon">emoji_objects</span>Suggerimenti</h3>
        <p>Nessun suggerimento disponibile.</p>
      </article>
    </section>
  `,
  styles: [`
    .trend-suggestions-panel { margin-top:16px; width:100%; box-sizing:border-box; padding:12px 18px; border:1px solid rgba(77,132,187,.42); border-radius:14px; background:radial-gradient(circle at 5% 50%,rgba(255,190,55,.055),transparent 24%),linear-gradient(145deg,rgba(15,31,52,.78),rgba(7,18,31,.98)); }
    .trend-suggestions-panel h3 { display:flex; align-items:center; gap:9px; margin:0 0 6px; font-size:16px; }
    .trend-suggestions-icon { color:#ffe34f; font-size:34px; font-variation-settings:'FILL' 1,'wght' 700,'GRAD' 100,'opsz' 24; }
    .trend-suggestions-panel p { margin:0; color:#a9bad2; font-size:13px; }
    .strategy-row { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin-top:24px; align-items:stretch; }
    .strategy-card { display:flex; flex-direction:column; align-items:stretch; gap:14px; padding:24px 18px; text-align:center; min-width:0; border:1px solid rgba(125,150,190,.45); border-radius:14px; background:rgba(35,55,90,.30); }
    .strategy-card.trend-positive { border-color:#69d8a5; box-shadow:0 0 0 1px rgba(105,216,165,.25); }
    .strategy-card.trend-negative { border-color:#ff858c; box-shadow:0 0 0 1px rgba(255,133,140,.25); }
    .strategy-card label { font-weight:600; }
    .strategy-card select { width:100%; min-width:0; padding:10px 12px; border-radius:8px; background:#203554; color:white; border:1px solid #6085b5; }
    .results { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; width:100%; }
    .result { display:flex; flex-direction:column; justify-content:center; gap:8px; padding:16px 8px; min-width:0; border:1px solid rgba(125,150,190,.35); border-radius:12px; background:rgba(35,55,90,.45); }
    .result strong { font-size:clamp(15px,1.5vw,23px); overflow-wrap:anywhere; }
    .result span { font-size:12px; }
    .price-delta { grid-column:1/-1; display:flex; align-items:center; justify-content:center; min-height:49px; box-sizing:border-box; font-size:16px; font-weight:700; padding:10px 8px; border:1px solid rgba(125,150,190,.35); border-radius:12px; background:rgba(35,55,90,.45); color:#a9bad2; }
    .price-delta.positive { color:#69d8a5; }
    .price-delta.negative { color:#ff858c; }
    .error { color:#ff9292; }
    .portfolio-hint { grid-column:1/-1; text-align:center; }
    @media(max-width:1100px) { .strategy-row { grid-template-columns:1fr; } .result strong { font-size:23px; } }

  `]
})
export class TrendFollowingPageComponent implements OnDestroy {
  readonly portfolioSelection = inject(PortfolioSelectionService);
  private readonly api = inject(ApiService);
  private readonly quotations = inject(QuotationService);
  private portfolioRequest?: Subscription;
  private settingsRequest?: Subscription;
  private settingsReady = false;
  private saving = false;
  private saveQueued = false;
  saveError = '';
  loadingSettings = false;
  private readonly strategyKeys = [
    'buy-hold-momentum', 'sma-200', 'ts-momentum-12m', 'dual-sma-50-200',
    'momentum-world-xeon', 'momentum-xeon-fast-reentry', 'trend-vol-target',
    'momentum-world-xeon-vol-target'
  ];
  private currentPortfolioId: string | null = null;
  private currentRefreshVersion = -1;
  private pendingStrategy: number | null = null;
  readonly trendStrategy = inject(TrendStrategyService);
  etfs: TrendEtf[] = [];
  loadingPortfolio = false;
  portfolioMessage = '';
  readonly slots: TrendSlot[] = Array.from({ length: 3 }, () => ({
    isin: '', price: null, average: null, loading: false, error: '', requestId: 0
  }));

  constructor() {
    effect(() => {
      const strategy = this.trendStrategy.selectedStrategy();
      if (this.settingsReady && strategy !== null) this.queueSave();
    });
    effect(() => {
      const selected = this.portfolioSelection.selectedPortfolio();
      const refreshVersion = this.portfolioSelection.refreshVersion();
      if (selected?.id !== this.currentPortfolioId || refreshVersion !== this.currentRefreshVersion) {
        this.pendingStrategy = this.currentPortfolioId === null ? untracked(() => this.trendStrategy.selectedStrategy()) : null;
        this.currentPortfolioId = selected?.id ?? null;
        this.currentRefreshVersion = refreshVersion;
        untracked(() => this.loadPortfolio());
      }
    });
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
    this.settingsRequest?.unsubscribe();
    this.settingsReady = false;
    this.saveQueued = false;
    this.loadingSettings = false;
    this.saveError = '';
    this.portfolioMessage = '';
    this.trendStrategy.selectedStrategy.set(null);
    this.slots.forEach(slot => this.clearSlot(slot));
    this.etfs = [];
    const selected = this.portfolioSelection.selectedPortfolio();
    if (!selected) { this.loadingPortfolio = false; this.portfolioMessage = 'Seleziona un portafoglio dalla navbar.'; return; }
    if (selected.tipo !== 'reale') { this.loadingPortfolio = false; this.portfolioMessage = 'Il portafoglio selezionato è di laboratorio: gli ETF del Trend Following sono attualmente disponibili solo per portafogli reali.'; return; }
    this.loadingPortfolio = true;
    this.portfolioRequest = this.api.getRealPortfolioHoldings(selected.id).subscribe({
      next: (response: any) => {
        if (this.portfolioSelection.selectedPortfolio()?.id !== selected.id) return;
        this.setEtfs(Array.isArray(response?.data) ? response.data : []);
      },
      error: () => { this.loadingPortfolio = false; this.portfolioMessage = 'Errore nel caricamento degli ETF del portafoglio. Controlla la richiesta GET /api/real-portfolios/:id/holdings.'; }
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
    this.portfolioMessage = this.etfs.length ? '' : 'Questo portafoglio non contiene ETF acquistati. Aggiungi ETF da I miei portafogli per poterli selezionare qui.';
    this.loadSavedSettings();
  }
  selectEtf(slotIndex: number, isin: string): void {
    const slot = this.slots[slotIndex];
    if (!slot || (isin && this.slots.some((other, i) => i !== slotIndex && other.isin === isin))) return;
    this.clearSlot(slot);
    slot.isin = isin;
    if (this.settingsReady) this.queueSave();
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
  private loadSavedSettings(): void {
    const portfolioId = this.currentPortfolioId;
    if (!portfolioId) return;
    this.loadingSettings = true;
    this.settingsRequest = this.api.getTrendFollowingSettings(portfolioId).subscribe({
      next: (response: any) => {
        if (portfolioId !== this.currentPortfolioId) return;
        const data = response?.data;
        const index = this.strategyKeys.indexOf(data?.strategyKey);
        const saved = Array.isArray(data?.settings?.etfIsins) ? data.settings.etfIsins : [];
        const allowed = new Set(this.etfs.map(etf => etf.isin.toUpperCase()));
        const seen = new Set<string>();
        for (let i = 0; i < this.slots.length; i++) {
          const isin = typeof saved[i] === 'string' ? saved[i].toUpperCase() : '';
          if (isin && allowed.has(isin) && !seen.has(isin)) {
            seen.add(isin);
            this.selectEtf(i, isin);
          }
        }
        this.trendStrategy.selectedStrategy.set(index >= 0 ? index : this.pendingStrategy);
        this.pendingStrategy = null;
        this.loadingSettings = false;
        this.settingsReady = true;
        if (!data && this.trendStrategy.selectedStrategy() !== null) this.queueSave();
      },
      error: () => {
        if (portfolioId !== this.currentPortfolioId) return;
        this.loadingSettings = false;
        this.settingsReady = true;
        this.trendStrategy.selectedStrategy.set(this.pendingStrategy);
        this.pendingStrategy = null;
        this.saveError = 'Impossibile recuperare la configurazione salvata; puoi selezionare gli ETF, ma verifica il collegamento al server.';
      }
    });
  }

  private queueSave(): void {
    if (!this.settingsReady || !this.currentPortfolioId || this.trendStrategy.selectedStrategy() === null) return;
    this.saveQueued = true;
    if (!this.saving) this.flushSave();
  }

  private flushSave(): void {
    if (!this.saveQueued) { this.saving = false; return; }
    const portfolioId = this.currentPortfolioId;
    const strategyIndex = this.trendStrategy.selectedStrategy();
    if (!portfolioId || strategyIndex === null || !this.settingsReady) {
      this.saveQueued = false;
      this.saving = false;
      return;
    }
    this.saving = true;
    this.saveQueued = false;
    const etfIsins = this.slots.map(slot => slot.isin);
    this.api.saveTrendFollowingSettings(portfolioId, this.strategyKeys[strategyIndex], etfIsins).subscribe({
      next: () => {
        if (portfolioId === this.currentPortfolioId) this.saveError = '';
        this.flushSave();
      },
      error: () => {
        if (portfolioId === this.currentPortfolioId) this.saveError = 'Salvataggio non riuscito. Riprova modificando la selezione.';
        this.flushSave();
      }
    });
  }

  formatPrice(value: number | null): string {
    return value === null ? '—' : new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  formatSigned(value: number): string {
    return (value > 0 ? '+' : value < 0 ? '-' : '') + this.formatPrice(Math.abs(value));
  }
  formatSignedPercentage(price: number, average: number): string {
    return average > 0 ? this.formatSigned((price - average) / average * 100) + '%' : '—';
  }
  ngOnDestroy(): void {
    this.portfolioRequest?.unsubscribe();
    this.settingsRequest?.unsubscribe();
    this.slots.forEach(slot => slot.subscription?.unsubscribe());
  }
}
