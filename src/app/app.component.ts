import { Component, inject, OnInit } from '@angular/core';
import { AnalyticsService } from './core/services/analytics.service';
import { RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, CommonModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  preferencesOpen = false;
  readonly analytics = inject(AnalyticsService);
  ngOnInit(): void { this.analytics.start(); }
  chooseAnalytics(accepted: boolean): void { this.analytics.setConsent(accepted); this.preferencesOpen = false; }
  openPreferences(): void { this.preferencesOpen = true; }
}
