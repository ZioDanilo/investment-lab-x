import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-money-input',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="money-field"><input type="number" inputmode="decimal" min="0" step="0.01" [attr.aria-label]="label" [value]="value" (input)="valueChange.emit($any($event.target).value)" /><span>€</span></div>`,
  styles: [`
    :host{display:inline-flex;min-width:0}
    .money-field{display:flex;align-items:center;height:38px;width:100%;min-width:0;border:1px solid rgba(133,176,226,.24);border-radius:10px;background:rgba(12,18,26,.72);color:#edf6ff;box-sizing:border-box}
    .money-field:focus-within{border-color:rgba(108,201,255,.65);box-shadow:0 0 0 2px rgba(108,201,255,.1)}
    input{min-width:0;width:100%;height:100%;padding:0 10px 0 14px;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:.82rem;font-weight:700}
    .money-field span{padding:0 12px 0 4px;color:rgba(191,214,235,.8);font-size:.82rem}
  `]
})
export class MoneyInputComponent {
  @Input() label = 'Importo';
  @Input() value = 0;
  @Output() valueChange = new EventEmitter<string>();
}
