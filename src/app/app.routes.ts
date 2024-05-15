import { Routes } from '@angular/router';
import { sessionGuard } from '@auth/guards/session/session.guard';
import { HomeComponent } from './landing/pages/home/home.component';

export const APP_ROUTES: Routes = [
    {
        path: 'auth',
        loadChildren: () =>
            import('./auth/auth.routes').then((m) => m.AUTH_ROUTES),
    },
    {
        path: 'admin',
        canActivate: [sessionGuard],
        loadChildren: () =>
            import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES),
    },
    {
        path: 'home',
        component: HomeComponent,
    },
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'home',
    },
];
