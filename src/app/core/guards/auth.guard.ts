import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const username = localStorage.getItem('investmentLabUsername');

  if (username === 'tutorial') {
    return localStorage.getItem('investmentLabRole') === 'TUTORIAL' && sessionStorage.getItem('investmentLabTutorial') === 'true'
      ? (state.url.split('?')[0] === '/home' ? true : router.createUrlTree(['/home']))
      : router.createUrlTree(['/login']);
  }
  return username ? true : router.createUrlTree(['/login']);
};
