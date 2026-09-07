import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dialog-input',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dialog-input.component.html',
  styleUrls: ['./dialog-input.component.css']
})
export class DialogInputComponent {
  @Input() visible = false;
  @Input() message = '';
  @Input() value = '';
  @Input() placeholder = '';
  @Input() confirmLabel = 'Conferma';
  @Input() cancelLabel = 'Annulla';
  @Input() confirmDisabled = false;

  @Output() valueChange = new EventEmitter<string>();
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  onOverlayClick(): void {
    this.cancel.emit();
  }

  onDialogClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  onInput(value: string): void {
    this.valueChange.emit(value);
  }

  onConfirm(): void {
    if (!this.confirmDisabled) {
      this.confirm.emit();
    }
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
