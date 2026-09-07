import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class QuotationService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // Get daily quotations (fetches from DB or API as needed)
  getDailyQuotations(): Observable<any> {
    return this.http.get(`${this.apiUrl}/quotations/daily`);
  }

  // Get quotation history for a specific ETF
  getQuotationHistory(isin: string, limit: number = 30): Observable<any> {
    return this.http.get(`${this.apiUrl}/quotations/history`, {
      params: { isin, limit: limit.toString() }
    });
  }

  // Delete today's quotations (for refresh)
  deleteTodayQuotations(): Observable<any> {
    return this.http.delete(`${this.apiUrl}/quotations/today`);
  }

  // Force refresh - Update ALL ETFs from JustETF, overwrite DB
  forceRefreshQuotations(): Observable<any> {
    return this.http.post(`${this.apiUrl}/quotations/force-refresh`, {});
  }

  // Refresh single ETF quotation
  refreshSingleQuotation(isin: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/quotations/refresh-single`, {}, {
      params: { isin }
    });
  }
}
