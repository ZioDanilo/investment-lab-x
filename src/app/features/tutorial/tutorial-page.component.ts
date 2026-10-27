import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-tutorial-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <main class="tutorial-page">
      <header class="tutorial-header">
        <strong>Razer <span>· Modalità tutorial</span></strong>
        <button type="button" (click)="exit()">Esci dal tutorial</button>
      </header>
      <section class="tutorial-card">
        <p class="step">TUTORIAL · PASSAGGIO 1 DI 1</p>
        <h1>Benvenuto nel laboratorio dimostrativo</h1>
        <p>Sei entrato con il profilo locale <strong>TUTORIAL</strong>, senza password e senza accedere ai dati di altri utenti.</p>
        <p>Questo è il punto di partenza del percorso guidato. Le prossime fasi introdurranno la creazione del portafoglio e le analisi con dati di esempio, mantenendo bloccate le azioni non previste.</p>
        <div class="tutorial-callout">Per continuare, nelle prossime implementazioni evidenzieremo soltanto l'azione consentita.</div>
        <button type="button" (click)="exit()">Torna alla login</button>
      </section>
    </main>
  `,
  styles: [`
    :host{display:block;min-height:100vh;background:#08172a;color:#eaf3ff;font-family:Arial,sans-serif}
    .tutorial-page{max-width:1100px;margin:auto;padding:24px}
    .tutorial-header{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .tutorial-header strong{font-size:26px}.tutorial-header span{font-size:15px;color:#8da9c8}
    .tutorial-card{margin:12vh auto 0;max-width:690px;padding:38px;border:1px solid #285276;border-radius:18px;background:#102943;box-shadow:0 20px 55px #0005}
    h1{font-size:30px}.step{color:#79c9ff;font-size:12px;font-weight:bold;letter-spacing:2px}
    p{line-height:1.7}.tutorial-callout{padding:18px;border-radius:10px;background:#1b3d59;margin:24px 0}
    button{background:#1684d0;border:0;color:white;border-radius:9px;padding:12px 18px;font-weight:bold;cursor:pointer}
    .tutorial-header button{background:transparent;border:1px solid #5e829e}
  `]
})
export class TutorialPageComponent implements OnInit {
  private readonly router = inject(Router);

  ngOnInit(): void {
    if (sessionStorage.getItem('investmentLabTutorial') !== 'true') {
      void this.router.navigateByUrl('/login');
    }
  }

  exit(): void {
    sessionStorage.removeItem('investmentLabTutorial');
    void this.router.navigateByUrl('/login');
  }
}
