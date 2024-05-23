import { AsyncPipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  DataTableActionsComponent,
  DataTableComponent,
  InputComponent,
} from '../../../shared';
import { MatButton } from '@angular/material/button';

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
  ],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent {
  constructor(private formBuilder: FormBuilder) {}
  public expenseForm = this.formBuilder.group({
    expense_name: this.formBuilder.control('', []),
    expense_amount: this.formBuilder.control('', []),
  });

  public expenses = signal<any>([]);

  public addNewExpense() {
    this.expenses.set([...this.expenses(), this.expenseForm.getRawValue()]);
  }
}
