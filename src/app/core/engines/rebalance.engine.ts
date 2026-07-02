import { Etf } from '../models/etf.model';
import { BrokerPosition, RebalanceRow } from '../models/rebalance.model';

export class RebalanceEngine {
  static parseBrokerExport(text: string): BrokerPosition[] {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    return lines.slice(1).map(line => {
      const cols = line.split('\t');
      return {
        titolo: cols[0] ?? '',
        isin: cols[1] ?? '',
        simbolo: cols[2] ?? '',
        mercato: cols[3] ?? '',
        strumento: cols[4] ?? '',
        valuta: cols[5] ?? '',
        quantita: this.num(cols[6]),
        prezzoMedioCarico: this.num(cols[7]),
        cambioCarico: this.num(cols[8]),
        valoreCarico: this.num(cols[9]),
        prezzoMercato: this.num(cols[10]),
        cambioMercato: this.num(cols[11]),
        valoreMercatoEur: this.num(cols[12]),
        varPercent: this.num(cols[13]),
        varEur: this.num(cols[14]),
        varValuta: this.num(cols[15]),
        rateo: this.num(cols[16])
      };
    });
  }

  static buildRows(etfs: Etf[], p1: BrokerPosition[], p2: BrokerPosition[], cashToAdd: number): RebalanceRow[] {
    const all = [...p1, ...p2];
    const totalMarketValue = all.reduce((sum, p) => sum + p.valoreMercatoEur, 0);
    const investable = totalMarketValue + cashToAdd;

    return etfs.map(etf => {
      const positions = all.filter(p => p.isin === etf.isin && etf.isin);
      const quantity = positions.reduce((sum, p) => sum + p.quantita, 0);
      const marketValue = positions.reduce((sum, p) => sum + p.valoreMercatoEur, 0);
      const marketPrice = quantity > 0 ? marketValue / quantity : positions[0]?.prezzoMercato ?? 0;
      const currentWeight = totalMarketValue > 0 ? marketValue / totalMarketValue : 0;
      const targetValue = investable * etf.weight;
      const deltaEur = targetValue - marketValue;
      const deltaQuantity = marketPrice > 0 ? Math.trunc(deltaEur / marketPrice) : 0;
      return { etfName: etf.name, isin: etf.isin, targetWeight: etf.weight, quantity, marketPrice, marketValue, currentWeight, targetValue, deltaEur, deltaQuantity };
    });
  }

  private static num(value: string | undefined): number {
    if (!value) return 0;
    return Number(value.replace(/\./g, '').replace(',', '.')) || 0;
  }
}
