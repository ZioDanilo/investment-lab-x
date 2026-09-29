import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
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

  async onLogin(): Promise<void> {
    // Complete the Market Universe warm-up before entering the application so
    // Monte Carlo portfolio projections do not pay the cold-cache cost later.
    try {
      await firstValueFrom(this.apiService.warmupMarketUniverseCache());
    } catch (error) {
      console.error('[Market Universe warmup]', error);
    }

    await this.router.navigateByUrl('/home');
  }
}
