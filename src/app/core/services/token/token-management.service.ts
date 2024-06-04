import { Injectable } from '@angular/core';
import { jwtDecode } from 'jwt-decode';
import { SessionStorageService } from '../session-storage/session-storage.service';
import { TokenKeyType, TokenType } from '../../types/token';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment.development';

@Injectable({
  providedIn: 'root',
})
export class TokenManagementService {
  private readonly API_URL = environment.apiUrl;
  constructor(private sessionStorage: SessionStorageService, private httpClient: HttpClient) { }

  public getAccessToken(): string {
    return this.sessionStorage.getItem('accessToken') as string;
  }

  public getRefreshToken(): string {
    return this.sessionStorage.getItem('refreshToken') as string;
  }

  private getAccessTokenData(token: string): (TokenType<TokenKeyType> | null) {
    if (token) {
      return jwtDecode(token);
    }
    return null;
  }

  public saveAccessTokenData(token: string, refreshToken?: string): void {
    this.sessionStorage.setItem('accessToken', token);
    if (refreshToken) {
      this.sessionStorage.setItem('refreshToken', refreshToken);
    }
  }


  public clearAccessToken(): void {
    this.sessionStorage.removeItem('accessToken');
    this.sessionStorage.removeItem('refreshToken');
  }

  public isTokenExpired(): boolean {
    const tokenData = this.getAccessTokenData(this.getAccessToken());
    if (tokenData) {
      const exp = new Date(tokenData.exp * 1000);
      const currentDate = new Date();
      return exp < currentDate;
    }

    return true;
  }

  public getNewToken() {
    const tokens = {
      accessToken: this.getAccessToken(),
      refreshToken: this.getRefreshToken()
    }
    return this.httpClient.post<{ accessToken: string }>(this.API_URL + 'auth/refresh', tokens);
  }
}
