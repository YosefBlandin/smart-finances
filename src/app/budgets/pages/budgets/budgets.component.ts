import { AsyncPipe, CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { BrowserModule } from '@angular/platform-browser';
import { InputComponent } from '../../../shared';
import { MatButton } from '@angular/material/button';
import { BehaviorSubject } from 'rxjs';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent, MatButton, AsyncPipe],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent {
  constructor(private formBuilder: FormBuilder) {}
  public expenseForm = this.formBuilder.group({
    expense_name: this.formBuilder.control('', []),
    expense_amount: this.formBuilder.control('', []),
  });

  public expenses = new BehaviorSubject<any[]>([]);

  public addNewExpense() {
    this.expenses.next([
      ...this.expenses.getValue(),
      this.expenseForm.getRawValue(),
    ]);
  }
}
