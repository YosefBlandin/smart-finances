import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenManagementService } from '../../services';

export const sessionInterceptor: HttpInterceptorFn = (req, next) => {

  const userToken = inject(TokenManagementService).getAccessToken();
  if (userToken) {
    const modifiedReq = req.clone({ headers: req.headers.set('authorization', `Bearer ${userToken}`) });
    return next(modifiedReq)
  }
  return next(req);
};
