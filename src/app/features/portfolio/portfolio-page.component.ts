import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioStateService } from '../../core/services/portfolio-state.service';

@Component({
  selector: 'app-portfolio-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './portfolio-page.component.html',
  styleUrls: ['./portfolio-page.component.css']
})
export class PortfolioPageComponent {
  editingValues: string[] = [];
  dragSrcIndex: number | null = null;
  kpiOrder: string[] = ['Rendimento atteso', 'Volatilità', 'Max Drawdown', 'Rientro (mesi)', 'Robustezza'];
  private editing = new Set<number>();

  constructor(public state: PortfolioStateService) {
    this.syncEditingValues();
  }

  private syncEditingValues(): void {
    const etfs = this.state.etfs();
    this.editingValues = etfs.map(e => this.formatPercent(e.weight * 100));
  }

  private formatPercent(n: number): string {
    if (!Number.isFinite(n)) return '0.00';
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  startEdit(index: number, event?: FocusEvent): void {
    this.editing.add(index);
    // initialize buffer with current value (two decimals)
    this.editingValues[index] = this.formatPercent(this.state.etfs()[index].weight * 100);
    // prevent parent handlers from stealing focus
    if (event) (event.target as HTMLElement).focus();
  }

  onEditInput(index: number, event: Event): void {
    this.editingValues[index] = (event.target as HTMLInputElement).value;
  }

  commitEdit(index: number, event?: FocusEvent): void {
    const rawValue = (this.editingValues[index] ?? '').toString().replace(',', '.').trim();
    if (rawValue === '') {
      // user left field empty: revert to current state value
      this.editingValues[index] = this.formatPercent(this.state.etfs()[index].weight * 100);
      this.editing.delete(index);
      return;
    }

    const parsed = parseFloat(rawValue.replace(/[^0-9.+-]/g, ''));
    if (Number.isNaN(parsed)) {
      // invalid input: revert
      this.editingValues[index] = this.formatPercent(this.state.etfs()[index].weight * 100);
      this.editing.delete(index);
      return;
    }

    // clamp and round to 2 decimals
    const clamped = Math.max(0, Math.min(100, Number(parsed.toFixed(2))));
    this.state.updateEtfWeight(index, clamped);
    // sync display to formatted value
    this.editingValues[index] = this.formatPercent(clamped);
    this.editing.delete(index);
  }

  get totalWeight(): number {
    return this.state.etfs().reduce((sum, etf) => sum + etf.weight, 0);
  }

  formatKpiValue(name: string, value: number, isTarget = false): string {
    if (!Number.isFinite(value)) {
      return '—';
    }

    switch (name) {
      case 'Volatilità':
      case 'Rendimento atteso':
      case 'Max Drawdown':
      case 'Recessione':
      case 'Stagflazione':
      case 'TER medio':
        return `${(value * 100).toFixed(2)}%`;
      case 'Sharpe':
      case 'PQS':
      case 'Diversificazione':
      case 'Numero ETF':
        return isTarget ? `${value}` : `${value}`;
      default:
        return `${value}`;
    }
  }

  onCardDragStart(index: number, event: DragEvent): void {
    this.dragSrcIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    event.dataTransfer?.setDragImage(event.currentTarget as HTMLElement, 0, 0);
  }

  onCardDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onCardDrop(index: number, event: DragEvent): void {
    event.preventDefault();
    const sourceIndex = this.dragSrcIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    if (sourceIndex === undefined || sourceIndex === null || sourceIndex === index) {
      this.dragSrcIndex = null;
      return;
    }

    const next = [...this.kpiOrder];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(index, 0, moved);
    this.kpiOrder = next;
    this.dragSrcIndex = null;
  }

  onCardDragEnd(): void {
    this.dragSrcIndex = null;
  }

  get weightDelta(): number {
    return 1 - this.totalWeight;
  }

  get absWeightDelta(): number {
    return Math.abs(this.weightDelta);
  }
  
  // keep editing buffer in sync if etfs change externally
  // (simple approach: called manually by callers that mutate etfs)
  public refreshBuffers(): void {
    this.syncEditingValues();
  }
}
