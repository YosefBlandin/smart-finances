import {
    ApplicationConfig,
    EnvironmentProviders,
    importProvidersFrom,
} from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { APP_ROUTES } from './app.routes';
import {
    provideHttpClient,
    withFetch,
    withInterceptors,
} from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { httpInterceptorProviders } from './core/interceptors';
import { DatePipe } from '@angular/common';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { environment } from 'src/environments/environment';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';

const firebaseProviders: EnvironmentProviders = importProvidersFrom([
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => getFirestore()),
    provideAuth(() => getAuth()),
]);

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(APP_ROUTES, withViewTransitions()),
        provideHttpClient(
            withFetch(),
            withInterceptors(httpInterceptorProviders)
        ),
        provideAnimationsAsync(),
        firebaseProviders,
        DatePipe,
    ],
};
