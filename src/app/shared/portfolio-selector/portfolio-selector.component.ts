import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, Input, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';

@Component({
  selector: 'app-portfolio-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './portfolio-selector.component.html',
  styleUrls: ['./portfolio-selector.component.css']
})
export class PortfolioSelectorComponent {
  @Input() mode: 'reale' | 'laboratorio' | 'auto' = 'auto';
  @Input() showLabel = true;
  private readonly portfolioSelectionService = inject(PortfolioSelectionService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly currentUrl = signal(this.router.url);

  readonly options = this.portfolioSelectionService.portfolioOptions;
  readonly realOptions = computed(() => this.options().filter((option) => option.tipo === 'reale'));
  readonly laboratoryOptions = computed(() => this.options().filter((option) => option.tipo === 'laboratorio'));
  readonly effectiveMode = computed((): 'reale' | 'laboratorio' | 'all' => {
    if (this.mode !== 'auto') return this.mode;
    const url = this.currentUrl();
    return url.startsWith('/portafogli') || url.startsWith('/ribilanciamento') || url.startsWith('/trend-following') ? 'reale' : 'all';
  });
  readonly visibleOptions = computed(() => this.effectiveMode() === 'reale' ? this.realOptions() : this.effectiveMode() === 'laboratorio' ? this.laboratoryOptions() : this.options());
  readonly selectedPortfolio = this.portfolioSelectionService.selectedPortfolio;
  readonly visibleSelectedPortfolio = computed(() => {
    const selected = this.selectedPortfolio();
    const mode = this.effectiveMode();
    if (mode === 'laboratorio') {
      const id = this.portfolioSelectionService.lastLaboratoryPortfolioId();
      return this.laboratoryOptions().find(option => option.id === id) ?? null;
    }
    if (mode === 'reale') {
      if (selected?.tipo === 'reale') return this.realOptions().find(option => option.id === selected.id) ?? null;
      const lastRealId = this.portfolioSelectionService.lastRealPortfolioId();
      return this.realOptions().find(option => option.id === lastRealId) ?? null;
    }
    // Restore the last globally selected portfolio when the route allows both types.
    return selected;
  });
  readonly loading = this.portfolioSelectionService.loading;
  readonly hasError = this.portfolioSelectionService.hasError;
  readonly selectedLabel = computed(() => this.visibleSelectedPortfolio()?.label ?? 'Seleziona portafoglio');
  readonly triggerPlaceholder = 'Seleziona portafoglio';

  isOpen = false;

  constructor() {
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      this.currentUrl.set(event.urlAfterRedirects);
      this.restoreRealSelectionForTrend();
    });
  }

  private restoreRealSelectionForTrend(): void {
    if (!this.currentUrl().startsWith('/trend-following')) return;
    const selected = this.portfolioSelectionService.selectedPortfolio();
    if (selected?.tipo === 'reale') return;
    const lastId = this.portfolioSelectionService.lastRealPortfolioId();
    const lastReal = this.realOptions().find(option => option.id === lastId);
    if (lastReal) this.portfolioSelectionService.setSelectedPortfolio(lastReal.id);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;

    if (!this.elementRef.nativeElement.contains(target)) {
      this.isOpen = false;
    }
  }

  toggle(): void {
    if (this.loading() || this.hasError()) {
      return;
    }

    this.isOpen = !this.isOpen;
  }

  selectPortfolio(portfolioId: string | null): void {
    if (this.effectiveMode() === 'laboratorio') {
      this.portfolioSelectionService.lastLaboratoryPortfolioId.set(portfolioId);
    } else {
      this.portfolioSelectionService.setSelectedPortfolio(portfolioId);
    }
    this.isOpen = false;
  }
}
