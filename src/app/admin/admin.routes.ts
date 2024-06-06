import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { DashboardLayoutComponent } from './layout/dashboard-layout/dashboard-layout.component';
import { ServicesComponent } from './pages/services/services.component';
import { SecurityComponent } from './pages/security/security.component';
import { LogsComponent } from './pages/logs/logs.component';
import { ChangePasswordComponent } from './pages/change-password/change-password.component';
import { UserDetailsComponent } from './pages/user-details/user-details.component';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: DashboardLayoutComponent,
    children: [
      {
        path: 'dashboard',
        component: DashboardComponent,
      },
      {
        path: 'users/:id',
        component: UserDetailsComponent,
      },
      {
        path: 'services',
        component: ServicesComponent,
      },
      {
        path: 'security',
        component: SecurityComponent,
      },
      {
        path: 'logs',
        component: LogsComponent,
      },
      {
        path: 'change-password',
        component: ChangePasswordComponent,
      },
    ],
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
];
