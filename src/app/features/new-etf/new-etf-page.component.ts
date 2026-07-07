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
  descrizione = signal('');
  loading = signal(false);
  successMessage = signal('');
  errorMessage = signal('');

  constructor(private apiService: ApiService) {}

  addEtf(): void {
    // Validation
    const isinValue = this.isin().trim();
    const descrizioneValue = this.descrizione().trim();

    if (!isinValue) {
      this.errorMessage.set('ISIN è obbligatorio');
      return;
    }

    if (!descrizioneValue) {
      this.errorMessage.set('Descrizione è obbligatoria');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    // Call backend API
    this.apiService.addEtf(isinValue, descrizioneValue).subscribe({
      next: (response: any) => {
        this.loading.set(false);
        
        if (response.success) {
          // Success: clear form and show message
          this.successMessage.set(response.message || `Aggiunto ETF ${descrizioneValue}`);
          this.isin.set('');
          this.descrizione.set('');
          
          // Auto-hide success message after 3 seconds
          setTimeout(() => this.successMessage.set(''), 3000);
        } else {
          // Error response from backend
          this.errorMessage.set(response.error || 'Errore sconosciuto');
        }
      },
      error: (error: any) => {
        this.loading.set(false);
        
        // Handle specific error messages
        if (error.error?.error === 'ETF già censito') {
          this.errorMessage.set('ETF già censito');
        } else if (error.error?.error) {
          this.errorMessage.set(error.error.error);
        } else if (error.status === 409) {
          this.errorMessage.set('ETF già censito');
        } else {
          this.errorMessage.set('Errore nell\'aggiunta dell\'ETF');
        }
        
        console.error('Error adding ETF:', error);
      }
    });
  }

  clearForm(): void {
    this.isin.set('');
    this.descrizione.set('');
    this.errorMessage.set('');
    this.successMessage.set('');
  }
}

