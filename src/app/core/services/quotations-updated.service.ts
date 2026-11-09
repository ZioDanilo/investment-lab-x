import { Injectable, signal } from '@angular/core';

/** Signals successful quotation updates and fully reloads the current page afterwards. */
@Injectable({ providedIn: 'root' })
export class QuotationsUpdatedService {
  readonly version = signal(0);
  private reloadPending = false;

  publish(): void {
    this.version.update(value => value + 1);
    // A full reload ensures every widget, chart and derived calculation uses
    // the latest persisted prices, regardless of the route where refresh began.
    // Coalesce multiple successful updates into one reload and let progress UI finish.
    if (this.reloadPending) return;
    this.reloadPending = true;
    setTimeout(() => window.location.reload(), 1200);
  }
}
