import { DashboardLayoutComponent } from '@admin/layout/dashboard-layout/dashboard-layout.component';
import { AsyncPipe } from '@angular/common';
import { Component, OnInit, signal, SkipSelf } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { UserFacadeService } from '@core/facades/user/user.facade';
import { IUserDetails } from '@core/interfaces/user';
import {
  ConfirmDialogComponent,
  InputComponent,
  InputSelectComponent,
} from '@shared/components';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  map,
  Observable,
  shareReplay,
  startWith,
} from 'rxjs';
import isEqual from 'fast-deep-equal';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
@Component({
  selector: 'smart-user-details',
  standalone: true,
  imports: [
    MatButton,
    MatIcon,
    InputComponent,
    ReactiveFormsModule,
    ConfirmDialogComponent,
    AsyncPipe,
    InputSelectComponent,
  ],
  templateUrl: './user-details.component.html',
  styleUrl: './user-details.component.css',
})
export class UserDetailsComponent implements OnInit {
  public userDetails$ = new BehaviorSubject<IUserDetails | undefined>(
    undefined
  );
  public isLoadingFind$ = signal<boolean>(false);
  public isLoadingUpdate$ = signal<boolean>(false);
  public isLoadingDelete$ = signal<boolean>(false);
  public userPlatformInformation = this.formBuilder.group({
    id: this.formBuilder.control(0, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    username: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    email: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    avatar: this.formBuilder.control('', {
      nonNullable: false,
      validators: [],
    }),
    apiKey: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    apiSecret: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    statusId: this.formBuilder.control(0, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    channelId: this.formBuilder.control(0, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    createdAt: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    updatedAt: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    deletedAt: this.formBuilder.control('', {
      nonNullable: false,
      validators: [],
    }),
  });

  public userPersonalInformation = this.formBuilder.group({
    identificationType: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    identification: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    name: this.formBuilder.control('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    localPhone: this.formBuilder.control('', { nonNullable: true }),
    cellPhone: this.formBuilder.control('', { nonNullable: true }),
  });
  public isDirty = signal<boolean>(false);
  public areFormsInvalid = signal<boolean>(false);
  public identificationTypes: { value: string | number; label: string }[] = [
    { label: 'Venezolano', value: 'V' },
    { label: 'Pasaporte', value: 'P' },
    { label: 'Jurídico', value: 'J' },
    { label: 'Extranjero', value: 'E' },
  ];
  public statusOptions: { value: string | number; label: string }[] = [
    { label: 'Activo', value: 1 },
    { label: 'Inactivo', value: 2 },
  ];
  public channelOptions: { value: string | number; label: string }[] = [
    { label: 'Web', value: 1 },
    { label: 'App', value: 2 },
  ];

  constructor(
    private userFacadeService: UserFacadeService,
    private activatedRouteService: ActivatedRoute,
    private routerService: Router,
    private formBuilder: FormBuilder,
    private dialog: MatDialog,
    private snackbar: MatSnackBar,
    @SkipSelf() private adminLayout: DashboardLayoutComponent
  ) {
    this.adminLayout.activeOptionTitle = 'Detalles del Usuario';
  }

  ngOnInit(): void {
    this.activatedRouteService.params.subscribe((params: unknown) => {
      const parameters = params as { id: string };

      if (parameters.id) {
        this.findUserById(parameters.id);
      }
    });

    this.allFormsStatusChanges.subscribe((status) => {
      this.handleAllFormsStatus(status);
      console.log({ status });
    });

    this.userFacadeService.isLoadingDelete.subscribe(this.isLoadingDelete$.set);
    this.userFacadeService.isLoadingUpdate.subscribe(this.isLoadingUpdate$.set);

    this.userFacadeService.userFound.subscribe(
      (userDetails: IUserDetails | undefined) => {
        if (userDetails) {
          const userWithoutPassword = {
            ...userDetails,
          };
          delete userWithoutPassword.password;
          this.userDetails$.next(userWithoutPassword);
          this.userPlatformInformation.patchValue(userWithoutPassword);
          this.userPersonalInformation.patchValue(userWithoutPassword);
        }
      }
    );
    this.userFacadeService.isLoadingFind.subscribe(this.isLoadingFind$.set);

    combineLatest([
      this.userPersonalInformation.valueChanges,
      this.userPlatformInformation.valueChanges.pipe(
        map((values) => ({
          ...values,
          id: parseInt(values.id?.toString() ?? ''),
          statusId: parseInt(values.statusId?.toString() ?? ''),
          channelId: parseInt(values.channelId?.toString() ?? ''),
        }))
      ),
    ])
      .pipe(
        map(([a, b]) => ({ ...a, ...b })),
        this.dirtyCheck(this.userDetails)
      )
      .subscribe(this.isDirty.set);
  }

  get userDetails(): Observable<IUserDetails | undefined> {
    return this.userDetails$.asObservable();
  }

  get allFormsStatusChanges(): Observable<string[]> {
    return combineLatest([
      this.userPlatformInformation.statusChanges.pipe(startWith('VALID')),
      this.userPersonalInformation.statusChanges.pipe(startWith('VALID')),
    ]);
  }

  public handleAllFormsStatus(statuses: string[]): void {
    const formsValid = statuses.filter((status) => status === 'VALID');

    if (formsValid.length !== 2) {
      this.areFormsInvalid.set(true);
    } else {
      this.areFormsInvalid.set(false);
    }
  }

  public findUserById(id: string): void {
    this.userFacadeService.find(parseInt(id));
  }

  public handleGoBack() {
    this.routerService.navigate(['admin/users']);
  }

  public dirtyCheck<IUserDetails>(source: Observable<IUserDetails>) {
    return function <IUserDetails>(
      valueChanges: Observable<IUserDetails>
    ): Observable<boolean> {
      const isDirty$ = combineLatest([source, valueChanges]).pipe(
        debounceTime(300),
        map(([a, b]) => {
          console.log(a, b);
          return isEqual(a, b) === false;
        }),
        startWith(false),
        shareReplay({ bufferSize: 1, refCount: true })
      );
      return isDirty$;
    };
  }

  public handleDelete() {
    const userId = this.userDetails$.getValue()?.id as number;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Estas seguro de que deseas eliminar este usuario?',
        message: 'Esta accion es irreversible.',
        buttonText: 'Eliminar',
        secondaryButtonText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((value) => {
      if (value) {
        this.userFacadeService.delete(userId, true).subscribe({
          next: () => {
            this.handleGoBack();
            this.openSnackBar(
              'Usuario eliminado con exito',
              3000,
              'fill',
              'success'
            );
          },
          error: (err) => {
            this.openSnackBar(
              err.message ?? 'El usuario no se pudo eliminar',
              3000,
              'fill',
              'error'
            );
          },
        });
      }
    });
  }

  public handleEdit() {
    const allFormsData = {
      ...this.userPlatformInformation.getRawValue(),
      ...this.userPersonalInformation.getRawValue(),
    };

    this.userFacadeService.update({ ...allFormsData }).subscribe({
      next: () => {
        this.openSnackBar(
          'Los cambios fueron aplicados exitosamente',
          3000,
          'fill',
          'success'
        );
      },
      error: (err) => {
        this.openSnackBar(
          err.message ?? 'Los cambios no fueron aplicados',
          3000,
          'fill',
          'error'
        );
      },
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
