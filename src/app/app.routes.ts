import { Routes } from '@angular/router';
import { AppShellComponent } from './app-shell.component';
import { HomePageComponent } from './features/home/home-page.component';
import { LoginPageComponent } from './features/auth/login-page.component';
import { MontecarloPageComponent } from './features/montecarlo/montecarlo-page.component';
import { MarketUniversePageComponent } from './features/market-universe/market-universe-page.component';
import { PortafoliPageComponent } from './features/portafogli/portafogli-page.component';
import { RebalanceComponent } from './features/rebalance/rebalance.component';
import { NewEtfPageComponent } from './features/new-etf/new-etf-page.component';
import { RealPortfoliosPageComponent } from './features/real-portfolios/real-portfolios-page.component';
import { authGuard } from './core/guards/auth.guard';

export const appRoutes: Routes = [
  { path: 'login', component: LoginPageComponent },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'home', component: HomePageComponent },
      { path: 'laboratorio-portafogli', component: PortafoliPageComponent },
      { path: 'portafogli', component: RealPortfoliosPageComponent },
      { path: 'monte-carlo', component: MontecarloPageComponent },
      { path: 'ribilanciamento', component: RebalanceComponent },
      { path: 'market-universe', component: MarketUniversePageComponent },
      { path: 'nuovo-etf', component: NewEtfPageComponent }
    ]
  },
  { path: '**', redirectTo: '/login' }
];
