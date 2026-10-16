# Checklist di pubblicazione AdSense — Razer

## Implementato
- Pagina pubblica informativa, accessibile senza autenticazione: /chi-siamo.
- Rotte pubbliche per privacy, cookie e contatti.
- robots.txt che consente la scansione.
- Nessuno script AdSense o tracker aggiunto prima del consenso.

## Da completare PRIMA della domanda di approvazione
- Sostituire le pagine privacy/cookie provvisorie con informative verificate basate sui trattamenti effettivi (inclusi autenticazione, hosting, log, analytics e fornitori).
- Pubblicare ragione sociale/nome del titolare, dati obbligatori e contatto verificato.
- Aggiungere contenuti originali pubblici di qualità (guide approfondite, metodologia, esempi, rischi e limiti) e collegarli dalla landing.
- Verificare che Google possa esaminare contenuti sostanziali senza login.
- Audit di pagine con dati dimostrativi: etichettare chiaramente i dati fittizi.
- Definire e implementare CMP conforme per SEE/UK/Svizzera prima di annunci personalizzati o tracciamenti non essenziali.
- Aggiungere il codice AdSense e ads.txt solo dopo aver ottenuto l'ID publisher reale; non inventare ID.
- Verificare ownership dominio, disponibilità pubblica, HTTPS, navigazione mobile, errori 404, assenza di contenuti vuoti e rispetto delle policy AdSense.
- Verificare l'idoneità degli spazi da 150px e le regole sui posizionamenti prima di pubblicare annunci reali.
- Chiarire titolarità e trattamento fiscale dei ricavi.

Nessuna modifica in questo branch garantisce l'approvazione di Google.

## Google Analytics 4
- Servizio Angular di tracciamento page_view sulle navigazioni SPA, senza parametri personali o query string.
- Nessuna richiesta GA4 senza consenso esplicito; pulsanti Accetta/Rifiuta e revoca.
- Configurare gaMeasurementId in src/environments/environment.prod.ts dopo aver creato la proprietà GA4.
- Verificare l'informativa privacy completa e la CMP prima della messa in produzione: il banner implementato è un consenso basilare per sole statistiche, non una CMP pubblicitaria certificata.
- Le impression AdSense non sono conteggiate da GA4: richiedono integrazione AdSense separata e ID publisher.
