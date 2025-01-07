import { Injectable, inject } from '@angular/core';
import { from, map } from 'rxjs';
import { TokenManagementService } from '@core/services';
import { Router } from '@angular/router';
import { IContext, IMeta } from 'src/app/core/services/api';

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  constructor(
    private tokenManagement: TokenManagementService,
    private router: Router
  ) {}

  public login({ email, password }: { email: string; password: string }) {
    // return loginObservable.pipe(
    //   map((response: { [key: string]: IMeta | IContext | any }) => {
    //     const accessToken = response && response?.['user']?.accessToken;
    //     const refreshToken =
    //       response && response?.['stsTokenManager']?.refreshToken;
    //     console.log(response);
    //     if (accessToken) {
    //       this.tokenManagement.saveAccessTokenData(accessToken, refreshToken);
    //       return response;
    //     } else {
    //       return response?.['error'];
    //     }
    //   })
    // );
  }

  public signup({ email, password }: { email: string; password: string }) {
    // return signupObservable.pipe(
    //   map((response: { [key: string]: IMeta | IContext | any }) => {
    //     const accessToken = response && response?.['user']?.accessToken;
    //     const refreshToken =
    //       response && response?.['stsTokenManager']?.refreshToken;
    //     console.log(response);
    //     if (accessToken) {
    //       this.tokenManagement.saveAccessTokenData(accessToken, refreshToken);
    //       return response;
    //     } else {
    //       return response?.['error'];
    //     }
    //   })
    // );
  }

  public logout(): void {
    // signOut(this.auth).then(() => {
    //   this.tokenManagement.clearAccessToken();
    //   this.router.navigateByUrl('auth/login');
    // });
  }
}
