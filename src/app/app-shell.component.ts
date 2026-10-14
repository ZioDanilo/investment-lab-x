import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { AfterViewInit, Component, HostListener, OnDestroy, inject } from '@angular/core';
import { firstValueFrom, filter } from 'rxjs';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortfolioSelectorComponent } from './shared/portfolio-selector/portfolio-selector.component';
import { MoneyInputComponent } from './shared/inputs/money-input.component';
import { RebalanceInputService } from './core/services/rebalance-input.service';
import { ApiService } from './core/api/api.service';
import { ActionConfirmationService } from './core/services/action-confirmation.service';
import { ActionConfirmationComponent } from './shared/components/action-confirmation/action-confirmation.component';
import { PortfolioSelectionService } from './core/services/portfolio-selection.service';
import { TrendStrategyService } from './core/services/trend-strategy.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, PortfolioSelectorComponent, MoneyInputComponent, ActionConfirmationComponent],
  templateUrl: './app-shell.component.html',
  styleUrls: ['./app-shell.component.css']
})
export class AppShellComponent implements OnDestroy, AfterViewInit {
  constructor() {
    // Services are in-memory: after a browser refresh rebuild the user-scoped data.
    if (localStorage.getItem('investmentLabUsername')) {
      this.portfolioSelection.loadPortfolios();
      void this.refreshMarketUniverseGenerationStatus();
    }
  }

  readonly trendStrategy = inject(TrendStrategyService);
  get isTrendFollowingPage(): boolean { return this.router.url.startsWith('/trend-following'); }
  rebalanceTargetLeft = 0;
  rebalanceTargetWidth = 280;
  private targetResizeObserver: ResizeObserver | null = null;
  ngAfterViewInit(): void {
    this.alignRebalanceSelector();
    // The rebalance action row is created only after route navigation.
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => requestAnimationFrame(() => this.alignRebalanceSelector()));
    requestAnimationFrame(() => this.alignRebalanceSelector());
    if (typeof ResizeObserver !== 'undefined') {
      this.targetResizeObserver = new ResizeObserver(() => this.alignRebalanceSelector());
      const navbar = document.querySelector('.nav-links > app-portfolio-selector');
      const row = document.querySelector('.app-feature-action-row');
      if (navbar) this.targetResizeObserver.observe(navbar);
      if (row) this.targetResizeObserver.observe(row);
    }
  }
  @HostListener('window:resize')
  alignRebalanceSelector(): void {
    const navbar = document.querySelector('.nav-links > app-portfolio-selector .selector-trigger');
    const row = document.querySelector('.app-feature-action-row');
    if (!navbar || !row) return;
    this.rebalanceTargetLeft = navbar.getBoundingClientRect().left - row.getBoundingClientRect().left;
    this.rebalanceTargetWidth = navbar.getBoundingClientRect().width;
  }
  ngOnDestroy(): void {
    this.targetResizeObserver?.disconnect();
    this.stopMarketUniversePolling();
  }
  readonly featureRoutes = ['/laboratorio-portafogli','/portafogli','/monte-carlo','/ribilanciamento','/market-universe','/trend-following'];
  private readonly router = inject(Router);
  readonly rebalanceInputs = inject(RebalanceInputService);
  private readonly apiService = inject(ApiService);
  private readonly confirmation = inject(ActionConfirmationService);
  private readonly http = inject(HttpClient);
  isImportingYahooPrices = false;

  async importYahooPrices(event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.isAdmin || this.isImportingYahooPrices) return;
    this.confirmation.ask('Aggiornare tutte le quotazioni?', 'Aggiorna', () => this.executeYahooPricesUpdate());
  }

  private async executeYahooPricesUpdate(): Promise<void> {
    if (this.isImportingYahooPrices) return;
    this.isImportingYahooPrices = true;
    try {
      const result = await firstValueFrom(this.http.post<any>(environment.apiUrl + '/yahoo-finance/update-quotations', {}));
      console.info('[Yahoo import]', result);
      this.confirmation.notify('Aggiornamento quotazioni: ' + (result.inserted ?? 0) + ' inserite, ' + (result.updatedToday ?? 0) + ' aggiornate, ' + (result.existing ?? 0) + ' già presenti, ' + (result.skippedPrices ?? 0) + ' prezzi assenti, ' + (result.failures?.length ?? 0) + ' errori, ' + (result.rejectedPrices?.length ?? 0) + ' prezzi anomali rifiutati.', (result.failures?.length ?? 0) > 0 || (result.rejectedPrices?.length ?? 0) > 0 || result.success === false);
    } catch (error: any) {
      console.error('[Yahoo import]', error);
      this.confirmation.notify('Importazione Yahoo non riuscita: ' + (error?.error?.error || error?.message || 'errore sconosciuto'), true);
    } finally {
      this.isImportingYahooPrices = false;
    }
  }

  private readonly portfolioSelection = inject(PortfolioSelectionService);

  get showFeatureSidebar(): boolean { return this.featureRoutes.some(path => this.router.url.startsWith(path)); }
  get isAdmin(): boolean { return this.loggedUsername !== '' && localStorage.getItem('investmentLabRole') === 'ADMIN'; }
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
      ? Math.max(1, this.marketUniverseGenerationProgress)
      : (this.activeFeaturePage?.headerActionProgress ?? 0);
  }
  get isRebalancePage(): boolean { return this.router.url.startsWith('/ribilanciamento'); }
  private get isMonteCarloPage(): boolean { return this.router.url.startsWith('/monte-carlo'); }
  runFeatureAction(): void { this.activeFeaturePage?.runHeaderAction?.(); }
  get secondaryFeatureActionLabel(): string { return this.activeFeaturePage?.secondaryHeaderActionLabel ?? ''; }
  get secondaryFeatureActionIcon(): string { return this.activeFeaturePage?.secondaryHeaderActionIcon ?? ''; }
  get secondaryFeatureActionDisabled(): boolean { return this.activeFeaturePage?.secondaryHeaderActionDisabled ?? false; }
  get secondaryFeatureActionRunning(): boolean { return this.activeFeaturePage?.secondaryHeaderActionRunning ?? false; }
  runSecondaryFeatureAction(): void { this.activeFeaturePage?.runSecondaryHeaderAction?.(); }

  profileMenuOpen = false;
  isRegeneratingMarketUniverse = false;
  marketUniverseGenerationProgress = 0;
  private marketUniversePollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private marketUniversePolling = false;
  private pendingMarketUniverseRunId: string | null = null;

  private pushMarketUniverseStatusToActivePage(): void {
    this.activeFeaturePage?.setMarketUniverseGenerationStatus?.(
      this.isRegeneratingMarketUniverse,
      this.marketUniverseGenerationProgress
    );
  }

  private applyMarketUniverseGenerationStatus(response: any): boolean {
    const data = response?.data ?? response ?? {};
    const inProgress = data?.inProgress === true;
    if (!inProgress && this.pendingMarketUniverseRunId && data?.runId === this.pendingMarketUniverseRunId) {
      const success = data?.status === 'ACTIVE';
      this.confirmation.notify(success
        ? `Market Universe generato correttamente (${data?.assetCount ?? 0} ETF).`
        : `Generazione Market Universe non riuscita (stato: ${data?.status || 'sconosciuto'}).`, !success);
      this.pendingMarketUniverseRunId = null;
    }
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
      const response = await firstValueFrom(this.apiService.getMarketUniverseV2GenerationStatus());
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
        const response = await firstValueFrom(this.apiService.getMarketUniverseV2GenerationStatus());
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
    if (!this.isAdmin || this.isRegeneratingMarketUniverse) {
      return;
    }

    this.profileMenuOpen = false;
    this.confirmation.ask('Generare nuovamente il Market Universe?', 'Genera', () => this.executeMarketUniverseRegeneration());
  }

  private async executeMarketUniverseRegeneration(): Promise<void> {
    if (!this.isAdmin || this.isRegeneratingMarketUniverse) return;
    this.isRegeneratingMarketUniverse = true;
    this.marketUniverseGenerationProgress = 0;
    this.pushMarketUniverseStatusToActivePage();
    this.profileMenuOpen = false;

    try {
      // The regeneration endpoint acknowledges the background job immediately.
      // Keep the UI locked locally and start polling only after that acknowledgement,
      // when the GENERATING state is already persisted.
      const response = await firstValueFrom(this.apiService.regenerateMarketUniverseV2());
      const payload = response?.data ?? response;
      if (payload?.success === false) {
        throw new Error(payload?.error || 'Market Universe regeneration failed');
      }

      this.pendingMarketUniverseRunId = String(payload?.runId || '') || null;
      this.startMarketUniversePolling();
    } catch (error: any) {
      console.error('Errore nella rigenerazione del Market Universe', error);
      this.pendingMarketUniverseRunId = null;
      this.confirmation.notify('Generazione Market Universe non avviata: ' + (error?.error?.error || error?.message || 'errore sconosciuto'), true);
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
      localStorage.removeItem('investmentLabRole');
      sessionStorage.clear();
    } catch {}

    void this.router.navigateByUrl('/login');
  }
}
