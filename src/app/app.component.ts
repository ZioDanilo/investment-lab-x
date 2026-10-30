import { Component, inject, OnInit } from '@angular/core';
import { AnalyticsService } from './core/services/analytics.service';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  readonly analytics = inject(AnalyticsService);
  ngOnInit(): void { this.analytics.start(); }
  openPrivacyChoices(): void {
    // Google Funding Choices is loaded by the published AdSense privacy message.
    const googleWindow = window as Window & {
      googlefc?: { callbackQueue?: Array<() => void>; showRevocationMessage?: () => void };
    };
    if (typeof googleWindow.googlefc?.showRevocationMessage === 'function') {
      googleWindow.googlefc.showRevocationMessage();
    } else {
      // Fallback: keep privacy information reachable when CMP has not loaded.
      window.location.assign('/privacy');
    }
  }
}
