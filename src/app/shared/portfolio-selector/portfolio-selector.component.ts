import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, computed, inject } from '@angular/core';
import { PortfolioSelectionService } from '../../core/services/portfolio-selection.service';

@Component({
  selector: 'app-portfolio-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './portfolio-selector.component.html',
  styleUrls: ['./portfolio-selector.component.css']
})
export class PortfolioSelectorComponent {
  private readonly portfolioSelectionService = inject(PortfolioSelectionService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly options = this.portfolioSelectionService.portfolioOptions;
  readonly selectedPortfolio = this.portfolioSelectionService.selectedPortfolio;
  readonly loading = this.portfolioSelectionService.loading;
  readonly hasError = this.portfolioSelectionService.hasError;
  readonly selectedLabel = computed(() => this.selectedPortfolio()?.label ?? 'Seleziona portafoglio');
  readonly triggerPlaceholder = 'Seleziona portafoglio';

  isOpen = false;

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
    this.portfolioSelectionService.setSelectedPortfolio(portfolioId);
    this.isOpen = false;
  }
}
