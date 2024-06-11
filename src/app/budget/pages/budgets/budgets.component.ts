import {
  AfterViewInit,
  Component,
  OnInit,
  ViewChild,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import {
  CardItemComponent,
  DataTableComponent,
  InputComponent,
} from '../../../shared';
import { MatButton, MatFabButton } from '@angular/material/button';
import { MatDrawer } from '@angular/material/sidenav';
import { ExpenseFormModalComponent } from '../../../shared/components/expense-form-modal/expense-form-modal.component';
import { MatDialog } from '@angular/material/dialog';
import { ExpenseFacadeService } from '../../../core/facades/budget/budget.facade';
import { DataTableActionType } from '../../../core/types/data-table';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
import { Timestamp } from '@angular/fire/firestore';
@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    MatButton,
    MatFabButton,
    MatIcon,
    DataTableComponent,
    CardItemComponent,
    DatePipe,
    ExpenseFormModalComponent,
  ],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent implements OnInit, AfterViewInit {
  @ViewChild('drawer') matDrawer!: MatDrawer;
  constructor(
    private matDialog: MatDialog,
    private snackbar: MatSnackBar,
    private expenseFacadeService: ExpenseFacadeService
  ) {}

  showFiller = false;
  public budgets = signal<
    {
      name: string;
      savings_rate: string;
      amount_saved: number;
      currency: string;
      total_savings_goal: number;
      start_date: Timestamp;
      end_date: Timestamp;
    }[]
  >([]);
  public expensesActions: DataTableActionType[] = [
    {
      icon: 'delete',
      actionName: 'delete',
      disabled: false,
    },
  ];

  ngOnInit(): void {
    this.expenseFacadeService.allExpenses.subscribe(this.budgets.set);

    this.expenseFacadeService.getAllExpenses();
  }

  ngAfterViewInit(): void {}

  public onAddExpense() {
    this.matDialog.open(ExpenseFormModalComponent);
  }

  public onDeleteExpense(id: number) {
    const dialogRef = this.matDialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Are you sure?',
        message: 'This action is irreversible',
        secondaryButtonText: 'Cancel',
        buttonText: 'Delete',
      },
    });

    dialogRef.afterClosed().subscribe((value) => {
      if (value) {
        this.expenseFacadeService.delete(id, true).subscribe({
          next: () => {
            this.openSnackBar(
              'Expense deleted successfully',
              3000,
              'fill',
              'success'
            );
          },
          error: (err: Error) => {
            this.openSnackBar(
              err.message ?? 'The expense was not deleted',
              3000,
              'fill',
              'error'
            );
          },
        });
      }
    });
  }

  public handleExpenseAction({ id, action }: { id: number; action: string }) {
    const actionHandlers: { [key: string]: () => void } = {
      delete: () => this.onDeleteExpense(id),
    };

    actionHandlers[action]();
  }

  private openSnackBar(
    message: string,
    duration = 5000,
    appearance: 'fill' | 'outline' | 'soft' = 'fill',
    type: 'info' | 'success' | 'error' = 'info'
  ): void {
    const config: MatSnackBarConfig = {
      duration: duration,
      verticalPosition: 'bottom',
      horizontalPosition: 'center',
      panelClass: `snackbar-type-${appearance}-${type}`,
    };
    this.snackbar.open(message, '', config);
  }
}
