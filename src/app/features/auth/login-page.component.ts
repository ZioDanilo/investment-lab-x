import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
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
export class LoginPageComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly apiService = inject(ApiService);
  private readonly portfolioSelection = inject(PortfolioSelectionService);

  landingStats: { users: number | null; portfolios: number | null; etfs: number | null; operations: number | null } = { users: null, portfolios: null, etfs: null, operations: null };

  ngOnInit(): void {
    this.apiService.getLandingStats().subscribe({
      next: (response: any) => {
        const data = response?.data;
        if (response?.success && data && [data.users, data.portfolios, data.etfs, data.operations].every((value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0)) {
          this.landingStats = { users: data.users, portfolios: data.portfolios, etfs: data.etfs, operations: data.operations };
        }
      },
      error: () => { /* Keep placeholders if statistics cannot be loaded. */ }
    });
  }

  username = '';
  password = '';
  registerMode = false;
  submitting = false;
  authError = '';
  authSuccess = '';
  usernameTaken = false;
  private usernameCheckTimer?: ReturnType<typeof setTimeout>;

  setRegisterMode(registerMode: boolean): void {
    if (this.submitting) return;
    this.registerMode = registerMode;
    this.authError = '';
    this.authSuccess = '';
    this.usernameTaken = false;
  }

  onUsernameChange(value: string): void {
    this.usernameTaken = false;
    this.authError = '';
    if (!this.registerMode) return;

    if (this.usernameCheckTimer) clearTimeout(this.usernameCheckTimer);
    const username = String(value ?? '').trim();
    if (!username) return;

    this.usernameCheckTimer = setTimeout(() => this.checkUsernameAvailability(), 350);
  }

  checkUsernameAvailability(): void {
    if (!this.registerMode) return;
    const username = this.username.trim();
    if (!username) {
      this.usernameTaken = false;
      return;
    }

    this.apiService.checkUsernameAvailability(username).subscribe({
      next: (response: any) => {
        if (this.username.trim().toLowerCase() !== username.toLowerCase()) return;
        this.usernameTaken = response?.data?.available === false;
      },
      error: () => {
        // Registration itself remains the authoritative uniqueness check.
        this.usernameTaken = false;
      }
    });
  }

  onSubmit(): void {
    if (this.submitting || !this.username || !this.password || (this.registerMode && this.usernameTaken)) return;
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
    localStorage.removeItem('investmentLabRole');
    this.portfolioSelection.resetForLogin();

    this.apiService.login(username, password).subscribe({
      next: (response: any) => {
        localStorage.setItem('investmentLabUsername', String(response?.data?.username ?? username));
        localStorage.setItem('investmentLabRole', response?.data?.role === 'ADMIN' ? 'ADMIN' : 'GUEST');
        this.portfolioSelection.loadPortfolios();
        this.submitting = false;
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
