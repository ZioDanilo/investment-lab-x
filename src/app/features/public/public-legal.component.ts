import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
 selector:'app-public-legal',
 standalone:true,
 imports:[RouterLink],
 template:`<main class="legal">
 <nav><a routerLink="/login">← ETFolio</a> · <a routerLink="/chi-siamo">Informazioni sul servizio</a></nav>
 <h1>{{ title }}</h1>
 @if (page === 'privacy') {
 <p>Questa pagina è in preparazione. Prima dell'attivazione di servizi pubblicitari e di tracciamento, il titolare del trattamento dovrà pubblicare un'informativa completa e verificata che descriva identità e contatti, finalità, basi giuridiche, destinatari, conservazione e diritti degli interessati.</p>
 <p>Non vengono attivati nuovi tracker pubblicitari da questa pagina.</p>
 } @else if (page === 'cookies') {
 <p>Gli annunci pubblicitari e i relativi strumenti di profilazione non sono ancora attivi. Prima dell'attivazione verranno pubblicate informazioni sui cookie effettivamente utilizzati e, quando richiesto, sarà implementata una piattaforma di gestione del consenso.</p>
 } @else {
 <p>Per informazioni sul servizio, consulta la pagina <a routerLink="/chi-siamo">Informazioni su ETFolio</a>.</p>
 <p>I riferimenti ufficiali del gestore e un canale di contatto verificato devono essere inseriti prima della richiesta di approvazione pubblicitaria.</p>
 }
 <footer><a routerLink="/privacy">Privacy</a> · <a routerLink="/cookies">Cookie</a> · <a routerLink="/contatti">Contatti</a></footer>
 </main>`,
 styles:[`.legal{max-width:780px;margin:auto;padding:40px 24px 80px;color:#e4edf8;font:16px/1.7 system-ui,sans-serif}.legal a{color:#79caff}.legal footer{margin-top:50px}:host{display:block;min-height:100vh;background:#08131f}`]
})
export class PublicLegalComponent {
 private router=inject(Router);
 get page():string { return this.router.url.split('?')[0].replace('/',''); }
 get title():string { return ({privacy:'Informativa privacy',cookies:'Informazioni sui cookie',contatti:'Contatti'} as Record<string,string>)[this.page] || 'Informazioni'; }
}
