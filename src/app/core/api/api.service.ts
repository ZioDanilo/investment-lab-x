import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  MonteCarloSnapshotRequest,
  MonteCarloSnapshotResponse
} from '../models/monte-carlo-contracts.model';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  login(username: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/login`, { username, password });
  }

  register(username: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/register`, { username, password });
  }

  checkUsernameAvailability(username: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/auth/username-availability?username=${encodeURIComponent(username)}`);
  }

  // Portfolio endpoints
  getPortfolios(tipo?: 'reale' | 'laboratorio'): Observable<any> {
    const suffix = tipo ? `?tipo=${tipo}` : '';
    return this.http.get(`${this.apiUrl}/portfolio${suffix}`);
  }

  getPortfolioById(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/portfolio/${id}`);
  }

  createPortfolio(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/portfolio`, data);
  }

  updatePortfolio(id: string, data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/portfolio/${id}`, data);
  }

  deletePortfolio(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/portfolio/${id}`);
  }

  getPortfolioKpiTargets(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/portfolio/${id}/kpi-targets`);
  }

  savePortfolioKpiTargets(id: string, kpis: Array<{ kpi: string; priority: number; target: string | null }>): Observable<any> {
    return this.http.put(`${this.apiUrl}/portfolio/${id}/kpi-targets`, { kpis });
  }

  // Trend Following: one persisted strategy and its ETF slots per real portfolio.
  getTrendFollowingEtfs(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/trend-following/${encodeURIComponent(portfolioId)}/etfs`);
  }

  getTrendCriteria(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/trend-following/${encodeURIComponent(portfolioId)}/criteria`);
  }

  saveTrendCriteria(portfolioId: string, criteria: Array<{strategyKey:string;isin:string;benchmarkIsin:string}>): Observable<any> {
    return this.http.put(`${this.apiUrl}/trend-following/${encodeURIComponent(portfolioId)}/criteria`, {criteria});
  }

  getTrendFollowingSettings(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/trend-following/${encodeURIComponent(portfolioId)}`);
  }

  saveTrendFollowingSettings(portfolioId: string, strategyKey: string, etfIsins: string[]): Observable<any> {
    return this.http.put(`${this.apiUrl}/trend-following/${encodeURIComponent(portfolioId)}`, {
      strategyKey, settings: { etfIsins }
    });
  }

  getTrendEtfSelections(portfolioId: string, strategyKey: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/trend-following/${encodeURIComponent(portfolioId)}/strategies/${encodeURIComponent(strategyKey)}/etfs`);
  }

  saveTrendEtfSelections(portfolioId: string, strategyKey: string, etfIsins: string[]): Observable<any> {
    return this.http.put(`${this.apiUrl}/trend-following/${encodeURIComponent(portfolioId)}/strategies/${encodeURIComponent(strategyKey)}/etfs`, { etfIsins });
  }

  // Real portfolio endpoints
  getRealPortfolios(): Observable<any> {
    return this.http.get(`${this.apiUrl}/real-portfolios`);
  }

  createRealPortfolio(data: { name: string; description?: string | null }): Observable<any> {
    return this.http.post(`${this.apiUrl}/real-portfolios`, data);
  }

  deleteRealPortfolio(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/real-portfolios/${id}`);
  }

  getLatestRealPortfolioOperations(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/real-portfolios/${portfolioId}/operations/latest`);
  }

  getRealPortfolioOperations(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/real-portfolios/${portfolioId}/operations`);
  }

  updateRealPortfolioOrder(portfolioIds: string[]): Observable<any> {
    return this.http.put(`${this.apiUrl}/real-portfolios/order`, { portfolioIds });
  }

  getRealPortfolioMarketValues(): Observable<any> {
    return this.http.get(`${this.apiUrl}/real-portfolios/market-values`);
  }

  getRealPortfolioMarketValue(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/real-portfolios/${portfolioId}/market-value`);
  }

  getLatestStoredQuotation(isin: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/quotations/history?isin=${encodeURIComponent(isin)}&limit=1`);
  }

  getRealPortfolioHistory(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/real-portfolios/${portfolioId}/history`);
  }

  getRealPortfolioHoldings(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/real-portfolios/${portfolioId}/holdings`);
  }

  createRealPortfolioOperation(portfolioId: string, data: { operationType: 'buy' | 'sell'; etfId: string; operationDate: string; quantity: number; unitPrice: number }): Observable<any> {
    return this.http.post(`${this.apiUrl}/real-portfolios/${portfolioId}/operations`, data);
  }

  refreshSingleEodhdQuotation(isin: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/quotations/single/${encodeURIComponent(isin)}/refresh`, {});
  }

  refreshRealPortfolioQuotations(portfolioId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/quotations/real-portfolio/${portfolioId}/refresh`, {});
  }

  // ETF endpoints
  getETFs(): Observable<any> {
    return this.http.get(`${this.apiUrl}/etf`);
  }

  getETFById(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/etf/${id}`);
  }

  // Get all ETFs (for quotations page)
  getAllEtfs(): Observable<any> {
    return this.http.get(`${this.apiUrl}/etf/list/all`);
  }

  // Delete ETF and all related data
  deleteEtf(isin: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/etf/${isin}/delete`);
  }

  createETF(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/etf`, data);
  }

  updateETF(id: string, data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/etf/${id}`, data);
  }

  // Add ETF endpoint (new)
  addEtf(isin: string, descrizione: string, nickname?: string | null): Observable<any> {
    return this.http.post(`${this.apiUrl}/etf/add`, { isin, descrizione, nickname });
  }

  // Search ETF on JustETF
  searchJustETF(isin: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/etf/search/justetf?isin=${isin}`);
  }

  // Search ETF by ISIN or description
  searchETF(query: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/portfolio/search-etf?q=${query}`);
  }

  // Save portafoglio
  savePortafoglio(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/portfolio`, data);
  }

  // KPI endpoints
  calculateKPIs(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/kpi/calculate`, data);
  }

  getKPIMetrics(portfolioId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/kpi/metrics/${portfolioId}`);
  }

  // Rebalance endpoints
  suggestRebalance(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/rebalance/suggest`, data);
  }

  executeRebalance(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/rebalance/execute`, data);
  }

  // Monte Carlo endpoints
  getMonteCarloConfig(): Observable<any> {
    return this.http.get(`${this.apiUrl}/monte-carlo/config`);
  }

  getMonteCarloSnapshot(request: MonteCarloSnapshotRequest): Observable<MonteCarloSnapshotResponse> {
    return this.http.post<MonteCarloSnapshotResponse>(`${this.apiUrl}/monte-carlo/snapshot`, request);
  }

  // Market Universe endpoints
  getMarketUniverseAssets(): Observable<any> {
    return this.http.get(`${this.apiUrl}/market-universe/assets`);
  }

  getMarketUniverseAssetByIsin(isin: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/market-universe/assets/isin/${encodeURIComponent(isin)}`);
  }

  diagnoseMarketUniverseEtfV2(isin: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/market-universe/v2/diagnostics/etf/${encodeURIComponent(isin)}`);
  }

  // Market Universe V2: ETF-oriented persistence, no application warm-up cache.
  getMarketUniverseV2GenerationStatus(): Observable<any> {
    return this.http.get(`${this.apiUrl}/market-universe/v2/generation-status`);
  }

  regenerateMarketUniverseV2(): Observable<any> {
    return this.http.post(`${this.apiUrl}/market-universe/v2/regenerate`, {});
  }

  buildBinaryPortfolioProjectionV2(payload: any): Observable<ArrayBuffer> {
    return this.http.post(`${this.apiUrl}/market-universe/v2/portfolio/projection/binary`, payload, {
      responseType: 'arraybuffer'
    });
  }

  // Health check
  healthCheck(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`);
  }
  // Factor Engine V2 diagnostic endpoints
  getFactorUniverseReadiness(): Observable<any> {
    return this.http.get(`${this.apiUrl}/factor-engine/universe/readiness`);
  }

  getFactorUniversePreview(): Observable<any> {
    return this.http.get(`${this.apiUrl}/factor-engine/universe/preview`);
  }

  generateFactorUniverseSample(payload: { scenario: string; intensity: number; seed: number }): Observable<any> {
    return this.http.post(`${this.apiUrl}/factor-engine/universe/sample`, payload);
  }

  runFactorUniverseStatisticalTest(payload: { scenario: string; intensity: number; seed: number; samples: number }): Observable<any> {
    return this.http.post(`${this.apiUrl}/factor-engine/universe/statistical-test`, payload);
  }

  evaluateEtfHistoricalValidation(payload: { etfId?: string; isin?: string; rows: Array<{ date?: string; realReturn: number; modelReturn: number }> }): Observable<any> {
    return this.http.post(`${this.apiUrl}/factor-engine/validation/etf/evaluate`, payload);
  }
}
