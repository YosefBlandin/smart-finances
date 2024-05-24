import { AsyncPipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  DataTableActionsComponent,
  DataTableComponent,
  InputComponent,
} from '../../../shared';
import { MatButton } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIcon } from '@angular/material/icon';
import { MatActionList, MatListItem } from '@angular/material/list';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    MatButton,
    AsyncPipe,
    DataTableComponent,
    DataTableActionsComponent,
    MatSidenavModule,
    MatIcon,
    MatActionList,
    MatListItem,
  ],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent {
  constructor(private formBuilder: FormBuilder) {}
  public options: any[] = [
    {
      label: 'Home',
      route: '',
      icon: 'home',
    },
    {
      label: 'Notifications',
      route: '',
      icon: 'notifications',
    },
    {
      label: 'Goals',
      route: '',
      icon: 'military_tech',
    },
  ];
  public expenseForm = this.formBuilder.group({
    expense_name: this.formBuilder.control('', []),
    expense_amount: this.formBuilder.control('', []),
  });
  showFiller = false;
  public expenses = signal<any>([]);

  public addNewExpense() {
    this.expenses.set([...this.expenses(), this.expenseForm.getRawValue()]);
    this.expenseForm.reset();
  }
}
