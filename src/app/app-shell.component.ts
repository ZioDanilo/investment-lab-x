import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortfolioSelectorComponent } from './shared/portfolio-selector/portfolio-selector.component';
import { ApiService } from './core/api/api.service';
import { PortfolioSelectionService } from './core/services/portfolio-selection.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, PortfolioSelectorComponent],
  templateUrl: './app-shell.component.html',
  styleUrls: ['./app-shell.component.css']
})
export class AppShellComponent implements OnDestroy {
  constructor() {
    // Services are in-memory: after a browser refresh rebuild the user-scoped data.
    if (localStorage.getItem('investmentLabUsername')) {
      this.portfolioSelection.loadPortfolios();
      void this.refreshMarketUniverseGenerationStatus();
    }
  }

  ngOnDestroy(): void {
    this.stopMarketUniversePolling();
  }
  readonly featureRoutes = ['/laboratorio-portafogli','/portafogli','/monte-carlo','/ribilanciamento','/market-universe','/nuovo-etf'];
  private readonly router = inject(Router);
  private readonly apiService = inject(ApiService);
  private readonly portfolioSelection = inject(PortfolioSelectionService);

  get showFeatureSidebar(): boolean { return this.featureRoutes.some(path => this.router.url.startsWith(path)); }
  get loggedUsername(): string { return localStorage.getItem('investmentLabUsername')?.trim() || ''; }

  activeFeaturePage: any = null;
  onFeatureActivate(component: any): void {
    this.activeFeaturePage = component;
    this.pushMarketUniverseStatusToActivePage();
  }
  get featureActionLabel(): string {
    return this.isMonteCarloPage && this.isRegeneratingMarketUniverse
      ? 'Generazione Market Universe'
      : (this.activeFeaturePage?.headerActionLabel ?? '');
  }
  get featureActionIcon(): string {
    return this.isMonteCarloPage && this.isRegeneratingMarketUniverse
      ? 'autorenew'
      : (this.activeFeaturePage?.headerActionIcon ?? '');
  }
  get featureActionDisabled(): boolean {
    return (this.isMonteCarloPage && this.isRegeneratingMarketUniverse)
      || (this.activeFeaturePage?.headerActionDisabled ?? false);
  }
  get featureActionRunning(): boolean {
    return (this.isMonteCarloPage && this.isRegeneratingMarketUniverse)
      || (this.activeFeaturePage?.headerActionRunning ?? false);
  }
  get featureActionProgress(): number {
    return this.isMonteCarloPage && this.isRegeneratingMarketUniverse
      ? this.marketUniverseGenerationProgress
      : (this.activeFeaturePage?.headerActionProgress ?? 0);
  }
  private get isMonteCarloPage(): boolean { return this.router.url.startsWith('/monte-carlo'); }
  runFeatureAction(): void { this.activeFeaturePage?.runHeaderAction?.(); }

  profileMenuOpen = false;
  isRegeneratingMarketUniverse = false;
  marketUniverseGenerationProgress = 0;
  private marketUniversePollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private marketUniversePolling = false;

  private pushMarketUniverseStatusToActivePage(): void {
    this.activeFeaturePage?.setMarketUniverseGenerationStatus?.(
      this.isRegeneratingMarketUniverse,
      this.marketUniverseGenerationProgress
    );
  }

  private applyMarketUniverseGenerationStatus(response: any): boolean {
    const data = response?.data ?? response ?? {};
    const inProgress = data?.inProgress === true;
    this.isRegeneratingMarketUniverse = inProgress;
    this.marketUniverseGenerationProgress = inProgress
      ? Math.max(0, Math.min(100, Number(data?.progressPercentage) || 0))
      : 0;
    this.pushMarketUniverseStatusToActivePage();
    return inProgress;
  }

  private stopMarketUniversePolling(): void {
    this.marketUniversePolling = false;
    if (this.marketUniversePollTimeoutId !== null) {
      clearTimeout(this.marketUniversePollTimeoutId);
      this.marketUniversePollTimeoutId = null;
    }
  }

  private async refreshMarketUniverseGenerationStatus(): Promise<void> {
    try {
      const response = await firstValueFrom(this.apiService.getMarketUniverseGenerationStatus());
      if (this.applyMarketUniverseGenerationStatus(response)) {
        this.startMarketUniversePolling();
      }
    } catch (error) {
      console.error('Errore lettura stato Market Universe', error);
    }
  }

  private startMarketUniversePolling(): void {
    if (this.marketUniversePolling) {
      return;
    }
    this.marketUniversePolling = true;

    const poll = async (): Promise<void> => {
      if (!this.marketUniversePolling) return;
      try {
        const response = await firstValueFrom(this.apiService.getMarketUniverseGenerationStatus());
        if (!this.applyMarketUniverseGenerationStatus(response)) {
          this.stopMarketUniversePolling();
          return;
        }
      } catch (error) {
        console.error('Errore polling Market Universe', error);
      }
      if (this.marketUniversePolling) {
        this.marketUniversePollTimeoutId = setTimeout(() => void poll(), 3000);
      }
    };

    this.marketUniversePollTimeoutId = setTimeout(() => void poll(), 3000);
  }

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
    this.marketUniverseGenerationProgress = 0;
    this.pushMarketUniverseStatusToActivePage();
    this.profileMenuOpen = false;

    try {
      // The regeneration endpoint acknowledges the background job immediately.
      // Keep the UI locked locally and start polling only after that acknowledgement,
      // when the GENERATING state is already persisted.
      const response = await firstValueFrom(this.apiService.regenerateMarketUniverse());
      const payload = response?.data ?? response;
      if (payload?.success === false) {
        throw new Error(payload?.error || 'Market Universe regeneration failed');
      }

      this.startMarketUniversePolling();
    } catch (error) {
      console.error('Errore nella rigenerazione del Market Universe', error);
      this.stopMarketUniversePolling();
      this.isRegeneratingMarketUniverse = false;
      this.marketUniverseGenerationProgress = 0;
      this.pushMarketUniverseStatusToActivePage();
    }
  }

  logout(event: MouseEvent): void {
    event.stopPropagation();
    this.profileMenuOpen = false;

    this.portfolioSelection.resetForLogin();

    try {
      localStorage.removeItem('investmentLabUsername');
      sessionStorage.clear();
    } catch {}

    void this.router.navigateByUrl('/login');
  }
}
