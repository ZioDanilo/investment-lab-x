import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Etf, EtfMacroStatistics } from '../../core/models/etf.model';
import { PortfolioStateService } from '../../core/services/portfolio-state.service';
import { CalibrationService } from '../../core/services/calibration.service';

interface EtfDetailView {
  etf?: Etf;
  loading: boolean;
  error?: string;
  calibrating: boolean;
  calibrationDelta?: number;
  calibrationStatus?: string;
}

@Component({
  selector: 'app-etf-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './etf-detail.component.html',
  styleUrls: ['./etf-detail.component.css']
})
export class EtfDetailComponent implements OnInit {
  readonly state = signal<EtfDetailView>({
    loading: true,
    calibrating: false
  });

  readonly expandedScenarios = signal<boolean>(false);
  readonly Math = Math; // Expose Math for template

  constructor(
    private route: ActivatedRoute,
    private portfolio: PortfolioStateService,
    private calibration: CalibrationService
  ) {}

  ngOnInit(): void {
    const isin = this.route.snapshot.paramMap.get('isin');
    if (!isin) {
      this.state.update(s => ({ ...s, error: 'ISIN not provided', loading: false }));
      return;
    }

    this.loadEtfDetail(isin);
  }

  private loadEtfDetail(isin: string): void {
    const etfs = this.portfolio.etfs();
    const etf = etfs.find(e => e.isin === isin);

    if (!etf) {
      this.state.update(s => ({
        ...s,
        error: `ETF ${isin} not found`,
        loading: false
      }));
      return;
    }

    this.state.update(s => ({
      ...s,
      etf,
      loading: false,
      calibrationStatus: this.getCalibrationStatus(etf)
    }));
  }

  private getCalibrationStatus(etf: Etf): string {
    if (!etf.calibratedAt) {
      return 'NOT CALIBRATED';
    }

    if (!etf.lastCalibrationMedianCagr || !etf.longTermExpectedReturn) {
      return 'INCOMPLETE DATA';
    }

    const delta = etf.lastCalibrationMedianCagr - etf.longTermExpectedReturn;
    const deltaPercent = (delta * 100).toFixed(3);

    if (Math.abs(delta) < 0.002) {
      return `✅ CALIBRATED (Δ = ${deltaPercent}%)`;
    }

    return `⚠ OUT OF TOLERANCE (Δ = ${deltaPercent}%)`;
  }

  getScenarioName(scenario: string): string {
    const names: { [key: string]: string } = {
      expansion: 'Expansion',
      soft_landing: 'Soft Landing',
      recession: 'Recession',
      stagflation: 'Stagflation'
    };
    return names[scenario] || scenario;
  }

  getScenarioExpectedReturn(stats: any, scenario: string): number | null {
    return stats?.[scenario]?.expectedReturn || null;
  }

  onCalibrate(): void {
    const etf = this.state().etf;
    if (!etf || !etf.longTermExpectedReturn) {
      this.state.update(s => ({
        ...s,
        error: 'ETF or longTermExpectedReturn not available'
      }));
      return;
    }

    this.state.update(s => ({ ...s, calibrating: true, error: undefined }));

    this.calibration.calibrateETF(etf.isin, etf.longTermExpectedReturn).subscribe({
      next: (response) => {
        if (response.success) {
          console.log('✅ Calibration succeeded:', response.data);
          // Reload ETF data
          this.loadEtfDetail(etf.isin);
        } else {
          this.state.update(s => ({
            ...s,
            error: response.message || 'Calibration failed',
            calibrating: false
          }));
        }
      },
      error: (err) => {
        console.error('❌ Calibration error:', err);
        this.state.update(s => ({
          ...s,
          error: err.error?.error || 'Calibration request failed',
          calibrating: false
        }));
      }
    });
  }

  toggleScenarios(): void {
    this.expandedScenarios.update(v => !v);
  }

  computeCalibrationDelta(): number | null {
    const etf = this.state().etf;
    if (!etf || !etf.lastCalibrationMedianCagr || !etf.longTermExpectedReturn) {
      return null;
    }
    return etf.lastCalibrationMedianCagr - etf.longTermExpectedReturn;
  }
}
