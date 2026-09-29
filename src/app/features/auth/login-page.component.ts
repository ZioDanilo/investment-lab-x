import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/api/api.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.css']
})
export class LoginPageComponent {
  private readonly router = inject(Router);
  private readonly apiService = inject(ApiService);

  onLogin(): void {
    // Warm-up is intentionally fire-and-forget: login/navigation must never wait
    // for the Market Universe cache. ApiService resolves the correct backend from
    // the Angular environment (local ng serve -> localhost, production -> Render).
    this.apiService.warmupMarketUniverseCache().subscribe({
      next: () => undefined,
      error: (error) => console.error('[Market Universe warmup]', error)
    });

    void this.router.navigateByUrl('/home');
  }
}
