import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { from, map } from 'rxjs';
import { TokenManagementService } from '@core/services';
import { environment } from 'src/environments/environment';
import { Router } from '@angular/router';
import { IContext, IMeta } from 'src/app/core/services/api';
import {
    Auth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
} from '@angular/fire/auth';

@Injectable({
    providedIn: 'root',
})
export class LoginService {
    private readonly API_URL = environment.apiUrl;
    private auth: Auth = inject(Auth);

    constructor(
        private httpClient: HttpClient,
        private tokenManagement: TokenManagementService,
        private router: Router
    ) {}

    public login({ email, password }: { email: string; password: string }) {
        const httpHeaders: HttpHeaders = new HttpHeaders({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
            Accept: '*/*',
            Connection: 'keep-alive',
        });
        const loginObservable = from(
            signInWithEmailAndPassword(this.auth, email, password)
        );

        return loginObservable.pipe(
            map((response: { [key: string]: IMeta | IContext | any }) => {
                const accessToken = response && response?.['user']?.accessToken;
                const refreshToken =
                    response && response?.['stsTokenManager']?.refreshToken;
                console.log(response);
                if (accessToken) {
                    this.tokenManagement.saveAccessTokenData(
                        accessToken,
                        refreshToken
                    );
                    return response;
                } else {
                    return response?.['error'];
                }
            })
        );
    }

    public signup({ email, password }: { email: string; password: string }) {
        const httpHeaders: HttpHeaders = new HttpHeaders({
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
            Accept: '*/*',
            Connection: 'keep-alive',
        });
        const signupObservable = from(
            createUserWithEmailAndPassword(this.auth, email, password)
        );

        return signupObservable.pipe(
            map((response: { [key: string]: IMeta | IContext | any }) => {
                const accessToken = response && response?.['user']?.accessToken;
                const refreshToken =
                    response && response?.['stsTokenManager']?.refreshToken;
                console.log(response);
                if (accessToken) {
                    this.tokenManagement.saveAccessTokenData(
                        accessToken,
                        refreshToken
                    );
                    return response;
                } else {
                    return response?.['error'];
                }
            })
        );
    }

    public logout(): void {
        this.tokenManagement.clearAccessToken();
        this.router.navigateByUrl('auth/login');
    }
}
