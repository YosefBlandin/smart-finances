import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  Inject,
  PLATFORM_ID,
  PLATFORM_INITIALIZER,
  ViewChild,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  DataTableActionsComponent,
  DataTableComponent,
  InputComponent,
} from '../../../shared';
import { MatButton } from '@angular/material/button';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatIcon } from '@angular/material/icon';
import { MatActionList, MatListItem } from '@angular/material/list';
import { PlatformConfig } from '@angular/platform-server';
import { Platform } from '@angular/cdk/platform';

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
export class BudgetsComponent implements AfterViewInit {
  @ViewChild('drawer') matDrawer!: MatDrawer;
  constructor(
    private formBuilder: FormBuilder,
    @Inject(PLATFORM_ID) public platformId: string
  ) {}
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
  public showDrawerButton = signal(true);
  public expenses = signal<any>([]);

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (window.innerWidth >= 1024) {
        this.matDrawer.open();
        this.showDrawerButton.set(false);
      }
    }
  }

  public addNewExpense() {
    this.expenses.set([...this.expenses(), this.expenseForm.getRawValue()]);
    this.expenseForm.reset();
  }
}
