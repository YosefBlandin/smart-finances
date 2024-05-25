import { AfterViewInit, Component, ViewChild, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DataTableComponent, InputComponent } from '../../../shared';
import { MatButton } from '@angular/material/button';
import { MatDrawer } from '@angular/material/sidenav';
@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent, MatButton, DataTableComponent],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent implements AfterViewInit {
  @ViewChild('drawer') matDrawer!: MatDrawer;
  constructor(private formBuilder: FormBuilder) {}
  public expenseForm = this.formBuilder.group({
    expense_name: this.formBuilder.control('', []),
    expense_amount: this.formBuilder.control('', []),
  });
  showFiller = false;
  public expenses = signal<any>([]);

  ngAfterViewInit(): void {}

  public addNewExpense() {
    this.expenses.set([...this.expenses(), this.expenseForm.getRawValue()]);
    this.expenseForm.reset();
  }
}
