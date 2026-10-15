import { Injectable, signal } from '@angular/core';

export interface ConfirmationRequest {
  title: string;
  confirmLabel: string;
  action: () => void | Promise<void>;
  acknowledgeOnly?: boolean;
  isError?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ActionConfirmationService {
  readonly pending = signal<ConfirmationRequest | null>(null);

  ask(title: string, confirmLabel: string, action: () => void | Promise<void>): void {
    this.pending.set({ title, confirmLabel, action });
  }

  notify(message: string, isError = false, onAcknowledge: () => void = () => {}): void {
    this.pending.set({ title: message, confirmLabel: 'OK', action: onAcknowledge, acknowledgeOnly: true, isError });
  }

  cancel(): void { this.pending.set(null); }

  confirm(): void {
    const request = this.pending();
    if (!request) return;
    this.pending.set(null);
    void request.action();
  }
}
