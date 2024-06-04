import { AfterContentChecked, AfterViewInit, Component, SkipSelf, ViewChild, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { STEPPER_GLOBAL_OPTIONS } from '@angular/cdk/stepper';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { InputComponent } from '../input/input.component';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { MatIcon } from '@angular/material/icon';
import { Observable, combineLatest, startWith } from 'rxjs';
import { customEmailValidator } from '@core/formValidators';
import { IUserForm } from 'src/app/core/interfaces/user';
import { UserFacadeService } from 'src/app/core/facades/user/user.facade';
import { InputSelectComponent } from '../input-select/input-select.component';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

@Component({
  selector: 'smart-finances-user-form-modal',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    InputComponent,
    InputSelectComponent,
    ReactiveFormsModule,
    MatStepperModule,
    MatButtonModule,
    MatIcon
  ],
  providers: [
    {
      provide: STEPPER_GLOBAL_OPTIONS,
      useValue: { showError: true },
    },
  ],
  templateUrl: './user-form-modal.component.html',
  styleUrl: './user-form-modal.component.css'
})
export class UserFormModalComponent implements AfterViewInit, AfterContentChecked {
  @ViewChild(MatStepper) matStepper!: MatStepper;
  public currentStepIndex$ = signal<number>(0);
  public areFormsInvalid$ = signal<boolean>(false);
  public isLoading$ = signal<boolean>(false);
  public errorMessage = signal<{ message: string, statusCode: number } | undefined>(undefined);
  public stepsArrLength = 0;
  public identificationTypes: { value: string | number, label: string }[] = [
    { label: 'Venezolano', value: 'V' },
    { label: 'Pasaporte', value: 'P' },
    { label: 'Jurídico', value: 'J' },
    { label: 'Extranjero', value: 'E' },
  ]
  public statusOptions: { value: string | number, label: string }[] = [
    { label: 'Activo', value: '1' },
    { label: 'Inactivo', value: '2' },
  ]
  public channelOptions: { value: string | number, label: string }[] = [
    { label: 'Web', value: '1' },
    { label: 'App', value: '2' },
  ]

  public personalInfoForm: FormGroup = this.formBuilder.group({
    identificationType: this.formBuilder.control("", { nonNullable: true, validators: [Validators.required, Validators.maxLength(1)] }),
    identification: this.formBuilder.control("", { nonNullable: true, validators: [Validators.required, Validators.maxLength(8)] }),
    name: this.formBuilder.control("", { nonNullable: true, validators: [Validators.required, Validators.maxLength(40)] }),
    localPhone: this.formBuilder.control("", { nonNullable: true, validators: [Validators.required, Validators.maxLength(15)] }),
    cellPhone: this.formBuilder.control("", { nonNullable: true, validators: [Validators.required, Validators.maxLength(15)] }),
  })

  public userInfoForm: FormGroup = this.formBuilder.group({
    email: this.formBuilder.control("", { nonNullable: true, validators: [Validators.required, customEmailValidator] }),
    username: this.formBuilder.control("", { nonNullable: true, validators: [Validators.required] }),
    password: this.formBuilder.control("", { nonNullable: true, validators: [Validators.required] }),
  })

  public permissionsForm: FormGroup = this.formBuilder.group({
    channelId: this.formBuilder.control("1", { nonNullable: true, validators: [Validators.required, Validators.maxLength(1)] }),
    statusId: this.formBuilder.control("1", { nonNullable: true, validators: [Validators.required, Validators.maxLength(1)] }),
  });

  constructor(
    private userFacadeService: UserFacadeService,
    public formBuilder: FormBuilder,
    private snackbar: MatSnackBar,
    @SkipSelf() private dialogRef: MatDialogRef<UserFormModalComponent>
  ) {
  }

  public ngAfterViewInit(): void {
    this.matStepper.selectedIndexChange.subscribe(this.currentStepIndex$.set)
    this.allFormsStatusChanges.subscribe(this.handleAllFormsStatus.bind(this))

    this.userFacadeService.isLoadingCreate.subscribe((isLoading) => {
      this.isLoading$.set(isLoading)
      if (isLoading) {
        this.dialogRef.disableClose = true
      } else {
        this.dialogRef.disableClose = false
      }
    })
  }

  public ngAfterContentChecked(): void {
    if (this.matStepper instanceof MatStepper) {
      this.stepsArrLength = Array.from(this.matStepper.steps).length - 1;
    }
  }

  get currentStepIndex(): number {
    return this.currentStepIndex$();
  }

  get allFormsStatusChanges(): Observable<string[]> {
    return combineLatest([
      this.personalInfoForm.statusChanges.pipe(startWith("INVALID")),
      this.userInfoForm.statusChanges.pipe(startWith("INVALID")),
      this.permissionsForm.statusChanges.pipe(startWith("VALID"))
    ])
  }

  public handleAllFormsStatus(statuses: string[]): void {
    const formsValid = statuses.filter((status) => status === "VALID");

    if (formsValid.length !== 3) {
      this.areFormsInvalid$.set(true);
    } else {
      this.areFormsInvalid$.set(false);
    }
  }

  public isStepInvalid(stepIndex?: number): boolean {
    type StepsStatusType = {
      [key: number]: string
    }

    const stepsStatus: StepsStatusType = {
      0: this.personalInfoForm.status,
      1: this.userInfoForm.status,
      2: this.permissionsForm.status
    }

    return stepsStatus[stepIndex ?? this.currentStepIndex] === "INVALID";
  }

  public handleNextStep(): void {
    this.matStepper.next()
  }

  public handlePreviousStep(): void {
    this.matStepper.previous()
  }

  public handleCloseModal(): void {
    this.dialogRef.close()
  }

  public handleInputErrorStep(errorMsg: string): void {
    const allFormGroups = [this.personalInfoForm, this.userInfoForm, this.permissionsForm];

    allFormGroups.forEach(async (formGroup: FormGroup, index: number) => {
      const keysOfControls: string[] = Object.keys(formGroup.controls);

      const controlKeyThatMatches = await this.getKeyInErrorMsg(keysOfControls, errorMsg);

      console.log({ controlKeyThatMatches })

      if (typeof controlKeyThatMatches === "string") {
        formGroup.get(controlKeyThatMatches)?.setErrors([errorMsg])

        while (index < this.currentStepIndex) {
          console.log({ index, currentStepIndex: this.currentStepIndex })
          this.matStepper.previous();
        }
      }

    })
  }

  public async getKeyInErrorMsg(keyOfControls: string[], errorMsg: string): Promise<string | boolean> {
    return new Promise((resolve) => {
      keyOfControls.forEach((controlKey: string) => {
        const matchErrorWithControl: boolean = errorMsg.split(" ")[0].toLowerCase() === controlKey;
        if (matchErrorWithControl) {
          resolve(controlKey)
        }
      });
    })
  }

  public handleSubmit() {
    const allFormsData: IUserForm = {
      ...this.personalInfoForm.getRawValue(),
      ...this.userInfoForm.getRawValue(),
      ...this.permissionsForm.getRawValue(),
    }
    this.userFacadeService.create(allFormsData).subscribe({
      next: this.handleCreateResponse.bind(this),
      error: this.handleCreateError.bind(this)
    })
  }

  public handleCreateResponse() {
    this.handleCloseModal()
    this.userFacadeService.getAllUsers(true, () => this.openSnackBar("Usuario creado con exito", 3000, "fill", "success"))

  }

  public handleCreateError(err: { message: string, statusCode: number }) {
    this.errorMessage.set({ ...err })
    if (err.statusCode === 400) {
      this.handleInputErrorStep(err.message[0])
    }
  }

  public isDesktop(): boolean {
    if (window.innerWidth > 768) {
      return true
    }
    return false
  }

  private openSnackBar(message: string,
    duration = 5000,
    appearance: 'fill' | 'outline' | 'soft' = 'fill',
    type: 'info' | 'success' | 'error' = 'info'): void {

    const config: MatSnackBarConfig = {
      duration: duration,
      verticalPosition: 'bottom',
      horizontalPosition: 'center',
      panelClass: `snackbar-type-${appearance}-${type}`
    };
    this.snackbar.open(message, '', config);
  }
}
