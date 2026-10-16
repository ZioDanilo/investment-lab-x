import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-public-info',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="info">
      <nav><a routerLink="/login">← Torna a ETFolio</a></nav>
      <h1>ETFolio: strumenti per analizzare portafogli ETF</h1>
      <p>ETFolio è una piattaforma per costruire, confrontare e studiare portafogli di ETF. Le simulazioni sono strumenti di analisi e non previsioni dei risultati futuri.</p>
      <h2>Cosa puoi fare</h2>
      <section><h3>Laboratorio portafogli</h3><p>Componi portafogli con pesi differenti e confronta indicatori come rendimento atteso, volatilità e drawdown.</p></section>
      <section><h3>Simulazioni Monte Carlo</h3><p>Esplora la distribuzione dei possibili risultati attraverso simulazioni statistiche basate su ipotesi di mercato. I risultati dipendono dal modello e non sono garantiti.</p></section>
      <section><h3>Ribilanciamento</h3><p>Confronta una composizione obiettivo con un portafoglio reale e analizza possibili operazioni di acquisto e vendita, tenendo conto dei vincoli previsti dal modello.</p></section>
      <section><h3>Trend following</h3><p>Studia strategie sistematiche basate sull'andamento storico dei prezzi e confrontane caratteristiche e limiti.</p></section>
      <h2>Avvertenze</h2>
      <p>I contenuti sono informativi e didattici, non costituiscono consulenza finanziaria personalizzata né inviti all'investimento. Investire comporta il rischio di perdere capitale. Rendimenti storici e simulati non garantiscono risultati futuri.</p>
      <p>Per utilizzare gli strumenti, <a routerLink="/login">accedi o registrati</a>.</p>
      <footer><a routerLink="/privacy">Privacy</a> · <a routerLink="/cookies">Cookie</a> · <a routerLink="/contatti">Contatti</a></footer>
    </main>`,
  styles: [`.info{max-width:850px;margin:0 auto;padding:40px 24px 80px;color:#e4edf8;font:16px/1.65 system-ui,sans-serif}.info h1{font-size:clamp(28px,4vw,42px);line-height:1.2}.info h2{margin-top:32px}.info section{padding:8px 0;border-bottom:1px solid #283a4c}.info a{color:#79caff}.info footer{margin-top:40px;border-top:1px solid #283a4c;padding-top:20px}:host{display:block;min-height:100vh;background:#08131f}`]
})
export class PublicInfoComponent {}
