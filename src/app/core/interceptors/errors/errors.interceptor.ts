import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { TokenManagementService } from '../../services/token/token-management.service';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

export const errorsInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenManagementService = inject(TokenManagementService);
  const routerService = inject(Router);

  return next(req).pipe(catchError((err) => {
    const errStatusCode: number = err.error.statusCode;
    const isRefreshTokenErr = err.error.message === "Invalid or incorrectly signed tokens.";
    if (errStatusCode === 401 && !isRefreshTokenErr) {
      tokenManagementService.getNewToken().subscribe((response: { accessToken: string }) => {
        tokenManagementService.saveAccessTokenData(response.accessToken)
      })
    } else if (isRefreshTokenErr) {
      routerService.navigateByUrl("/auth/login")
    }

    return throwError(() => ({
      ...err.error,
      message: errStatusCode === 400 ? [...err.error.message] : [err.error.message],
    }));
  }));
};
