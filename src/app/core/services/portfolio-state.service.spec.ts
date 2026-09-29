import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PortfolioStateService } from './portfolio-state.service';
import { PortfolioSelectionService } from './portfolio-selection.service';
import { MontecarloPortfolioEditorComponent } from '../../shared/components/montecarlo-portfolio-editor/montecarlo-portfolio-editor.component';
import { ApiService } from '../api/api.service';

describe('PortfolioStateService', () => {
  let service: PortfolioStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(PortfolioStateService);
  });

  it('should regenerate the Monte Carlo simulation when requested', () => {
    const initialSummary = service.monteCarloSummary();

    service.runMonteCarloSimulation();

    const updatedSummary = service.monteCarloSummary();
    expect(service.simulationSeed()).toBeGreaterThan(0);
    expect(Number.isFinite(updatedSummary.simulatedValue)).toBeTrue();
    expect(updatedSummary.probabilityPositive).toBeGreaterThanOrEqual(0);
    expect(updatedSummary.probabilityPositive).toBeLessThanOrEqual(1);
    expect(updatedSummary.simulatedValue).not.toBe(initialSummary.simulatedValue);
  });
});

describe('PortfolioSelectionService working portfolio semantics', () => {
  let service: PortfolioSelectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(PortfolioSelectionService);
  });

  it('preserves the active working portfolio across a route change while the selected portfolio stays the same', () => {
    const soniaId = 'sonia';
    const soniaWorking = {
      id: soniaId,
      name: 'Sonia',
      holdings: [{ etfId: 'A', weight: 40 }, { etfId: 'B', weight: 30 }, { etfId: 'C', weight: 20 }, { etfId: 'D', weight: 10 }]
    };

    service.setSelectedPortfolio(soniaId);
    service.preserveWorkingPortfolio(soniaId, soniaWorking);

    expect(service.currentWorkingPortfolioId()).toBe(soniaId);
    expect(service.workingPortfolio()?.holdings).toEqual(soniaWorking.holdings);

    service.setSelectedPortfolio(soniaId);
    expect(service.currentWorkingPortfolioId()).toBe(soniaId);
    expect(service.workingPortfolio()?.holdings).toEqual(soniaWorking.holdings);
  });

  it('drops the previous unsaved working state when selecting a different portfolio from the dropdown', () => {
    const soniaId = 'sonia';
    const portfolioTestId = 'portfolio-test';
    const soniaWorking = {
      id: soniaId,
      name: 'Sonia',
      holdings: [{ etfId: 'A', weight: 40 }, { etfId: 'B', weight: 30 }, { etfId: 'C', weight: 20 }, { etfId: 'D', weight: 10 }]
    };

    service.setSelectedPortfolio(soniaId);
    service.preserveWorkingPortfolio(soniaId, soniaWorking);
    service.setSelectedPortfolio(portfolioTestId);

    expect(service.currentWorkingPortfolioId()).toBe(portfolioTestId);
    expect(service.workingPortfolio()).toBeNull();
    expect(service.originalPortfolioSnapshot()).toBeNull();

    const reloadedSonia = {
      id: soniaId,
      name: 'Sonia',
      holdings: [{ etfId: 'A', weight: 50 }, { etfId: 'B', weight: 30 }, { etfId: 'C', weight: 20 }]
    };

    const restored = service.restoreWorkingPortfolio(soniaId, reloadedSonia);
    expect(restored?.holdings).toEqual(reloadedSonia.holdings);
    expect(service.currentWorkingPortfolioId()).toBe(soniaId);
    expect(service.workingPortfolio()?.holdings).toEqual(reloadedSonia.holdings);
  });

  it('preserves the original percent weights when a working portfolio is restored from session state', () => {
    const fixture = TestBed.createComponent(MontecarloPortfolioEditorComponent);
    const component = fixture.componentInstance;

    const holdings = [
      { etfId: 'A', isin: 'A', ticker: 'A', name: 'ETF A', fullName: 'ETF A', weight: 31 },
      { etfId: 'B', isin: 'B', ticker: 'B', name: 'ETF B', fullName: 'ETF B', weight: 24 },
      { etfId: 'C', isin: 'C', ticker: 'C', name: 'ETF C', fullName: 'ETF C', weight: 17 },
      { etfId: 'D', isin: 'D', ticker: 'D', name: 'ETF D', fullName: 'ETF D', weight: 13 },
      { etfId: 'E', isin: 'E', ticker: 'E', name: 'ETF E', fullName: 'ETF E', weight: 9 },
      { etfId: 'F', isin: 'F', ticker: 'F', name: 'ETF F', fullName: 'ETF F', weight: 6 }
    ];

    const mapped = holdings.map((holding) => component['mapHoldingToItem'](holding));

    expect(mapped.map((item) => item.weight)).toEqual([31, 24, 17, 13, 9, 6]);
    expect(mapped.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it('preserves the edited working weights after navigating away and back', () => {
    const fixture = TestBed.createComponent(MontecarloPortfolioEditorComponent);
    const component = fixture.componentInstance;
    const service = TestBed.inject(PortfolioSelectionService);

    const snapshot = {
      id: 'portfolio-1',
      name: 'Portfolio 1',
      holdings: [
        { etfId: 'A', isin: 'A', ticker: 'A', nickname: 'A', fullName: 'ETF A', weight: 40 },
        { etfId: 'B', isin: 'B', ticker: 'B', nickname: 'B', fullName: 'ETF B', weight: 35 },
        { etfId: 'C', isin: 'C', ticker: 'C', nickname: 'C', fullName: 'ETF C', weight: 25 }
      ]
    };

    service.preserveWorkingPortfolio('portfolio-1', snapshot);
    const restored = component['mapHoldingToItem'](snapshot.holdings[0]);
    const second = component['mapHoldingToItem'](snapshot.holdings[1]);
    const third = component['mapHoldingToItem'](snapshot.holdings[2]);

    expect([restored.weight, second.weight, third.weight]).toEqual([40, 35, 25]);
    expect(service.workingPortfolio()?.holdings.map((holding) => holding.weight)).toEqual([40, 35, 25]);
  });
});
