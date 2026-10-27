import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const username = localStorage.getItem('investmentLabUsername');

  if (username === 'tutorial') {
    return localStorage.getItem('investmentLabRole') === 'TUTORIAL' && sessionStorage.getItem('investmentLabTutorial') === 'true'
      ? (router.url === '/home' ? true : true)
      : router.createUrlTree(['/login']);
  }
  return username ? true : router.createUrlTree(['/login']);
};
