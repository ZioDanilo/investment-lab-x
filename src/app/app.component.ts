import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PortfolioPageComponent } from './features/portfolio/portfolio-page.component';
import { CorrelationsPageComponent } from './features/correlations/correlations-page.component';
import { MontecarloPageComponent } from './features/montecarlo/montecarlo-page.component';
import { BacktestingPageComponent } from './features/backtesting/backtesting-page.component';
import { NewEtfPageComponent } from './features/new-etf/new-etf-page.component';
import { SettingsPageComponent } from './features/settings/settings-page.component';

type NavItemId = 'portfolio' | 'correlations' | 'montecarlo' | 'backtesting' | 'new-etf' | 'settings';

interface NavItem {
  id: NavItemId;
  label: string;
  description: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, PortfolioPageComponent, CorrelationsPageComponent, MontecarloPageComponent, BacktestingPageComponent, NewEtfPageComponent, SettingsPageComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  readonly navItems: NavItem[] = [
    { id: 'portfolio', label: 'Portafoglio', description: 'Allocazioni e performance', icon: '◌' },
    { id: 'correlations', label: 'Correlazioni', description: 'Analisi di rischio', icon: '⟡' },
    { id: 'montecarlo', label: 'Montecarlo', description: 'Simulazioni future', icon: '✦' },
    { id: 'backtesting', label: 'Backtesting', description: 'Storico e test', icon: '⚡' },
    { id: 'new-etf', label: 'Nuovo ETF', description: 'Aggiungi strumenti', icon: '＋' },
    { id: 'settings', label: 'Impostazioni', description: 'Preferenze e regole', icon: '⚙' }
  ];

  activePage = signal<NavItemId>('portfolio');

  selectPage(id: NavItemId): void {
    this.activePage.set(id);
  }

  activeLabel(): string {
    const item = [...this.navItems].find(entry => entry.id === this.activePage());
    return item?.label ?? 'Portafoglio';
  }
}
