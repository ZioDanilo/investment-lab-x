import { Injectable, signal } from '@angular/core';

/** Broadcasts successful quotation writes so active views reload DB-derived values. */
@Injectable({ providedIn: 'root' })
export class QuotationsUpdatedService {
  readonly version = signal(0);
  publish(): void { this.version.update(value => value + 1); }
}
