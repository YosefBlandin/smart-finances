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
    path: 'budgets',
    loadChildren: () => import('./budgets').then((m) => m.budgetsRoutes),
  },
];
