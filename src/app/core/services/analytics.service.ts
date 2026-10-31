import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../../environments/environment';

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; }
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly router = inject(Router);
  private initialized = false;
  private readonly measurementId = (environment as { gaMeasurementId?: string }).gaMeasurementId ?? '';
  private readonly consentKey = 'razer-analytics-consent';

  get consent(): 'accepted' | 'rejected' | null {
    const stored = localStorage.getItem(this.consentKey);
    return stored === 'accepted' || stored === 'rejected' ? stored : null;
  }

  start(): void {
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => this.trackPage(event.urlAfterRedirects));
    if (this.consent === 'accepted') this.enable();
  }

  setConsent(accepted: boolean): void {
    localStorage.setItem(this.consentKey, accepted ? 'accepted' : 'rejected');
    if (accepted) {
      window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
      this.enable();
    }
    else {
      // Stop further events; previously loaded Google scripts cannot be fully unloaded.
      this.initialized = false;
      window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      window.location.reload();
    }
  }

  private enable(): void {
    if (this.initialized || !/^G-[A-Z0-9]+$/.test(this.measurementId)) return;
    this.initialized = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = (...args: unknown[]) => { window.dataLayer?.push(args); };
    window.gtag('consent', 'default', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', this.measurementId, { send_page_view: false });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(this.measurementId);
    document.head.appendChild(script);
    this.trackPage(this.router.url);
  }

  private trackPage(path: string): void {
    if (!this.initialized || this.consent !== 'accepted') return;
    const cleanPath = path.split('?')[0].split('#')[0];
    window.gtag?.('event', 'page_view', {
      page_path: cleanPath,
      page_location: window.location.origin + cleanPath,
      page_title: document.title
    });
  }
}
