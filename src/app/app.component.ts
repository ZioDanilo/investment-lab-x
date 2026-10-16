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
  chooseAnalytics(accepted: boolean): void { this.analytics.setConsent(accepted); }
}
