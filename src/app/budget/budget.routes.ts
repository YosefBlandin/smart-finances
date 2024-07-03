import { Routes } from '@angular/router';
import { BudgetsPageComponent } from './pages/budget-list-page/budget-list-page.component';
import { PlatformLayoutComponent } from './components/platform-layout/platform-layout.component';
import { BudgetDetailsPageComponent } from './pages/budget-details-page/budget-details-page.component';
import { BudgetCreationPageComponent } from './pages/budget-creation-page/budget-creation-page.component';

export const BUDGET_ROUTES: Routes = [
  {
    path: '',
    component: PlatformLayoutComponent,
    children: [
      {
        path: '',
        component: BudgetsPageComponent,
      },
      {
        path: 'create',
        component: BudgetCreationPageComponent,
      },
      {
        path: 'details/:entityId',
        component: BudgetDetailsPageComponent,
      },
    ],
  },
];
