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
import { BudgetFacadeService } from '../../../core/facades/budget/budget.facade';
import { DataTableActionType } from '../../../core/types/data-table';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
import { BudgetFormComponent } from '../../components';
import { Router, RouterLink } from '@angular/router';
@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatIcon,
    CardItemComponent,
    DatePipe,
    RouterLink,
  ],
  templateUrl: './budget-list-page.component.html',
  styleUrl: './budget-list-page.component.scss',
})
export class BudgetsPageComponent implements OnInit, AfterViewInit {
  @ViewChild('drawer') matDrawer!: MatDrawer;
  constructor(
    private matDialog: MatDialog,
    private snackbar: MatSnackBar,
    private BudgetFacadeService: BudgetFacadeService,
    private router: Router
  ) {}

  showFiller = false;
  public budgets = signal<
    {
      id: number;
      name: string;
      savings_rate: string | undefined;
      amount_saved: number;
      currency: string;
      total_savings_goal: number;
      start_date: Date;
      end_date: Date;
      progress_percentage: string;
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
    this.BudgetFacadeService.allExpenses.subscribe(this.budgets.set);

    this.BudgetFacadeService.getAllBudgets();
  }

  ngAfterViewInit(): void {}

  public onNewBudget() {
    this.matDialog.open(BudgetFormComponent, {
      width: '100%',
      maxWidth: 600,
    });
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
        this.BudgetFacadeService.delete(id, true).subscribe({
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

  public navigateToBudgetDetails(entityId: string | number): void {
    this.router.navigate([`/budget/details/${entityId}`]);
  }
}
