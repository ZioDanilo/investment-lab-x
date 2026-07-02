export interface BrokerPosition {
  titolo: string;
  isin: string;
  simbolo: string;
  mercato: string;
  strumento: string;
  valuta: string;
  quantita: number;
  prezzoMedioCarico: number;
  cambioCarico: number;
  valoreCarico: number;
  prezzoMercato: number;
  cambioMercato: number;
  valoreMercatoEur: number;
  varPercent: number;
  varEur: number;
  varValuta: number;
  rateo: number;
}

export interface RebalanceRow {
  etfName: string;
  isin: string;
  targetWeight: number;
  quantity: number;
  marketPrice: number;
  marketValue: number;
  currentWeight: number;
  targetValue: number;
  deltaEur: number;
  deltaQuantity: number;
}
