import { Component } from '@angular/core';
import { CommonModule, PercentPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { KpiName } from '../../core/models/kpi.model';
import { PortfolioStateService } from '../../core/services/portfolio-state.service';

@Component({
  selector: 'app-control-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, PercentPipe, DecimalPipe],
  templateUrl: './control-panel.component.html'
})
export class ControlPanelComponent {
  constructor(public state: PortfolioStateService) {}

  formatKpi(name: string, value: number): string {
    if (['Rendimento atteso','Volatilità','Max Drawdown','Recessione','Stagflazione','TER medio'].includes(name)) {
      return `${(value * 100).toFixed(2)}%`;
    }
    return value.toFixed(name === 'Numero ETF' ? 0 : 2);
  }

  kpiStatus(name: string, target: number, direction: 'higher'|'lower'|'range'): 'OK'|'KO' {
    const actual = this.state.kpiValues()[name];
    return direction === 'higher' ? (actual >= target ? 'OK' : 'KO') : (actual <= target ? 'OK' : 'KO');
  }

  scoreClass(score: number): string {
    if (score >= 70) return 'green';
    if (score >= 40) return 'yellow';
    return 'red';
  }

  runSimulation(): void {
    this.state.runMonteCarloSimulation();
  }

  resetKpis(): void {
    this.state.resetKpis();
  }

  updateKpiName(index: number, name: KpiName): void {
    this.state.updateKpiName(index, name);
  }

  updateKpiTarget(index: number, value: string, name: string): void {
    this.state.updateKpiTarget(index, this.parseKpiTargetValue(name, value));
  }

  getAvailableKpiNames(index: number): KpiName[] {
    return this.state.availableKpiNames(index);
  }

  getKpiTargetInputValue(name: string, target: number): string {
    if (this.isPercentKpi(name)) {
      return `${Math.abs(target) * 100}`;
    }
    return target.toString();
  }

  private parseKpiTargetValue(name: string, value: string): number {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return 0;
    }

    if (this.isPercentKpi(name)) {
      return name === 'Max Drawdown' ? -Math.abs(parsed) / 100 : parsed / 100;
    }

    return parsed;
  }

  private isPercentKpi(name: string): boolean {
    return ['Rendimento atteso', 'Volatilità', 'Max Drawdown', 'Recessione', 'Stagflazione', 'TER medio'].includes(name);
  }
}
