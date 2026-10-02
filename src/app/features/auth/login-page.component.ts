import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
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
  usernameTaken = false;
  factorTestRunning = false;
  factorTestResult = '';
  factorTestOk = false;
  etfValidationRunning = false;
  etfValidationResult = '';
  etfValidationOk = false;
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

  testFactorEngineV2(): void {
    if (this.factorTestRunning) return;
    this.factorTestRunning = true;
    this.factorTestResult = 'Test Factor Engine V2 in corso...';
    this.factorTestOk = false;

    forkJoin({
      readiness: this.apiService.getFactorUniverseReadiness(),
      preview: this.apiService.getFactorUniversePreview(),
      sample: this.apiService.generateFactorUniverseSample({ scenario: 'expansion', intensity: 0.5, seed: 42 }),
      statisticalTest: this.apiService.runFactorUniverseStatisticalTest({ scenario: 'expansion', intensity: 0.5, seed: 42, samples: 100000 })
    }).subscribe({
      next: (result) => {
        this.factorTestRunning = false;
        this.factorTestOk = result.statisticalTest?.data?.pass === true;
        this.factorTestResult = JSON.stringify(result, null, 2);
        console.group('[Factor Engine V2 test]');
        console.log('readiness', result.readiness);
        console.log('preview', result.preview);
        console.log('sample', result.sample);
        console.log('statisticalTest', result.statisticalTest);
        console.groupEnd();
      },
      error: (error) => {
        this.factorTestRunning = false;
        this.factorTestOk = false;
        this.factorTestResult = JSON.stringify({ status: error?.status, message: error?.message, error: error?.error }, null, 2);
        console.error('[Factor Engine V2 test]', error);
      }
    });
  }

  testEtfHistoricalValidation(): void {
    if (this.etfValidationRunning) return;
    this.etfValidationRunning = true;
    this.etfValidationOk = false;
    this.etfValidationResult = 'Test Historical Validation Engine in corso...';

    const rows = [
      { date: '2025-01', realReturn: 0.021, modelReturn: 0.019 },
      { date: '2025-02', realReturn: -0.014, modelReturn: -0.012 },
      { date: '2025-03', realReturn: 0.008, modelReturn: 0.009 },
      { date: '2025-04', realReturn: 0.027, modelReturn: 0.024 },
      { date: '2025-05', realReturn: -0.006, modelReturn: -0.004 },
      { date: '2025-06', realReturn: 0.016, modelReturn: 0.015 },
      { date: '2025-07', realReturn: 0.011, modelReturn: 0.010 },
      { date: '2025-08', realReturn: -0.019, modelReturn: -0.017 },
      { date: '2025-09', realReturn: 0.023, modelReturn: 0.021 },
      { date: '2025-10', realReturn: 0.007, modelReturn: 0.008 },
      { date: '2025-11', realReturn: -0.009, modelReturn: -0.008 },
      { date: '2025-12', realReturn: 0.018, modelReturn: 0.016 }
    ];

    this.apiService.evaluateEtfHistoricalValidation({ isin: 'DIAGNOSTIC_TEST', rows }).subscribe({
      next: (result: any) => {
        this.etfValidationRunning = false;
        this.etfValidationOk = result?.success === true && result?.data?.status === 'diagnostic_only';
        this.etfValidationResult = JSON.stringify(result, null, 2);
        console.log('[ETF Historical Validation test]', result);
      },
      error: (error) => {
        this.etfValidationRunning = false;
        this.etfValidationOk = false;
        this.etfValidationResult = JSON.stringify({ status: error?.status, message: error?.message, error: error?.error }, null, 2);
        console.error('[ETF Historical Validation test]', error);
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
