import { Etf } from '../models/etf.model';

export const INITIAL_ETFS: Etf[] = [
  { id:'momentum', name:'Momentum', isin:'IE00BL25JP72', ticker:'XDEM.MI', compartment:'Crescita', mission:'Trend e crescita', weight:0.25, expectedReturn:0.122, volatility:0.18, maxDrawdown:-0.60, ter:0.0025, liquidity:5, recession:-0.12, stagflation:-0.06 },
  { id:'quality', name:'Quality', isin:'IE00BP3QZ601', compartment:'Crescita', mission:'Qualità utili', weight:0.25, expectedReturn:0.117, volatility:0.13, maxDrawdown:-0.45, ter:0.0025, liquidity:5, recession:0.06, stagflation:0.07 },
  { id:'minvol', name:'Minimum Volatility', isin:'IE00B8FHGS14', ticker:'MVOL.MI', compartment:'Difesa', mission:'Riduzione volatilità', weight:0.12, expectedReturn:0.081, volatility:0.10, maxDrawdown:-0.30, ter:0.0030, liquidity:5, recession:0.07, stagflation:0.05 },
  { id:'healthcare', name:'Healthcare', isin:'IE00BYZK4776', ticker:'HEAL.MI', compartment:'Difesa', mission:'Difesa strutturale', weight:0.10, expectedReturn:0.1015, volatility:0.14, maxDrawdown:-0.35, ter:0.0025, liquidity:5, recession:0.08, stagflation:0.09 },
  { id:'staples', name:'Consumer Staples', isin:'IE000ZIJ5B20', ticker:'STAW.MI', compartment:'Difesa', mission:'Consumi essenziali', weight:0.00, expectedReturn:0.0755, volatility:0.11, maxDrawdown:-0.30, ter:0.0025, liquidity:4, recession:0.10, stagflation:0.10 },
  { id:'gov13', name:'Gov Bonds EU 1-3Y', isin:'', compartment:'Stabilità', mission:'Stabilità e ribilanciamento', weight:0.08, expectedReturn:0.031, volatility:0.03, maxDrawdown:-0.08, ter:0.0015, liquidity:5, recession:0.06, stagflation:0.03 },
  { id:'gov710', name:'Gov Bonds EU 7-10Y', isin:'', compartment:'Recessione', mission:'Taglio tassi', weight:0.00, expectedReturn:-0.0055, volatility:0.08, maxDrawdown:-0.25, ter:0.0015, liquidity:5, recession:0.12, stagflation:-0.08 },
  { id:'inflinked', name:'Inflation Linked Bonds', isin:'', compartment:'Inflazione', mission:'Inflazione realizzata', weight:0.00, expectedReturn:0.0175, volatility:0.06, maxDrawdown:-0.20, ter:0.0020, liquidity:4, recession:0.07, stagflation:0.12 },
  { id:'infexpect', name:'Inflation Expectations 2-10Y', isin:'LU1390062245', compartment:'Inflazione', mission:'Aspettative inflazione', weight:0.00, expectedReturn:0.019, volatility:0.075, maxDrawdown:-0.18, ter:0.0025, liquidity:4, recession:0.04, stagflation:0.16 },
  { id:'gold', name:'Gold', isin:'IE00B579F325', ticker:'SGLD.MI', compartment:'Inflazione', mission:'Crisi sistemiche', weight:0.07, expectedReturn:0.077, volatility:0.15, maxDrawdown:-0.45, ter:0.0015, liquidity:5, recession:0.10, stagflation:0.15 },
  { id:'commodities', name:'Commodities', isin:'IE00BKY4W127', ticker:'PCOM.MI', compartment:'Inflazione', mission:'Shock materie prime', weight:0.05, expectedReturn:0.0775, volatility:0.20, maxDrawdown:-0.60, ter:0.0019, liquidity:4, recession:-0.05, stagflation:0.18 },
  { id:'cash', name:'Overnight / Cash', isin:'LU0290358497', ticker:'XEON.MI', compartment:'Liquidità', mission:'Liquidità investita', weight:0.08, expectedReturn:0.034, volatility:0.005, maxDrawdown:-0.01, ter:0.0010, liquidity:5, recession:0.05, stagflation:0.02 }
];
