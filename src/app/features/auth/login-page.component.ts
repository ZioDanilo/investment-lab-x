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
    const username = this.username.trim();
    if (this.loggingIn) return;
    this.loggingIn = true;
    this.loginError = '';

    // Login is a hard user boundary: never keep portfolio state from a previous user.
    localStorage.removeItem('investmentLabUsername');
    this.portfolioSelection.resetForLogin();
    // Authentication is intentionally permissive for now: no username/password validation.
    localStorage.setItem('investmentLabUsername', username);
    this.portfolioSelection.loadPortfolios();
    this.loggingIn = false;
    this.apiService.warmupMarketUniverseCache().subscribe({
      next: () => undefined,
      error: (error) => console.error('[Market Universe warmup]', error)
    });
    void this.router.navigateByUrl('/home');


  }
}
