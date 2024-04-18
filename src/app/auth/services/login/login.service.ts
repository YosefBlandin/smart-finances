import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map } from 'rxjs';
import { TokenManagementService } from '@core/services';
import { environment } from 'src/environments/environment';
import { Router } from '@angular/router';
import { IContext, IMeta } from 'src/app/core/services/api';

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  private readonly API_URL = environment.apiUrl;

  constructor(
    private httpClient: HttpClient,
    private tokenManagement: TokenManagementService,
    private router: Router
  ) {
  }

  public login(data: {
    username: string;
    password: string;
  }) {
    const httpHeaders: HttpHeaders = new HttpHeaders({
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
      "Accept": "*/*",
      "Connection": "keep-alive"
    })
    return this.httpClient.post<{ username: string, password: string }>(this.API_URL + 'auth/login', data, {
      headers: httpHeaders
    }).pipe(
      map((response: { [key: string]: IMeta | IContext | any }) => {
        const accessToken = response && response?.["data"]?.accessToken;
        const refreshToken = response && response?.["data"]?.refreshToken;

        if (accessToken) {
          this.tokenManagement.saveAccessTokenData(accessToken, refreshToken);
          return response;
        } else {
          return response?.['error'];
        }
      }
      )
    );
  }

  public logout(): void {
    this.tokenManagement.clearAccessToken();
    this.router.navigateByUrl("auth/login");
  }
}
