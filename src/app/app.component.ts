import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PortafoliPageComponent } from './features/portafogli/portafogli-page.component';
import { CorrelationsPageComponent } from './features/correlations/correlations-page.component';
import { MontecarloNewPageComponent } from './features/montecarlo/montecarlo-new-page.component';
import { MontecarloValidationPageComponent } from './features/montecarlo/montecarlo-validation-page.component';
import { BacktestingPageComponent } from './features/backtesting/backtesting-page.component';
import { NewEtfPageComponent } from './features/new-etf/new-etf-page.component';
import { SettingsPageComponent } from './features/settings/settings-page.component';
import { QuotazioniPageComponent } from './features/quotazioni/quotazioni-page.component';
import { AppIcons } from './shared/design-system';

type NavItemId = 'portafogli' | 'quotazioni' | 'correlations' | 'montecarlo' | 'montecarlo-validation' | 'backtesting' | 'new-etf' | 'settings';

interface NavItem {
  id: NavItemId;
  label: string;
  description: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, PortafoliPageComponent, CorrelationsPageComponent, MontecarloNewPageComponent, MontecarloValidationPageComponent, BacktestingPageComponent, NewEtfPageComponent, SettingsPageComponent, QuotazioniPageComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  readonly navItems: NavItem[] = [
    { id: 'portafogli', label: 'Portafogli', description: 'Gestione portafogli', icon: AppIcons.portfolio },
    { id: 'quotazioni', label: 'Quotazioni', description: 'Prezzi giornalieri', icon: AppIcons.quotations },
    { id: 'correlations', label: 'Correlazioni', description: 'Analisi di rischio', icon: AppIcons.correlations },
    { id: 'montecarlo', label: 'Montecarlo', description: 'Flusso simulazioni', icon: AppIcons.monteCarlo },
    { id: 'montecarlo-validation', label: 'Montecarlo Validation', description: 'DEV / Step 11 browser gate', icon: AppIcons.monteCarlo },
    { id: 'backtesting', label: 'Backtesting', description: 'Storico e test', icon: AppIcons.backtesting },
    { id: 'new-etf', label: 'Nuovo ETF', description: 'Aggiungi strumenti', icon: AppIcons.newEtf },
    { id: 'settings', label: 'Impostazioni', description: 'Preferenze e regole', icon: AppIcons.settings }
  ];

  activePage = signal<NavItemId>('montecarlo');

  selectPage(id: NavItemId): void {
    this.activePage.set(id);
  }

  activeLabel(): string {
    const item = [...this.navItems].find(entry => entry.id === this.activePage());
    return item?.label ?? 'Portafogli';
  }
}
