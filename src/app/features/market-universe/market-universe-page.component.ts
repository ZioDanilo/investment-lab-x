import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { MarketAsset } from '../../core/models/market-universe.model';

type SortField = 'name' | 'ticker' | 'assetClass' | 'ter' | 'expectedReturn' | 'volatility' | 'maxDrawdown';
type SortDirection = 'asc' | 'desc';
type AssetStatus = 'COMPLETE' | 'INCOMPLETE' | 'LEGACY';

@Component({
  selector: 'app-market-universe-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './market-universe-page.component.html',
  styleUrls: ['./market-universe-page.component.css']
})
export class MarketUniversePageComponent {
  private readonly http = inject(HttpClient);
  readonly yahooLoading = signal(false);

  callYahooFinance(): void {
    if (this.yahooLoading()) return;
    this.yahooLoading.set(true);
    // Explicit diagnostic ticker: the assets on this branch are mock data.
    this.http.get(`${environment.apiUrl}/yahoo-finance/diagnostic`, { params: { symbol: 'IWDA.AS' } }).subscribe({
      next: response => { console.info('[Yahoo Finance diagnostic]', response); this.yahooLoading.set(false); },
      error: error => { console.error('[Yahoo Finance diagnostic]', error); this.yahooLoading.set(false); }
    });
  }

  readonly loading = signal(false);
  readonly error = signal('');
  // Dati dimostrativi locali: nessuna richiesta al backend o al database.
  private readonly demoAssets: MarketAsset[] = [
    { id: 'demo-1', isin: 'DEMO0000001', ticker: 'WRLD', name: 'ETF Azionario Globale Demo', nickname: 'World Demo', description: 'Strumento dimostrativo', assetClass: 'Equity', subAssetClass: 'Global', category: 'Azionario globale', geography: 'Globale', currency: 'EUR', instrumentType: 'ETF', provider: 'Demo Asset Management', ter: 0.002, distributing: false, hedged: false, expectedReturn: 0.073, volatility: 0.155, maxDrawdown: -0.34, returnRangeMin: -0.28, returnRangeMax: 0.32, source: 'backend', general: { expectedReturn: 0.073, volatility: 0.155, maxDrawdown: -0.34, returnRange: { min: -0.28, max: 0.32 } }, expansion: { expectedReturn: 0.12, volatility: 0.13, maxDrawdown: -0.2, returnRange: { min: -0.12, max: 0.35 } }, soft_landing: { expectedReturn: 0.075, volatility: 0.12, maxDrawdown: -0.18, returnRange: { min: -0.15, max: 0.25 } }, recession: { expectedReturn: -0.15, volatility: 0.24, maxDrawdown: -0.42, returnRange: { min: -0.4, max: 0.18 } }, stagflation: { expectedReturn: -0.055, volatility: 0.2, maxDrawdown: -0.32, returnRange: { min: -0.3, max: 0.2 } } },
    { id: 'demo-2', isin: 'DEMO0000002', ticker: 'BOND', name: 'ETF Obbligazionario Euro Demo', nickname: 'Bond Demo', description: 'Strumento dimostrativo', assetClass: 'Bond', subAssetClass: 'Government', category: 'Titoli di Stato', geography: 'Europa', currency: 'EUR', instrumentType: 'ETF', provider: 'Demo Asset Management', ter: 0.0015, distributing: false, hedged: false, expectedReturn: 0.032, volatility: 0.065, maxDrawdown: -0.15, returnRangeMin: -0.11, returnRangeMax: 0.14, source: 'backend', general: { expectedReturn: 0.032, volatility: 0.065, maxDrawdown: -0.15, returnRange: { min: -0.11, max: 0.14 } }, expansion: { expectedReturn: 0.025, volatility: 0.055, maxDrawdown: -0.1, returnRange: { min: -0.08, max: 0.11 } }, soft_landing: { expectedReturn: 0.05, volatility: 0.05, maxDrawdown: -0.08, returnRange: { min: -0.04, max: 0.14 } }, recession: { expectedReturn: 0.07, volatility: 0.09, maxDrawdown: -0.13, returnRange: { min: -0.1, max: 0.2 } }, stagflation: { expectedReturn: -0.06, volatility: 0.11, maxDrawdown: -0.2, returnRange: { min: -0.19, max: 0.1 } } },
    { id: 'demo-3', isin: 'DEMO0000003', ticker: 'GOLD', name: 'ETF Oro Demo', nickname: 'Gold Demo', description: 'Strumento dimostrativo', assetClass: 'Commodity', subAssetClass: 'Gold', category: 'Oro', geography: 'Globale', currency: 'EUR', instrumentType: 'ETC', provider: 'Demo Asset Management', ter: 0.0025, distributing: false, hedged: false, expectedReturn: 0.048, volatility: 0.17, maxDrawdown: -0.29, returnRangeMin: -0.25, returnRangeMax: 0.3, source: 'backend', general: { expectedReturn: 0.048, volatility: 0.17, maxDrawdown: -0.29, returnRange: { min: -0.25, max: 0.3 } }, expansion: { expectedReturn: 0.025, volatility: 0.14, maxDrawdown: -0.2, returnRange: { min: -0.2, max: 0.22 } }, soft_landing: { expectedReturn: 0.04, volatility: 0.13, maxDrawdown: -0.18, returnRange: { min: -0.16, max: 0.24 } }, recession: { expectedReturn: 0.09, volatility: 0.22, maxDrawdown: -0.3, returnRange: { min: -0.28, max: 0.4 } }, stagflation: { expectedReturn: 0.12, volatility: 0.23, maxDrawdown: -0.32, returnRange: { min: -0.27, max: 0.45 } } }
  ];
  readonly assets = signal<MarketAsset[]>(this.demoAssets);
  readonly selectedAsset = signal<MarketAsset | null>(null);
  readonly searchTerm = signal('');
  readonly sortField = signal<SortField>('name');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly assetClassFilter = signal('');
  readonly categoryFilter = signal('');
  readonly currencyFilter = signal('');
  readonly providerFilter = signal('');

  readonly scenarioLabels: Record<string, string> = {
    general: 'General',
    expansion: 'Expansion',
    soft_landing: 'Soft Landing',
    recession: 'Recession',
    stagflation: 'Stagflation'
  };

  readonly scenarioOrder = ['general', 'expansion', 'soft_landing', 'recession', 'stagflation'];

  readonly uniqueAssetClasses = computed(() => [...new Set(this.assets().map((asset) => asset.assetClass).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right)));
  readonly uniqueCategories = computed(() => [...new Set(this.assets().map((asset) => asset.category).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right)));
  readonly uniqueCurrencies = computed(() => [...new Set(this.assets().map((asset) => asset.currency).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right)));
  readonly uniqueProviders = computed(() => [...new Set(this.assets().map((asset) => asset.provider).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right)));

  readonly summary = computed(() => {
    const all = this.assets();
    const total = all.length;
    const assetClasses = new Set(all.map((asset) => asset.assetClass).filter(Boolean)).size;
    const averageTer = total
      ? all.filter((asset) => asset.ter != null).reduce((sum, asset) => sum + Number(asset.ter ?? 0), 0) / all.filter((asset) => asset.ter != null).length
      : 0;
    const completeStats = all.filter((asset) => this.getStatus(asset) === 'COMPLETE').length;

    return {
      total,
      assetClasses,
      averageTer,
      completeStats
    };
  });

  readonly filteredAssets = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const assetClass = this.assetClassFilter().trim();
    const category = this.categoryFilter().trim();
    const currency = this.currencyFilter().trim();
    const provider = this.providerFilter().trim();

    let current = [...this.assets()];

    if (query) {
      current = current.filter((asset) => {
        const haystack = [
          asset.name,
          asset.nickname,
          asset.isin,
          asset.ticker,
          asset.assetClass,
          asset.category,
          asset.currency,
          asset.provider,
          asset.description
        ]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      });
    }

    if (assetClass) {
      current = current.filter((asset) => asset.assetClass === assetClass);
    }

    if (category) {
      current = current.filter((asset) => asset.category === category);
    }

    if (currency) {
      current = current.filter((asset) => asset.currency === currency);
    }

    if (provider) {
      current = current.filter((asset) => asset.provider === provider);
    }

    return current.sort((left, right) => {
      const field = this.sortField();
      const direction = this.sortDirection() === 'asc' ? 1 : -1;
      const leftValue = this.getComparableValue(left, field);
      const rightValue = this.getComparableValue(right, field);

      if (leftValue === rightValue) {
        return left.name.localeCompare(right.name) * direction;
      }

      if (leftValue == null) {
        return 1 * direction;
      }
      if (rightValue == null) {
        return -1 * direction;
      }

      return (Number(leftValue) - Number(rightValue)) * direction;
    });
  });

  readonly legacyFallbackActive = computed(() => this.assets().some((asset) => asset.source === 'legacy-fallback' || asset.legacyFallback === true));

  // Selezione iniziale locale.
  constructor() {
    this.selectedAsset.set(this.demoAssets[0]);
  }

  selectAsset(asset: MarketAsset): void {
    this.selectedAsset.set(asset);
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.assetClassFilter.set('');
    this.categoryFilter.set('');
    this.currencyFilter.set('');
    this.providerFilter.set('');
    this.sortField.set('name');
    this.sortDirection.set('asc');
  }

  setSortField(field: SortField): void {
    if (this.sortField() === field) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }

    this.sortField.set(field);
    this.sortDirection.set('asc');
  }

  private getComparableValue(asset: MarketAsset, field: SortField): number | null {
    switch (field) {
      case 'name':
        return asset.name ? asset.name.length : null;
      case 'ticker':
        return asset.ticker ? asset.ticker.length : null;
      case 'assetClass':
        return asset.assetClass ? asset.assetClass.length : null;
      case 'ter':
        return asset.ter ?? null;
      case 'expectedReturn':
        return asset.expectedReturn ?? null;
      case 'volatility':
        return asset.volatility ?? null;
      case 'maxDrawdown':
        return asset.maxDrawdown ?? null;
      default:
        return null;
    }
  }

  getStatus(asset: MarketAsset): AssetStatus {
    if (asset.source === 'legacy-fallback' || asset.legacyFallback === true) {
      return 'LEGACY';
    }

    const hasRequiredFields = !!asset.isin && !!asset.name && !!asset.assetClass && asset.expectedReturn != null && asset.volatility != null && asset.maxDrawdown != null;
    const hasMacroCoverage = !!(asset.general || asset.expansion || asset.soft_landing || asset.recession || asset.stagflation);

    return hasRequiredFields && hasMacroCoverage ? 'COMPLETE' : 'INCOMPLETE';
  }

  formatPercent(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) {
      return '—';
    }

    const percent = value * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
  }

  formatSignedPercent(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) {
      return '—';
    }

    const percent = value * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
  }

  formatTer(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) {
      return '—';
    }

    const percent = value * 100;
    return `${percent.toFixed(2)}%`;
  }

  formatRate(value: number | null | undefined, digits = 1): string {
    if (value == null || !Number.isFinite(value)) {
      return '—';
    }

    const percent = value * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(digits)}%`;
  }

  formatValue(value: unknown): string {
    if (value === null || value === undefined || value === '' || Number.isNaN(value as number)) {
      return '—';
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toString() : '—';
    }

    return String(value);
  }

  scenarioStats(asset: MarketAsset | null, key: string): any {
    if (!asset) {
      return null;
    }

    return asset[key as keyof MarketAsset] ?? null;
  }
}
