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
  loggingIn = false;
  loginError = '';

  onLogin(): void {
    if (this.loggingIn) return;

    const username = this.username;
    const password = this.password;
    this.loggingIn = true;
    this.loginError = '';

    // Login is a hard user boundary: never keep portfolio state from a previous user.
    localStorage.removeItem('investmentLabUsername');
    this.portfolioSelection.resetForLogin();

    this.apiService.login(username, password).subscribe({
      next: (response: any) => {
        localStorage.setItem('investmentLabUsername', String(response?.data?.username ?? username));
        this.portfolioSelection.loadPortfolios();
        this.loggingIn = false;
        this.apiService.warmupMarketUniverseCache().subscribe({
          next: () => undefined,
          error: (error) => console.error('[Market Universe warmup]', error)
        });
        void this.router.navigateByUrl('/home');
      },
      error: () => {
        this.loggingIn = false;
        this.loginError = 'Username o password non corretti.';
      }
    });
  }
}
