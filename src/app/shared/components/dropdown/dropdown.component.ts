import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output, inject, signal } from '@angular/core';

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

@Component({
  selector: 'app-dropdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dropdown.component.html',
  styleUrls: ['./dropdown.component.css']
})
export class DropdownComponent {
  private elementRef = inject(ElementRef<HTMLElement>);

  @Input() items: DropdownOption[] = [];
  @Input() mode: 'select' | 'autocomplete' = 'select';
  @Input() value: string | null = null;
  @Input() query = '';
  @Input() placeholder = 'Seleziona';
  @Input() emptyText = 'Nessun risultato';
  @Input() loadingText = 'Caricamento...';
  @Input() disabled = false;
  @Input() loading = false;
  @Input() minQueryLength = 0;

  @Output() valueChange = new EventEmitter<string>();
  @Output() queryChange = new EventEmitter<string>();

  readonly isOpen = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  toggle(): void {
    if (this.disabled) return;
    this.isOpen.update((open) => !open);
  }

  open(): void {
    if (this.disabled) return;
    if (this.mode === 'autocomplete' && this.query.trim().length < this.minQueryLength && !this.loading && this.items.length === 0) {
      return;
    }
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  onInput(event: Event): void {
    const nextQuery = (event.target as HTMLInputElement | null)?.value ?? '';
    this.queryChange.emit(nextQuery);

    if (nextQuery.trim().length >= this.minQueryLength || this.loading) {
      this.isOpen.set(true);
      return;
    }

    this.close();
  }

  onInputFocus(): void {
    if (this.query.trim().length >= this.minQueryLength || this.items.length > 0 || this.loading) {
      this.open();
    }
  }

  selectItem(item: DropdownOption): void {
    if (item.disabled) return;

    this.valueChange.emit(item.value);
    this.close();
  }

  selectedLabel(): string {
    return this.items.find((item) => item.value === this.value)?.label ?? '';
  }

  panelVisible(): boolean {
    if (!this.isOpen()) return false;
    if (this.loading) return true;
    if (this.items.length > 0) return true;
    return this.mode === 'autocomplete' && this.query.trim().length >= this.minQueryLength;
  }

  highlight(text: string | undefined): string {
    const safeText = this.escapeHtml(text ?? '');
    const term = this.escapeRegExp(this.query.trim());

    if (!term) {
      return safeText;
    }

    const pattern = new RegExp(`(${term})`, 'ig');
    return safeText.replace(pattern, '<span class="dropdown-highlight">$1</span>');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}