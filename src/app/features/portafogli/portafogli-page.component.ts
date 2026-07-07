import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioStateService } from '../../core/services/portfolio-state.service';
import { ApiService } from '../../core/api/api.service';

interface Etf {
  id: string;
  isin: string;
  name: string;
  description: string;
  ticker?: string;
}

interface PortfolioEtf {
  etfId: string;
  peso: number;
  etf?: Etf;
}

@Component({
  selector: 'app-portafogli-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './portafogli-page.component.html',
  styleUrls: ['./portafogli-page.component.css']
})
export class PortafoliPageComponent implements OnInit {
  private apiService = inject(ApiService);
  private portfolioState = inject(PortfolioStateService);

  // Signals for portfolio list view
  portafogli = signal<any[]>([]);
  loading = signal(false);

  // Signals for form
  showForm = signal(false);
  nomePortafoglio = signal('');
  searchQuery = signal('');
  searchResults = signal<Etf[]>([]);
  selectedEtfs = signal<PortfolioEtf[]>([]);
  searchLoading = signal(false);

  // Computed signals
  totalWeight = computed(() => {
    return this.selectedEtfs().reduce((sum, e) => sum + (e.peso || 0), 0);
  });

  isTotalValid = computed(() => {
    const total = this.totalWeight();
    return Math.abs(total - 100) < 0.01;
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

  // Open new portfolio form
  openNewPortfolioForm() {
    this.showForm.set(true);
    this.nomePortafoglio.set('');
    this.searchQuery.set('');
    this.selectedEtfs.set([]);
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
        this.searchResults.set(res.data || []);
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
      peso: 0,
      etf: etf
    };

    this.selectedEtfs.update(etfs => [...etfs, newEtf]);
    this.searchResults.set([]);
    this.searchQuery.set('');
  }

  // Update ETF weight
  updateEtfWeight(index: number, value: string) {
    const peso = parseFloat(value) || 0;
    this.selectedEtfs.update(etfs => {
      etfs[index].peso = peso;
      return [...etfs];
    });
  }

  // Remove ETF from selection
  removeEtf(index: number) {
    this.selectedEtfs.update(etfs => {
      etfs.splice(index, 1);
      return [...etfs];
    });
  }

  // Save portfolio
  savePortafoglio() {
    if (!this.nomePortafoglio().trim()) {
      alert('Inserisci il nome del portafoglio');
      return;
    }

    if (this.selectedEtfs().length === 0) {
      alert('Aggiungi almeno un ETF');
      return;
    }

    if (!this.isTotalValid()) {
      alert(`Il peso totale deve essere 100%, attualmente ${this.totalWeight().toFixed(2)}%`);
      return;
    }

    const payload = {
      nome: this.nomePortafoglio(),
      etfs: this.selectedEtfs().map(e => ({
        etfId: e.etfId,
        peso: e.peso
      }))
    };

    this.apiService.savePortafoglio(payload).subscribe({
      next: (res: any) => {
        alert('Portafoglio salvato con successo!');
        this.closeForm();
        this.loadPortafogli();
      },
      error: (err: any) => {
        alert('Errore nel salvataggio: ' + (err.error?.error || 'Errore sconosciuto'));
      }
    });
  }

  // Clear form
  private clearForm() {
    this.nomePortafoglio.set('');
    this.searchQuery.set('');
    this.selectedEtfs.set([]);
    this.searchResults.set([]);
  }
}
