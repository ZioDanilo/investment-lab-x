import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ApiService } from '../../core/api/api.service';
import { AssetDonutComponent, AssetDonutItem } from '../../shared/components/asset-donut/asset-donut.component';
import { Router, RouterLink } from '@angular/router';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';
import { QuotationService } from '../../core/services/quotation.service';
import { firstValueFrom, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

interface HomeSimulation { id: string; name: string; status: 'loading' | 'ready' | 'error'; error?: string; cagr: number | null; drawdown: number | null; volatility: number | null; }

interface TrendAlert { portfolioId: string; portfolio: string; strategy: string; signal: 'Acquisto' | 'Vendita'; etf: string; }

interface NavItem {
  label: string;
  icon: string;
  active?: boolean;
}

interface ShortcutCard {
  title: string;
  description: string;
  accent: string;
  icon: string;
}

interface PortfolioRow {
  name: string;
  modified: string;
  etfCount: number;
  expectedReturn: string;
  volatility: string;
  positive: boolean;
}

interface SummaryMetric {
  value: string;
  label: string;
  icon: string;
  tone: string;
}


interface ScenarioCard {
  name: string;
  returnValue: string;
  drawdown: string;
  tone: string;
  returnClass: string;
  drawdownClass: string;
}

interface ActivityItem {
  label: string;
  detail: string;
  date: string;
  icon: string;
}

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [CommonModule, RouterLink, AssetDonutComponent],
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.css']
})
export class HomePageComponent implements OnInit, OnDestroy {
  constructor(private readonly api: ApiService, private readonly quotations: QuotationService, private readonly portfolioSelection: PortfolioSelectionService, private readonly router: Router) {}
  simulations: HomeSimulation[] = [];
  simulationsLoading = false;
  simulationsError = false;
  private destroyed = false;
  trendAlerts: TrendAlert[] = [];
  alertsLoading = false;
  alertsError = false;
  assetMix: AssetDonutItem[] = [];
  totalEtfs = 0;
  assetLoading = true;
  assetError = false;
  private readonly assetColors = ['#2D91FF','#31D48D','#FF526C','#FF9F43','#9B67ED','#21C7C7','#F9BE48','#E96BA8','#64A7FF','#86D957'];
  get isTutorial(): boolean { return localStorage.getItem('investmentLabRole') === 'TUTORIAL'; }
  ngOnInit(): void { if (!this.isTutorial) { this.loadAssetMix(); this.loadPortfolioSummary(); this.loadTrendAlerts(); this.loadHomeSimulations(); } else this.assetLoading = false; }
  private loadAssetMix(): void {
    this.assetLoading = true;
    this.assetError = false;
    this.api.getETFs().subscribe({
      next: (response: any) => {
        const etfs: any[] = Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : Array.isArray(response?.etfs) ? response.etfs : [];
        this.totalEtfs = etfs.length;
        const counts = new Map<string, number>();
        for (const etf of etfs) {
          const assetClass = String(etf.assetClass ?? etf.asset_class ?? '').trim() || 'Non classificato';
          counts.set(assetClass, (counts.get(assetClass) ?? 0) + 1);
        }
        this.assetMix = [...counts.entries()].map(([label, value], index) => ({
          label, value, weight: this.totalEtfs ? value / this.totalEtfs * 100 : 0,
          color: this.assetColors[index % this.assetColors.length]
        }));
        this.assetLoading = false;
      },
      error: () => { this.assetLoading = false; this.assetError = true; this.assetMix = []; this.totalEtfs = 0; }
    });
  }

  get loggedUsername(): string { return localStorage.getItem('investmentLabUsername')?.trim() || ''; }


  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home', active: true },
    { label: 'Laboratorio Portafogli', icon: 'science' },
    { label: 'Portafogli', icon: 'folder' },
    { label: 'Monte Carlo', icon: 'query_stats' },
    { label: 'Ribilanciamento', icon: 'sync' },
    { label: 'Trend Following', icon: 'show_chart' },
    { label: 'ETF & Mercati', icon: 'bar_chart' }
  ];

  readonly shortcuts: ShortcutCard[] = [
    { title: 'Laboratorio Portafogli', description: 'Costruisci e analizza nuovi portafogli con dati ADB.', accent: 'blue', icon: 'science' },
    { title: 'I miei Portafogli', description: 'Gestisci, confronta e modifica i portafogli salvati.', accent: 'purple', icon: 'folder' },
    { title: 'Monte Carlo', description: 'Simulazioni avanzate sui portafogli selezionati.', accent: 'green', icon: 'trending_up' },
    { title: 'Ribilanciamento', description: 'Calcola e pianifica le operazioni di ribilanciamento.', accent: 'amber', icon: 'sync' },
    { title: 'Trend Following', description: 'Esplora e analizza strategie di trend following sugli ETF.', accent: 'blue', icon: 'show_chart' },
    { title: 'ETF & Mercati', description: 'Gestisci il database ETF e consulta le quotazioni interne.', accent: 'cyan', icon: 'bar_chart' }
  ];

  readonly portfolios: PortfolioRow[] = [
    { name: 'All Weather v6', modified: '12/12/2024', etfCount: 8, expectedReturn: '7,8%', volatility: '10,2%', positive: true },
    { name: 'Global Growth', modified: '10/12/2024', etfCount: 6, expectedReturn: '9,1%', volatility: '14,3%', positive: true },
    { name: 'Conservative Income', modified: '08/12/2024', etfCount: 7, expectedReturn: '5,2%', volatility: '6,8%', positive: true },
    { name: 'Europa Focus', modified: '05/12/2024', etfCount: 5, expectedReturn: '6,4%', volatility: '11,1%', positive: true },
    { name: 'Innovazione 2030', modified: '02/12/2024', etfCount: 9, expectedReturn: '10,8%', volatility: '16,5%', positive: true }
  ];

  summaryMetrics: SummaryMetric[] = [
    { value: '—', label: 'Portafogli salvati', icon: 'folder', tone: 'blue' },
    { value: '—', label: 'Rendimento medio', icon: 'show_chart', tone: 'cyan' },
    { value: '—', label: 'Volatilità media', icon: 'signal_cellular_alt', tone: 'purple' },
    { value: '—', label: 'Drawdown medio', icon: 'trending_down', tone: 'red' }
  ];


  private readonly trendLabels: Record<string, string> = {
    'sma-200': 'Media mobile 200 giorni',
    'dual-sma-50-200': 'Doppia media mobile 50/200',
    'ts-momentum-12m': 'Time Series 12 mesi',
    'momentum-world-xeon': 'Media mobile rapporto 100 giorni',
    'momentum-xeon-fast-reentry': 'Segno continuo 30 giorni'
  };

  openTrendAlert(alert: TrendAlert): void {
    this.portfolioSelection.setSelectedPortfolio(alert.portfolioId);
    void this.router.navigate(['/trend-following']);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  formatSimulationPercent(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : (value * 100).toFixed(1).replace('.', ',') + '%';
  }

  // Market Universe V2 binary projection (MU64): 1000 simulated paths x 360 months.
  // KPI calculated from the projected monthly portfolio returns, not legacy snapshots.
  private calculateMarketUniverseV2Kpis(buffer: ArrayBuffer): { cagr: number; drawdown: number; volatility: number } {
    const view = new DataView(buffer);
    if (buffer.byteLength < 32 || String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'MU64') {
      throw new Error('Risposta Market Universe V2 non valida');
    }
    const version = view.getUint16(4, true);
    const pathCount = view.getUint32(12, true);
    const monthCount = view.getUint32(16, true);
    const runIdBytes = view.getUint32(8, true);
    if (version !== 1 || !pathCount || !monthCount) throw new Error('Geometria Market Universe V2 non valida');
    const offset = 32 + runIdBytes;
    const required = pathCount * monthCount;
    if (buffer.byteLength < offset + required * 8) throw new Error('Risposta Market Universe V2 incompleta');
    const annualReturns: number[] = [];
    const maxDrawdowns: number[] = [];
    let monthlySum = 0;
    let monthlySumSquares = 0;
    for (let path = 0; path < pathCount; path++) {
      let capital = 1;
      let peak = 1;
      let worst = 0;
      for (let month = 0; month < monthCount; month++) {
        const ret = view.getFloat64(offset + (path * monthCount + month) * 8, true);
        if (!Number.isFinite(ret) || ret <= -1) throw new Error('Rendimento mensile V2 non valido');
        monthlySum += ret;
        monthlySumSquares += ret * ret;
        capital *= 1 + ret;
        peak = Math.max(peak, capital);
        worst = Math.min(worst, capital / peak - 1);
      }
      annualReturns.push(Math.pow(capital, 12 / monthCount) - 1);
      maxDrawdowns.push(worst);
    }
    // Robust CAGR: 5%-trimmed mean across Monte Carlo paths.
    annualReturns.sort((a, b) => a - b);
    const trim = Math.floor(pathCount * .05);
    const central = annualReturns.slice(trim, pathCount - trim);
    const cagr = central.reduce((sum, x) => sum + x, 0) / central.length;
    maxDrawdowns.sort((a, b) => a - b);
    const drawdown = maxDrawdowns[Math.floor(pathCount / 2)];
    const n = required;
    const mean = monthlySum / n;
    const volatility = Math.sqrt(Math.max(0, monthlySumSquares / n - mean * mean) * 12);
    return { cagr, drawdown, volatility };
  }

  private async loadHomeSimulations(): Promise<void> {
    this.simulationsLoading = true;
    this.simulationsError = false;
    try {
      const response: any = await firstValueFrom(this.api.getPortfolios());
      if (this.destroyed) return;
      const portfolios: any[] = (Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [])
        .filter((p: any) => p.tipo === 'reale');
      this.simulations = portfolios.map((p: any) => ({
        id: String(p.id), name: String(p.name || p.nome || p.id),
        status: 'loading' as const, cagr: null, drawdown: null, volatility: null
      }));
      // Run sequentially to avoid saturating the browser with concurrent Monte Carlo workers.
      for (const item of this.simulations) {
        if (this.destroyed) return;
        try {
          const holdingsResponse: any = await firstValueFrom(this.api.getRealPortfolioHoldings(item.id));
          if (this.destroyed) return;
          const holdings: any[] = Array.isArray(holdingsResponse?.data) ? holdingsResponse.data : [];
          // Use the same current-market-value weighting as the Monte Carlo portfolio editor.
          const total = holdings.reduce((sum, h) => sum + Math.max(0, Number(h.marketValue) || 0), 0);
          if (total <= 0) throw new Error('Portafoglio senza valore di mercato');
          const positions = holdings
            .map(h => ({ isin: String(h.isin || h.etf?.isin || '').toUpperCase(), weight: Math.max(0, Number(h.marketValue) || 0) / total }))
            .filter(p => p.isin && p.weight > 0);
          if (!positions.length) throw new Error('Composizione non disponibile');
          const binary = await firstValueFrom(this.api.buildBinaryPortfolioProjectionV2({
            holdings: positions.map(p => ({ isin: p.isin, weight: p.weight }))
          }));
          if (this.destroyed) return;
          const stats = this.calculateMarketUniverseV2Kpis(binary);
          item.cagr = stats.cagr;
          item.drawdown = stats.drawdown;
          item.volatility = stats.volatility;
          item.status = 'ready';
          item.error = undefined;
        } catch (error) {
          if (this.destroyed) return;
          console.warn('Monte Carlo Home:', item.name, error);
          item.error = String((error as any)?.error?.error?.message || (error as any)?.error?.message || (error as any)?.message || 'Simulazione non disponibile');
          item.status = 'error';
        }
      }
    } catch (error) {
      if (!this.destroyed) { this.simulationsError = true; console.warn('Monte Carlo Home: elenco portafogli', error); }
    } finally {
      if (!this.destroyed) this.simulationsLoading = false;
    }
  }

  private loadTrendAlerts(): void {
    this.alertsLoading = true;
    this.alertsError = false;
    forkJoin({ portfolios: this.api.getPortfolios(), etfs: this.api.getETFs() }).pipe(
      switchMap(({ portfolios, etfs }: any) => {
        // Trend Following belongs to the real portfolios from /portfolio (navbar), not /real-portfolios.
        const list: any[] = (Array.isArray(portfolios?.data) ? portfolios.data : Array.isArray(portfolios) ? portfolios : []).filter((p: any) => p.tipo === 'reale');
        const catalog: any[] = Array.isArray(etfs?.data) ? etfs.data : Array.isArray(etfs) ? etfs : [];
        const nicknames = new Map(catalog.map((e: any) => [String(e.isin || '').toUpperCase(), String(e.nickname || e.isin)]));
        if (!list.length) return of([] as TrendAlert[]);
        return forkJoin(list.map((portfolio: any) =>
          this.api.getTrendCriteria(portfolio.id).pipe(
            switchMap((response: any) => {
              const settings = response?.data || {};
              const criteria: any[] = Array.isArray(settings.criteria) ? settings.criteria : [];
              const active = criteria.filter(row => row.enabled !== false &&
                !!row.isin && !!this.trendLabels[row.strategyKey]);
              if (!active.length) return of([] as TrendAlert[]);
              const isins = [...new Set(active.flatMap(row => [row.isin, row.benchmarkIsin].filter(Boolean)))];
              return forkJoin(isins.map(isin => this.quotations.getQuotationHistory(isin, active.some(row => row.strategyKey === 'ts-momentum-12m' && (row.isin === isin || row.benchmarkIsin === isin)) ? 5000 : 400).pipe(
                map((history: any) => ({ isin: String(isin).toUpperCase(), rows: history?.data || [] })),
                catchError(() => of({ isin: String(isin).toUpperCase(), rows: [] }))
              ))).pipe(map(histories => {
                const prices = new Map(histories.map(h => [h.isin, this.trendPrices(h.rows)]));
                return active.filter(row => this.isTriggered(row, prices)).map(row => ({
                  portfolioId: String(portfolio.id),
                  portfolio: String(portfolio.name || portfolio.nome || portfolio.id),
                  strategy: this.trendLabels[row.strategyKey],
                  signal: row.signal === 'buy' ? 'Acquisto' as const : 'Vendita' as const,
                  etf: nicknames.get(String(row.isin).toUpperCase()) || String(row.isin)
                }));
              }));
            }),
            catchError((error) => { console.warn('Home Trend Following: errore portafoglio', portfolio.id, error); return of([] as TrendAlert[]); })
          )
        )).pipe(map(groups => groups.flat()));
      })
    ).subscribe({
      next: alerts => { this.trendAlerts = alerts; this.alertsLoading = false; },
      error: () => { this.alertsError = true; this.alertsLoading = false; }
    });
  }

  private trendPrices(raw: any[]): { date: string; price: number }[] {
    const unique = new Map<string, number>();
    for (const row of Array.isArray(raw) ? raw : []) {
      const date = String(row?.date || '').slice(0, 10);
      const price = Number(row?.quotation);
      if (date && Number.isFinite(price) && price > 0 && !unique.has(date)) unique.set(date, price);
    }
    return [...unique].sort((a, b) => b[0].localeCompare(a[0])).map(([date, price]) => ({ date, price }));
  }

  private isTriggered(row: any, histories: Map<string, { date: string; price: number }[]>): boolean {
    const primary = histories.get(String(row.isin).toUpperCase()) || [];
    const buy = row.signal === 'buy';
    const key = row.strategyKey;
    if (key === 'momentum-xeon-fast-reentry') {
      if (primary.length < 31) return false;
      const count = primary.slice(0, 30).filter((entry, i) =>
        buy ? entry.price > primary[i + 1].price : entry.price < primary[i + 1].price).length;
      return buy ? count / 30 > 0.85 : count > 25;
    }
    if (key === 'momentum-world-xeon') {
      const other = histories.get(String(row.benchmarkIsin || '').toUpperCase()) || [];
      const second = new Map(other.map(q => [q.date, q.price]));
      const common = primary.filter(q => second.has(q.date)).slice(0, 100);
      if (common.length < 100) return false;
      const ratios = common.map(q => q.price / second.get(q.date)!);
      const delta = ratios[0] - ratios.reduce((sum, v) => sum + v, 0) / 100;
      return buy ? delta > 0 : delta < 0;
    }
    if (key === 'ts-momentum-12m') {
      if (!primary.length) return false;
      const target = new Date(primary[0].date + 'T12:00:00Z');
      target.setUTCFullYear(target.getUTCFullYear() - 1);
      const past = primary.find(q => q.date <= target.toISOString().slice(0, 10));
      if (!past) return false;
      const currentReturn = (primary[0].price / past.price - 1) * 100;
      let benchmarkReturn = 0;
      if (row.benchmarkIsin) {
        const benchmark = histories.get(String(row.benchmarkIsin).toUpperCase()) || [];
        if (!benchmark.length) return false;
        const benchmarkDate = new Date(benchmark[0].date + 'T12:00:00Z');
        benchmarkDate.setUTCFullYear(benchmarkDate.getUTCFullYear() - 1);
        const benchmarkPast = benchmark.find(q => q.date <= benchmarkDate.toISOString().slice(0, 10));
        if (!benchmarkPast) return false;
        benchmarkReturn = (benchmark[0].price / benchmarkPast.price - 1) * 100;
      }
      return buy ? currentReturn > benchmarkReturn : currentReturn < benchmarkReturn;
    }
    if (primary.length < 200) return false;
    const average = primary.slice(0, 200).reduce((sum, q) => sum + q.price, 0) / 200;
    const current = key === 'dual-sma-50-200'
      ? primary.slice(0, 50).reduce((sum, q) => sum + q.price, 0) / 50
      : primary[0].price;
    const difference = (current / average - 1) * 100;
    const threshold = Number(row.thresholdPercent || 0);
    return buy ? difference > threshold : difference < threshold;
  }

  private loadPortfolioSummary(): void {
    this.api.getRealPortfolios().subscribe({
      next: (response: any) => {
        const portfolios: any[] = Array.isArray(response?.data) ? response.data : [];
        this.summaryMetrics[0].value = String(portfolios.length);
        const results: Array<{ annualReturn: number | null; volatility: number | null; drawdown: number | null }> = [];
        for (const portfolio of portfolios) {
          this.api.getRealPortfolioHistory(portfolio.id).subscribe({
            next: (res: any) => {
              results.push(this.calculateStatistics(Array.isArray(res?.data) ? res.data : []));
              this.updateAverages(results);
            },
            error: () => { results.push({ annualReturn: null, volatility: null, drawdown: null }); this.updateAverages(results); }
          });
        }
      },
      error: () => { this.summaryMetrics[0].value = '—'; }
    });
  }

  private calculateStatistics(history: any[]): { annualReturn: number | null; volatility: number | null; drawdown: number | null } {
    // Match the TWR statistics of the real-portfolios page.
    const rows = history.filter(row => row.valuation !== 'incomplete' && Number.isFinite(row.performancePercent))
      .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const empty = { annualReturn: null, volatility: null, drawdown: null };
    if (rows.length < 2) return empty;
    const index = (row: any) => 1 + Number(row.performancePercent) / 100;
    const start = index(rows[0]), end = index(rows[rows.length - 1]);
    if (!(start > 0 && end > 0)) return empty;
    const days = (Date.parse(rows[rows.length - 1].date + 'T00:00:00Z') - Date.parse(rows[0].date + 'T00:00:00Z')) / 86400000;
    const annualReturn = days >= 30 ? (Math.pow(end / start, 365.25 / days) - 1) * 100 : null;
    const returns: number[] = [];
    let peak = start, drawdown = 0;
    for (let i = 0; i < rows.length; i++) {
      const current = index(rows[i]);
      if (!(current > 0)) continue;
      peak = Math.max(peak, current);
      drawdown = Math.min(drawdown, (current / peak - 1) * 100);
      if (i > 0) {
        const previous = index(rows[i - 1]);
        if (previous > 0 && rows[i].date !== rows[i - 1].date) returns.push(current / previous - 1);
      }
    }
    const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : 0;
    const volatility = returns.length >= 20 ? Math.sqrt(variance) * Math.sqrt(252) * 100 : null;
    return { annualReturn, volatility, drawdown };
  }

  private updateAverages(rows: Array<{ annualReturn: number | null; volatility: number | null; drawdown: number | null }>): void {
    const average = (key: 'annualReturn' | 'volatility' | 'drawdown'): string => {
      const values = rows.map(row => row[key]).filter((value): value is number => value !== null && Number.isFinite(value));
      return values.length ? new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(values.reduce((a, b) => a + b, 0) / values.length) + '%' : '—';
    };
    this.summaryMetrics[1].value = average('annualReturn');
    this.summaryMetrics[2].value = average('volatility');
    this.summaryMetrics[3].value = average('drawdown');
  }

  readonly scenarios: ScenarioCard[] = [
    { name: 'Espansione', returnValue: '+7,2%', drawdown: '-12,4%', tone: 'green', returnClass: 'positive', drawdownClass: 'negative' },
    { name: 'Soft Landing', returnValue: '+4,8%', drawdown: '-10,1%', tone: 'blue', returnClass: 'positive', drawdownClass: 'negative' },
    { name: 'Recessione', returnValue: '-2,1%', drawdown: '-28,6%', tone: 'red', returnClass: 'negative', drawdownClass: 'negative' },
    { name: 'Stagflazione', returnValue: '+1,4%', drawdown: '-22,3%', tone: 'amber', returnClass: 'positive', drawdownClass: 'negative' }
  ];

  readonly activity: ActivityItem[] = [
    { label: 'Portafoglio modificato', detail: 'All Weather v6', date: '12/12/2024, 16:42', icon: 'edit_document' },
    { label: 'Nuovo ETF aggiunto', detail: 'Vanguard LifeStrategy 80', date: '12/12/2024, 11:18', icon: 'add_circle' },
    { label: 'Simulazione completata', detail: 'Global Growth (10.000 iterazioni)', date: '11/12/2024, 18:05', icon: 'check_circle' },
    { label: 'Ribilanciamento calcolato', detail: 'Conservative Income', date: '10/12/2024, 14:23', icon: 'calculate' }
  ];
}
