import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';

type Scenario = 'expansion' | 'soft_landing' | 'recession' | 'stagflation';

const SCENARIO_LABELS: Record<Scenario, string> = {
  expansion: 'Espansione',
  soft_landing: 'Soft Landing',
  recession: 'Recessione',
  stagflation: 'Stagflazione'
};

interface EtfRow { isin: string; name: string; nickname?: string | null; }
interface CorrRecord { isin1: string; isin2: string; expansion: number; soft_landing: number; recession: number; stagflation: number; }

@Component({
  selector: 'app-correlations-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './correlations-page.component.html',
  styleUrls: ['./correlations-page.component.css']
})
export class CorrelationsPageComponent implements OnInit {
  readonly scenarios: Scenario[] = ['expansion', 'soft_landing', 'recession', 'stagflation'];
  readonly scenarioLabels = SCENARIO_LABELS;

  selectedScenario = signal<Scenario>('expansion');
  etfs = signal<EtfRow[]>([]);
  correlations = signal<CorrRecord[]>([]);
  loading = signal(true);
  error = signal('');

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set('');

    // Load ETFs and correlations in parallel
    let etfsLoaded = false;
    let corrLoaded = false;
    const checkDone = () => { if (etfsLoaded && corrLoaded) this.loading.set(false); };

    this.api.getAllEtfs().subscribe({
      next: (res: any) => {
        if (res.success && Array.isArray(res.data)) {
          this.etfs.set(res.data.map((e: any) => ({
            isin: e.isin,
            name: e.name || e.description || e.isin,
            nickname: e.nickname || null
          })));
        }
        etfsLoaded = true;
        checkDone();
      },
      error: () => { this.error.set('Errore nel caricamento ETF'); etfsLoaded = true; checkDone(); }
    });

    this.api.getCorrelations().subscribe({
      next: (res: any) => {
        if (res.success && Array.isArray(res.data)) {
          this.correlations.set(res.data.map((c: any) => ({
            isin1: c.isin1,
            isin2: c.isin2,
            expansion: parseFloat(c.expansion) || 0,
            soft_landing: parseFloat(c.soft_landing) || 0,
            recession: parseFloat(c.recession) || 0,
            stagflation: parseFloat(c.stagflation) || 0
          })));
        }
        corrLoaded = true;
        checkDone();
      },
      error: () => { this.error.set('Errore nel caricamento correlazioni'); corrLoaded = true; checkDone(); }
    });
  }

  /** Build NxN matrix for the selected scenario */
  readonly matrix = computed<(number | null)[][]>(() => {
    const etfs = this.etfs();
    const corrs = this.correlations();
    const scenario = this.selectedScenario();
    const n = etfs.length;
    if (n === 0) return [];

    // Build lookup: "ISIN1|ISIN2" → value
    const lookup = new Map<string, number>();
    for (const c of corrs) {
      const v = c[scenario];
      lookup.set(`${c.isin1}|${c.isin2}`, v);
      lookup.set(`${c.isin2}|${c.isin1}`, v); // symmetric
    }

    return etfs.map((rowEtf, i) =>
      etfs.map((colEtf, j) => {
        if (i === j) return 1;
        return lookup.get(`${rowEtf.isin}|${colEtf.isin}`) ?? null;
      })
    );
  });

  displayEtfLabel(etf: EtfRow): string {
    return etf.nickname?.trim() || '—';
  }

  etfTitle(etf: EtfRow): string {
    return this.displayEtfLabel(etf);
  }

  getValue(row: number, col: number): number | null {
    return this.matrix()[row]?.[col] ?? null;
  }

  displayValue(v: number | null): string {
    if (v === null) return '—';
    if (v === 1) return '1';
    return v.toFixed(2).replace('.', ',');
  }

  corrClass(v: number | null): string {
    if (v === null) return 'corr-missing';
    if (v === 1) return 'corr-diagonal';
    if (v >= 0.7) return 'corr-strong-pos';
    if (v >= 0.3) return 'corr-moderate-pos';
    if (v > 0) return 'corr-weak-pos';
    if (v === 0) return 'corr-neutral';
    if (v >= -0.3) return 'corr-weak-neg';
    if (v >= -0.7) return 'corr-moderate-neg';
    return 'corr-strong-neg';
  }
}
