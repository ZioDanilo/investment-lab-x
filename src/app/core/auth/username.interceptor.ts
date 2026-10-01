import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

const clearInvalidSession = (router: Router): void => {
  try {
    localStorage.removeItem('investmentLabUsername');
    sessionStorage.clear();
  } catch {}
  void router.navigateByUrl('/login');
};

export const usernameInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const username = localStorage.getItem('investmentLabUsername');

  const authRequest = req.url.includes('/auth/login') ||
    req.url.includes('/auth/register') ||
    req.url.includes('/auth/username-availability');

  if (!username && !authRequest) {
    clearInvalidSession(router);
    return throwError(() => new HttpErrorResponse({
      status: 401,
      statusText: 'Sessione non disponibile',
      url: req.url
    }));
  }

  const request = username
    ? req.clone({ setHeaders: { 'X-Username': username } })
    : req;

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      // A persisted username is not enough: the backend is authoritative.
      // Any 401 means that the user/session can no longer be trusted.
      if (error.status === 401 && !authRequest) {
        clearInvalidSession(router);
      }
      return throwError(() => error);
    })
  );
};
