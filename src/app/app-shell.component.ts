import { Component, HostListener, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortfolioSelectorComponent } from './shared/portfolio-selector/portfolio-selector.component';
import { ApiService } from './core/api/api.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, PortfolioSelectorComponent],
  templateUrl: './app-shell.component.html',
  styleUrls: ['./app-shell.component.css']
})
export class AppShellComponent {
  private readonly router = inject(Router);
  private readonly apiService = inject(ApiService);

  profileMenuOpen = false;
  isRegeneratingMarketUniverse = false;

  goHome(event: MouseEvent): void {
    event.preventDefault();

    if (this.router.url === '/home') {
      window.location.reload();
      return;
    }

    void this.router.navigateByUrl('/home');
  }

  toggleProfileMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.profileMenuOpen = !this.profileMenuOpen;
  }

  @HostListener('document:click')
  closeProfileMenu(): void {
    this.profileMenuOpen = false;
  }

  async regenerateMarketUniverse(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (this.isRegeneratingMarketUniverse) {
      return;
    }

    this.isRegeneratingMarketUniverse = true;
    this.profileMenuOpen = false;

    try {
      const response = await firstValueFrom(this.apiService.regenerateMarketUniverse());
      const payload = response?.data ?? response;
      if (payload?.success === false) {
        throw new Error(payload?.error || 'Market Universe regeneration failed');
      }
    } catch (error) {
      console.error('Errore nella rigenerazione del Market Universe', error);
    } finally {
      this.isRegeneratingMarketUniverse = false;
    }
  }

  logout(event: MouseEvent): void {
    event.stopPropagation();
    this.profileMenuOpen = false;

    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}

    void this.router.navigateByUrl('/login');
  }
}
