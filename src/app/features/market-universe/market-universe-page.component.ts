import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';
import { MarketAsset } from '../../core/models/market-universe.model';

type SortField = 'name' | 'ticker' | 'assetClass' | 'ter' | 'expectedReturn' | 'volatility' | 'maxDrawdown';
type SortDirection = 'asc' | 'desc';
type AssetStatus = 'COMPLETE' | 'INCOMPLETE' | 'LEGACY';

interface CorrelationRow {
  targetIsin: string;
  targetName: string;
  expansion: number | null;
  softLanding: number | null;
  recession: number | null;
  stagflation: number | null;
}

@Component({
  selector: 'app-market-universe-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './market-universe-page.component.html',
  styleUrls: ['./market-universe-page.component.css']
})
export class MarketUniversePageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly assets = signal<MarketAsset[]>([]);
  readonly selectedAsset = signal<MarketAsset | null>(null);
  readonly searchTerm = signal('');
  readonly sortField = signal<SortField>('name');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly assetClassFilter = signal('');
  readonly categoryFilter = signal('');
  readonly currencyFilter = signal('');
  readonly providerFilter = signal('');
  readonly correlationRows = signal<CorrelationRow[]>([]);
  readonly correlationsLoading = signal(false);
  readonly correlationError = signal('');

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

  ngOnInit(): void {
    this.loadAssets();
  }

  private loadAssets(): void {
    this.loading.set(true);
    this.error.set('');
    this.correlationError.set('');
    this.correlationRows.set([]);

    this.api.getMarketUniverseAssets().subscribe({
      next: (response: any) => {
        const assets = Array.isArray(response?.data) ? response.data : [];
        this.assets.set(assets);

        if (assets.length > 0) {
          const currentSelection = this.selectedAsset();
          const nextSelection = assets.find((asset: MarketAsset) => asset.isin === currentSelection?.isin) ?? assets[0];
          this.selectedAsset.set(nextSelection);
          this.loadCorrelations(nextSelection.isin);
        } else {
          this.selectedAsset.set(null);
          this.correlationRows.set([]);
        }

        this.loading.set(false);
      },
      error: (err) => {
        console.error('Market Universe load failed', err);
        this.error.set(err?.error?.error || 'Errore nel caricamento del Market Universe');
        this.assets.set([]);
        this.selectedAsset.set(null);
        this.correlationRows.set([]);
        this.loading.set(false);
      }
    });
  }

  selectAsset(asset: MarketAsset): void {
    this.selectedAsset.set(asset);
    this.loadCorrelations(asset.isin);
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

  private loadCorrelations(isin: string): void {
    if (!isin) {
      this.correlationRows.set([]);
      this.correlationError.set('');
      return;
    }

    this.correlationsLoading.set(true);
    this.correlationError.set('');

    this.api.getCorrelations(isin).subscribe({
      next: (response: any) => {
        const rows = Array.isArray(response?.data) ? response.data : [];
        const map = new Map<string, { isin: string; name: string; expansion: number | null; soft_landing: number | null; recession: number | null; stagflation: number | null }>();

        for (const row of rows) {
          const counterpart = String(row.isin1 ?? '').trim().toUpperCase() === String(isin ?? '').trim().toUpperCase()
            ? String(row.isin2 ?? '').trim().toUpperCase()
            : String(row.isin1 ?? '').trim().toUpperCase();

          const targetAsset = this.assets().find((asset) => String(asset.isin).trim().toUpperCase() === counterpart);

          if (!counterpart || !targetAsset) {
            continue;
          }

          map.set(counterpart, {
            isin: counterpart,
            name: targetAsset.name,
            expansion: this.toNumber(row.expansion),
            soft_landing: this.toNumber(row.soft_landing),
            recession: this.toNumber(row.recession),
            stagflation: this.toNumber(row.stagflation)
          });
        }

        this.correlationRows.set(Array.from(map.values()).map((entry) => ({
          targetIsin: entry.isin,
          targetName: entry.name,
          expansion: entry.expansion,
          softLanding: entry.soft_landing,
          recession: entry.recession,
          stagflation: entry.stagflation
        })));
        this.correlationsLoading.set(false);
      },
      error: () => {
        this.correlationError.set('Correlazioni non disponibili per questo asset.');
        this.correlationRows.set([]);
        this.correlationsLoading.set(false);
      }
    });
  }

  private toNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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
