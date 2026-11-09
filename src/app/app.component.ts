import { Component, inject, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import { AnalyticsService } from './core/services/analytics.service';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgIf],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  readonly analytics = inject(AnalyticsService);
  readonly router = inject(Router);
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  get publicPage(): boolean { return ['/','/chi-siamo','/privacy','/cookies','/contatti'].includes(this.router.url.split(/[?#]/)[0]); }
  ngOnInit(): void {
    this.analytics.start();
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe(event => {
      const path = event.urlAfterRedirects.split(/[?#]/)[0];
      const pages: Record<string, [string,string]> = {
        '/': ['Razer | Laboratorio ETF, portafogli e simulazioni Monte Carlo','Costruisci e confronta portafogli ETF, studia rischio e rendimento con simulazioni Monte Carlo. Prova il tutorial gratuito senza registrazione.'],
        '/chi-siamo': ['Guida ETF, Monte Carlo e rischio | Razer','Guida pubblica Razer: diversificazione ETF, volatilità, drawdown, simulazioni Monte Carlo, ribilanciamento e trend following.'],
        '/privacy': ['Informativa privacy | Razer','Informativa sul trattamento dei dati personali e sui diritti degli utenti Razer.'],
        '/cookies': ['Cookie e preferenze | Razer','Informazioni su cookie, Google Analytics, pubblicità e gestione delle preferenze di consenso.'],
        '/contatti': ['Contatti | Razer','Contatti del gestore della piattaforma Razer e richieste relative alla privacy.'],
        '/login': ['Razer | Laboratorio ETF e simulazioni','Accedi a Razer o esplora il tutorial della piattaforma per analizzare portafogli ETF.']
      };
      const data=pages[path] ?? ['Razer | Analisi portafogli ETF','Piattaforma Razer per analisi ETF, simulazioni e gestione del rischio.'];
      this.titleService.setTitle(data[0]);
      const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (canonical) canonical.href = 'https://razeretf.com' + path;
      this.meta.updateTag({name:'description',content:data[1]});
      this.meta.updateTag({name:'robots',content:this.publicPage ? 'index,follow' : 'noindex,follow'});
      this.meta.updateTag({property:'og:title',content:data[0]});
      this.meta.updateTag({property:'og:description',content:data[1]});
    });
  }
  openPrivacyChoices(): void {
    // Google Funding Choices is loaded by the published AdSense privacy message.
    const googleWindow = window as Window & {
      googlefc?: { callbackQueue?: Array<() => void>; showRevocationMessage?: () => void };
    };
    if (typeof googleWindow.googlefc?.showRevocationMessage === 'function') {
      googleWindow.googlefc.showRevocationMessage();
    } else {
      // Fallback: keep privacy information reachable when CMP has not loaded.
      void this.router.navigateByUrl('/cookies');
    }
  }
}
