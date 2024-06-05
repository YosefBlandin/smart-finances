import {
  AfterViewInit,
  Component,
  Inject,
  ViewChild,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataTableComponent, InputComponent } from '../../../shared';
import { MatButton } from '@angular/material/button';
import { MatDrawer } from '@angular/material/sidenav';
import { UserFormModalComponent } from '../../../shared/components/user-form-modal/user-form-modal.component';
import { MatDialog } from '@angular/material/dialog';
@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    MatButton,
    DataTableComponent,
    UserFormModalComponent,
  ],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent implements AfterViewInit {
  @ViewChild('drawer') matDrawer!: MatDrawer;
  constructor(private matDialog: MatDialog) {}

  showFiller = false;
  public expenses = signal<any>([]);

  ngAfterViewInit(): void {}

  public onAddExpense() {
    this.matDialog.open(UserFormModalComponent);
  }

  public saveExpense() {
    // this.expenses.set([...this.expenses(), this.expenseForm.getRawValue()]);
    // this.expenseForm.reset();
  }
}
