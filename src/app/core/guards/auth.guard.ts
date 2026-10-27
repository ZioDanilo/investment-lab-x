import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const username = localStorage.getItem('investmentLabUsername');

  if (username === 'tutorial') {
    return localStorage.getItem('investmentLabRole') === 'TUTORIAL' && sessionStorage.getItem('investmentLabTutorial') === 'true'
      ? (['/home', '/laboratorio-portafogli', '/monte-carlo'].includes(state.url.split('?')[0]) ? true : router.createUrlTree(['/home']))
      : router.createUrlTree(['/login']);
  }
  return username ? true : router.createUrlTree(['/login']);
};
