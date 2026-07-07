import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/api/api.service';

@Component({
  selector: 'app-debug-etf',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="page-panel">
      <div class="page-header">
        <h2>Debug ETF Data</h2>
        <p>Visualizzazione dati grezzi dal backend</p>
      </div>

      <div class="content-card">
        <button (click)="loadEtfs()" class="btn btn-primary">
          Ricarica dati
        </button>

        <div *ngIf="loading()" style="margin: 20px 0;">
          Caricamento...
        </div>

        <div *ngIf="error()" style="margin: 20px 0; color: red;">
          Errore: {{ error() }}
        </div>

        <table *ngIf="etfs().length > 0" style="width: 100%; margin-top: 20px; border-collapse: collapse;">
          <thead>
            <tr style="background: #f0f0f0; border-bottom: 2px solid #333;">
              <th style="padding: 10px; text-align: left;">ISIN</th>
              <th style="padding: 10px; text-align: left;">ID (UUID)</th>
              <th style="padding: 10px; text-align: left;">Name</th>
              <th style="padding: 10px; text-align: left;">Description</th>
              <th style="padding: 10px; text-align: left;">Ticker</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let etf of etfs()" style="border-bottom: 1px solid #ddd;">
              <td style="padding: 10px;">{{ etf.isin }}</td>
              <td style="padding: 10px; font-size: 0.8em;">{{ etf.id }}</td>
              <td style="padding: 10px;">{{ etf.name }}</td>
              <td style="padding: 10px; font-weight: bold; color: green;">{{ etf.description }}</td>
              <td style="padding: 10px;">{{ etf.ticker }}</td>
            </tr>
          </tbody>
        </table>

        <pre *ngIf="etfs().length > 0" style="margin-top: 20px; background: #f5f5f5; padding: 10px; overflow-x: auto;">{{ etfs() | json }}</pre>
      </div>
    </section>
  `,
  styles: [`
    .btn {
      padding: 10px 20px;
      background: #7c5cff;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    .btn:hover {
      background: #6a4ddd;
    }
  `]
})
export class DebugEtfComponent implements OnInit {
  etfs = signal<any[]>([]);
  loading = signal(false);
  error = signal('');

  constructor(private apiService: ApiService) {}

  ngOnInit() {
    this.loadEtfs();
  }

  loadEtfs(): void {
    this.loading.set(true);
    this.error.set('');
    
    this.apiService.getETFs().subscribe({
      next: (response: any) => {
        this.loading.set(false);
        if (response.success && response.data) {
          this.etfs.set(response.data);
        } else {
          this.error.set('No data received');
        }
      },
      error: (err: any) => {
        this.loading.set(false);
        this.error.set(err.message || 'Error loading ETFs');
      }
    });
  }
}
