import { Routes } from '@angular/router';
import { PublicInfoComponent } from './features/public/public-info.component';
import { PublicLegalComponent } from './features/public/public-legal.component';
import { AppShellComponent } from './app-shell.component';
import { HomePageComponent } from './features/home/home-page.component';
import { LoginPageComponent } from './features/auth/login-page.component';
import { MontecarloPageComponent } from './features/montecarlo/montecarlo-page.component';
import { MarketUniversePageComponent } from './features/market-universe/market-universe-page.component';
import { PortafoliPageComponent } from './features/portafogli/portafogli-page.component';
import { RebalanceComponent } from './features/rebalance/rebalance.component';
import { RealPortfoliosPageComponent } from './features/real-portfolios/real-portfolios-page.component';
import { TrendFollowingPageComponent } from './features/trend-following/trend-following-page.component';
import { authGuard } from './core/guards/auth.guard';

export const appRoutes: Routes = [
  { path: 'login', component: LoginPageComponent },
  { path: 'chi-siamo', component: PublicInfoComponent },
  { path: 'privacy', component: PublicLegalComponent },
  { path: 'cookies', component: PublicLegalComponent },
  { path: 'contatti', component: PublicLegalComponent },
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
      { path: 'trend-following', component: TrendFollowingPageComponent }
    ]
  },
  { path: '**', redirectTo: '/login' }
];
