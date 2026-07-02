import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-correlations-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './correlations-page.component.html',
  styleUrls: ['./correlations-page.component.css']
})
export class CorrelationsPageComponent {
  readonly assets = [
    'MSCI World',
    'Momentum',
    'Quality',
    'Minimum Volatility',
    'Healthcare',
    'Consumer Staples',
    'MSCI World Small Cap',
    'Gov Bonds EU 1-3Y',
    'Gov Bonds EU 7-10Y',
    'Corporate Bond EUR 3-5Y',
    'Inflation Linked Bonds',
    'Inflation Expectations 2-10Y',
    'Gold',
    'Commodities',
    'Overnight / Cash'
  ];

  readonly matrix = [
    [1, 0.9, 0.92, 0.8, 0.85, 0.75, 0.88, -0.1, -0.25, -0.2, -0.1, 0, -0.05, 0.3, 0],
    [0.9, 1, 0.8, 0.6, 0.75, 0.55, 0.82, -0.1, -0.25, -0.2, -0.1, 0.05, 0.2, 0.35, 0],
    [0.92, 0.8, 1, 0.7, 0.85, 0.8, 0.78, -0.1, -0.25, -0.2, -0.1, 0.05, 0.1, 0.2, 0],
    [0.8, 0.6, 0.7, 1, 0.75, 0.55, 0.65, -0.1, -0.25, -0.2, -0.1, 0.1, 0.15, 0.1, 0],
    [0.85, 0.75, 0.85, 0.75, 1, 0.8, 0.65, -0.1, -0.25, -0.2, -0.1, 0.15, 0.2, 0.1, 0],
    [0.75, 0.55, 0.8, 0.55, 0.8, 1, 0.5, -0.1, -0.25, -0.2, -0.1, 0.15, 0.1, 0, 0],
    [0.88, 0.82, 0.78, 0.65, 0.65, 0.5, 1, -0.05, -0.25, -0.2, -0.1, 0.35, 0.2, 0.35, 0],
    [-0.1, -0.1, -0.1, -0.1, -0.1, -0.1, -0.05, 1, 0.4, 0.5, 0.25, 0.1, 0.2, 0.1, 0],
    [-0.25, -0.25, -0.25, -0.25, -0.25, -0.25, -0.25, 0.4, 1, 0.45, 0.2, 0.1, 0.1, 0, 0],
    [-0.2, -0.2, -0.2, -0.2, -0.2, -0.2, -0.2, 0.5, 0.45, 1, 0.2, 0.05, 0.05, 0.1, 0],
    [-0.1, -0.1, -0.1, -0.1, -0.1, -0.1, -0.1, 0.25, 0.2, 0.2, 1, 0.6, 0.25, 0.1, 0],
    [-0.05, -0.05, -0.05, -0.05, -0.05, -0.05, 0.35, 0.1, 0.1, 0.05, 0.6, 1, 0.45, 0.2, 0],
    [0, 0.05, 0.05, 0.1, 0.1, 0.15, 0.2, 0.2, 0.1, 0.05, 0.25, 0.45, 1, 0.2, 0],
    [0.3, 0.35, 0.2, 0.15, 0.1, 0, 0.35, 0.1, 0, 0.1, 0.25, 0.2, 0.2, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
  ];

  displayValue(value: number): string {
    return value.toFixed(2).replace('.', ',');
  }
}
