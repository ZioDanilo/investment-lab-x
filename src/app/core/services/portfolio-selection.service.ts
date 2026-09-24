import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';

export interface PortfolioOption {
  id: string;
  label: string;
}

@Injectable({
  providedIn: 'root'
})
export class PortfolioSelectionService {
  private readonly apiService = inject(ApiService);

  readonly portfolioOptions = signal<PortfolioOption[]>([]);
  readonly selectedPortfolio = signal<PortfolioOption | null>(null);
  readonly loading = signal(false);
  readonly hasError = signal(false);

  constructor() {
    this.loadPortfolios();
  }

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
      label: String(label)
    };
  }

  loadPortfolios(): void {
    this.loading.set(true);
    this.hasError.set(false);

    this.apiService.getPortfolios().subscribe({
      next: (response: any) => {
        const data = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
        const nextOptions = data
          .map((portfolio: any) => this.normalizePortfolio(portfolio))
          .filter((portfolio: PortfolioOption | null): portfolio is PortfolioOption => !!portfolio);

        this.portfolioOptions.set(nextOptions);

        const currentSelection = this.selectedPortfolio();
        const validSelection = currentSelection && nextOptions.some((portfolio: PortfolioOption) => portfolio.id === currentSelection.id)
          ? currentSelection
          : null;

        this.selectedPortfolio.set(validSelection);
        this.loading.set(false);
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
      return;
    }

    const nextPortfolio = this.portfolioOptions().find((portfolio) => portfolio.id === portfolioId);

    this.selectedPortfolio.set(nextPortfolio ?? null);
  }

  setSelectedPortfolioByLabel(label: string): void {
    const nextPortfolio = this.portfolioOptions().find((portfolio) => portfolio.label === label);

    if (nextPortfolio) {
      this.selectedPortfolio.set(nextPortfolio);
    }
  }
}
