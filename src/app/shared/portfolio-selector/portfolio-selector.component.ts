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
  @Input() mode: 'reale' | 'laboratorio' = 'reale';
  @Input() showLabel = true;
  private readonly portfolioSelectionService = inject(PortfolioSelectionService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly currentUrl = signal(this.router.url);

  readonly options = this.portfolioSelectionService.portfolioOptions;
  readonly realOptions = computed(() => this.options().filter((option) => option.tipo === 'reale'));
  readonly laboratoryOptions = computed(() => this.options().filter((option) => option.tipo === 'laboratorio'));
  readonly realOnly = computed(() => this.mode === 'reale');
  readonly selectedPortfolio = this.portfolioSelectionService.selectedPortfolio;
  readonly visibleSelectedPortfolio = computed(() => {
    const selected = this.selectedPortfolio();
    const expected = this.mode;
    if (expected === 'reale') return selected?.tipo === 'reale' ? selected : null;
    // The simulated target is independent of the real portfolio in the navbar. // A simulated selection is hidden in the global navbar.
    const rememberedId = this.portfolioSelectionService.lastLaboratoryPortfolioId();
    return this.options().find(option => option.id === rememberedId && option.tipo === expected) ?? null;
  });
  readonly loading = this.portfolioSelectionService.loading;
  readonly hasError = this.portfolioSelectionService.hasError;
  readonly selectedLabel = computed(() => this.visibleSelectedPortfolio()?.label ?? 'Seleziona portafoglio');
  readonly triggerPlaceholder = 'Seleziona portafoglio';

  isOpen = false;

  constructor() {
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      this.currentUrl.set(event.urlAfterRedirects);
    });
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
    if (this.mode === 'laboratorio') {
      this.portfolioSelectionService.lastLaboratoryPortfolioId.set(portfolioId);
    } else {
      this.portfolioSelectionService.setSelectedPortfolio(portfolioId);
    }
    this.isOpen = false;
  }
}
