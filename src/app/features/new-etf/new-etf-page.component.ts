import { Component, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';
import { TastoConfermaComponent } from '../../shared/components/tasto-conferma/tasto-conferma.component';

const PROMPT_INSTRUCTIONS = `Sei un analista quantitativo specializzato in ETF, asset allocation e comportamento degli strumenti finanziari nei diversi regimi macroeconomici.

Devi analizzare un ETF identificato principalmente tramite ISIN e compilare il JSON di output fornito in fondo al prompt.

Non hai alcun contesto precedente. Tutte le informazioni necessarie devono essere ricavate dai dati presenti nell’input e, quando necessario, da ricerche su fonti pubbliche attendibili.

OBIETTIVO

Produrre un record JSON completo contenente:

1. i dati essenziali dell’ETF target;
2. il rendimento atteso di lungo periodo;
3. il livello di confidenza della stima di lungo periodo;
4. le statistiche annuali condizionate a quattro scenari macroeconomici;
5. le correlazioni attese tra l’ETF target e ciascun ETF già presente nella lista \`existing_etfs\`.

Restituisci esclusivamente JSON valido.

Non aggiungere introduzioni, spiegazioni, commenti, citazioni, blocchi Markdown o testo esterno al JSON.

==================================================
1. IDENTIFICAZIONE DELL’ETF
==================================================

Identifica con precisione l’ETF tramite:

- ISIN;
- nome;
- eventuale ticker;
- eventuale valuta indicata.

Verifica, quando possibile:

- emittente;
- indice o strategia replicata;
- asset class;
- area geografica;
- fattore di investimento;
- composizione;
- valuta base;
- eventuale copertura valutaria;
- replica fisica o sintetica;
- politica di distribuzione;
- duration e qualità creditizia, se obbligazionario;
- esposizione a futures, materie prime o derivati, se applicabile.

Dai priorità alle seguenti fonti:

1. sito ufficiale dell’emittente;
2. factsheet ufficiale;
3. KID/KIID o prospetto;
4. pagina ufficiale dell’indice;
5. fonti finanziarie autorevoli.

Non dedurre la copertura valutaria dalla sola valuta di negoziazione.

==================================================
2. DEFINIZIONI NUMERICHE
==================================================

Tutti i valori percentuali devono essere restituiti in forma decimale.

Esempi:

- 8% = 0.08
- 15,5% = 0.155
- -25% = -0.25

Le correlazioni devono essere comprese tra -1 e +1.

I valori \`confidence\` devono essere compresi tra 0 e 1.

Non usare stringhe percentuali.

==================================================
3. LONG-TERM EXPECTED RETURN
==================================================

Compila:

- \`long_term_expected_return\`
- \`long_term_expected_return_confidence\`

\`long_term_expected_return\` deve rappresentare una stima forward-looking del CAGR nominale annuo di lungo periodo dell’ETF:

- al netto del TER;
- prima di imposte, commissioni di negoziazione e costi personali dell’investitore;
- coerente con la natura dell’asset;
- espresso dal punto di vista di un investitore nella valuta indicata nell’input;
- includendo l’effetto valutario quando l’ETF non è coperto.

Non usare automaticamente il rendimento storico come previsione futura.

Considera, a seconda dell’asset:

- rendimento degli utili e crescita degli utili per l’azionario;
- premi fattoriali per Momentum, Quality, Value, Minimum Volatility, Small Cap e altri fattori;
- yield, duration, rischio tasso e rischio credito per le obbligazioni;
- tassi monetari per strumenti overnight o monetari;
- inflazione, roll yield e struttura dei futures per le commodity;
- rendimento reale, tassi reali e domanda monetaria per l’oro.

\`long_term_expected_return_confidence\` deve esprimere l’affidabilità della stima:

- 0.90-1.00: strumento molto ampio, storico lungo e struttura semplice;
- 0.75-0.89: stima abbastanza solida;
- 0.55-0.74: ETF specialistico, storico limitato o struttura complessa;
- inferiore a 0.55: forte incertezza.

==================================================
4. SCENARI MACROECONOMICI
==================================================

Compila le statistiche per questi quattro scenari:

- \`expansion\`
- \`soft_landing\`
- \`recession\`
- \`stagflation\`

Definizioni:

EXPANSION
Crescita economica sostenuta, utili in aumento, condizioni finanziarie favorevoli e rischio di mercato contenuto o moderato.

SOFT LANDING
Rallentamento ordinato della crescita senza recessione profonda, inflazione in moderazione e politica monetaria progressivamente meno restrittiva.

RECESSION
Contrazione economica, utili sotto pressione, aumento dell’avversione al rischio, possibile ampliamento degli spread e successivo calo dei tassi.

STAGFLATION
Crescita debole o negativa insieme a inflazione persistente, tassi reali o nominali elevati e pressione sui margini.

==================================================
5. STATISTICHE PER SCENARIO
==================================================

Per ogni scenario compila esattamente cinque valori:

- \`expected_return\`
- \`volatility\`
- \`max_drawdown\`
- \`return_range.min\`
- \`return_range.max\`

Definizioni:

\`expected_return\`
Rendimento annuo semplice medio atteso, condizionato al verificarsi dello scenario.

\`volatility\`
Volatilità annualizzata attesa dei rendimenti nello scenario.

\`max_drawdown\`
Drawdown massimo plausibile durante un episodio significativo dello scenario. Deve essere zero o negativo.

\`return_range.min\`
Estremo annuale negativo plausibile del rendimento semplice nello scenario.

\`return_range.max\`
Estremo annuale positivo plausibile del rendimento semplice nello scenario.

Regole obbligatorie:

return_range.min <= expected_return <= return_range.max

max_drawdown <= 0

volatility >= 0

return_range.min >= -1

I range devono rappresentare estremi plausibili per la simulazione, non eventi teoricamente illimitati.

Le statistiche devono essere coerenti tra loro. Un ETF più volatile deve generalmente avere range più ampi. Un ETF difensivo deve normalmente avere drawdown e volatilità inferiori a un ETF azionario aggressivo.

==================================================
6. CORRELAZIONI
==================================================

Per ogni elemento presente in \`existing_etfs\`, genera esattamente un elemento nella lista \`correlations\`.

La lunghezza di \`correlations\` deve essere identica alla lunghezza di \`existing_etfs\`.

Se \`existing_etfs\` è vuoto:

"correlations": []

Per ogni ETF esistente compila:

- \`target_isin\`
- \`expansion\`
- \`soft_landing\`
- \`recession\`
- \`stagflation\`
- \`confidence\`
- \`drivers\`

\`target_isin\` deve coincidere esattamente con l’ISIN dell’ETF esistente.

La correlazione deve rappresentare la correlazione Pearson attesa tra i rendimenti annuali dei due strumenti, condizionata allo scenario.

Non correlare i prezzi assoluti.

Considera:

- asset class condivisa;
- esposizione geografica;
- fattore;
- settori;
- duration;
- rischio credito;
- esposizione valutaria;
- sensibilità a inflazione e tassi;
- comportamento risk-on/risk-off;
- struttura fisica, sintetica o basata su futures.

Le correlazioni possono cambiare tra scenari. In particolare:

- nelle recessioni le correlazioni tra asset rischiosi possono aumentare;
- governativi di alta qualità e azionario possono diventare più negativamente correlati nelle recessioni disinflazionistiche;
- oro e commodity possono comportarsi diversamente in recessione e stagflazione;
- strumenti monetari devono normalmente avere correlazioni prossime a zero;
- ETF con benchmark, universo e fattori simili devono avere correlazioni elevate.

\`confidence\` indica l’affidabilità della stima della coppia.

\`drivers\` deve essere un array di stringhe sintetiche che spieghi i principali fattori della correlazione.

Usa preferibilmente valori scelti da questo vocabolario:

- global_equity
- developed_markets
- emerging_markets
- us_equity
- europe_equity
- large_cap
- mid_cap
- small_cap
- momentum
- quality
- value
- growth
- minimum_volatility
- healthcare
- consumer_staples
- clean_energy
- government_bonds
- corporate_bonds
- inflation_linked
- inflation_expectations
- duration_short
- duration_medium
- duration_long
- credit_risk
- interest_rate_sensitivity
- gold
- commodities
- energy
- industrial_metals
- agriculture
- overnight_cash
- inflation_protection
- systemic_risk_hedge
- defensive_asset
- cyclical_asset
- equity_market_beta
- factor_divergence
- usd_exposure
- eur_exposure
- currency_diversification
- futures_roll_yield

==================================================
7. GESTIONE DEI DATI INCERTI
==================================================

Se non esistono statistiche pubbliche direttamente osservabili per uno scenario:

- non lasciare il valore a zero;
- non usare null;
- produci una stima quantitativa ragionata;
- riduci il livello di confidence;
- mantieni coerenza con asset class, benchmark e struttura del prodotto.

Non inventare ISIN, ticker o caratteristiche anagrafiche non verificabili.

Se il ticker non è fornito e non è identificabile con sufficiente sicurezza, conserva il valore presente nell’input oppure usa null.

==================================================
8. VALIDAZIONI FINALI
==================================================

Prima di restituire il JSON verifica:

1. JSON sintatticamente valido;
2. nessuna chiave obbligatoria mancante;
3. nessuna chiave aggiuntiva rispetto al template;
4. tutti i numeri sono numeri JSON e non stringhe;
5. tutti i valori percentuali sono decimali;
6. tutte le correlazioni sono comprese tra -1 e +1;
7. tutte le confidence sono comprese tra 0 e 1;
8. per ogni scenario:
   min <= expected_return <= max;
9. tutti i max_drawdown sono <= 0;
10. \`correlations.length === existing_etfs.length\`;
11. ogni ETF esistente compare una sola volta in \`correlations\`;
12. l’ordine delle correlazioni deve seguire l’ordine di \`existing_etfs\`;
13. non devono comparire correlazioni dell’ETF target con sé stesso;
14. non modificare gli ISIN ricevuti;
15. non aggiungere fonti, metadata o note esterne allo schema.

==================================================
9. FORMATO DI OUTPUT OBBLIGATORIO
==================================================

Mantieni esattamente la struttura del JSON seguente.

Popola i valori a zero e i campi dell’ETF target con i risultati dell’analisi.

Non aggiungere, rinominare o eliminare proprietà.

Restituisci esclusivamente il JSON compilato.

INPUT:

{
  "task": "build_etf_database_record_with_macro_correlations_and_macro_statistics",
  "version": "3.1",
  "target_etf": {
    "isin": "{{TARGET_ISIN}}",
    "name": "{{TARGET_NAME}}",
    "currency": "{{TARGET_CURRENCY}}",
    "long_term_expected_return": 0,
	"volatility": 0,
    "max_drawdown": 0,
	"return_range": {
      "min": 0,
      "max": 0
    }
    "notes": "Nuovo ETF da aggiungere al database"
  },
  "target_macro_statistics": {
    "isin": "{{TARGET_ISIN}}",
    "expansion": {
      "expected_return": 0,
      "volatility": 0,
      "max_drawdown": 0,
      "return_range": {
        "min": 0,
        "max": 0
      }
    },
    "soft_landing": {
      "expected_return": 0,
      "volatility": 0,
      "max_drawdown": 0,
      "return_range": {
        "min": 0,
        "max": 0
      }
    },
    "recession": {
      "expected_return": 0,
      "volatility": 0,
      "max_drawdown": 0,
      "return_range": {
        "min": 0,
        "max": 0
      }
    },
    "stagflation": {
      "expected_return": 0,
      "volatility": 0,
      "max_drawdown": 0,
      "return_range": {
        "min": 0,
        "max": 0
      }
    }
  },
  "macro_scenarios": [
    "expansion",
    "soft_landing",
    "recession",
    "stagflation"
  ],
  "required_statistics_per_scenario": [
    "expected_return",
    "volatility",
    "max_drawdown",
    "return_range.min",
    "return_range.max"
  ],
  "existing_etfs": {{EXISTING_ETFS_JSON_ARRAY}},
  "correlations": {{CORRELATIONS_PLACEHOLDER_ARRAY}},
  "output_format": {
    "type": "json",
    "include_target_record": true,
    "include_macro_statistics": true,
    "include_correlations": true,
    "correlation_direction": "target_to_existing_only"
  }
}`;

@Component({
  selector: 'app-new-etf-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TastoConfermaComponent],
  templateUrl: './new-etf-page.component.html',
  styleUrls: ['./new-etf-page.component.css']
})
export class NewEtfPageComponent implements OnInit {
  isin = signal('');
  nickname = signal('');
  loading = signal(false);
  successMessage = signal('');
  errorMessage = signal('');
  allEtfs = signal<any[]>([]);

  // JustETF search
  searchingJustETF = signal(false);
  searchError = signal('');
  etfName = signal('');
  etfTicker = signal('');
  etfQuotation = signal<number | null>(null);

  // Correlation JSON input
  correlationJson = signal('');
  correlationLoading = signal(false);
  correlationSuccess = signal('');
  correlationError = signal('');
  promptCopied = signal(false);

  isDuplicateIsin = computed(() => {
    const isinValue = this.isin().trim().toUpperCase();
    if (!isinValue) return false;
    return this.allEtfs().some(etf => etf.isin.toUpperCase() === isinValue);
  });

  canSubmitAll = computed(() => {
    const isinValue = this.isin().trim();
    const jsonValue = this.correlationJson().trim();
    return !!isinValue && !!jsonValue && !this.correlationLoading();
  });

  promptText = computed(() => {
    const isinValue = this.isin().trim().toUpperCase();
    const nameValue = this.etfName().trim();
    const nicknameValue = this.nickname().trim();

    if (!isinValue || !nameValue) return '';

    const existingEtfs = this.allEtfs().map(etf => ({
      isin: etf.isin,
      name: etf.name || etf.description || '',
      nickname: etf.nickname || null
    }));

    const promptPayload = {
      task: 'build_etf_database_record_with_macro_correlations_and_macro_statistics',
      version: '3.0',
      target_etf: {
        isin: isinValue,
        name: nameValue,
        nickname: nicknameValue || null,
        ticker: this.etfTicker() || null,
        currency: 'EUR',
        long_term_expected_return: 0,
        long_term_expected_return_confidence: 0,
        volatility: 0,
        max_drawdown: 0,
        return_range: { min: 0, max: 0 }
      },
      target_macro_statistics: {
        isin: isinValue,
        long_term_expected_return: 0,
        long_term_expected_return_confidence: 0,
        expansion: { expected_return: 0, volatility: 0, max_drawdown: 0, return_range: { min: 0, max: 0 } },
        soft_landing: { expected_return: 0, volatility: 0, max_drawdown: 0, return_range: { min: 0, max: 0 } },
        recession: { expected_return: 0, volatility: 0, max_drawdown: 0, return_range: { min: 0, max: 0 } },
        stagflation: { expected_return: 0, volatility: 0, max_drawdown: 0, return_range: { min: 0, max: 0 } }
      },
      existing_etfs: existingEtfs,
      correlations: []
    };

    return PROMPT_INSTRUCTIONS + '\n\n' + JSON.stringify(promptPayload, null, 2);
  });

  constructor(private apiService: ApiService) {}

  ngOnInit(): void {
    this.loadAllEtfs();
  }

  private loadAllEtfs(): void {
    this.apiService.getAllEtfs().subscribe({
      next: (response: any) => {
        if (response.success && Array.isArray(response.data)) {
          this.allEtfs.set(response.data);
        }
      },
      error: () => {}
    });
  }

  searchOnJustETF(): void {
    const isinValue = this.isin().trim().toUpperCase();
    if (!isinValue || isinValue.length < 12) return;

    this.searchingJustETF.set(true);
    this.searchError.set('');
    this.etfName.set('');
    this.etfTicker.set('');
    this.etfQuotation.set(null);

    this.apiService.searchJustETF(isinValue).subscribe({
      next: (response: any) => {
        this.searchingJustETF.set(false);
        if (response.success && response.data) {
          this.etfName.set(response.data.name || '');
          this.etfTicker.set(response.data.ticker || '');
          this.etfQuotation.set(response.data.quotation ?? null);
        } else {
          this.searchError.set('ETF non trovato su JustETF');
        }
      },
      error: (error: any) => {
        this.searchingJustETF.set(false);
        this.searchError.set('Errore nella ricerca: ' + (error.error?.error || 'problema di connessione'));
      }
    });
  }

  copyPrompt(): void {
    const text = this.promptText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.promptCopied.set(true);
      setTimeout(() => this.promptCopied.set(false), 2000);
    });
  }

  onNicknameInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.nickname.set(target.value);
  }

  addAndSave(): void {
    const isinValue = this.isin().trim().toUpperCase();
    const jsonValue = this.correlationJson().trim();
    const nicknameValue = this.nickname().trim();

    if (!isinValue || !jsonValue) {
      this.correlationError.set('Inserisci ISIN e JSON correlazioni prima di procedere.');
      return;
    }

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(jsonValue);
    } catch {
      this.correlationError.set('JSON non valido. Verifica il formato e riprova.');
      return;
    }

    this.correlationLoading.set(true);
    this.correlationError.set('');
    this.correlationSuccess.set('');

    const correlations = parsedJson.correlations ?? [];
    const macroStats = parsedJson.target_macro_statistics ?? null;
    const generalStats = parsedJson.target_etf ?? null;
    const nome = parsedJson.target_etf?.name || this.etfName() || '';
    const ticker = parsedJson.target_etf?.ticker || this.etfTicker() || '';
    const quotation = this.etfQuotation();

    this.apiService.addEtfWithCorrelations(
      isinValue,
      nome,
      nome,
      nicknameValue || null,
      ticker,
      quotation,
      correlations,
      macroStats,
      generalStats
    ).subscribe({
      next: (response: any) => {
        this.correlationLoading.set(false);
        if (response.success) {
          this.correlationSuccess.set(response.message || 'ETF e correlazioni salvati con successo.');
          this.isin.set('');
          this.nickname.set('');
          this.correlationJson.set('');
          this.etfName.set('');
          this.etfTicker.set('');
          this.etfQuotation.set(null);
          this.loadAllEtfs();
          setTimeout(() => this.correlationSuccess.set(''), 4000);
        } else {
          this.correlationError.set(response.error || 'Errore nel salvataggio.');
        }
      },
      error: (error: any) => {
        this.correlationLoading.set(false);
        let errorMsg = 'Errore nel salvataggio.';
        if (typeof error === 'string') {
          errorMsg = error;
        } else if (error?.error?.error && typeof error.error.error === 'string') {
          errorMsg = error.error.error;
          if (error.error.details?.length) {
            const detailStr = error.error.details.map((d: any) => `${d.field}: ${d.message}`).join('; ');
            errorMsg += ` — Dettagli: ${detailStr}`;
          }
        } else if (error?.error?.message && typeof error.error.message === 'string') {
          errorMsg = error.error.message;
        } else if (error?.message && typeof error.message === 'string') {
          errorMsg = error.message;
        } else if (typeof error?.error === 'string') {
          errorMsg = error.error;
        }
        this.correlationError.set(errorMsg);
      }
    });
  }
}
