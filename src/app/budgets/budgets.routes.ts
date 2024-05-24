import { Routes } from '@angular/router';
import { BudgetsComponent } from './pages/budgets/budgets.component';
import { PlatformLayoutComponent } from './components/platform-layout/platform-layout.component';

export const budgetsRoutes: Routes = [
  {
    path: '',
    component: PlatformLayoutComponent,
    children: [
      {
        path: '',
        component: BudgetsComponent,
      },
    ],
  },
];
