import { AsyncPipe } from '@angular/common';
import { Component, OnInit, SkipSelf, signal } from '@angular/core';
import { DataTableActionType } from '@core/types/data-table';
import { IUserDetails } from 'src/app/core/interfaces/user';
import { MatDialog } from '@angular/material/dialog';
import {
  ConfirmDialogComponent,
  DataTableComponent,
  ButtonComponent,
  UserFormModalComponent,
} from '@shared/components';
import { UserFacadeService } from '../../../core/facades/user/user.facade';
import { Router } from '@angular/router';
import { DashboardLayoutComponent } from '@admin/layout/dashboard-layout/dashboard-layout.component';
import { MatButton } from '@angular/material/button';
import {
  MatSnackBar,
  MatSnackBarAction,
  MatSnackBarActions,
  MatSnackBarConfig,
  MatSnackBarLabel,
} from '@angular/material/snack-bar';

@Component({
  selector: 'smart-users',
  standalone: true,
  imports: [
    DataTableComponent,
    AsyncPipe,
    UserFormModalComponent,
    ButtonComponent,
    ConfirmDialogComponent,
    MatButton,
    MatSnackBarLabel,
    MatSnackBarActions,
    MatSnackBarAction,
  ],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css',
})
export class UsersComponent implements OnInit {
  public allUsersData$ = signal<
    {
      id: number;
      identificación: string;
      correo: string;
      'fecha de creación': string;
      'fecha de actualización': string;
      actions?: DataTableActionType[];
    }[]
  >([]);

  public tableActions: DataTableActionType[] = [
    { icon: 'info', actionName: 'details', disabled: false },
    { icon: 'delete', actionName: 'delete', disabled: false },
  ];

  public tablePageSizeOptions: number[] = [12, 18, 30, 50];
  public isLoadingGetAll$ = signal<boolean>(false);
  public isLoadingDelete$ = signal<boolean>(false);

  constructor(
    private userFacadeService: UserFacadeService,
    public dialog: MatDialog,
    private routerService: Router,
    private snackbar: MatSnackBar,
    @SkipSelf() private adminLayout: DashboardLayoutComponent
  ) {
    this.adminLayout.activeOptionTitle = 'Usuarios';
  }

  ngOnInit(): void {
    this.userFacadeService.getAllUsers();

    this.userFacadeService.allUsers.subscribe({
      next: this.handleGetResponse.bind(this),
      error: this.handleGetError.bind(this),
    });

    this.userFacadeService.isLoadingGetAll.subscribe(this.isLoadingGetAll$.set);

    this.userFacadeService.isLoadingDelete.subscribe(this.isLoadingDelete$.set);
  }

  public handleGetResponse(allUsers: IUserDetails[]) {
    this.allUsersData$.set(allUsers.map(this.getNecessaryUserValue.bind(this)));
  }

  public handleGetError(err: Error) {
    console.error(err);
  }

  public getNecessaryUserValue(user: IUserDetails) {
    return {
      id: user.id,
      identificación: user.identification,
      correo: user.email,
      'fecha de creación': user.createdAt,
      'fecha de actualización': user.updatedAt,
    };
  }

  public handleTableAction({
    id,
    action,
  }: {
    id: number;
    action: string;
  }): void {
    if (action === 'delete') {
      this.handleDelete(id);
    } else if (action === 'details') {
      this.handleGoDetails(id);
    }
  }

  private handleGoDetails(id: number) {
    this.routerService.navigate([`admin/users/${id}`]);
  }

  private handleDelete(id: number) {
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
        this.userFacadeService.delete(id, true).subscribe({
          next: () => {
            this.openSnackBar(
              'Usuario eliminado con exito',
              3000,
              'fill',
              'success'
            );
          },
          error: (err: Error) => {
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

  public handleCreate(): void {
    this.dialog.open(UserFormModalComponent, {
      width: '100%',
      maxWidth: this.getModalMaxWidth(),
    });
  }

  private getModalMaxWidth(): string {
    if (window.innerWidth < 768) {
      return '95vw';
    } else if (window.innerWidth <= 1024) {
      return '80vw';
    } else if (window.innerWidth <= 1200) {
      return '70vw';
    }
    return '50vw';
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
