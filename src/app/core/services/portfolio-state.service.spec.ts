import { TestBed } from '@angular/core/testing';
import { PortfolioStateService } from './portfolio-state.service';

describe('PortfolioStateService', () => {
  let service: PortfolioStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PortfolioStateService);
  });

  it('should regenerate the Monte Carlo simulation when requested', () => {
    const initialSummary = service.monteCarloSummary();

    service.runMonteCarloSimulation();

    const updatedSummary = service.monteCarloSummary();
    expect(service.simulationSeed()).toBeGreaterThan(0);
    expect(updatedSummary.simulatedValue).toBeFinite();
    expect(updatedSummary.probabilityPositive).toBeGreaterThanOrEqual(0);
    expect(updatedSummary.probabilityPositive).toBeLessThanOrEqual(1);
    expect(updatedSummary.simulatedValue).not.toBe(initialSummary.simulatedValue);
  });
});
