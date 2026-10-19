import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AnalyticsService } from '../../core/services/analytics.service';

@Component({
 selector:'app-public-legal',standalone:true,imports:[RouterLink],
 template:`<main class="legal">
 <nav><a routerLink="/login">← Razer</a> · <a routerLink="/chi-siamo">Guida al servizio</a></nav>
 <h1>{{ title }}</h1>
 <p class="updated">Ultimo aggiornamento: 16 ottobre 2026</p>
 @if(page === 'privacy') {
 <p class="notice"><strong>Informativa da completare:</strong> gli eventuali ulteriori dati identificativi e obblighi informativi del titolare devono ancora essere verificati. Questa pagina descrive soltanto i trattamenti identificati nell'applicazione; non rappresenta una verifica esaustiva di backend, hosting o fornitori.</p>
 <h2>1. Titolare del trattamento</h2><p>Il titolare del trattamento è <strong>Danilo Lantieri</strong>, persona fisica. Per richieste relative al trattamento dei dati personali è disponibile l'indirizzo <a href="mailto:postmaster&#64;razeretf.com">postmaster&#64;razeretf.com</a>. Non viene pubblicato un indirizzo di residenza; eventuali ulteriori obblighi informativi dovranno essere verificati. Consulta la pagina <a routerLink="/contatti">Contatti</a>.</p>
 <h2>2. Dati trattati e finalità</h2><p>Per la creazione e gestione dell'account il servizio richiede username e password; i dati tecnici di connessione possono essere trattati per erogazione, sicurezza e prevenzione degli abusi. L'utente può inserire informazioni sui propri portafogli e sulle operazioni: tali dati sono utilizzati per fornire le funzioni richieste. Le statistiche di utilizzo tramite Google Analytics 4 sono facoltative e si attivano soltanto dopo il consenso, quando il servizio è configurato.</p>
 <h2>3. Basi giuridiche</h2><p>Le operazioni necessarie a fornire il servizio possono basarsi sull'esecuzione del rapporto con l'utente (art. 6, par. 1, lett. b, GDPR); gli obblighi di legge sulla relativa base normativa; le statistiche non essenziali sul consenso (art. 6, par. 1, lett. a). Eventuali ulteriori finalità e basi giuridiche devono essere confermate dal titolare.</p>
 <h2>4. Fornitori e destinatari</h2><p>Il frontend è distribuito tramite Cloudflare Pages; il backend utilizza Render e servizi di database. Se attivato, Google Analytics 4 è fornito da Google. L'elenco completo dei fornitori, i relativi ruoli, le sedi e gli eventuali trasferimenti extra SEE devono essere verificati e integrati dal titolare prima della pubblicazione definitiva.</p>
 <h2>5. Conservazione</h2><p>I tempi di conservazione di account, portafogli, log tecnici e backup devono essere definiti e pubblicati dal titolare. Il consenso alle statistiche viene salvato nel browser e può essere revocato dalla pagina Cookie; le preferenze pubblicitarie sono gestite dalla CMP Google.</p>
 <h2>6. Diritti degli interessati</h2><p>Nei casi previsti dal GDPR puoi richiedere accesso, rettifica, cancellazione, limitazione, portabilità e opposizione; puoi revocare il consenso senza pregiudicare la liceità dei trattamenti precedenti. È possibile proporre reclamo al Garante per la protezione dei dati personali. Per esercitare questi diritti puoi scrivere a <a href="mailto:postmaster&#64;razeretf.com">postmaster&#64;razeretf.com</a>.</p>
 <h2>7. Minori e sicurezza</h2><p>Il servizio non è progettato specificamente per minori. Le misure tecniche di sicurezza, la gestione degli incidenti e le politiche di conservazione devono essere documentate dal gestore.</p>
 } @else if(page === 'cookies') {
 <p>Razer distingue fra strumenti tecnici necessari e tecnologie statistiche facoltative. Il sito integra unità pubblicitarie Google AdSense e utilizza il messaggio di consenso Google Privacy e messaggi per le preferenze pubblicitarie nei territori in cui è richiesto. Gli annunci potrebbero non essere sempre disponibili o visualizzati.</p>
 <h2>Memorizzazione tecnica</h2><p>L'applicazione usa lo storage del browser per mantenere lo stato di accesso e preferenze operative. La voce <code>razer-analytics-consent</code> conserva la scelta sulle statistiche. Occorre verificare tutti i cookie e storage effettivamente prodotti anche da backend e infrastruttura.</p>
 <h2>Statistiche facoltative</h2><p>Google Analytics 4 viene caricato soltanto se accetti esplicitamente le statistiche e se è configurato un ID valido. Rifiutare non limita l'utilizzo del servizio. La revoca blocca i caricamenti nelle visite successive; eventuali dati già trasmessi seguono le condizioni applicabili al fornitore.</p>
 <h2>Pubblicità e CMP</h2><p>Il sito utilizza Google AdSense (Google Ireland Limited) per gli spazi pubblicitari e la CMP Google Privacy e messaggi per raccogliere e gestire le preferenze pubblicitarie. I fornitori e le finalità sono consultabili nel messaggio di consenso Google. Le informazioni sui trattamenti e sui tempi di conservazione devono essere ulteriormente verificate dal titolare.</p>
 <h2>Le tue preferenze</h2><p>Per le scelte pubblicitarie usa il comando Preferenze privacy disponibile sul sito, che richiama la CMP Google quando disponibile. Le preferenze relative alle statistiche facoltative sono gestite separatamente qui:</p>
 <div class="actions"><button type="button" (click)="analytics.setConsent(false)">Rifiuta / revoca statistiche</button><button type="button" (click)="analytics.setConsent(true)">Accetta statistiche</button></div>
 <p>Stato attuale: <strong>{{ analytics.consent === 'accepted' ? 'Statistiche accettate' : analytics.consent === 'rejected' ? 'Statistiche rifiutate' : 'Nessuna scelta' }}</strong>.</p>
 } @else {
 <p>Razer è una piattaforma per l'analisi didattica dei portafogli ETF. Per informazioni sul funzionamento consulta la <a routerLink="/chi-siamo">guida pubblica</a>.</p>
 <h2>Gestore del servizio</h2><p>Gestore e titolare del trattamento: <strong>Danilo Lantieri</strong>, persona fisica. Email di contatto: <a href="mailto:postmaster&#64;razeretf.com">postmaster&#64;razeretf.com</a>. Non viene pubblicato l'indirizzo di residenza. Restano da verificare eventuali ulteriori dati identificativi obbligatori, se applicabili.</p>
 <h2>Richieste sulla privacy</h2><p>Per richieste di accesso, rettifica, cancellazione e altri diritti relativi ai dati personali, scrivi a <a href="mailto:postmaster&#64;razeretf.com">postmaster&#64;razeretf.com</a>.</p>
 }
 <footer><a routerLink="/chi-siamo">Guida</a> · <a routerLink="/privacy">Privacy</a> · <a routerLink="/cookies">Cookie</a> · <a routerLink="/contatti">Contatti</a></footer>
 </main>`,
 styles:[`:host{display:block;min-height:100vh;background:#08131f;color:#e4edf8}.legal{max-width:850px;margin:auto;padding:40px 24px 90px;font:16px/1.75 system-ui,sans-serif}.legal a{color:#81ccff}.legal h1{font-size:clamp(30px,4vw,42px)}.legal h2{font-size:21px;margin-top:30px}.legal .updated{color:#a9bdd0}.legal .notice{padding:15px 20px;background:#30271c;border-left:3px solid #f0bc71}.legal footer{margin-top:55px;padding-top:22px;border-top:1px solid #284154}.legal button{padding:10px 14px;border-radius:8px;border:1px solid #7899b5;background:#17344b;color:white;cursor:pointer}.legal .actions{display:flex;gap:10px;flex-wrap:wrap}`]
})
export class PublicLegalComponent {
 private readonly router=inject(Router);
 readonly analytics=inject(AnalyticsService);
 get page():string {return this.router.url.split('?')[0].replace('/','');}
 get title():string {return ({privacy:'Informativa sulla privacy',cookies:'Cookie e preferenze',contatti:'Contatti e titolare'} as Record<string,string>)[this.page] || 'Informazioni';}
}
