import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { QuotationService } from '../../core/services/quotation.service';
import { ApiService } from '../../core/api/api.service';
import { TastoConfermaComponent } from '../../shared/components/tasto-conferma/tasto-conferma.component';

interface Quotation {
  isin: string;
  name: string;
  quotation: number | null;
  variation: string;
  refreshing?: boolean;
  inPortfolio?: boolean;
  deleting?: boolean;
}

@Component({
  selector: 'app-quotazioni-page',
  standalone: true,
  imports: [CommonModule, TastoConfermaComponent],
  templateUrl: './quotazioni-page.component.html',
  styleUrls: ['./quotazioni-page.component.css']
})
export class QuotazioniPageComponent implements OnInit {
  private quotationService = inject(QuotationService);
  private apiService = inject(ApiService);

  quotations = signal<Quotation[]>([]);
  filterText = signal('');
  filteredQuotations = computed(() => {
    const query = this.filterText().trim().toLowerCase();
    if (!query) {
      return this.quotations();
    }

    return this.quotations().filter((quote) =>
      quote.name.toLowerCase().includes(query) || quote.isin.toLowerCase().includes(query)
    );
  });
  loading = signal(false);
  error = signal('');
  lastUpdateDate = signal('');
  portfolioIsins = signal<Set<string>>(new Set());

  onFilterInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    this.filterText.set(value);
  }

  ngOnInit() {
    this.loadAllData();
  }

  loadAllData(): void {
    this.loading.set(true);
    this.error.set('');

    // Load portfolios first to know which ISINs are in use
    this.apiService.getPortfolios().subscribe({
      next: (portRes: any) => {
        const inUse = new Set<string>();
        if (portRes.success && Array.isArray(portRes.data)) {
          portRes.data.forEach((p: any) => {
            (p.etfs || []).forEach((pe: any) => {
              if (pe.etf?.isin) inUse.add(pe.etf.isin);
            });
          });
        }
        this.portfolioIsins.set(inUse);
        this.loadEtfsAndQuotations();
      },
      error: () => {
        this.portfolioIsins.set(new Set());
        this.loadEtfsAndQuotations();
      }
    });
  }

  private loadEtfsAndQuotations(): void {
    // Load all ETFs first
    this.apiService.getAllEtfs().subscribe({
      next: (etfResponse: any) => {
        if (etfResponse.success) {
          const allEtfs = etfResponse.data || [];
          
          // Then load quotations for today
          this.quotationService.getDailyQuotations().subscribe({
            next: (quotResponse: any) => {
              if (quotResponse.success) {
                const dailyQuotations = quotResponse.data || [];
                this.lastUpdateDate.set(quotResponse.date || new Date().toISOString().split('T')[0]);
                
                // Merge ETF data with quotations
                const merged = this.mergeEtfsWithQuotations(allEtfs, dailyQuotations);
                this.quotations.set(merged);
              } else {
                // Even if quotations fail, show all ETFs with ND
                const merged = this.mergeEtfsWithQuotations(allEtfs, []);
                this.quotations.set(merged);
              }
              this.loading.set(false);
            },
            error: (err: any) => {
              console.error('Error loading quotations:', err);
              // Show all ETFs with ND on error
              const merged = this.mergeEtfsWithQuotations(allEtfs, []);
              this.quotations.set(merged);
              this.loading.set(false);
            }
          });
        } else {
          this.error.set('Errore nel caricamento ETF');
          this.loading.set(false);
        }
      },
      error: (err: any) => {
        console.error('Error loading ETFs:', err);
        this.error.set(err.error?.error || 'Errore nel caricamento ETF');
        this.loading.set(false);
      }
    });
  }

  private mergeEtfsWithQuotations(etfs: any[], quotations: Quotation[]): Quotation[] {
    const inUse = this.portfolioIsins();
    const quotMap = new Map();
    quotations.forEach(q => {
      quotMap.set(q.isin, q);
    });

    return etfs.map(etf => {
      const quot = quotMap.get(etf.isin);
      return {
        isin: etf.isin,
        name: etf.name,
        quotation: quot ? quot.quotation : null,
        variation: quot ? quot.variation : '-',
        refreshing: false,
        inPortfolio: inUse.has(etf.isin),
        deleting: false
      };
    });
  }

  refreshSingleQuotation(isin: string): void {
    const index = this.quotations().findIndex((q) => q.isin === isin);
    if (index < 0) return;

    // Mark this row as refreshing
    const currentQuotations = this.quotations();
    if (currentQuotations[index]) {
      currentQuotations[index].refreshing = true;
      this.quotations.set([...currentQuotations]);
    }

    this.quotationService.refreshSingleQuotation(isin).subscribe({
      next: (response: any) => {
        if (response.success && response.data) {
          // Update just this ETF
          const updated = [...this.quotations()];
          const targetIndex = updated.findIndex((q) => q.isin === isin);
          if (targetIndex >= 0) {
            updated[targetIndex] = {
              ...updated[targetIndex],
              isin: response.data.isin,
              name: response.data.name,
              quotation: response.data.quotation,
              variation: response.data.variation,
              refreshing: false
            };
            this.quotations.set(updated);
          }
        }
      },
      error: (err: any) => {
        console.error('Error refreshing single quotation:', err);
        // Clear refreshing flag
        const updated = [...this.quotations()];
        if (updated[index]) {
          updated[index].refreshing = false;
        }
        this.quotations.set(updated);
      }
    });
  }

  async forceRefreshQuotations(): Promise<void> {
    this.error.set('');

    // Force refresh from JustETF - update ALL ETFs, overwrite DB
    return new Promise((resolve, reject) => {
      this.quotationService.forceRefreshQuotations().subscribe({
        next: (response: any) => {
          if (response.success) {
            this.quotations.set(response.data || []);
            this.lastUpdateDate.set(response.date || new Date().toISOString().split('T')[0]);
            resolve();
          } else {
            const errorMsg = this.sanitizeErrorMessage(response.error || 'Errore nel refresh delle quotazioni');
            this.error.set(errorMsg);
            reject(new Error(errorMsg));
          }
        },
        error: (err: any) => {
          console.error('Error force refreshing quotations:', err);
          const errorMsg = this.sanitizeErrorMessage(err.error?.error || 'Errore nel refresh delle quotazioni');
          this.error.set(errorMsg);
          reject(err);
        }
      });
    });
  }

  deleteEtf(isin: string): void {
    const index = this.quotations().findIndex((q) => q.isin === isin);
    if (index < 0) return;

    const etf = this.quotations()[index];
    if (!etf || etf.inPortfolio) return;

    if (!confirm(`Eliminare definitivamente l'ETF ${etf.name} (${isin}) e tutti i suoi dati correlati (correlazioni, quotazioni, statistiche macro)?`)) return;

    const updated = [...this.quotations()];
    updated[index] = { ...updated[index], deleting: true };
    this.quotations.set(updated);

    this.apiService.deleteEtf(isin).subscribe({
      next: (res: any) => {
        if (res.success) {
          this.quotations.update(list => list.filter((_, i) => i !== index));
        } else {
          const u = [...this.quotations()];
          u[index] = { ...u[index], deleting: false };
          this.quotations.set(u);
          this.error.set(res.error || 'Errore nella cancellazione');
        }
      },
      error: (err: any) => {
        const u = [...this.quotations()];
        u[index] = { ...u[index], deleting: false };
        this.quotations.set(u);
        this.error.set(err.error?.error || 'Errore nella cancellazione');
      }
    });
  }

  private sanitizeErrorMessage(message: string): string {
    // Nascondi messaggi tecnici di Puppeteer e dettagli interni
    if (message.includes('puppeteer') || message.includes('browser') || message.includes('launch')) {
      return 'Errore nel caricamento dei dati da JustETF. Riprova tra un momento.';
    }
    return message;
  }

  getVariationClass(variation: string): string {
    if (variation === '-') return '';
    const value = parseFloat(variation);
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return '';
  }
}
