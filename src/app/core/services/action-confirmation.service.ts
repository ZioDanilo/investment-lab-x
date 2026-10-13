import { Injectable, signal } from '@angular/core';

export interface ConfirmationRequest {
  title: string;
  confirmLabel: string;
  action: () => void | Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class ActionConfirmationService {
  readonly pending = signal<ConfirmationRequest | null>(null);

  ask(title: string, confirmLabel: string, action: () => void | Promise<void>): void {
    this.pending.set({ title, confirmLabel, action });
  }

  cancel(): void { this.pending.set(null); }

  confirm(): void {
    const request = this.pending();
    if (!request) return;
    this.pending.set(null);
    void request.action();
  }
}
