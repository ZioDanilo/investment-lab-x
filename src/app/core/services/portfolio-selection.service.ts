import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';

export interface PortfolioOption {
  id: string;
  label: string;
  tipo: 'reale' | 'laboratorio';
}

export interface WorkingPortfolioSnapshot {
  id: string;
  name?: string;
  holdings: Array<{ etfId: string; isin?: string; ticker?: string; nickname?: string; fullName?: string; weight: number; [key: string]: any }>;
}

@Injectable({
  providedIn: 'root'
})
export class PortfolioSelectionService {
  private readonly apiService = inject(ApiService);

  readonly portfolioOptions = signal<PortfolioOption[]>([]);
  readonly selectedPortfolio = signal<PortfolioOption | null>(null);
  readonly currentWorkingPortfolioId = signal<string | null>(null);
  readonly workingPortfolio = signal<WorkingPortfolioSnapshot | null>(null);
  readonly originalPortfolioSnapshot = signal<WorkingPortfolioSnapshot | null>(null);
  readonly loading = signal(false);
  readonly hasError = signal(false);
  // Increments after every successful global portfolio reload so all portfolio views can refresh.
  readonly refreshVersion = signal(0);

  constructor() {}

  private normalizePortfolio(raw: any): PortfolioOption | null {
    if (!raw) {
      return null;
    }

    const id = raw.id ?? raw._id ?? raw.portfolioId ?? raw.slug ?? raw.name ?? raw.nome;
    const label = raw.name ?? raw.nome ?? raw.label ?? raw.title ?? 'Portafoglio senza nome';

    if (!id || !label) {
      return null;
    }

    return {
      id: String(id),
      label: String(label),
      tipo: raw.tipo === 'reale' ? 'reale' : 'laboratorio'
    };
  }

  resetForLogin(): void {
    this.portfolioOptions.set([]);
    this.selectedPortfolio.set(null);
    this.discardWorkingPortfolio();
    this.loading.set(false);
    this.hasError.set(false);
  }

  loadPortfolios(): void {
    // Keep the selected identity while refreshing the backing list.
    const selectedBeforeRefresh = this.selectedPortfolio();
    this.loading.set(true);
    this.hasError.set(false);

    this.apiService.getPortfolios().subscribe({
      next: (response: any) => {
        const data = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
        const nextOptions = data
          .map((portfolio: any) => this.normalizePortfolio(portfolio))
          .filter((portfolio: PortfolioOption | null): portfolio is PortfolioOption => !!portfolio);

        this.portfolioOptions.set(nextOptions);

        const refreshedSelection = selectedBeforeRefresh
          ? nextOptions.find((portfolio: PortfolioOption) => portfolio.id === selectedBeforeRefresh.id) ?? null
          : null;

        this.selectedPortfolio.set(refreshedSelection);
        this.loading.set(false);
        this.refreshVersion.update((version) => version + 1);
      },
      error: () => {
        this.portfolioOptions.set([]);
        this.selectedPortfolio.set(null);
        this.hasError.set(true);
        this.loading.set(false);
      }
    });
  }

  setSelectedPortfolio(portfolioId: string | null): void {
    if (!portfolioId) {
      this.selectedPortfolio.set(null);
      this.discardWorkingPortfolio();
      return;
    }

    const nextPortfolio = this.portfolioOptions().find((portfolio) => portfolio.id === portfolioId);
    const previousId = this.currentWorkingPortfolioId();

    if (previousId && previousId !== portfolioId) {
      this.discardWorkingPortfolio();
    }

    this.selectedPortfolio.set(nextPortfolio ?? null);
    if (nextPortfolio && this.currentWorkingPortfolioId() !== nextPortfolio.id) {
      this.currentWorkingPortfolioId.set(nextPortfolio.id);
      this.workingPortfolio.set(null);
      this.originalPortfolioSnapshot.set(null);
    }
  }

  setSelectedPortfolioByLabel(label: string): void {
    const nextPortfolio = this.portfolioOptions().find((portfolio) => portfolio.label === label);

    if (nextPortfolio) {
      this.setSelectedPortfolio(nextPortfolio.id);
    }
  }

  preserveWorkingPortfolio(portfolioId: string, portfolio: WorkingPortfolioSnapshot | null): void {
    const normalizedPortfolio = portfolio ? {
      ...portfolio,
      holdings: Array.isArray(portfolio.holdings) ? portfolio.holdings.map((holding) => ({ ...holding })) : []
    } : null;

    if (this.currentWorkingPortfolioId() && this.currentWorkingPortfolioId() !== portfolioId) {
      this.discardWorkingPortfolio();
    }

    this.currentWorkingPortfolioId.set(portfolioId);
    this.workingPortfolio.set(normalizedPortfolio);
    if (!this.originalPortfolioSnapshot() || this.originalPortfolioSnapshot()?.id !== portfolioId) {
      this.originalPortfolioSnapshot.set(normalizedPortfolio ? {
        ...normalizedPortfolio,
        holdings: normalizedPortfolio.holdings.map((holding) => ({ ...holding }))
      } : null);
    }
  }

  restoreWorkingPortfolio(portfolioId: string, fallback: WorkingPortfolioSnapshot | null): WorkingPortfolioSnapshot | null {
    const currentId = this.currentWorkingPortfolioId();
    const storedPortfolio = this.workingPortfolio();

    if (currentId === portfolioId && storedPortfolio) {
      return {
        ...storedPortfolio,
        holdings: storedPortfolio.holdings.map((holding) => ({ ...holding }))
      };
    }

    if (currentId && currentId !== portfolioId) {
      this.discardWorkingPortfolio();
    }

    const normalizedFallback = fallback ? {
      ...fallback,
      holdings: Array.isArray(fallback.holdings) ? fallback.holdings.map((holding) => ({ ...holding })) : []
    } : null;

    this.currentWorkingPortfolioId.set(portfolioId);
    this.originalPortfolioSnapshot.set(normalizedFallback ? { ...normalizedFallback, holdings: normalizedFallback.holdings.map((holding) => ({ ...holding })) } : null);
    this.workingPortfolio.set(normalizedFallback ? { ...normalizedFallback, holdings: normalizedFallback.holdings.map((holding) => ({ ...holding })) } : null);
    return normalizedFallback;
  }

  discardWorkingPortfolio(): void {
    this.currentWorkingPortfolioId.set(null);
    this.workingPortfolio.set(null);
    this.originalPortfolioSnapshot.set(null);
  }
}
