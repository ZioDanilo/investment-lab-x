import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CalibrationRequest {
  longTermExpectedReturn: number;
}

export interface CalibrationResponse {
  success: boolean;
  message: string;
  data?: {
    isin: string;
    name: string;
    longTermExpectedReturn: number;
    calibratedAt: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class CalibrationService {
  private readonly apiUrl = `${environment.apiUrl}/etf`;

  constructor(private http: HttpClient) {}

  /**
   * Calibrate a single ETF by ISIN
   */
  calibrateETF(isin: string, longTermExpectedReturn: number): Observable<CalibrationResponse> {
    return this.http.post<CalibrationResponse>(
      `${this.apiUrl}/${isin}/calibrate`,
      { longTermExpectedReturn }
    );
  }
}