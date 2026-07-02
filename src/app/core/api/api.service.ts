import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

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

  createETF(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/etf`, data);
  }

  updateETF(id: string, data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/etf/${id}`, data);
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

  // Health check
  healthCheck(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`);
  }
}
