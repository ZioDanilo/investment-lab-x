import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/api/api.service';
import { Etf } from '../../../core/models/etf.model';
import { EtfMacroStatistics } from '../../../core/models/monte-carlo.model';
import { DialogInputComponent } from '../dialog-input/dialog-input.component';

export interface MontecarloPortfolioItem {
  etfId: string;
  isin: string;
  ticker: string;
  nickname: string;
  fullName: string;
  weight: number;
  description?: string;
  macroStatistics?: EtfMacroStatistics;
  expectedReturn?: number;
  volatility?: number;
  maxDrawdown?: number;
  ter?: number;
  liquidity?: number;
  recession?: number;
  stagflation?: number;
  originalWeight?: number;
  isAddedTemporarily?: boolean;
  displayValue: string;
}

export interface MontecarloPortfolioEditorState {
  selectedPortfolioId: string | null;
  originalItems: MontecarloPortfolioItem[];
  currentItems: MontecarloPortfolioItem[];
  totalWeight: number;
  hasChanges: boolean;
  isValid: boolean;
  isLoading: boolean;
  isSaving: boolean;
}

export interface MontecarloPortfolioEditorChange {
  state: MontecarloPortfolioEditorState;
  effectiveEtfs: Etf[];
}

interface EtfSearchItem {
  id: string;
  isin: string;
  name: string;
  description?: string;
  ticker?: string;
  nickname?: string;
}

@Component({
  selector: 'app-montecarlo-portfolio-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogInputComponent],
  templateUrl: './montecarlo-portfolio-editor.component.html',
  styleUrls: ['./montecarlo-portfolio-editor.component.css']
})
export class MontecarloPortfolioEditorComponent implements OnChanges, OnDestroy {
  private readonly apiService = inject(ApiService);

  @Input() portfolioId: string | null = null;
  @Output() stateChange = new EventEmitter<MontecarloPortfolioEditorChange>();
  @Output() portfolioSaved = new EventEmitter<string>();

  readonly items = signal<MontecarloPortfolioItem[]>([]);
  readonly originalItems = signal<MontecarloPortfolioItem[]>([]);
  readonly currentWeightValues = signal<Record<string, number>>({});
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly selectedPortfolioName = signal('');
  readonly searchQuery = signal('');
  readonly searchResults = signal<EtfSearchItem[]>([]);
  readonly searchLoading = signal(false);
  readonly showSearchResults = signal(false);
  readonly highlightedIndex = signal(0);
  readonly createDialogVisible = signal(false);
  readonly createPortfolioNameDraft = signal('');

  private searchTimer: number | null = null;

  readonly totalWeight = computed(() =>
    this.items().reduce((sum, item) => sum + (Number.isFinite(item.weight) ? item.weight : 0), 0)
  );

  readonly totalWeightInCents = computed(() => Math.round(this.totalWeight() * 100));

  readonly isValid = computed(() => {
    const totalInCents = this.totalWeightInCents();
    const hasPositiveWeight = this.items().some((item) => item.weight > 0);
    const allWeightsValid = this.items().every((item) => this.isWeightWithinRange(item.weight));
    return totalInCents === 10000 && hasPositiveWeight && allWeightsValid;
  });

  readonly hasChanges = computed(() => {
    const current = this.normalizeComposition(this.items());
    const original = this.normalizeComposition(this.originalItems());
    return JSON.stringify(current) !== JSON.stringify(original);
  });

  readonly canRestorePortfolio = computed(() => Boolean(this.portfolioId) && !this.saving());
  readonly canUpdatePortfolio = computed(() =>
    Boolean(this.portfolioId) &&
    !this.saving()
  );
  readonly canCreatePortfolio = computed(() =>
    Boolean(this.portfolioId) &&
    !this.saving()
  );
  readonly canConfirmCreatePortfolio = computed(() => this.createPortfolioNameDraft().trim().length > 0 && !this.saving());

  readonly effectiveEtfs = computed<Etf[]>(() =>
    this.items()
      .filter((item) => item.weight > 0)
      .map((item) => ({
        id: item.etfId,
        name: item.fullName,
        nickname: item.nickname || item.ticker || item.isin,
        isin: item.isin,
        ticker: item.ticker,
        description: item.fullName,
        compartment: 'ETF',
        mission: item.fullName,
        weight: item.weight / 100,
        expectedReturn: item.expectedReturn ?? 0,
        volatility: item.volatility ?? 0,
        maxDrawdown: item.maxDrawdown ?? 0,
        ter: item.ter ?? 0,
        liquidity: item.liquidity ?? 5,
        recession: item.recession ?? 0,
        stagflation: item.stagflation ?? 0,
        macroStatistics: item.macroStatistics
      }))
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['portfolioId']?.currentValue !== undefined) {
      if (this.portfolioId) {
        this.loadPortfolioComposition(this.portfolioId);
      } else {
        this.resetEditor();
      }
    }
  }

  ngOnDestroy(): void {
    if (this.searchTimer) {
      window.clearTimeout(this.searchTimer);
    }
  }

  async restoreFromBackend(): Promise<void> {
    if (!this.portfolioId) {
      return;
    }

    await this.loadPortfolioComposition(this.portfolioId);
  }

  async restorePortfolio(): Promise<void> {
    await this.restoreFromBackend();
  }

  async updatePortfolio(): Promise<void> {
    if (!this.portfolioId || !this.canUpdatePortfolio()) {
      return;
    }

    if (!this.isValid()) {
      window.alert('La composizione deve avere un totale esatto del 100,00% prima di aggiornare il portafoglio.');
      return;
    }

    this.saving.set(true);
    this.emitState();

    const payload = {
      nome: this.selectedPortfolioName() || 'Portafoglio aggiornato',
      descrizione: `Aggiornato il ${new Date().toLocaleString('it-IT')}`,
      etfs: this.buildPortfolioPayloadItems()
    };

    this.apiService.updatePortfolio(this.portfolioId, payload).subscribe({
      next: (response: any) => {
        const newId = response?.data?.id || this.portfolioId;
        this.loadPortfolioComposition(newId);
        this.portfolioSaved.emit(newId);
        this.saving.set(false);
        this.emitState();
      },
      error: () => {
        this.saving.set(false);
        this.emitState();
      }
    });
  }

  openCreatePortfolioDialog(): void {
    if (!this.canCreatePortfolio()) {
      return;
    }

    if (!this.isValid()) {
      window.alert('La composizione deve avere un totale esatto del 100,00% prima di creare un nuovo portafoglio.');
      return;
    }

    this.createPortfolioNameDraft.set(this.selectedPortfolioName() || 'Nuovo portafoglio');
    this.createDialogVisible.set(true);
  }

  closeCreatePortfolioDialog(): void {
    this.createDialogVisible.set(false);
  }

  onCreatePortfolioNameInput(value: string): void {
    this.createPortfolioNameDraft.set(value);
  }

  confirmCreatePortfolio(): void {
    if (!this.canConfirmCreatePortfolio()) {
      return;
    }

    const name = this.createPortfolioNameDraft().trim();
    this.createDialogVisible.set(false);

    this.saving.set(true);
    this.emitState();

    const payload = {
      nome: name.trim(),
      descrizione: `Creato il ${new Date().toLocaleString('it-IT')}`,
      etfs: this.buildPortfolioPayloadItems()
    };

    this.apiService.createPortfolio(payload).subscribe({
      next: (response: any) => {
        const newId = response?.data?.id || response?.id;
        if (newId) {
          this.selectedPortfolioName.set(name.trim());
          this.portfolioSaved.emit(newId);
        }
        this.saving.set(false);
        this.emitState();
      },
      error: () => {
        this.saving.set(false);
        this.emitState();
      }
    });
  }

  getState(): MontecarloPortfolioEditorState {
    return {
      selectedPortfolioId: this.portfolioId,
      originalItems: this.originalItems(),
      currentItems: this.items(),
      totalWeight: this.totalWeight(),
      hasChanges: this.hasChanges(),
      isValid: this.isValid(),
      isLoading: this.loading(),
      isSaving: this.saving()
    };
  }

  async loadPortfolioComposition(portfolioId: string): Promise<void> {
    this.loading.set(true);
    this.emitState();

    this.apiService.getPortfolioById(portfolioId).subscribe({
      next: (response: any) => {
        const holdings = response?.data?.holdings || [];
        const mapped = holdings.map((holding: any) => this.mapHoldingToItem(holding));

        this.items.set(mapped);
        this.originalItems.set(mapped.map((item: MontecarloPortfolioItem) => ({ ...item })));
        this.currentWeightValues.set(Object.fromEntries(mapped.map((item: MontecarloPortfolioItem) => [String(item.etfId), item.weight])));
        this.selectedPortfolioName.set(response?.data?.name || response?.name || response?.data?.nome || response?.nome || '');
        this.searchQuery.set('');
        this.searchResults.set([]);
        this.showSearchResults.set(false);
        this.loading.set(false);
        this.emitState();
      },
      error: () => {
        this.loading.set(false);
        this.emitState();
      }
    });
  }

  onSearchInput(value: string): void {
    const query = value.trim();
    this.searchQuery.set(query);

    if (query.length < 3) {
      this.searchResults.set([]);
      this.showSearchResults.set(false);
      this.highlightedIndex.set(0);
      return;
    }

    if (this.searchTimer) {
      window.clearTimeout(this.searchTimer);
    }

    this.searchTimer = window.setTimeout(() => {
      this.searchLoading.set(true);
      this.apiService.searchETF(query).subscribe({
        next: (response: any) => {
          const addedEtfIds = this.items().map((item) => item.etfId);
          const filtered = (response?.data || []).filter((etf: EtfSearchItem) => !addedEtfIds.includes(etf.id));
          this.searchResults.set(filtered);
          this.showSearchResults.set(filtered.length > 0);
          this.highlightedIndex.set(0);
          this.searchLoading.set(false);
        },
        error: () => {
          this.searchResults.set([]);
          this.showSearchResults.set(false);
          this.searchLoading.set(false);
        }
      });
    }, 300);
  }

  onSearchKeydown(event: KeyboardEvent): void {
    const results = this.searchResults();
    if (results.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedIndex.set((this.highlightedIndex() + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedIndex.set((this.highlightedIndex() - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = results[this.highlightedIndex()];
      if (selected) {
        void this.addEtfFromSearch(selected);
      }
    } else if (event.key === 'Escape') {
      this.showSearchResults.set(false);
      this.searchResults.set([]);
    }
  }

  selectSearchResult(etf: EtfSearchItem): void {
    void this.addEtfFromSearch(etf);
  }

  async addEtfFromSearch(etf: EtfSearchItem): Promise<void> {
    if (this.items().some((item) => item.etfId === etf.id)) {
      return;
    }

    const details = await this.fetchEtfDetails(etf);
    const macroStatistics = details?.macroStatistics ?? details?.macro_statistics;
    const resolvedName = details?.name || etf.name;
    const resolvedNickname = details?.nickname || etf.nickname || details?.ticker || etf.ticker || etf.isin;
    const resolvedTicker = details?.ticker || etf.ticker || '';
    const resolvedDescription = details?.description || etf.description || resolvedName;

    this.items.update((current) => [
      ...current,
      {
        etfId: etf.id,
        isin: etf.isin,
        ticker: resolvedTicker,
        nickname: resolvedNickname,
        fullName: resolvedName,
        description: resolvedDescription,
        macroStatistics,
        expectedReturn: details?.expectedReturn ?? 0,
        volatility: details?.volatility ?? 0,
        maxDrawdown: details?.maxDrawdown ?? 0,
        ter: details?.ter ?? details?.expense ?? 0,
        liquidity: details?.liquidity ?? 5,
        recession: details?.recession ?? 0,
        stagflation: details?.stagflation ?? 0,
        weight: 0,
        originalWeight: 0,
        isAddedTemporarily: true,
        displayValue: '0,00'
      }
    ]);
    this.currentWeightValues.update((current) => ({ ...current, [etf.id]: 0 }));

    this.searchQuery.set('');
    this.searchResults.set([]);
    this.showSearchResults.set(false);
    this.highlightedIndex.set(0);
    this.emitState();
  }

  private async fetchEtfDetails(etf: EtfSearchItem): Promise<any | null> {
    try {
      const catalogResponse = await firstValueFrom(this.apiService.getETFs());
      const catalog = catalogResponse?.data ?? [];
      const fromCatalog = catalog.find((entry: any) =>
        String(entry?.id) === String(etf.id) ||
        String(entry?.isin || '').toUpperCase() === String(etf.isin || '').toUpperCase()
      );

      if (fromCatalog) {
        return fromCatalog;
      }
    } catch {
      // Fallback below: keep flow resilient even if catalog endpoint fails.
    }

    try {
      const response = await firstValueFrom(this.apiService.getETFById(etf.id));
      return response?.data ?? response ?? null;
    } catch {
      return null;
    }
  }

  removeItem(index: number): void {
    this.items.update((current) => {
      const removed = current[index];
      const next = current.filter((_, currentIndex) => currentIndex !== index);
      if (removed) {
        this.currentWeightValues.update((values) => {
          const updated = { ...values };
          delete updated[String(removed.etfId)];
          return updated;
        });
      }
      return next;
    });
    this.emitState();
  }

  onWeightInput(index: number, value: string): void {
    const parsed = this.parseWeightInput(value);
    this.items.update((current) => {
      const next = [...current];
      const item = next[index];
      if (!item) {
        return current;
      }

      const normalized = parsed ?? item.weight;
      next[index] = {
        ...item,
        displayValue: value || this.formatWeight(normalized),
        weight: normalized
      };
      return next;
    });

    this.emitState();
  }

  commitWeight(index: number, value: string): void {
    const parsed = this.parseWeightInput(value);
    const normalizedWeight = parsed ?? this.items()[index]?.weight ?? 0;
    this.items.update((current) => {
      const next = [...current];
      const item = next[index];
      if (!item) {
        return current;
      }

      const appliedWeight = this.clampWeight(normalizedWeight);
      next[index] = {
        ...item,
        weight: appliedWeight,
        displayValue: this.formatWeight(appliedWeight)
      };
      return next;
    });
    this.emitState();
  }

  onSliderChange(index: number, value: string): void {
    const nextInteger = Number.parseInt(String(value), 10);
    if (Number.isNaN(nextInteger)) {
      return;
    }

    this.items.update((current) => {
      const next = [...current];
      const item = next[index];
      if (!item) {
        return current;
      }

      const currentWeight = item.weight;
      const roundedCurrent = Math.round(currentWeight);
      const appliedWeight = !Number.isInteger(currentWeight) && currentWeight !== 0
        ? this.clampWeight(nextInteger > roundedCurrent ? Math.ceil(currentWeight) : Math.floor(currentWeight))
        : this.clampWeight(nextInteger);

      next[index] = {
        ...item,
        weight: appliedWeight,
        displayValue: this.formatWeight(appliedWeight)
      };
      return next;
    });

    this.emitState();
  }

  toPercentWeight(weight: number | null | undefined): number {
    if (weight === null || weight === undefined || Number.isNaN(weight)) {
      return 0;
    }

    return Number(weight) * 100;
  }

  trackByEtfId(index: number, item: MontecarloPortfolioItem): string {
    return String(item.etfId);
  }

  formatWeight(value: number): string {
    return `${value.toFixed(2).replace('.', ',')}`;
  }

  getWeightDelta(): string {
    const delta = this.totalWeight() - 100;
    if (delta > 0) {
      return `Eccedenza: ${this.formatWeight(delta)}%`;
    }
    if (delta < 0) {
      return `Mancano: ${this.formatWeight(Math.abs(delta))}%`;
    }
    return 'Totale esatto';
  }

  buildEffectiveComposition(): Array<{ etfId: string; weight: number }> {
    return this.items()
      .filter((item) => item.weight > 0)
      .map((item) => ({
        etfId: item.etfId,
        weight: Number(item.weight.toFixed(2))
      }));
  }

  private buildPortfolioPayloadItems(): Array<{ etfId: string; peso: number }> {
    return this.items()
      .filter((item) => item.weight > 0)
      .map((item) => ({
        etfId: item.etfId,
        peso: Number(item.weight.toFixed(2))
      }));
  }

  private mapHoldingToItem(holding: any): MontecarloPortfolioItem {
    const weight = this.clampWeight(this.toPercentWeight(holding.weight));
    const nickname = holding.nickname || holding.name || holding.description || holding.ticker || holding.isin || 'ETF';
    const fullName = holding.fullName || holding.name || holding.description || holding.nickname || holding.ticker || holding.isin || nickname;

    return {
      etfId: holding.etfId || holding.id || holding.isin,
      isin: holding.isin || '',
      ticker: holding.ticker || '',
      nickname,
      fullName,
      description: holding.description || fullName,
      weight,
      originalWeight: weight,
      macroStatistics: holding.macroStatistics,
      expectedReturn: holding.expectedReturn || 0,
      volatility: holding.volatility || 0,
      maxDrawdown: holding.maxDrawdown || 0,
      ter: holding.ter || holding.expense || 0,
      liquidity: holding.liquidity || 5,
      recession: holding.recession || 0,
      stagflation: holding.stagflation || 0,
      isAddedTemporarily: false,
      displayValue: this.formatWeight(weight)
    };
  }

  private parseWeightInput(value: string | number): number | null {
    const normalized = String(value ?? '').trim().replace(',', '.');
    if (!normalized) {
      return null;
    }

    const parsed = Number.parseFloat(normalized);
    if (Number.isNaN(parsed)) {
      return null;
    }

    return this.clampWeight(parsed);
  }

  private clampWeight(value: number): number {
    return Math.max(0, Math.min(100, value));
  }

  private isWeightWithinRange(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 100;
  }

  private normalizeComposition(items: MontecarloPortfolioItem[]) {
    return items
      .filter((item) => item.weight > 0)
      .map((item) => ({
        etfId: item.etfId,
        weight: Number(item.weight.toFixed(2))
      }))
      .sort((a, b) => a.etfId.localeCompare(b.etfId));
  }

  private emitState(): void {
    this.stateChange.emit({
      state: this.getState(),
      effectiveEtfs: this.effectiveEtfs()
    });
  }

  private resetEditor(): void {
    this.items.set([]);
    this.originalItems.set([]);
    this.currentWeightValues.set({});
    this.selectedPortfolioName.set('');
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.showSearchResults.set(false);
    this.highlightedIndex.set(0);
    this.emitState();
  }
}
