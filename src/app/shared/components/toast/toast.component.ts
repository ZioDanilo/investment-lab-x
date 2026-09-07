import { Component, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.component.html',
  styleUrls: ['./toast.component.css']
})
export class ToastComponent {
  message = signal('');
  isVisible = signal(false);
  private hideTimeout: any;

  constructor() {
    effect(() => {
      if (this.isVisible()) {
        // Auto-hide after 3 seconds
        if (this.hideTimeout) {
          clearTimeout(this.hideTimeout);
        }
        this.hideTimeout = setTimeout(() => {
          this.hide();
        }, 3000);
      }
    });
  }

  show(msg: string) {
    this.message.set(msg);
    this.isVisible.set(true);
  }

  hide() {
    this.isVisible.set(false);
  }
}
