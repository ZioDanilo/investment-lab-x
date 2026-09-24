import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface NavItem {
  label: string;
  icon: string;
  active?: boolean;
}

interface ShortcutCard {
  title: string;
  description: string;
  accent: string;
  icon: string;
}

interface PortfolioRow {
  name: string;
  modified: string;
  etfCount: number;
  expectedReturn: string;
  volatility: string;
  positive: boolean;
}

interface SummaryMetric {
  value: string;
  label: string;
  icon: string;
  tone: string;
}

interface AssetLegend {
  label: string;
  value: string;
  color: string;
}

interface ScenarioCard {
  name: string;
  returnValue: string;
  drawdown: string;
  tone: string;
  returnClass: string;
  drawdownClass: string;
}

interface ActivityItem {
  label: string;
  detail: string;
  date: string;
  icon: string;
}

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.css']
})
export class HomePageComponent {
  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home', active: true },
    { label: 'Laboratorio Portafogli', icon: 'science' },
    { label: 'Portafogli', icon: 'folder' },
    { label: 'Monte Carlo', icon: 'query_stats' },
    { label: 'Ribilanciamento', icon: 'sync' },
    { label: 'ETF & Mercati', icon: 'bar_chart' }
  ];

  readonly shortcuts: ShortcutCard[] = [
    { title: 'Laboratorio Portafogli', description: 'Costruisci e analizza nuovi portafogli con dati ADB.', accent: 'blue', icon: 'science' },
    { title: 'I tuoi Portafogli', description: 'Gestisci, confronta e modifica i portafogli salvati.', accent: 'purple', icon: 'folder' },
    { title: 'Monte Carlo', description: 'Simulazioni avanzate sui portafogli selezionati.', accent: 'green', icon: 'trending_up' },
    { title: 'Ribilanciamento', description: 'Calcola e pianifica le operazioni di ribilanciamento.', accent: 'amber', icon: 'sync' },
    { title: 'ETF & Mercati', description: 'Gestisci il database ETF e consulta le quotazioni interne.', accent: 'cyan', icon: 'bar_chart' },
    { title: 'Nuovo ETF', description: 'Aggiungi un nuovo ETF al database di Investment Lab.', accent: 'blue', icon: 'add' }
  ];

  readonly portfolios: PortfolioRow[] = [
    { name: 'All Weather v6', modified: '12/12/2024', etfCount: 8, expectedReturn: '7,8%', volatility: '10,2%', positive: true },
    { name: 'Global Growth', modified: '10/12/2024', etfCount: 6, expectedReturn: '9,1%', volatility: '14,3%', positive: true },
    { name: 'Conservative Income', modified: '08/12/2024', etfCount: 7, expectedReturn: '5,2%', volatility: '6,8%', positive: true },
    { name: 'Europa Focus', modified: '05/12/2024', etfCount: 5, expectedReturn: '6,4%', volatility: '11,1%', positive: true },
    { name: 'Innovazione 2030', modified: '02/12/2024', etfCount: 9, expectedReturn: '10,8%', volatility: '16,5%', positive: true }
  ];

  readonly summaryMetrics: SummaryMetric[] = [
    { value: '5', label: 'Portafogli salvati', icon: 'folder', tone: 'blue' },
    { value: '8,6%', label: 'Rendimento medio atteso', icon: 'show_chart', tone: 'cyan' },
    { value: '10,2%', label: 'Volatilità media', icon: 'signal_cellular_alt', tone: 'purple' },
    { value: '-18,4%', label: 'Drawdown medio', icon: 'trending_down', tone: 'red' }
  ];

  readonly assetMix: AssetLegend[] = [
    { label: 'Azioni', value: '42%', color: '#66d9ff' },
    { label: 'Obbligazioni', value: '28%', color: '#3f8efc' },
    { label: 'Materie prime', value: '12%', color: '#f9c74f' },
    { label: 'Real Estate', value: '8%', color: '#8c7ae6' },
    { label: 'Alternativi', value: '6%', color: '#8fe3d4' },
    { label: 'Valute', value: '4%', color: '#e2718c' }
  ];

  readonly scenarios: ScenarioCard[] = [
    { name: 'Espansione', returnValue: '+7,2%', drawdown: '-12,4%', tone: 'green', returnClass: 'positive', drawdownClass: 'negative' },
    { name: 'Soft Landing', returnValue: '+4,8%', drawdown: '-10,1%', tone: 'blue', returnClass: 'positive', drawdownClass: 'negative' },
    { name: 'Recessione', returnValue: '-2,1%', drawdown: '-28,6%', tone: 'red', returnClass: 'negative', drawdownClass: 'negative' },
    { name: 'Stagflazione', returnValue: '+1,4%', drawdown: '-22,3%', tone: 'amber', returnClass: 'positive', drawdownClass: 'negative' }
  ];

  readonly activity: ActivityItem[] = [
    { label: 'Portafoglio modificato', detail: 'All Weather v6', date: '12/12/2024, 16:42', icon: 'edit_document' },
    { label: 'Nuovo ETF aggiunto', detail: 'Vanguard LifeStrategy 80', date: '12/12/2024, 11:18', icon: 'add_circle' },
    { label: 'Simulazione completata', detail: 'Global Growth (10.000 iterazioni)', date: '11/12/2024, 18:05', icon: 'check_circle' },
    { label: 'Ribilanciamento calcolato', detail: 'Conservative Income', date: '10/12/2024, 14:23', icon: 'calculate' }
  ];
}
