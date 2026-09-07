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

  // Portfolio endpoints
  getPortfolios(): Observable<any> {
    return this.http.get(`${this.apiUrl}/portfolio`);
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

  // Add ETF + correlations atomically (single transaction)
  addEtfWithCorrelations(isin: string, descrizione: string, nome: string, nickname: string | null, ticker: string, quotation: number | null, correlations: any[], macroStatistics?: any, generalStats?: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/etf/add-with-correlations`, { isin, descrizione, nome, nickname, ticker, quotation, correlations, macro_statistics: macroStatistics, general_stats: generalStats });
  }

  // Search ETF on JustETF
  searchJustETF(isin: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/etf/search/justetf?isin=${isin}`);
  }

  // Save ETF correlations
  saveCorrelations(payload: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/correlations`, payload);
  }

  // Get all ETF correlations from DB
  getCorrelations(isin1?: string): Observable<any> {
    const params = isin1 ? `?isin1=${isin1}` : '';
    return this.http.get(`${this.apiUrl}/correlations${params}`);
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

  // Health check
  healthCheck(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`);
  }
}
