import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { DatePipe } from '@angular/common';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideClientHydration(),
    provideAnimationsAsync(),
    provideHttpClient(withFetch()),
    DatePipe, provideFirebaseApp(() => initializeApp({"projectId":"smart-finances-c4764","appId":"1:717485148267:web:26f1d59c4dccba0829892e","storageBucket":"smart-finances-c4764.appspot.com","apiKey":"API_KEY","authDomain":"smart-finances-c4764.firebaseapp.com","messagingSenderId":"717485148267","measurementId":"G-MTQR5WDTFV"})), provideAuth(() => getAuth()), provideFirestore(() => getFirestore()),
  ],
};
