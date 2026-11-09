import { Component } from '@angular/core';

@Component({
  selector: 'app-public-landing',
  standalone: true,
  template: `
    <main class="landing">
      <nav class="nav" aria-label="Navigazione principale">
        <a class="brand" href="/" aria-label="Razer - Vai alla pagina iniziale"><img class="brand-logo" src="assets/img/Logo_razer.png" alt="Razer" /></a>
        <div class="nav-links"><a href="/chi-siamo">Guida ETF</a><a class="nav-login" href="/login">Accedi</a></div>
      </nav>

      <header class="stage stage--hero" id="inizio">
        <div class="stage-content">
          <p class="eyebrow">RAZER · LABORATORIO ETF</p>
          <h1>Il tuo portafoglio.<br><span>Una nuova prospettiva.</span></h1>
          <p class="lead">Costruisci, confronta e simula portafogli ETF. Esplora scenari, rischio e strategie in un unico laboratorio.</p>
          <div class="actions">
            <a class="primary" href="/login?tour=1">Esplora il tutorial gratuito <span aria-hidden="true">↗</span></a>
            <a class="secondary" href="/login">Accedi alla piattaforma <span aria-hidden="true">→</span></a>
          </div>
          <p class="note">Tutorial gratuito, senza registrazione né dati finanziari personali.</p>
        </div>
        <a class="scroll-cue" href="#scopri">Scopri di più <span aria-hidden="true">↓</span></a>
      </header>

      <section class="stage stage--second" id="scopri" aria-labelledby="second-title">
        <div class="stage-content">
          <p class="eyebrow">01 / ESPLORA</p>
          <h2 id="second-title">Ogni scelta<br><span>merita una visione più ampia.</span></h2>
          <p class="lead">Un ambiente per osservare come pesi, esposizioni e correlazioni cambiano il profilo di un portafoglio.</p>
          <a class="text-link" href="/login?tour=1">Scopri il laboratorio <span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <section class="stage stage--third" aria-labelledby="third-title">
        <div class="stage-content">
          <p class="eyebrow">02 / SIMULA</p>
          <h2 id="third-title">Non una previsione.<br><span>Molti scenari da esplorare.</span></h2>
          <p class="lead">Confronta percorsi ipotetici con Monte Carlo e approfondisci il rapporto tra rendimento atteso e rischio.</p>
          <a class="text-link" href="/chi-siamo">Approfondisci il metodo <span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <div class="split-grid" aria-label="Funzionalità della piattaforma">
        <section class="tile tile--one" aria-labelledby="tile-one-title">
          <div class="tile-content"><p class="eyebrow">03 / CONFRONTA</p><h2 id="tile-one-title">Portafogli<br>su misura.</h2><p>Prova diverse allocazioni e confronta le caratteristiche dei tuoi portafogli.</p></div>
        </section>
        <section class="tile tile--two" aria-labelledby="tile-two-title">
          <div class="tile-content"><p class="eyebrow">04 / RIBILANCIA</p><h2 id="tile-two-title">Ritrova<br>l'equilibrio.</h2><p>Esamina gli scostamenti dai pesi obiettivo e gli aggiustamenti possibili.</p></div>
        </section>
        <section class="tile tile--three" aria-labelledby="tile-three-title">
          <div class="tile-content"><p class="eyebrow">05 / OSSERVA</p><h2 id="tile-three-title">Il mercato<br>in movimento.</h2><p>Analizza l'andamento dei prezzi e le strategie di trend following.</p></div>
        </section>
        <section class="tile tile--four" aria-labelledby="tile-four-title">
          <div class="tile-content"><p class="eyebrow">06 / COMPRENDI</p><h2 id="tile-four-title">Il rischio<br>è parte del viaggio.</h2><p>Leggi volatilità, drawdown e scenari sfavorevoli con maggiore consapevolezza.</p></div>
        </section>
      </div>


      <aside class="disclaimer"><strong>Uno strumento informativo, non una consulenza.</strong> RazerETF non offre raccomandazioni personalizzate né garantisce rendimenti futuri. Il capitale investito può diminuire.</aside>
      <footer><a href="/chi-siamo">Guida ETF</a><a href="/privacy">Privacy</a><a href="/cookies">Cookie</a><a href="/contatti">Contatti</a><a href="/login">Accedi</a></footer>
    </main>
  `,
  styles: [`
    :host{display:block;background:#080e17;color:#f3f7ff;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
    *{box-sizing:border-box}
    .landing{width:100%;overflow:hidden}
    .landing a{color:inherit}
    .nav{position:absolute;z-index:5;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:clamp(18px,3vw,42px) clamp(22px,5vw,88px)}
    .brand{text-decoration:none;font-weight:900;font-size:clamp(21px,2vw,29px);letter-spacing:.1em}
    .brand-logo{display:block;width:auto;height:clamp(34px,3.4vw,48px);max-width:min(230px,38vw);object-fit:contain;object-position:left center}
    .nav-links{display:flex;align-items:center;gap:clamp(14px,3vw,34px)}
    .nav-links a{text-decoration:none;font-size:14px;font-weight:650}
    .nav-login{border:1px solid #7892ac;padding:10px 19px;border-radius:999px}
    .stage{position:relative;min-height:100svh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:clamp(100px,12vh,160px) clamp(24px,8vw,144px);isolation:isolate;border-bottom:1px solid rgba(255,255,255,.09)}
    .stage-content{position:relative;z-index:1;width:min(100%,1100px)}
    .stage--hero{background:radial-gradient(ellipse at 76% 38%,rgba(0,137,211,.26),transparent 46%),linear-gradient(135deg,#08111e,#0b2135 55%,#060d17)}
    .stage--second{background:radial-gradient(ellipse at 24% 62%,rgba(24,164,191,.16),transparent 46%),linear-gradient(150deg,#101b2b,#07141f)}
    .stage--third{background:radial-gradient(ellipse at 75% 40%,rgba(108,95,210,.2),transparent 47%),linear-gradient(140deg,#0b1024,#11172e)}
    .eyebrow{margin:0 0 24px;color:#75d9ff;font-size:clamp(11px,1.1vw,14px);font-weight:750;letter-spacing:.22em;text-transform:uppercase}
    h1,h2{font-weight:760;letter-spacing:-.055em;line-height:1.07;margin:0;overflow-wrap:break-word}
    h1{font-size:clamp(42px,7vw,106px)}
    .stage h2{font-size:clamp(40px,6.4vw,92px)}
    h1 span,.stage h2 span{color:#91b8d7}
    .lead{max-width:740px;font-size:clamp(17px,1.65vw,24px);line-height:1.6;color:#c3d2e0;margin:clamp(22px,3vw,40px) 0 0}
    .actions{display:flex;align-items:center;flex-wrap:wrap;gap:14px;margin:clamp(26px,4vw,48px) 0 16px}
    .primary,.secondary{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:52px;padding:13px 23px;border-radius:10px;text-decoration:none;font-weight:730;font-size:clamp(14px,1.1vw,16px);transition:transform .2s,box-shadow .2s}
    .primary{background:#51d2ff;color:#071421!important}
    .secondary{border:1px solid rgba(119,201,255,.56);background:rgba(22,131,204,.16);color:#dff5ff!important}
    .primary:hover,.secondary:hover{transform:translateY(-2px);box-shadow:0 9px 26px rgba(24,161,225,.2)}
    .note{font-size:13px;color:#a7bfd2;margin:0}
    .scroll-cue{position:absolute;bottom:clamp(20px,4vh,48px);left:50%;transform:translateX(-50%);display:flex;gap:12px;align-items:center;color:#b9d4e7!important;text-decoration:none;font-size:13px;letter-spacing:.08em}
    .text-link{display:inline-flex;gap:12px;margin-top:34px;text-decoration:none;color:#77dcff!important;font-weight:750}
    .split-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:10px;background:#050a11}
    .tile{min-height:clamp(430px,60vh,750px);display:flex;align-items:center;justify-content:center;padding:clamp(30px,5vw,90px);border-radius:8px;isolation:isolate}
    .tile-content{width:min(100%,520px)}
    .tile h2{font-size:clamp(36px,4.4vw,70px)}
    .tile p:not(.eyebrow){max-width:440px;font-size:clamp(16px,1.3vw,20px);color:#c5d5e2;line-height:1.65}
    .tile--one{background:linear-gradient(145deg,#102e42,#071a2a)}
    .tile--two{background:linear-gradient(145deg,#252039,#10152a)}
    .tile--three{background:linear-gradient(145deg,#122b30,#081a22)}
    .tile--four{background:linear-gradient(145deg,#292333,#131321)}
    .disclaimer{padding:32px clamp(24px,8vw,144px);background:#0a1520;color:#a6b9c9;font-size:13px}
    .disclaimer strong{color:#d9e6f1}
    footer{display:flex;flex-wrap:wrap;gap:18px 30px;padding:30px clamp(24px,8vw,144px) 55px;background:#070e17;border-top:1px solid #253548}
    footer a{text-decoration:none;font-size:14px;color:#a6c9df!important}
    @media(max-width:760px){
      .split-grid{grid-template-columns:1fr;gap:8px;padding:8px}
      .tile{min-height:72svh;min-height:72dvh;padding:clamp(30px,8vw,60px)}
      .tile h2{font-size:clamp(40px,9vw,66px)}
      .stage{padding:120px 7vw 90px}
      .nav{padding:22px 7vw}
    }
    @media(max-width:440px){
      .nav-links{gap:12px}.nav-links a{font-size:12px}.nav-login{padding:8px 12px}
      .stage{min-height:100svh;min-height:100dvh}
      .actions{align-items:stretch;flex-direction:column}.primary,.secondary{width:100%}
      .scroll-cue{bottom:18px}
    }
    @media(prefers-reduced-motion:reduce){.primary,.secondary{transition:none}.primary:hover,.secondary:hover{transform:none}}
  `]
})
export class PublicLandingComponent {}
