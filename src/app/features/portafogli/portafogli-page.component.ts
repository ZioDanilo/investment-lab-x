import { Component, OnInit, signal, computed, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioStateService } from '../../core/services/portfolio-state.service';
import { ApiService } from '../../core/api/api.service';
import { ToastComponent } from '../../shared/components/toast/toast.component';
import { DialogComponent } from '../../shared/components/dialog/dialog.component';
import { TastoConfermaComponent } from '../../shared/components/tasto-conferma/tasto-conferma.component';
import { DropdownComponent, DropdownOption } from '../../shared/components/dropdown/dropdown.component';
import { CardCompactComponent } from '../../shared/components/card-compact/card-compact.component';

interface Etf {
  id: string;
  isin: string;
  name: string;
  description: string;
  ticker?: string;
}

interface PortfolioEtf {
  etfId: string;
  peso: number | null;
  etf?: Etf;
}

@Component({
  selector: 'app-portafogli-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ToastComponent, DialogComponent, TastoConfermaComponent, DropdownComponent, CardCompactComponent],
  templateUrl: './portafogli-page.component.html',
  styleUrls: ['./portafogli-page.component.css']
})
export class PortafoliPageComponent implements OnInit {
  private apiService = inject(ApiService);
  private portfolioState = inject(PortfolioStateService);

  @ViewChild(ToastComponent) toast!: ToastComponent;
  @ViewChild(DialogComponent) dialog!: DialogComponent;

  // Signals for portfolio list view
  portafogli = signal<any[]>([]);
  loading = signal(false);
  expandedPortfolioIds = signal<Set<string>>(new Set());

  // Signals for form
  showForm = signal(false);
  nomePortafoglio = signal('');
  searchQuery = signal('');
  searchResults = signal<Etf[]>([]);
  selectedEtfs = signal<PortfolioEtf[]>([]);
  searchLoading = signal(false);
  currentEditingPortfolioId = signal<string | null>(null);

  searchDropdownOptions = computed<DropdownOption[]>(() =>
    this.searchResults().map((etf) => ({
      value: etf.id,
      label: etf.name,
      description: etf.isin
    }))
  );

  // Computed signals
  totalWeight = computed(() => {
    return this.selectedEtfs().reduce((sum, e) => sum + (e.peso || 0), 0);
  });

  isTotalValid = computed(() => {
    const total = this.totalWeight();
    return Math.abs(total - 100) < 0.01;
  });

  portfolioColumns = computed(() => {
    const columns: any[][] = [[], [], []];
    this.portafogli().forEach((portafoglio, index) => {
      columns[index % 3].push(portafoglio);
    });
    return columns;
  });

  ngOnInit() {
    this.loadPortafogli();
  }

  // Load all portfolios
  loadPortafogli() {
    this.loading.set(true);
    this.apiService.getPortfolios().subscribe({
      next: (res: any) => {
        this.portafogli.set(res.data || []);
        this.loading.set(false);
      },
      error: (err: any) => {
        console.error('Error loading portfolios:', err);
        this.portafogli.set([]);
        this.loading.set(false);
      }
    });
  }

  isPortfolioExpanded(portafoglioId: string): boolean {
    return this.expandedPortfolioIds().has(portafoglioId);
  }

  togglePortfolioExpanded(portafoglioId: string): void {
    this.expandedPortfolioIds.update((current) => {
      const next = new Set(current);
      if (next.has(portafoglioId)) {
        next.delete(portafoglioId);
      } else {
        next.add(portafoglioId);
      }
      return next;
    });
  }

  // Open new portfolio form
  async openNewPortfolioForm(): Promise<void> {
    this.currentEditingPortfolioId.set(null);
    this.showForm.set(true);
    this.nomePortafoglio.set('');
    this.searchQuery.set('');
    this.selectedEtfs.set([]);
    this.searchResults.set([]);
  }

  // Open edit portfolio form
  openEditPortfolioForm(portafoglio: any) {
    this.currentEditingPortfolioId.set(portafoglio.id);
    this.showForm.set(true);
    this.nomePortafoglio.set(portafoglio.nome);
    this.searchQuery.set('');
    
    // Pre-fill with existing ETFs - ensure peso is a number
    const etfs = portafoglio.etfs.map((pe: any) => ({
      etfId: pe.etfId,
      peso: parseFloat(pe.peso) || 0,
      etf: pe.etf
    }));
    this.selectedEtfs.set(etfs);
    this.searchResults.set([]);
  }

  // Close form
  closeForm() {
    this.showForm.set(false);
    this.clearForm();
  }

  // Search ETF
  onSearchChange(query: string) {
    this.searchQuery.set(query);
    
    if (query.length < 3) {
      this.searchResults.set([]);
      return;
    }

    this.searchLoading.set(true);
    this.apiService.searchETF(query).subscribe({
      next: (res: any) => {
        // Filter out ETFs already added to the portfolio
        const selectedEtfIds = this.selectedEtfs().map(e => e.etfId);
        const filteredResults = (res.data || []).filter((etf: Etf) => !selectedEtfIds.includes(etf.id));
        this.searchResults.set(filteredResults);
        this.searchLoading.set(false);
      },
      error: (err: any) => {
        console.error('Error searching ETF:', err);
        this.searchResults.set([]);
        this.searchLoading.set(false);
      }
    });
  }

  // Add ETF from search result
  addEtfFromSearch(etf: Etf) {
    // Check if already added
    if (this.selectedEtfs().some(e => e.etfId === etf.id)) {
      alert('ETF già aggiunto');
      return;
    }

    const newEtf: PortfolioEtf = {
      etfId: etf.id,
      peso: null,
      etf: etf
    };

    this.selectedEtfs.update(etfs => [...etfs, newEtf]);
    this.searchResults.set([]);
    this.searchQuery.set('');
  }

  onSearchResultSelected(etfId: string): void {
    const etf = this.searchResults().find((item) => item.id === etfId);
    if (etf) {
      this.addEtfFromSearch(etf);
    }
  }

  // Update ETF weight - parse as integer with dynamic max
  updateEtfWeight(index: number, value: string) {
    let peso = parseInt(value) || 0;
    const maxWeight = this.getMaxWeight(index);
    
    // Clamp value between 0 and calculated max
    if (peso > maxWeight) {
      peso = maxWeight;
    }
    if (peso < 0) {
      peso = 0;
    }
    
    this.selectedEtfs.update(etfs => {
      etfs[index].peso = peso;
      return [...etfs];
    });
  }

  onWeightInput(index: number, event: Event) {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    this.updateEtfWeight(index, value);
  }

  // Calculate maximum weight for an ETF (100 - sum of other ETFs)
  getMaxWeight(index: number): number {
    const otherWeight = this.selectedEtfs()
      .reduce((sum, etf, i) => {
        return i !== index ? sum + (etf.peso || 0) : sum;
      }, 0);
    return Math.max(0, 100 - otherWeight);
  }

  // Remove ETF from selection
  removeEtf(index: number) {
    this.selectedEtfs.update(etfs => {
      etfs.splice(index, 1);
      return [...etfs];
    });
  }

  // Get weight display for input (null becomes empty string)
  getWeightDisplay(peso: number | null): string {
    return peso === null ? '' : String(peso);
  }

  // Save portfolio
  async savePortafoglio(): Promise<void> {
    if (!this.nomePortafoglio().trim()) {
      throw new Error('Inserisci il nome del portafoglio');
    }

    if (this.selectedEtfs().length === 0) {
      throw new Error('Aggiungi almeno un ETF');
    }

    if (!this.isTotalValid()) {
      throw new Error(`Il peso totale deve essere 100%, attualmente ${this.totalWeight().toFixed(2)}%`);
    }

    const payload = {
      nome: this.nomePortafoglio(),
      etfs: this.selectedEtfs().map(e => ({
        etfId: e.etfId,
        peso: e.peso
      }))
    };

    const isEditing = this.currentEditingPortfolioId() !== null;
    const request = isEditing
      ? this.apiService.updatePortfolio(this.currentEditingPortfolioId()!, payload)
      : this.apiService.savePortafoglio(payload);

    return new Promise((resolve, reject) => {
      request.subscribe({
        next: (res: any) => {
          const message = isEditing ? 'Portafoglio aggiornato con successo!' : 'Portafoglio salvato con successo!';
          this.toast.show(message);
          this.closeForm();
          this.loadPortafogli();
          resolve();
        },
        error: (err: any) => {
          reject(new Error(err.error?.error || 'Errore sconosciuto'));
        }
      });
    });
  }

  // Delete portfolio with confirmation
  deletePortafoglio(portafoglio: any) {
    this.dialog.show(
      `Sei sicuro di voler eliminare il portafoglio "${portafoglio.nome}"?`,
      () => {
        this.apiService.deletePortfolio(portafoglio.id).subscribe({
          next: (res: any) => {
            this.toast.show('Portafoglio eliminato con successo!');
            this.loadPortafogli();
          },
          error: (err: any) => {
            this.dialog.show('Errore nell\'eliminazione: ' + (err.error?.error || 'Errore sconosciuto'));
          }
        });
      }
    );
  }

  // Clear form
  private clearForm() {
    this.nomePortafoglio.set('');
    this.searchQuery.set('');
    this.selectedEtfs.set([]);
    this.searchResults.set([]);
  }

  // Format weight for display (handles string or number)
  formatWeight(peso: any): string {
    try {
      const numPeso = typeof peso === 'string' ? parseFloat(peso) : peso;
      return isNaN(numPeso) ? '0.00' : numPeso.toFixed(2);
    } catch (e) {
      return '0.00';
    }
  }
}
