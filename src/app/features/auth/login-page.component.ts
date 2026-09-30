import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/api/api.service';

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
  username = '';
  password = '';
  loggingIn = false;
  loginError = '';

  onLogin(): void {
    const username = this.username.trim();
    if (!username || this.loggingIn) {
      if (!username) this.loginError = 'Inserisci uno username.';
      return;
    }
    this.loggingIn = true;
    this.loginError = '';
    this.apiService.login(username, this.password).subscribe({
      next: (response: any) => {
        localStorage.setItem('investmentLabUsername', String(response?.data?.username ?? username));
        this.loggingIn = false;
        this.apiService.warmupMarketUniverseCache().subscribe({
          next: () => undefined,
          error: (error) => console.error('[Market Universe warmup]', error)
        });
        void this.router.navigateByUrl('/home');
      },
      error: () => {
        this.loggingIn = false;
        this.loginError = 'Accesso non riuscito.';
      }
    });
  }
}
