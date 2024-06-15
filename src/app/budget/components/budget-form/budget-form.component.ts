import {
  AfterContentChecked,
  AfterViewInit,
  Component,
  SkipSelf,
  ViewChild,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import {
  MatStep,
  MatStepContent,
  MatStepLabel,
  MatStepper,
} from '@angular/material/stepper';
import { BudgetFacadeService } from '@core/facades/budget/budget.facade';
import { InputComponent } from '@shared/components';
import { InputSelectComponent } from '@shared/components/input-select/input-select.component';
import { Observable, combineLatest, startWith } from 'rxjs';

type IncomeStreamType = FormGroup<{
  name: FormControl<string>;
  amount: FormControl<string>;
  type: FormControl<number>;
  frequency: FormControl<number>;
  date_occurred: FormControl<string>;
  start_date: FormControl<string>;
  end_date: FormControl<string>;
}>;

const expenses = [
  { label: 'Rent', value: 'rent' },
  { label: 'Grocery', value: 'grocery' },
  { label: 'Utility', value: 'utility' },
  { label: 'Transportation', value: 'transportation' },
  { label: 'Internet', value: 'internet' },
  { label: 'Cell Phone', value: 'cell phone' },
  { label: 'Insurance', value: 'insurance' },
  { label: 'Entertainment', value: 'entertainment' },
  { label: 'Dining Out', value: 'dining out' },
  { label: 'Medical Expense', value: 'medical expense' },
  { label: 'Clothing', value: 'clothing' },
  { label: 'Education', value: 'education' },
  { label: 'Gym Membership', value: 'gym membership' },
  { label: 'Subscription', value: 'subscription' },
  { label: 'Household Supply', value: 'household supply' },
  { label: 'Personal Care', value: 'personal care' },
  { label: 'Pet Care', value: 'pet care' },
  { label: 'Travel', value: 'travel' },
  { label: 'Child Care', value: 'child care' },
  { label: 'Loan Payment', value: 'loan payment' },
];

@Component({
  selector: 'app-budget-form',
  standalone: true,
  imports: [
    MatStepper,
    MatStepLabel,
    MatStepContent,
    MatStep,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    ReactiveFormsModule,
    InputComponent,
    InputSelectComponent,
  ],
  templateUrl: './budget-form.component.html',
  styleUrl: './budget-form.component.scss',
})
export class BudgetFormComponent implements AfterViewInit {
  @ViewChild(MatStepper) matStepper!: MatStepper;
  public mainBudgetInfoForm = this.formBuilder.group({
    name: this.formBuilder.control('', { validators: [] }),
    start_date: this.formBuilder.control('', { validators: [] }),
    end_date: this.formBuilder.control('', { validators: [] }),
    total_savings_goal: this.formBuilder.control('', { validators: [] }),
  });

  public budgetIncomeForm = this.formBuilder.group({
    amount_saved: this.formBuilder.control('', { validators: [] }),
    income_streams: this.formBuilder.array<IncomeStreamType>([]),
  });

  public incomeStreamForm = this.formBuilder.group({
    name: this.formBuilder.control('', { nonNullable: true, validators: [] }),
    amount: this.formBuilder.control('', {
      nonNullable: true,
      validators: [],
    }),
    type: this.formBuilder.control(1, { nonNullable: true, validators: [] }),
    frequency: this.formBuilder.control(0, {
      nonNullable: true,
      validators: [],
    }),
    date_occurred: this.formBuilder.control('', {
      nonNullable: true,
      validators: [],
    }),
    start_date: this.formBuilder.control('', {
      nonNullable: true,
      validators: [],
    }),
    end_date: this.formBuilder.control('', {
      nonNullable: true,
      validators: [],
    }),
  });

  public frequencyOptions = [
    {
      label: 'One Time',
      value: 0,
    },
    {
      label: 'Daily',
      value: 1,
    },
    {
      label: 'Weekly',
      value: 2,
    },
    {
      label: 'Biweekly',
      value: 3,
    },
    {
      label: 'Monthly',
      value: 4,
    },
    {
      label: 'Annually',
      value: 5,
    },
  ];

  public transactionOptions = [
    {
      label: 'Income',
      value: 1,
    },
    {
      label: 'Expenses',
      value: 2,
    },
  ];

  public earningsOptions = [
    { label: 'Salary', value: 'salary' },
    { label: 'Freelance Work', value: 'freelance work' },
    { label: 'Business Income', value: 'business income' },
    { label: 'Investment', value: 'investment' },
    { label: 'Rental Income', value: 'rental income' },
    { label: 'Dividend', value: 'dividend' },
    { label: 'Interest', value: 'interest' },
    { label: 'Bonus', value: 'bonus' },
    { label: 'Commission', value: 'commission' },
    { label: 'Social Security', value: 'social security' },
    { label: 'Pension', value: 'pension' },
    { label: 'Child Support', value: 'child support' },
    { label: 'Alimony', value: 'alimony' },
    { label: 'Gift', value: 'gift' },
    { label: 'Scholarship', value: 'scholarship' },
    { label: 'Grant', value: 'grant' },
    { label: 'Lottery Winning', value: 'lottery winning' },
    { label: 'Trust Fund', value: 'trust fund' },
    { label: 'Tax Refund', value: 'tax refund' },
    { label: 'Side Hustle', value: 'side hustle' },
  ];

  public currentStepIndex$ = signal<number>(0);
  public areFormsInvalid$ = signal<boolean>(false);
  public isLoading$ = signal<boolean>(false);
  public errorMessage = signal<
    { message: string; statusCode: number } | undefined
  >(undefined);
  public stepsArrLength = 0;

  constructor(
    public formBuilder: FormBuilder,
    private budgetFacadeService: BudgetFacadeService,
    private snackbar: MatSnackBar,
    @SkipSelf() private dialogRef: MatDialogRef<BudgetFormComponent>
  ) {}

  public ngAfterViewInit(): void {
    if (this.matStepper instanceof MatStepper) {
      this.matStepper.selectedIndexChange.subscribe(this.currentStepIndex$.set);
      this.stepsArrLength = Array.from(this.matStepper.steps).length - 1;
    }
    this.allFormsStatusChanges.subscribe(this.handleAllFormsStatus.bind(this));
  }

  get currentStepIndex(): number {
    return this.currentStepIndex$();
  }

  get allFormsStatusChanges(): Observable<string[]> {
    return combineLatest([
      this.mainBudgetInfoForm.statusChanges.pipe(startWith('INVALID')),
      this.budgetIncomeForm.statusChanges.pipe(startWith('INVALID')),
    ]);
  }

  get allIncomeStreamsForms() {
    return this.budgetIncomeForm.controls[
      'income_streams'
    ] as FormArray<IncomeStreamType>;
  }

  public addNewIncomeStream() {
    this.budgetIncomeForm.controls['income_streams'].push(
      this.incomeStreamForm
    );
    // this.incomeStreamForm.reset();
  }

  public isDesktop(): boolean {
    if (window.innerWidth > 768) {
      return true;
    }
    return false;
  }

  public handleAllFormsStatus(statuses: string[]): void {
    const formsValid = statuses.filter((status) => status === 'VALID');
    if (formsValid.length !== statuses.length) {
      this.areFormsInvalid$.set(true);
    } else {
      this.areFormsInvalid$.set(false);
    }
  }

  public isStepInvalid(stepIndex?: number): boolean {
    type StepsStatusType = {
      [key: number]: string;
    };

    const stepsStatus: StepsStatusType = {
      0: this.mainBudgetInfoForm.status,
      1: this.budgetIncomeForm.status,
    };

    return stepsStatus[stepIndex ?? this.currentStepIndex] === 'INVALID';
  }

  public handleNextStep(): void {
    this.matStepper.next();
  }

  public handlePreviousStep(): void {
    this.matStepper.previous();
  }

  public handleCloseModal(): void {
    this.dialogRef.close();
  }

  public handleInputErrorStep(errorMsg: string): void {
    const allFormGroups = [this.mainBudgetInfoForm, this.budgetIncomeForm];

    allFormGroups.forEach(async (formGroup: FormGroup, index: number) => {
      const keysOfControls: string[] = Object.keys(formGroup.controls);

      const controlKeyThatMatches = await this.getKeyInErrorMsg(
        keysOfControls,
        errorMsg
      );

      console.log({ controlKeyThatMatches });

      if (typeof controlKeyThatMatches === 'string') {
        formGroup.get(controlKeyThatMatches)?.setErrors([errorMsg]);

        while (index < this.currentStepIndex) {
          console.log({ index, currentStepIndex: this.currentStepIndex });
          this.matStepper.previous();
        }
      }
    });
  }

  public async getKeyInErrorMsg(
    keyOfControls: string[],
    errorMsg: string
  ): Promise<string | boolean> {
    return new Promise((resolve) => {
      keyOfControls.forEach((controlKey: string) => {
        const matchErrorWithControl: boolean =
          errorMsg.split(' ')[0].toLowerCase() === controlKey;
        if (matchErrorWithControl) {
          resolve(controlKey);
        }
      });
    });
  }

  public handleCreateResponse() {
    this.handleCloseModal();
    this.budgetFacadeService.getAllBudgets(true, () =>
      this.openSnackBar('Budget added successfully', 3000, 'fill', 'success')
    );
  }

  public handleCreateError(err: { message: string; statusCode: number }) {
    this.errorMessage.set({ ...err });
    if (err.statusCode === 400) {
      this.handleInputErrorStep(err.message[0]);
    }
  }

  public handleSubmit() {
    const allFormsData: any = {
      ...this.mainBudgetInfoForm.getRawValue(),
      ...this.budgetIncomeForm.getRawValue(),
    };
    this.budgetFacadeService.create(allFormsData).subscribe({
      next: this.handleCreateResponse.bind(this),
      error: this.handleCreateError.bind(this),
    });
  }

  public onSaveIncome() {
    const newIncomeForm = this.formBuilder.group({
      name: this.formBuilder.control('', { nonNullable: true, validators: [] }),
      amount: this.formBuilder.control('', {
        nonNullable: true,
        validators: [],
      }),
      type: this.formBuilder.control(1, { nonNullable: true, validators: [] }),
      frequency: this.formBuilder.control(0, {
        nonNullable: true,
        validators: [],
      }),
      date_occurred: this.formBuilder.control('', {
        nonNullable: true,
        validators: [],
      }),
      start_date: this.formBuilder.control('', {
        nonNullable: true,
        validators: [],
      }),
      end_date: this.formBuilder.control('', {
        nonNullable: true,
        validators: [],
      }),
    });
    newIncomeForm.patchValue(this.incomeStreamForm.getRawValue());
    this.allIncomeStreamsForms.push(newIncomeForm);
    console.log(this.budgetIncomeForm.getRawValue());

    this.incomeStreamForm.reset({
      name: '',
      amount: '',
      type: 1,
      frequency: 0,
      date_occurred: '',
      start_date: '',
      end_date: '',
    });
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
