import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-money-input',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="money-field"><input type="text" inputmode="decimal" [attr.aria-label]="label" [value]="draftValue" (keydown)="onKeydown($event)" (input)="onInput($any($event.target).value)" (blur)="onBlur()" /><span>€</span></div>`,
  styles: [`
    :host{display:inline-flex;min-width:0}
    .money-field{display:flex;align-items:center;height:38px;width:100%;min-width:0;border:1px solid rgba(133,176,226,.24);border-radius:10px;background:rgba(12,18,26,.72);color:#edf6ff;box-sizing:border-box}
    .money-field:focus-within{border-color:rgba(108,201,255,.65);box-shadow:0 0 0 2px rgba(108,201,255,.1)}
    input{min-width:0;width:100%;height:100%;padding:0 10px 0 14px;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:.82rem;font-weight:700}
    .money-field span{padding:0 12px 0 4px;color:rgba(191,214,235,.8);font-size:.82rem}
  `]
})
export class MoneyInputComponent implements OnChanges {
  @Input() label = 'Importo';
  @Input() value = 0;
  @Output() valueChange = new EventEmitter<string>();
  draftValue = '0';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && this.draftValue !== '-' && this.draftValue !== '') {
      this.draftValue = String(this.value);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (event.key === '-' && (input.value === '0' || input.value === '')) {
      event.preventDefault();
      this.draftValue = '-';
      input.value = '-';
      this.valueChange.emit('-');
    }
  }

  onInput(raw: string): void {
    const normalized = raw.replace(',', '.');
    if (!/^-?\\d*(?:\\.\\d*)?$/.test(normalized)) return;
    this.draftValue = raw;
    this.valueChange.emit(normalized);
  }

  onBlur(): void {
    if (this.draftValue === '-' || this.draftValue === '') this.draftValue = String(this.value);
  }
}
