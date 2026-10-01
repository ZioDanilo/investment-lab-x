import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.css']
})
export class LoginPageComponent {
  private readonly router = inject(Router);
  private readonly apiService = inject(ApiService);
  private readonly portfolioSelection = inject(PortfolioSelectionService);

  username = '';
  password = '';
  registerMode = false;
  submitting = false;
  authError = '';
  authSuccess = '';

  setRegisterMode(registerMode: boolean): void {
    if (this.submitting) return;
    this.registerMode = registerMode;
    this.authError = '';
    this.authSuccess = '';
  }

  onSubmit(): void {
    if (this.submitting || !this.username || !this.password) return;
    if (this.registerMode) {
      this.onRegister();
      return;
    }
    this.onLogin();
  }

  private onLogin(): void {
    const username = this.username;
    const password = this.password;
    this.submitting = true;
    this.authError = '';
    this.authSuccess = '';

    localStorage.removeItem('investmentLabUsername');
    this.portfolioSelection.resetForLogin();

    this.apiService.login(username, password).subscribe({
      next: (response: any) => {
        localStorage.setItem('investmentLabUsername', String(response?.data?.username ?? username));
        this.portfolioSelection.loadPortfolios();
        this.submitting = false;
        this.apiService.warmupMarketUniverseCache().subscribe({
          next: () => undefined,
          error: (error) => console.error('[Market Universe warmup]', error)
        });
        void this.router.navigateByUrl('/home');
      },
      error: () => {
        this.submitting = false;
        this.authError = 'Username o password non corretti.';
      }
    });
  }

  private onRegister(): void {
    this.submitting = true;
    this.authError = '';
    this.authSuccess = '';

    this.apiService.register(this.username, this.password).subscribe({
      next: (response: any) => {
        this.submitting = false;
        this.username = String(response?.data?.username ?? this.username);
        this.password = '';
        this.registerMode = false;
        this.authSuccess = 'Registrazione completata. Ora puoi accedere.';
      },
      error: (error) => {
        this.submitting = false;
        if (error?.status === 409) {
          this.authError = 'Username già esistente. Scegline un altro.';
          return;
        }
        this.authError = error?.error?.error || 'Registrazione non riuscita.';
      }
    });
  }
}
