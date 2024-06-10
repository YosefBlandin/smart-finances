import { Routes } from '@angular/router';
import { HomeComponent } from './landing/pages/home/home.component';
import { LandingLayoutComponent } from './shared/components/landing-layout/landing-layout.component';

export const routes: Routes = [
  {
    path: '',
    component: LandingLayoutComponent,
    children: [
      {
        path: '',
        component: HomeComponent,
      },
    ],
  },
  {
    path: 'budget',
    loadChildren: () => import('./budget').then((m) => m.BUDGET_ROUTES),
  },
  {
    path: 'auth',
    loadChildren: () => import('./auth').then((m) => m.AUTH_ROUTES),
  },
];
