import { Injectable, signal } from '@angular/core';

/** Notifies active views about successful quotation updates. */
@Injectable({ providedIn: 'root' })
export class QuotationsUpdatedService {
  readonly version = signal(0);
  private reloadPending = false;

  publish(): void {
    this.version.update(value => value + 1);
    // Real portfolios refreshes its data, calculations and charts reactively;
    // reloading here would discard the selected portfolio and current view.
    if (window.location.pathname.startsWith('/portafogli')) return;
    // Other routes retain their existing full-refresh behavior.
    // Coalesce multiple successful updates into one reload and let progress UI finish.
    if (this.reloadPending) return;
    this.reloadPending = true;
    setTimeout(() => window.location.reload(), 1200);
  }
}
