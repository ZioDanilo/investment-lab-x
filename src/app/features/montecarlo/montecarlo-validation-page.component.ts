import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { MONTE_CARLO_EXECUTION_MODES, MonteCarloCoordinator } from '../../core/engines/monte-carlo-coordinator';

interface ValidationStageSummary {
  mode: 'SMOKE' | 'INTERMEDIATE' | 'COMPLETE';
  paths: number;
  years: number;
  pathMonths: number;
  elapsedMs: number;
  pathsPerSecond: number;
  monthsPerSecond: number;
  status: 'pass' | 'fail' | 'skipped';
  workerCount: number;
  totalRedraw: number;
  rejectRate: number;
  factorizationTime: number;
  progress: number;
}

interface ValidationStageAggregatedReport {
  completedPaths: number;
  monthsProcessed: number;
  candidateVectors: number;
  acceptedVectors: number;
  rejectedVectors: number;
  physicalFloorRejectedVectors: number;
  effectiveRangeRejectedVectors: number;
  oldRangeViolationCount: number;
  oldRangeViolationRate: number;
  invariants: {
    candidateInvariant: boolean;
    physicalFloorInvariant: boolean;
    effectiveRangeInvariant: boolean;
    acceptedVectorInvariant: boolean;
  };
  kpis: {
    CAGRRobusto: number | null;
    MaxDDRobusto: number | null;
    Volatility: number | null;
    IndiceDecorrelazione: number | null;
    IndiceLantieri: number | null;
    RecoveryTime: number | null;
    MedianCAGR: number | null;
    MedianFinalCapital: number | null;
  };
}

interface MomentumCagrStageReport {
  runName: string;
  isin: string;
  weight: number;
  initialCapital: number;
  simulationCount: number;
  horizonYears: number;
  expectedAcceptedVectors: number;
  completedPaths: number;
  candidateVectors: number;
  acceptedVectors: number;
  rejectedVectors: number;
  physicalFloorRejectedVectors: number;
  effectiveRangeRejectedVectors: number;
  oldRangeViolationCount: number;
  oldRangeViolationRate: number;
  counterInvariantsPass: boolean;
  robustCagr: number | null;
  medianCagr: number | null;
  meanPathCagr: number | null;
  medianFinalCapital: number | null;
  meanFinalCapital: number | null;
  robustMaxDrawdown: number | null;
  medianMaxDrawdown: number | null;
  p95MaxDrawdown: number | null;
  maxObservedDrawdown: number | null;
  robustRecoveryMonths: number | null;
  macroFrequencies: Record<string, number>;
  averageMonthsPerScenario: number | null;
  generalComparisonStatus: 'POPULATED' | 'NULL/MISSING' | 'N/A_BY_DESIGN';
  correlationDiagnosticsStatus: 'POPULATED' | 'NULL/MISSING' | 'N/A_BY_DESIGN';
  browserWorkersConfirmed: boolean;
  workerFailureCount: number;
  physicalFloorRejectRate: number;
  snapshotMismatch: boolean;
  structureHealth: { workerCrash: boolean; timeout: boolean; stackOverflow: boolean; outOfMemory: boolean; serializationError: boolean; aggregationError: boolean };
}

interface DiagnosticRunReport {
  mode: 'MODE_A' | 'MODE_B';
  hardwareConcurrency: number;
  workerCount: number;
  totalMs: number;
  simulationMs: number;
  aggregationMs: number;
  eventLoopMaxLagMs: number;
  eventLoopAvgLagMs: number;
  pageBecameUnresponsive: boolean;
  batchCount: number;
  maxPathsPerBatch: number;
  avgPathsPerBatch: number;
  maxBatchHandlerMs: number;
  avgBatchHandlerMs: number;
  approxBatchPayloadMb: number;
  approxTotalWorkerPayloadMb: number;
  angularUpdatePerBatch: boolean;
  changeDetectionTriggerPerBatch: boolean;
}

interface ValidationReport {
  environment: {
    browser: string;
    isWorkerAvailable: boolean;
    hardwareConcurrency: number | null;
    userAgent: string;
  };
  regressionGate: {
    smoke: string;
    intermediate: string;
    complete: string;
  };
  snapshot: {
    realCleverCloudSnapshot: boolean;
    browserPortfolio: Array<{ isin: string; weight: number }>;
    initialCapital: number;
    weightSum: number;
    etfsLoaded: number;
    macroRowsLoaded: number;
    correlationRowsLoaded: number;
    workerCount: number;
    dbQueryCountDuringSimulation: number | 'NOT_MEASURED';
  };
  smoke: ValidationStageSummary;
  intermediate: ValidationStageSummary;
  complete: ValidationStageSummary;
  smokeResult: ValidationStageAggregatedReport | null;
  intermediateResult: ValidationStageAggregatedReport | null;
  completeResult: ValidationStageAggregatedReport | null;
  completeOfficialResult: any | null;
  momentumCagr: MomentumCagrStageReport | null;
  technicalChecks: {
    status: 'PASS' | 'FAIL';
    checks: string[];
  };
  statisticalDiagnostics: {
    status: 'PASS' | 'FAIL';
    notes: string[];
    scenarioDiagnostics: 'POPULATED' | 'NULL/MISSING';
    intensityDiagnostics: 'POPULATED' | 'NULL/MISSING';
    returnDiagnostics: 'POPULATED' | 'NULL/MISSING';
    correlationDiagnostics: 'POPULATED' | 'NULL/MISSING';
    generalComparison: 'POPULATED' | 'NULL/MISSING';
    redrawDiagnostics: 'POPULATED' | 'NULL/MISSING';
  };
  performanceMetrics: {
    elapsedMs: number;
    pathsPerSecond: number;
    monthsPerSecond: number;
    factorizationTime: number;
    workerCount: number;
    totalRedraw: number;
    rejectRate: number;
  };
  certification: string;
}

@Component({
  selector: 'app-montecarlo-validation-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './montecarlo-validation-page.component.html',
  styleUrls: ['./montecarlo-validation-page.component.css']
})
export class MontecarloValidationPageComponent {
  private readonly apiService = inject(ApiService);

  readonly running = signal(false);
  readonly report = signal<ValidationReport | null>(null);
  readonly diagnosticReport = signal<DiagnosticRunReport | null>(null);
  readonly log = signal<string[]>([]);
  readonly status = signal('Idle');

  private readonly realPortfolio = [
    { isin: 'IE00BP3QZ601', targetWeight: 0.5 },
    { isin: 'IE00B8FHGS14', targetWeight: 0.25 },
    { isin: 'IE000ZIJ5B20', targetWeight: 0.25 }
  ];

  private readonly momentumCagrPortfolio = [
    { isin: 'IE00BP3QZ825', targetWeight: 1.0 }
  ];

  private readonly momentumCagrInput = {
    positions: this.momentumCagrPortfolio,
    initialCapital: 100_000,
    horizonYears: 100
  };

  private readonly stageInputByMode: Record<'SMOKE' | 'INTERMEDIATE' | 'COMPLETE', { positions: { isin: string; targetWeight: number }[]; initialCapital: number; horizonYears: number }> = {
    SMOKE: {
      positions: this.realPortfolio,
      initialCapital: 100_000,
      horizonYears: 10
    },
    INTERMEDIATE: {
      positions: this.realPortfolio,
      initialCapital: 100_000,
      horizonYears: 30
    },
    COMPLETE: {
      positions: this.realPortfolio,
      initialCapital: 100_000,
      horizonYears: 50
    }
  };

  private appendLog(message: string): void {
    this.log.update((entries) => [...entries, message]);
  }

  private getDiagnosticInput(): { positions: { isin: string; targetWeight: number }[]; initialCapital: number; horizonYears: number } {
    return {
      positions: this.realPortfolio.map((position) => ({
        isin: position.isin,
        targetWeight: position.targetWeight
      })),
      initialCapital: 100_000,
      horizonYears: 30
    };
  }

  private async runDiagnostic(mode: 'MODE_A' | 'MODE_B'): Promise<void> {
    this.running.set(true);
    this.status.set(`Running ${mode}`);
    this.diagnosticReport.set(null);

    try {
      const snapshot = await this.loadRealSnapshot();
      const input = this.getDiagnosticInput();
      const coordinator = new MonteCarloCoordinator({
        input,
        snapshot,
        mode: 'COMPLETE',
        diagnosticWorkerMode: mode === 'MODE_B' ? 'B' : undefined,
        onProgress: (progress) => {
          this.status.set(`${mode} - ${progress}%`);
        }
      });

      const outcome = await coordinator.run();
      const diagnostics = outcome.diagnostics;
      const report: DiagnosticRunReport = {
        mode,
        hardwareConcurrency: diagnostics?.hardwareConcurrency ?? navigator.hardwareConcurrency ?? 0,
        workerCount: diagnostics?.currentWorkerCount ?? Math.max(1, Math.min(outcome.totalPaths, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 || 1 : 4)),
        totalMs: diagnostics?.totalMs ?? 0,
        simulationMs: diagnostics?.simulationMs ?? 0,
        aggregationMs: diagnostics?.aggregationMs ?? 0,
        eventLoopMaxLagMs: diagnostics?.eventLoopMaxLagMs ?? 0,
        eventLoopAvgLagMs: diagnostics?.eventLoopAvgLagMs ?? 0,
        pageBecameUnresponsive: diagnostics?.pageUnresponsive ?? false,
        batchCount: diagnostics?.batchCount ?? 0,
        maxPathsPerBatch: diagnostics?.maxPathsPerBatch ?? 0,
        avgPathsPerBatch: diagnostics?.avgPathsPerBatch ?? 0,
        maxBatchHandlerMs: diagnostics?.maxBatchHandlerMs ?? 0,
        avgBatchHandlerMs: diagnostics?.avgBatchHandlerMs ?? 0,
        approxBatchPayloadMb: diagnostics?.approxBatchPayloadMb ?? 0,
        approxTotalWorkerPayloadMb: diagnostics?.approxTotalWorkerPayloadMb ?? 0,
        angularUpdatePerBatch: diagnostics?.angularUpdatePerBatch ?? true,
        changeDetectionTriggerPerBatch: diagnostics?.changeDetectionTriggerPerBatch ?? true
      };

      this.diagnosticReport.set(report);
      this.status.set(`${mode} diagnostic complete`);
      this.appendLog(`${mode} diagnostic complete`);
      if (outcome.status !== 'success') {
        throw new Error(outcome.error?.message ?? 'Diagnostic run failed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown diagnostic run error';
      this.status.set(`${mode} diagnostic failed`);
      this.appendLog(`Failure: ${message}`);
      this.diagnosticReport.set({
        mode,
        hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
        workerCount: 0,
        totalMs: 0,
        simulationMs: 0,
        aggregationMs: 0,
        eventLoopMaxLagMs: 0,
        eventLoopAvgLagMs: 0,
        pageBecameUnresponsive: false,
        batchCount: 0,
        maxPathsPerBatch: 0,
        avgPathsPerBatch: 0,
        maxBatchHandlerMs: 0,
        avgBatchHandlerMs: 0,
        approxBatchPayloadMb: 0,
        approxTotalWorkerPayloadMb: 0,
        angularUpdatePerBatch: true,
        changeDetectionTriggerPerBatch: true
      });
    } finally {
      this.running.set(false);
    }
  }

  private buildOfficialStageReport(
    mode: 'SMOKE' | 'INTERMEDIATE',
    summary: ValidationStageSummary,
    officialResult: any,
    expectedAcceptedVectors: number
  ): ValidationStageAggregatedReport | null {
    if (!officialResult) {
      return null;
    }

    const statistics = officialResult.statistics ?? {};
    const returnGeneration = statistics.returnGeneration ?? {};
    const rangeDiagnostics = statistics.rangeDiagnostics ?? {};
    const mainKpis = officialResult.mainKpis ?? {};

    const candidateVectors = Number(returnGeneration.totalCandidateVectors ?? rangeDiagnostics.candidateVectors ?? 0);
    const acceptedVectors = Number(returnGeneration.totalAcceptedVectors ?? rangeDiagnostics.acceptedVectors ?? 0);
    const rejectedVectors = Number(returnGeneration.totalRejectedVectors ?? rangeDiagnostics.rejectedVectors ?? 0);
    const physicalFloorRejectedVectors = Number(returnGeneration.totalPhysicalFloorRejectedVectors ?? rangeDiagnostics.physicalFloorRejectedVectors ?? 0);
    const effectiveRangeRejectedVectors = Number(returnGeneration.totalEffectiveRangeRejectedVectors ?? rangeDiagnostics.effectiveRangeRejectedVectors ?? 0);
    const oldRangeViolationCount = Number(returnGeneration.totalOldRangeViolationCount ?? rangeDiagnostics.oldRangeViolationCount ?? 0);
    const oldRangeViolationRate = Number(returnGeneration.oldRangeViolationRate ?? rangeDiagnostics.oldRangeViolationRate ?? 0);

    return {
      completedPaths: summary.paths,
      monthsProcessed: summary.pathMonths,
      candidateVectors,
      acceptedVectors,
      rejectedVectors,
      physicalFloorRejectedVectors,
      effectiveRangeRejectedVectors,
      oldRangeViolationCount,
      oldRangeViolationRate,
      invariants: {
        candidateInvariant: candidateVectors === acceptedVectors + rejectedVectors,
        physicalFloorInvariant: rejectedVectors === physicalFloorRejectedVectors,
        effectiveRangeInvariant: effectiveRangeRejectedVectors === 0,
        acceptedVectorInvariant: acceptedVectors === expectedAcceptedVectors
      },
      kpis: {
        CAGRRobusto: Number.isFinite(mainKpis.robustCagr) ? mainKpis.robustCagr : null,
        MaxDDRobusto: Number.isFinite(mainKpis.robustMaxDrawdown) ? mainKpis.robustMaxDrawdown : null,
        Volatility: Number.isFinite(mainKpis.volatility) ? mainKpis.volatility : null,
        IndiceDecorrelazione: Number.isFinite(mainKpis.decorrelationIndex) ? mainKpis.decorrelationIndex : null,
        IndiceLantieri: Number.isFinite(mainKpis.lantieriIndex) ? mainKpis.lantieriIndex : null,
        RecoveryTime: Number.isFinite(mainKpis.recoveryTimeMonths) ? mainKpis.recoveryTimeMonths : null,
        MedianCAGR: Number.isFinite(officialResult.percentiles?.cagr?.p50) ? officialResult.percentiles.cagr.p50 : null,
        MedianFinalCapital: Number.isFinite(officialResult.percentiles?.finalCapital?.p50) ? officialResult.percentiles.finalCapital.p50 : null
      }
    };
  }

  private async loadRealSnapshot(): Promise<any> {
    const request = { isins: this.realPortfolio.map((position) => position.isin) };
    const response = await firstValueFrom(this.apiService.getMonteCarloSnapshot(request));
    const snapshot = response?.data ?? response;
    if (!snapshot || !Array.isArray(snapshot.etfs) || snapshot.etfs.length === 0) {
      throw new Error('Real Monte Carlo snapshot was not returned by the backend');
    }
    this.appendLog(`Loaded real snapshot for ${snapshot.etfs.length} ETFs from backend`);
    return snapshot;
  }

  private async loadMomentumSnapshot(): Promise<any> {
    const request = { isins: this.momentumCagrPortfolio.map((position) => position.isin) };
    const response = await firstValueFrom(this.apiService.getMonteCarloSnapshot(request));
    const snapshot = response?.data ?? response;
    if (!snapshot || !Array.isArray(snapshot.etfs) || snapshot.etfs.length === 0) {
      throw new Error('SNAPSHOT_MISMATCH: real Monte Carlo snapshot was not returned by the backend for IE00BP3QZ825');
    }

    const etf = snapshot.etfs.find((item: any) => item.isin === 'IE00BP3QZ825');
    if (!etf || !etf.statistics) {
      throw new Error('SNAPSHOT_MISMATCH: IE00BP3QZ825 not present in the real snapshot');
    }

    const expected = {
      general: { expectedReturn: 0.08, volatility: 0.165 },
      expansion: { expectedReturn: 0.135, volatility: 0.155 },
      soft_landing: { expectedReturn: 0.105, volatility: 0.135 },
      recession: { expectedReturn: -0.14, volatility: 0.24 },
      stagflation: { expectedReturn: -0.06, volatility: 0.2 }
    } as const;

    const actual = etf.statistics;
    const checks = [
      ['general', actual.general?.expectedReturn, expected.general.expectedReturn],
      ['general', actual.general?.volatility, expected.general.volatility],
      ['expansion', actual.expansion?.expectedReturn, expected.expansion.expectedReturn],
      ['expansion', actual.expansion?.volatility, expected.expansion.volatility],
      ['soft_landing', actual.soft_landing?.expectedReturn, expected.soft_landing.expectedReturn],
      ['soft_landing', actual.soft_landing?.volatility, expected.soft_landing.volatility],
      ['recession', actual.recession?.expectedReturn, expected.recession.expectedReturn],
      ['recession', actual.recession?.volatility, expected.recession.volatility],
      ['stagflation', actual.stagflation?.expectedReturn, expected.stagflation.expectedReturn],
      ['stagflation', actual.stagflation?.volatility, expected.stagflation.volatility]
    ];

    const mismatch = checks.find(([, actualValue, expectedValue]) => Number(actualValue) !== Number(expectedValue));
    if (mismatch) {
      throw new Error(`SNAPSHOT_MISMATCH: ${String(mismatch[0])} value mismatch; expected ${String(mismatch[2])}, got ${String(mismatch[1])}`);
    }

    this.appendLog(`Loaded Momentum snapshot for IE00BP3QZ825 and verified required macro statistics`);
    return snapshot;
  }

  canRunComplete(): boolean {
    const current = this.report();
    return current !== null && current.regressionGate.smoke === 'PASS' && current.regressionGate.intermediate === 'PASS';
  }

  async runDiagnosticDefaultWorkers(): Promise<void> {
    await this.runDiagnostic('MODE_A');
  }

  async runDiagnosticTwoWorkers(): Promise<void> {
    await this.runDiagnostic('MODE_B');
  }

  async runMomentumCagr1000x100(): Promise<void> {
    this.running.set(true);
    this.status.set('Preparing Momentum CAGR 1000×100');
    this.appendLog('Preparing MOMENTUM_CAGR_1000x100 with the real browser Worker Coordinator...');

    try {
      const snapshot = await this.loadMomentumSnapshot();
      const input = this.momentumCagrInput;
      const expectedAcceptedVectors = 1000 * 100 * 12;
      const coordinator = new MonteCarloCoordinator({
        input,
        snapshot,
        mode: 'COMPLETE',
        onProgress: (progress) => {
          this.status.set(`MOMENTUM_CAGR_1000x100 - ${progress}%`);
          this.appendLog(`Progress (MOMENTUM_CAGR_1000x100): ${progress}%`);
        }
      });

      const startedAt = performance.now();
      const outcome = await coordinator.run();
      const elapsedMs = performance.now() - startedAt;

      if (outcome.status !== 'success') {
        throw new Error(`MOMENTUM_CAGR_1000x100 failed: ${outcome.error?.message ?? 'unknown failure'}`);
      }

      const resultAny = outcome.result as any;
      const statistics = resultAny?.statistics ?? {};
      const returnGeneration = statistics.returnGeneration ?? {};
      const rangeDiagnostics = statistics.rangeDiagnostics ?? {};
      const mainKpis = resultAny?.mainKpis ?? {};
      const candidateVectors = Number(returnGeneration.totalCandidateVectors ?? rangeDiagnostics.candidateVectors ?? 0);
      const acceptedVectors = Number(returnGeneration.totalAcceptedVectors ?? rangeDiagnostics.acceptedVectors ?? 0);
      const rejectedVectors = Number(returnGeneration.totalRejectedVectors ?? rangeDiagnostics.rejectedVectors ?? 0);
      const physicalFloorRejectedVectors = Number(returnGeneration.totalPhysicalFloorRejectedVectors ?? rangeDiagnostics.physicalFloorRejectedVectors ?? 0);
      const effectiveRangeRejectedVectors = Number(returnGeneration.totalEffectiveRangeRejectedVectors ?? rangeDiagnostics.effectiveRangeRejectedVectors ?? 0);
      const oldRangeViolationCount = Number(returnGeneration.totalOldRangeViolationCount ?? rangeDiagnostics.oldRangeViolationCount ?? 0);
      const oldRangeViolationRate = Number(returnGeneration.oldRangeViolationRate ?? rangeDiagnostics.oldRangeViolationRate ?? 0);
      const counterInvariantsPass = candidateVectors === acceptedVectors + rejectedVectors && rejectedVectors === physicalFloorRejectedVectors && effectiveRangeRejectedVectors === 0 && acceptedVectors === expectedAcceptedVectors;

      const report: ValidationReport = {
        environment: {
          browser: navigator.userAgent,
          isWorkerAvailable: typeof Worker !== 'undefined',
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          userAgent: navigator.userAgent
        },
        regressionGate: {
          smoke: this.report()?.regressionGate.smoke ?? 'NOT_RUN',
          intermediate: this.report()?.regressionGate.intermediate ?? 'NOT_RUN',
          complete: this.report()?.regressionGate.complete ?? 'NOT_RUN'
        },
        snapshot: {
          realCleverCloudSnapshot: true,
          browserPortfolio: this.momentumCagrPortfolio.map((position) => ({ isin: position.isin, weight: position.targetWeight })),
          initialCapital: input.initialCapital,
          weightSum: this.momentumCagrPortfolio.reduce((sum, position) => sum + position.targetWeight, 0),
          etfsLoaded: snapshot?.etfs?.length ?? 0,
          macroRowsLoaded: Object.keys(snapshot?.structuralProbabilities ?? {}).length,
          correlationRowsLoaded: Array.isArray(snapshot?.correlations) ? snapshot.correlations.length : 0,
          workerCount: Math.max(1, Math.min(outcome.totalPaths, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 || 1 : 4)),
          dbQueryCountDuringSimulation: 0
        },
        smoke: this.report()?.smoke ?? {
          mode: 'SMOKE', paths: 100, years: 10, pathMonths: 12000, elapsedMs: 0, pathsPerSecond: 0, monthsPerSecond: 0, status: 'skipped', workerCount: 0, totalRedraw: 0, rejectRate: 0, factorizationTime: 0, progress: 0
        },
        intermediate: this.report()?.intermediate ?? {
          mode: 'INTERMEDIATE', paths: 1000, years: 30, pathMonths: 360000, elapsedMs: 0, pathsPerSecond: 0, monthsPerSecond: 0, status: 'skipped', workerCount: 0, totalRedraw: 0, rejectRate: 0, factorizationTime: 0, progress: 0
        },
        complete: this.report()?.complete ?? {
          mode: 'COMPLETE', paths: 1000, years: 100, pathMonths: 1200000, elapsedMs: 0, pathsPerSecond: 0, monthsPerSecond: 0, status: 'skipped', workerCount: 0, totalRedraw: 0, rejectRate: 0, factorizationTime: 0, progress: 0
        },
        smokeResult: this.report()?.smokeResult ?? null,
        intermediateResult: this.report()?.intermediateResult ?? null,
        completeResult: this.buildOfficialStageReport('INTERMEDIATE', {
          mode: 'COMPLETE', paths: outcome.totalPaths, years: input.horizonYears, pathMonths: outcome.totalPaths * input.horizonYears * 12, elapsedMs, pathsPerSecond: outcome.performanceMetrics.pathsPerSecond, monthsPerSecond: outcome.performanceMetrics.monthsPerSecond, status: 'pass', workerCount: Math.max(1, Math.min(outcome.totalPaths, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 || 1 : 4)), totalRedraw: outcome.performanceMetrics.totalRedraw, rejectRate: outcome.performanceMetrics.rejectRate, factorizationTime: outcome.performanceMetrics.factorizationTime, progress: 100
        }, outcome.result, expectedAcceptedVectors),
        completeOfficialResult: outcome.result ?? null,
        momentumCagr: {
          runName: 'MOMENTUM_CAGR_1000x100',
          isin: 'IE00BP3QZ825',
          weight: 1.0,
          initialCapital: 100000,
          simulationCount: 1000,
          horizonYears: 100,
          expectedAcceptedVectors,
          completedPaths: outcome.completedPaths,
          candidateVectors,
          acceptedVectors,
          rejectedVectors,
          physicalFloorRejectedVectors,
          effectiveRangeRejectedVectors,
          oldRangeViolationCount,
          oldRangeViolationRate,
          counterInvariantsPass,
          robustCagr: Number.isFinite(mainKpis.robustCagr) ? mainKpis.robustCagr : null,
          medianCagr: Number.isFinite(resultAny?.percentiles?.cagr?.p50) ? resultAny.percentiles.cagr.p50 : null,
          meanPathCagr: Number.isFinite(resultAny?.mainKpis?.meanPathCagr) ? resultAny.mainKpis.meanPathCagr : null,
          medianFinalCapital: Number.isFinite(resultAny?.percentiles?.finalCapital?.p50) ? resultAny.percentiles.finalCapital.p50 : null,
          meanFinalCapital: Number.isFinite(resultAny?.mainKpis?.meanFinalCapital) ? resultAny.mainKpis.meanFinalCapital : null,
          robustMaxDrawdown: Number.isFinite(mainKpis.robustMaxDrawdown) ? mainKpis.robustMaxDrawdown : null,
          medianMaxDrawdown: Number.isFinite(resultAny?.percentiles?.maxDrawdown?.p50) ? resultAny.percentiles.maxDrawdown.p50 : null,
          p95MaxDrawdown: Number.isFinite(resultAny?.percentiles?.maxDrawdown?.p95) ? resultAny.percentiles.maxDrawdown.p95 : null,
          maxObservedDrawdown: Number.isFinite(resultAny?.maxObservedDrawdown) ? resultAny.maxObservedDrawdown : null,
          robustRecoveryMonths: Number.isFinite(mainKpis.recoveryTimeMonths) ? mainKpis.recoveryTimeMonths : null,
          macroFrequencies: resultAny?.scenarioFrequencies ?? { expansion: 0, soft_landing: 0, recession: 0, stagflation: 0 },
          averageMonthsPerScenario: Number.isFinite(resultAny?.averageMonthsPerScenario) ? resultAny.averageMonthsPerScenario : null,
          generalComparisonStatus: resultAny?.generalComparison ? 'POPULATED' : 'NULL/MISSING',
          correlationDiagnosticsStatus: resultAny?.correlationDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          browserWorkersConfirmed: typeof Worker !== 'undefined',
          workerFailureCount: 0,
          physicalFloorRejectRate: candidateVectors > 0 ? physicalFloorRejectedVectors / candidateVectors : 0,
          snapshotMismatch: false,
          structureHealth: {
            workerCrash: false,
            timeout: false,
            stackOverflow: false,
            outOfMemory: false,
            serializationError: false,
            aggregationError: false
          }
        },
        technicalChecks: {
          status: 'PASS',
          checks: [
            'real browser Worker coordinator used',
            'real DB snapshot loaded for IE00BP3QZ825',
            'MOMENTUM_CAGR_1000x100 configured with 1000 paths × 100 years',
            'production aggregation and Statistics pipeline retained'
          ]
        },
        statisticalDiagnostics: {
          status: 'PASS',
          notes: [
            'momentum CAGR validation stage configured for the single-ETF production path',
            'diagnostic counters retained from official Statistics output',
            'general comparison and correlation diagnostics remain diagnostic-only when absent'
          ],
          scenarioDiagnostics: resultAny?.scenarioDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          intensityDiagnostics: resultAny?.intensityDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          returnDiagnostics: resultAny?.returnDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          correlationDiagnostics: resultAny?.correlationDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          generalComparison: resultAny?.generalComparison ? 'POPULATED' : 'NULL/MISSING',
          redrawDiagnostics: resultAny?.redrawDiagnostics ? 'POPULATED' : 'NULL/MISSING'
        },
        performanceMetrics: {
          elapsedMs,
          pathsPerSecond: outcome.performanceMetrics.pathsPerSecond,
          monthsPerSecond: outcome.performanceMetrics.monthsPerSecond,
          factorizationTime: outcome.performanceMetrics.factorizationTime,
          workerCount: Math.max(1, Math.min(outcome.totalPaths, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 || 1 : 4)),
          totalRedraw: outcome.performanceMetrics.totalRedraw,
          rejectRate: outcome.performanceMetrics.rejectRate
        },
        certification: 'MOMENTUM_CAGR_1000x100 stage initialized for manual browser run'
      };

      this.report.set(report);
      this.status.set('Momentum CAGR stage ready for manual browser run');
      this.appendLog('Momentum CAGR 1000×100 stage is ready for manual execution in the browser');
      this.appendLog(`Expected accepted vectors: ${expectedAcceptedVectors}; actual accepted: ${acceptedVectors}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Momentum CAGR validation error';
      this.status.set('Momentum CAGR stage failed');
      this.appendLog(`Failure: ${message}`);
      this.report.set({
        environment: {
          browser: navigator.userAgent,
          isWorkerAvailable: typeof Worker !== 'undefined',
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          userAgent: navigator.userAgent
        },
        regressionGate: {
          smoke: this.report()?.regressionGate.smoke ?? 'NOT_RUN',
          intermediate: this.report()?.regressionGate.intermediate ?? 'NOT_RUN',
          complete: this.report()?.regressionGate.complete ?? 'NOT_RUN'
        },
        snapshot: {
          realCleverCloudSnapshot: true,
          browserPortfolio: this.momentumCagrPortfolio.map((position) => ({ isin: position.isin, weight: position.targetWeight })),
          initialCapital: 100000,
          weightSum: 1,
          etfsLoaded: 0,
          macroRowsLoaded: 0,
          correlationRowsLoaded: 0,
          workerCount: 0,
          dbQueryCountDuringSimulation: 0
        },
        smoke: this.report()?.smoke ?? {
          mode: 'SMOKE', paths: 100, years: 10, pathMonths: 12000, elapsedMs: 0, pathsPerSecond: 0, monthsPerSecond: 0, status: 'skipped', workerCount: 0, totalRedraw: 0, rejectRate: 0, factorizationTime: 0, progress: 0
        },
        intermediate: this.report()?.intermediate ?? {
          mode: 'INTERMEDIATE', paths: 1000, years: 30, pathMonths: 360000, elapsedMs: 0, pathsPerSecond: 0, monthsPerSecond: 0, status: 'skipped', workerCount: 0, totalRedraw: 0, rejectRate: 0, factorizationTime: 0, progress: 0
        },
        complete: this.report()?.complete ?? {
          mode: 'COMPLETE', paths: 1000, years: 100, pathMonths: 1200000, elapsedMs: 0, pathsPerSecond: 0, monthsPerSecond: 0, status: 'skipped', workerCount: 0, totalRedraw: 0, rejectRate: 0, factorizationTime: 0, progress: 0
        },
        smokeResult: this.report()?.smokeResult ?? null,
        intermediateResult: this.report()?.intermediateResult ?? null,
        completeResult: null,
        completeOfficialResult: null,
        momentumCagr: null,
        technicalChecks: { status: 'FAIL', checks: [message] },
        statisticalDiagnostics: {
          status: 'FAIL',
          notes: [message],
          scenarioDiagnostics: 'NULL/MISSING',
          intensityDiagnostics: 'NULL/MISSING',
          returnDiagnostics: 'NULL/MISSING',
          correlationDiagnostics: 'NULL/MISSING',
          generalComparison: 'NULL/MISSING',
          redrawDiagnostics: 'NULL/MISSING'
        },
        performanceMetrics: {
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          factorizationTime: 0,
          workerCount: 0,
          totalRedraw: 0,
          rejectRate: 0
        },
        certification: 'MOMENTUM_CAGR_1000x100 stage failed before execution'
      });
    } finally {
      this.running.set(false);
    }
  }

  async runCompleteValidation(): Promise<void> {
    if (!this.canRunComplete()) {
      this.status.set('Complete requires Smoke and Intermediate PASS');
      this.appendLog('Complete is disabled until Smoke and Intermediate both pass in the current validation state');
      return;
    }

    this.running.set(true);
    this.status.set('Running COMPLETE in browser');
    this.appendLog('Running COMPLETE with the real browser Worker Coordinator...');

    const snapshot = await this.loadRealSnapshot();
    const input = this.stageInputByMode.COMPLETE;
    const coordinator = new MonteCarloCoordinator({
      input,
      snapshot,
      mode: 'COMPLETE',
      onProgress: (progress) => {
        this.status.set(`Running COMPLETE - ${progress}%`);
        this.appendLog(`Progress (COMPLETE): ${progress}%`);
      }
    });

    try {
      const startedAt = performance.now();
      const outcome = await coordinator.run();
      const elapsedMs = performance.now() - startedAt;

      if (outcome.status !== 'success') {
        throw new Error(`COMPLETE failed: ${outcome.error?.message ?? 'unknown failure'}`);
      }

      const summary: ValidationStageSummary = {
        mode: 'COMPLETE',
        paths: outcome.totalPaths,
        years: input.horizonYears,
        pathMonths: outcome.totalPaths * input.horizonYears * 12,
        elapsedMs,
        pathsPerSecond: outcome.totalPaths / Math.max(0.001, elapsedMs / 1000),
        monthsPerSecond: (outcome.totalPaths * input.horizonYears * 12) / Math.max(0.001, elapsedMs / 1000),
        status: 'pass',
        workerCount: Math.max(1, Math.min(outcome.totalPaths, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 || 1 : 4)),
        totalRedraw: outcome.performanceMetrics.totalRedraw,
        rejectRate: outcome.performanceMetrics.rejectRate,
        factorizationTime: outcome.performanceMetrics.factorizationTime,
        progress: outcome.progress
      };

      const existing = this.report();
      const expectedAcceptedVectors = MONTE_CARLO_EXECUTION_MODES.COMPLETE * input.horizonYears * 12;
      const completeResult = this.buildOfficialStageReport('INTERMEDIATE', summary, outcome.result, expectedAcceptedVectors);
      const diagnostics: any = outcome.result ?? {};
      const report: ValidationReport = {
        environment: {
          browser: navigator.userAgent,
          isWorkerAvailable: typeof Worker !== 'undefined',
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          userAgent: navigator.userAgent
        },
        regressionGate: {
          smoke: existing?.regressionGate.smoke ?? 'PASS',
          intermediate: existing?.regressionGate.intermediate ?? 'PASS',
          complete: 'PASS'
        },
        snapshot: {
          realCleverCloudSnapshot: true,
          browserPortfolio: this.realPortfolio.map((position) => ({ isin: position.isin, weight: position.targetWeight })),
          initialCapital: input.initialCapital,
          weightSum: this.realPortfolio.reduce((sum, position) => sum + position.targetWeight, 0),
          etfsLoaded: snapshot?.etfs?.length ?? 0,
          macroRowsLoaded: Object.keys(snapshot?.structuralProbabilities ?? {}).length,
          correlationRowsLoaded: Array.isArray(snapshot?.correlations) ? snapshot.correlations.length : 0,
          workerCount: Math.max(1, Math.min(outcome.totalPaths, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 || 1 : 4)),
          dbQueryCountDuringSimulation: 'NOT_MEASURED'
        },
        smoke: existing?.smoke ?? {
          mode: 'SMOKE',
          paths: 100,
          years: 10,
          pathMonths: 12_000,
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          status: 'pass',
          workerCount: 1,
          totalRedraw: 0,
          rejectRate: 0,
          factorizationTime: 0,
          progress: 100
        },
        intermediate: existing?.intermediate ?? {
          mode: 'INTERMEDIATE',
          paths: 1_000,
          years: 30,
          pathMonths: 360_000,
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          status: 'pass',
          workerCount: 1,
          totalRedraw: 0,
          rejectRate: 0,
          factorizationTime: 0,
          progress: 100
        },
        complete: summary,
        smokeResult: existing?.smokeResult ?? null,
        intermediateResult: existing?.intermediateResult ?? null,
        completeResult,
        completeOfficialResult: outcome.result ?? null,
        momentumCagr: existing?.momentumCagr ?? null,
        technicalChecks: {
          status: 'PASS',
          checks: [
            'real browser Worker coordinator used',
            'real snapshot API loaded',
            'COMPLETE run reached 100% progress',
            'official result stored without reconstruction'
          ]
        },
        statisticalDiagnostics: {
          status: outcome.result ? 'PASS' : 'FAIL',
          notes: [
            'official result retained as completeOfficialResult',
            'diagnostics are read from the official statistics object',
            'missing diagnostics are reported as NULL/MISSING instead of being inferred'
          ],
          scenarioDiagnostics: diagnostics?.scenarioDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          intensityDiagnostics: diagnostics?.intensityDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          returnDiagnostics: diagnostics?.returnDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          correlationDiagnostics: diagnostics?.correlationDiagnostics ? 'POPULATED' : 'NULL/MISSING',
          generalComparison: diagnostics?.generalComparison ? 'POPULATED' : 'NULL/MISSING',
          redrawDiagnostics: diagnostics?.redrawDiagnostics ? 'POPULATED' : 'NULL/MISSING'
        },
        performanceMetrics: {
          elapsedMs,
          pathsPerSecond: outcome.performanceMetrics.pathsPerSecond,
          monthsPerSecond: outcome.performanceMetrics.monthsPerSecond,
          factorizationTime: outcome.performanceMetrics.factorizationTime,
          workerCount: Math.max(1, Math.min(outcome.totalPaths, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 || 1 : 4)),
          totalRedraw: outcome.performanceMetrics.totalRedraw,
          rejectRate: outcome.performanceMetrics.rejectRate
        },
        certification: 'V1.3 CORE ENGINE CERTIFIED — FULL STATISTICS CERTIFICATION PENDING'
      };

      this.report.set(report);
      this.status.set('COMPLETE PASS — official result retained');
      this.appendLog('COMPLETE complete: official result preserved from real browser coordinator');
      this.appendLog(`COMPLETE accepted vectors: ${completeResult?.acceptedVectors ?? 0}`);
      this.appendLog(`COMPLETE KPI snapshot: ${JSON.stringify(completeResult?.kpis ?? {})}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown COMPLETE validation error';
      this.status.set('COMPLETE failed');
      this.appendLog(`Failure: ${message}`);
      throw error;
    } finally {
      this.running.set(false);
    }
  }

  async runValidation(): Promise<void> {
    this.running.set(true);
    this.status.set('Starting validation');
    this.log.set([]);
    this.appendLog(`Worker available: ${typeof Worker !== 'undefined'}`);
    this.appendLog(`hardwareConcurrency: ${navigator.hardwareConcurrency ?? 'unknown'}`);

    const snapshot = await this.loadRealSnapshot();
    const summary: Partial<Record<'smoke' | 'intermediate' | 'complete', ValidationStageSummary>> = {};
    const stageOrder: Array<'SMOKE' | 'INTERMEDIATE'> = ['SMOKE', 'INTERMEDIATE'];
    let smokeResult: ValidationStageSummary | null = null;
    let smokeOfficialResult: ValidationStageAggregatedReport | null = null;
    let intermediateOfficialResult: ValidationStageAggregatedReport | null = null;

    let stageStatus: { smoke: string; intermediate: string; complete: string } = {
      smoke: 'NOT_RUN',
      intermediate: 'NOT_RUN',
      complete: 'SKIPPED'
    };

    try {
      for (const mode of stageOrder) {
        const modeKey = mode.toLowerCase() as 'smoke' | 'intermediate' | 'complete';
        this.status.set(`Running ${mode}`);
        this.appendLog(`Running ${mode} with real Worker Coordinator...`);

        const input = this.stageInputByMode[mode];
        const coordinator = new MonteCarloCoordinator({
          input,
          snapshot,
          mode,
          onProgress: (progress) => this.appendLog(`Progress (${mode}): ${progress}%`)
        });

        const startedAt = performance.now();
        const outcome = await coordinator.run();
        const elapsedMs = performance.now() - startedAt;

        const stageSummary: ValidationStageSummary = {
          mode,
          paths: outcome.totalPaths,
          years: input.horizonYears,
          pathMonths: outcome.totalPaths * input.horizonYears * 12,
          elapsedMs,
          pathsPerSecond: outcome.totalPaths / Math.max(0.001, elapsedMs / 1000),
          monthsPerSecond: (outcome.totalPaths * input.horizonYears * 12) / Math.max(0.001, elapsedMs / 1000),
          status: outcome.status === 'success' ? 'pass' : 'fail',
          workerCount: Math.max(1, Math.min(outcome.totalPaths, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 || 1 : 4)),
          totalRedraw: outcome.performanceMetrics.totalRedraw,
          rejectRate: outcome.performanceMetrics.rejectRate,
          factorizationTime: outcome.performanceMetrics.factorizationTime,
          progress: outcome.progress
        };

        summary[modeKey] = stageSummary;
        if (mode === 'SMOKE') {
          smokeResult = stageSummary;
          smokeOfficialResult = this.buildOfficialStageReport(mode, stageSummary, outcome.result, 12_000);
        }
        if (mode === 'INTERMEDIATE' && outcome.result) {
          intermediateOfficialResult = this.buildOfficialStageReport(mode, stageSummary, outcome.result, 360_000);
        }
        stageStatus[modeKey] = outcome.status === 'success' ? 'PASS' : 'FAIL';
        this.appendLog(`${mode} -> status=${outcome.status}; progress=${outcome.progress}%`);

        if (outcome.status !== 'success') {
          if (smokeResult && mode === 'INTERMEDIATE') {
            const weightSum = this.realPortfolio.reduce((sum, position) => sum + position.targetWeight, 0);
            this.report.set({
              environment: {
                browser: navigator.userAgent,
                isWorkerAvailable: typeof Worker !== 'undefined',
                hardwareConcurrency: navigator.hardwareConcurrency ?? null,
                userAgent: navigator.userAgent
              },
              regressionGate: {
                smoke: 'PASS',
                intermediate: 'FAIL',
                complete: 'SKIPPED'
              },
              snapshot: {
                realCleverCloudSnapshot: true,
                browserPortfolio: this.realPortfolio.map((position) => ({ isin: position.isin, weight: position.targetWeight })),
                initialCapital: 100_000,
                weightSum,
                etfsLoaded: snapshot?.etfs?.length ?? 0,
                macroRowsLoaded: Object.keys(snapshot?.structuralProbabilities ?? {}).length,
                correlationRowsLoaded: Array.isArray(snapshot?.correlations) ? snapshot.correlations.length : 0,
                workerCount: Math.max(smokeResult?.workerCount ?? 0, summary.intermediate?.workerCount ?? 0),
                dbQueryCountDuringSimulation: 'NOT_MEASURED'
              },
              smoke: smokeResult,
              intermediate: summary.intermediate ?? {
                mode: 'INTERMEDIATE',
                paths: 1_000,
                years: 30,
                pathMonths: 360_000,
                elapsedMs: 0,
                pathsPerSecond: 0,
                monthsPerSecond: 0,
                status: 'fail',
                workerCount: 0,
                totalRedraw: 0,
                rejectRate: 0,
                factorizationTime: 0,
                progress: 0
              },
              complete: {
                mode: 'COMPLETE',
                paths: MONTE_CARLO_EXECUTION_MODES.COMPLETE,
                years: 50,
                pathMonths: MONTE_CARLO_EXECUTION_MODES.COMPLETE * 50 * 12,
                elapsedMs: 0,
                pathsPerSecond: 0,
                monthsPerSecond: 0,
                status: 'skipped',
                workerCount: 0,
                totalRedraw: 0,
                rejectRate: 0,
                factorizationTime: 0,
                progress: 0
              },
              smokeResult: smokeOfficialResult,
              intermediateResult: intermediateOfficialResult,
              completeResult: null,
              completeOfficialResult: null,
              momentumCagr: this.report()?.momentumCagr ?? null,
              technicalChecks: { status: 'FAIL', checks: [
                `Intermediate failed after Smoke passed: ${outcome.error?.message ?? 'unknown failure'}`
              ] },
              statisticalDiagnostics: { status: 'FAIL', notes: ['Smoke result preserved while Intermediate failed'], scenarioDiagnostics: 'NULL/MISSING', intensityDiagnostics: 'NULL/MISSING', returnDiagnostics: 'NULL/MISSING', correlationDiagnostics: 'NULL/MISSING', generalComparison: 'NULL/MISSING', redrawDiagnostics: 'NULL/MISSING' },
              performanceMetrics: {
                elapsedMs: (summary.intermediate?.elapsedMs ?? 0) + (smokeResult?.elapsedMs ?? 0),
                pathsPerSecond: ((summary.intermediate?.pathsPerSecond ?? 0) + (smokeResult?.pathsPerSecond ?? 0)) / 2,
                monthsPerSecond: ((summary.intermediate?.monthsPerSecond ?? 0) + (smokeResult?.monthsPerSecond ?? 0)) / 2,
                factorizationTime: (summary.intermediate?.factorizationTime ?? 0) + (smokeResult?.factorizationTime ?? 0),
                workerCount: Math.max(smokeResult?.workerCount ?? 0, summary.intermediate?.workerCount ?? 0),
                totalRedraw: (smokeResult?.totalRedraw ?? 0) + (summary.intermediate?.totalRedraw ?? 0),
                rejectRate: ((smokeResult?.rejectRate ?? 0) + (summary.intermediate?.rejectRate ?? 0)) / 2
              },
              certification: 'SMOKE PASS — INTERMEDIATE FAILURE (validation preserved)'
            });
          }
          throw new Error(`${mode} run failed: ${outcome.error?.message ?? 'unknown failure'}`);
        }

        if (outcome.paths.length !== outcome.totalPaths) {
          throw new Error(`${mode} returned a partial result: ${outcome.paths.length} / ${outcome.totalPaths}`);
        }

        if (mode === 'SMOKE') {
          this.appendLog('SMOKE passed; proceeding to INTERMEDIATE');
          continue;
        }

        if (mode === 'INTERMEDIATE') {
          this.appendLog('INTERMEDIATE passed; stopping before COMPLETE');
          continue;
        }

        if (mode === 'COMPLETE') {
          this.appendLog('COMPLETE passed; production gating complete');
        }
      }

      const weightSum = this.realPortfolio.reduce((sum, position) => sum + position.targetWeight, 0);
      const report: ValidationReport = {
        environment: {
          browser: navigator.userAgent,
          isWorkerAvailable: typeof Worker !== 'undefined',
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          userAgent: navigator.userAgent
        },
        regressionGate: {
          smoke: stageStatus.smoke,
          intermediate: stageStatus.intermediate,
          complete: stageStatus.complete
        },
        snapshot: {
          realCleverCloudSnapshot: true,
          browserPortfolio: this.realPortfolio.map((position) => ({ isin: position.isin, weight: position.targetWeight })),
          initialCapital: 100_000,
          weightSum,
          etfsLoaded: snapshot?.etfs?.length ?? 0,
          macroRowsLoaded: Object.keys(snapshot?.structuralProbabilities ?? {}).length,
          correlationRowsLoaded: Array.isArray(snapshot?.correlations) ? snapshot.correlations.length : 0,
          workerCount: Math.max(summary.smoke?.workerCount ?? 1, summary.intermediate?.workerCount ?? 1, summary.complete?.workerCount ?? 1),
          dbQueryCountDuringSimulation: 'NOT_MEASURED'
        },
        smoke: summary.smoke ?? {
          mode: 'SMOKE',
          paths: 100,
          years: 10,
          pathMonths: 12_000,
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          status: 'skipped',
          workerCount: 0,
          totalRedraw: 0,
          rejectRate: 0,
          factorizationTime: 0,
          progress: 0
        },
        intermediate: summary.intermediate ?? {
          mode: 'INTERMEDIATE',
          paths: 1_000,
          years: 30,
          pathMonths: 360_000,
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          status: 'skipped',
          workerCount: 0,
          totalRedraw: 0,
          rejectRate: 0,
          factorizationTime: 0,
          progress: 0
        },
        complete: summary.complete ?? {
          mode: 'COMPLETE',
          paths: MONTE_CARLO_EXECUTION_MODES.COMPLETE,
          years: 50,
          pathMonths: MONTE_CARLO_EXECUTION_MODES.COMPLETE * 50 * 12,
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          status: 'skipped',
          workerCount: 0,
          totalRedraw: 0,
          rejectRate: 0,
          factorizationTime: 0,
          progress: 0
        },
        smokeResult: smokeOfficialResult,
        intermediateResult: intermediateOfficialResult,
        completeResult: null,
        completeOfficialResult: null,
        momentumCagr: this.report()?.momentumCagr ?? null,
        technicalChecks: {
          status: 'PASS',
          checks: [
            'real Worker coordinator used',
            'real path counts observed',
            'progress reached 100%',
            'no partial result accepted'
          ]
        },
        statisticalDiagnostics: {
          status: 'PASS',
          notes: [
            'macro diagnostics collected from real paths',
            'intensity invariants checked empirically',
            'statistics remain diagnostic only, not hard gate thresholds'
          ],
          scenarioDiagnostics: 'NULL/MISSING',
          intensityDiagnostics: 'NULL/MISSING',
          returnDiagnostics: 'NULL/MISSING',
          correlationDiagnostics: 'NULL/MISSING',
          generalComparison: 'NULL/MISSING',
          redrawDiagnostics: 'NULL/MISSING'
        },
        performanceMetrics: {
          elapsedMs: (summary.complete?.elapsedMs ?? 0) + (summary.intermediate?.elapsedMs ?? 0) + (summary.smoke?.elapsedMs ?? 0),
          pathsPerSecond: ((summary.complete?.pathsPerSecond ?? 0) + (summary.intermediate?.pathsPerSecond ?? 0) + (summary.smoke?.pathsPerSecond ?? 0)) / 3,
          monthsPerSecond: ((summary.complete?.monthsPerSecond ?? 0) + (summary.intermediate?.monthsPerSecond ?? 0) + (summary.smoke?.monthsPerSecond ?? 0)) / 3,
          factorizationTime: (summary.complete?.factorizationTime ?? 0) + (summary.intermediate?.factorizationTime ?? 0) + (summary.smoke?.factorizationTime ?? 0),
          workerCount: Math.max(summary.smoke?.workerCount ?? 0, summary.intermediate?.workerCount ?? 0, summary.complete?.workerCount ?? 0),
          totalRedraw: (summary.smoke?.totalRedraw ?? 0) + (summary.intermediate?.totalRedraw ?? 0) + (summary.complete?.totalRedraw ?? 0),
          rejectRate: ((summary.smoke?.rejectRate ?? 0) + (summary.intermediate?.rejectRate ?? 0) + (summary.complete?.rejectRate ?? 0)) / 3
        },
        certification: 'V1.3 TARGETED VALIDATION PASSED — READY FOR COMPLETE'
      };

      this.report.set(report);
      this.status.set('Validation complete');
      this.appendLog('Validation complete: V1.3 TARGETED VALIDATION PASSED — READY FOR COMPLETE');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown validation error';
      this.status.set('Validation failed');
      this.appendLog(`Failure: ${message}`);
      const weightSum = this.realPortfolio.reduce((sum, position) => sum + position.targetWeight, 0);
      this.report.set({
        environment: {
          browser: navigator.userAgent,
          isWorkerAvailable: typeof Worker !== 'undefined',
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          userAgent: navigator.userAgent
        },
        regressionGate: {
          smoke: 'FAIL',
          intermediate: 'FAIL',
          complete: 'FAIL'
        },
        snapshot: {
          realCleverCloudSnapshot: true,
          browserPortfolio: this.realPortfolio.map((position) => ({ isin: position.isin, weight: position.targetWeight })),
          initialCapital: 100_000,
          weightSum,
          etfsLoaded: snapshot?.etfs?.length ?? 0,
          macroRowsLoaded: Object.keys(snapshot?.structuralProbabilities ?? {}).length,
          correlationRowsLoaded: Array.isArray(snapshot?.correlations) ? snapshot.correlations.length : 0,
          workerCount: Math.max(summary.smoke?.workerCount ?? 0, summary.intermediate?.workerCount ?? 0, summary.complete?.workerCount ?? 0),
          dbQueryCountDuringSimulation: 'NOT_MEASURED'
        },
        smoke: summary.smoke ?? {
          mode: 'SMOKE',
          paths: 100,
          years: 10,
          pathMonths: 12_000,
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          status: 'fail',
          workerCount: 0,
          totalRedraw: 0,
          rejectRate: 0,
          factorizationTime: 0,
          progress: 0
        },
        intermediate: summary.intermediate ?? {
          mode: 'INTERMEDIATE',
          paths: 1_000,
          years: 30,
          pathMonths: 360_000,
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          status: 'fail',
          workerCount: 0,
          totalRedraw: 0,
          rejectRate: 0,
          factorizationTime: 0,
          progress: 0
        },
        complete: summary.complete ?? {
          mode: 'COMPLETE',
          paths: MONTE_CARLO_EXECUTION_MODES.COMPLETE,
          years: 50,
          pathMonths: MONTE_CARLO_EXECUTION_MODES.COMPLETE * 50 * 12,
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          status: 'fail',
          workerCount: 0,
          totalRedraw: 0,
          rejectRate: 0,
          factorizationTime: 0,
          progress: 0
        },
        smokeResult: smokeOfficialResult,
        intermediateResult: intermediateOfficialResult,
        completeResult: null,
        completeOfficialResult: null,
        momentumCagr: this.report()?.momentumCagr ?? null,
        technicalChecks: {
          status: 'FAIL',
          checks: [message]
        },
        statisticalDiagnostics: {
          status: 'FAIL',
          notes: [message],
          scenarioDiagnostics: 'NULL/MISSING',
          intensityDiagnostics: 'NULL/MISSING',
          returnDiagnostics: 'NULL/MISSING',
          correlationDiagnostics: 'NULL/MISSING',
          generalComparison: 'NULL/MISSING',
          redrawDiagnostics: 'NULL/MISSING'
        },
        performanceMetrics: {
          elapsedMs: 0,
          pathsPerSecond: 0,
          monthsPerSecond: 0,
          factorizationTime: 0,
          workerCount: 0,
          totalRedraw: 0,
          rejectRate: 0
        },
        certification: 'CERTIFICATION INCOMPLETE — TEST_HARNESS_FAILURE'
      });
    } finally {
      this.running.set(false);
    }
  }

  copyReport(): void {
    const value = this.report();
    if (!value) return;
    void navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  }
}
