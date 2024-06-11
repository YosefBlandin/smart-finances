import { Component, SkipSelf, ViewChild, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
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
import { Observable, combineLatest, startWith } from 'rxjs';

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
  ],
  templateUrl: './budget-form.component.html',
  styleUrl: './budget-form.component.scss',
})
export class BudgetFormComponent {
  @ViewChild(MatStepper) matStepper!: MatStepper;
  public mainBudgetInfoForm = this.formBuilder.group({
    name: this.formBuilder.control('', { validators: [] }),
    start_date: this.formBuilder.control('', { validators: [] }),
    end_date: this.formBuilder.control('', { validators: [] }),
    total_savings_goal: this.formBuilder.control('', { validators: [] }),
  });

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

  get currentStepIndex(): number {
    return this.currentStepIndex$();
  }

  get allFormsStatusChanges(): Observable<string[]> {
    return combineLatest([
      this.mainBudgetInfoForm.statusChanges.pipe(startWith('INVALID')),
    ]);
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
    const allFormGroups = [this.mainBudgetInfoForm];

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
    this.budgetFacadeService.getAllExpenses(true, () =>
      this.openSnackBar('Expense added successfully', 3000, 'fill', 'success')
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
    };
    this.budgetFacadeService.create(allFormsData).subscribe({
      next: this.handleCreateResponse.bind(this),
      error: this.handleCreateError.bind(this),
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
