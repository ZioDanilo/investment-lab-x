import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RebalanceInputService {
  readonly cashToAdd = signal(0);
  setCash(value: string): void {
    const amount = Number(value);
    this.cashToAdd.set(Number.isFinite(amount) ? amount : 0);
  }
}
