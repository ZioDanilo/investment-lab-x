import { HttpInterceptorFn } from '@angular/common/http';

export const usernameInterceptor: HttpInterceptorFn = (req, next) => {
  const username = localStorage.getItem('investmentLabUsername');
  if (!username) return next(req);

  return next(req.clone({
    setHeaders: { 'X-Username': username }
  }));
};
