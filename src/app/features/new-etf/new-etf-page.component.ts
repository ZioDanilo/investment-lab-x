import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';

@Component({
  selector: 'app-new-etf-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './new-etf-page.component.html',
  styleUrls: ['./new-etf-page.component.css']
})
export class NewEtfPageComponent {
  isin = signal('');
  description = signal('');
  loading = signal(false);
  successMessage = signal('');
  errorMessage = signal('');

  constructor(private apiService: ApiService) {}

  addEtf(): void {
    const isinValue = this.isin().trim();
    const descriptionValue = this.description().trim();

    if (!isinValue || !descriptionValue) {
      this.errorMessage.set('ISIN e Descrizione sono obbligatori');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const payload = {
      ticker: isinValue.toUpperCase(),
      name: descriptionValue,
      description: descriptionValue
    };

    this.apiService.createETF(payload).subscribe({
      next: (response: any) => {
        this.loading.set(false);
        this.successMessage.set(`ETF ${isinValue} aggiunto con successo!`);
        this.isin.set('');
        this.description.set('');
        setTimeout(() => this.successMessage.set(''), 3000);
      },
      error: (error: any) => {
        this.loading.set(false);
        this.errorMessage.set('Errore nell\'aggiunta dell\'ETF: ' + (error.error?.error?.message || error.message));
      }
    });
  }
}

