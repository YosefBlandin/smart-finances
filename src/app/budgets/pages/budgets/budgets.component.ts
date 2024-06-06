import {
  AfterViewInit,
  Component,
  Inject,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DataTableComponent, InputComponent } from '../../../shared';
import { MatButton } from '@angular/material/button';
import { MatDrawer } from '@angular/material/sidenav';
import { ExpenseFormModalComponent } from '../../../shared/components/expense-form-modal/expense-form-modal.component';
import { MatDialog } from '@angular/material/dialog';
import { ExpenseFacadeService } from '../../../core/facades/expense/expense.facade';
import { isPlatformBrowser } from '@angular/common';
@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    MatButton,
    DataTableComponent,
    ExpenseFormModalComponent,
  ],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent implements OnInit, AfterViewInit {
  @ViewChild('drawer') matDrawer!: MatDrawer;
  constructor(
    private matDialog: MatDialog,
    private expenseFacadeService: ExpenseFacadeService,
    @Inject(PLATFORM_ID) private platformId: string
  ) {}

  showFiller = false;
  public expenses = signal<any>([]);

  ngOnInit(): void {
    this.expenseFacadeService.allExpenses.subscribe(this.expenses.set);

    this.expenseFacadeService.getAllExpenses();
  }

  ngAfterViewInit(): void {}

  public onAddExpense() {
    this.matDialog.open(ExpenseFormModalComponent);
  }

  public saveExpense() {
    // this.expenses.set([...this.expenses(), this.expenseForm.getRawValue()]);
    // this.expenseForm.reset();
  }
}
