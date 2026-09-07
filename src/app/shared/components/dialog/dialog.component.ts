import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dialog.component.html',
  styleUrls: ['./dialog.component.css']
})
export class DialogComponent {
  message = signal<string>('');
  isVisible = signal<boolean>(false);
  private onConfirm: (() => void) | null = null;

  show(message: string, onConfirmCallback?: () => void) {
    this.message.set(message);
    this.onConfirm = onConfirmCallback || null;
    this.isVisible.set(true);
  }

  confirm() {
    this.isVisible.set(false);
    if (this.onConfirm) {
      this.onConfirm();
    }
  }

  cancel() {
    this.isVisible.set(false);
  }
}
