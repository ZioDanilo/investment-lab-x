import { Routes } from '@angular/router';
import { AppShellComponent } from './app-shell.component';
import { HomePageComponent } from './features/home/home-page.component';
import { LoginPageComponent } from './features/auth/login-page.component';
import { MontecarloPageComponent } from './features/montecarlo/montecarlo-page.component';

export const appRoutes: Routes = [
  { path: 'login', component: LoginPageComponent },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  {
    path: '',
    component: AppShellComponent,
    children: [
      { path: 'home', component: HomePageComponent },
      { path: 'monte-carlo', component: MontecarloPageComponent }
    ]
  },
  { path: '**', redirectTo: '/login' }
];
