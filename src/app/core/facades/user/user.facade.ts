import { Injectable } from '@angular/core';
import { IUserDetails, IUserForm } from '../../interfaces/user';
import { UserService } from '../../services';
import { BehaviorSubject, catchError, map, throwError } from 'rxjs';
import { DatePipe } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class UserFacadeService {

  private allUsers$ = new BehaviorSubject<IUserDetails[]>([])
  private userFound$ = new BehaviorSubject<IUserDetails | undefined>(undefined)
  private isLoadingCreate$ = new BehaviorSubject<boolean>(false);
  private isLoadingUpdate$ = new BehaviorSubject<boolean>(false);
  private isLoadingGetAll$ = new BehaviorSubject<boolean>(false);
  private isLoadingDelete$ = new BehaviorSubject<boolean>(false);
  private isLoadingFind$ = new BehaviorSubject<boolean>(false);

  constructor(private userService: UserService, private datePipe: DatePipe) { }

  get allUsers() {
    return this.allUsers$.asObservable()
  }

  get userFound() {
    return this.userFound$.asObservable()
  }

  get isLoadingCreate() {
    return this.isLoadingCreate$.asObservable()
  }

  get isLoadingUpdate() {
    return this.isLoadingUpdate$.asObservable()
  }

  get isLoadingGetAll() {
    return this.isLoadingGetAll$.asObservable()
  }

  get isLoadingDelete() {
    return this.isLoadingDelete$.asObservable()
  }

  get isLoadingFind() {
    return this.isLoadingFind$.asObservable()
  }

  public create(data: IUserForm) {
    this.isLoadingCreate$.next(true)
    return this.userService.create({
      ...data,
      channelId: parseInt(data.channelId.toString()),
      statusId: parseInt(data.statusId.toString())
    }).pipe(
      catchError((err) => {
        this.isLoadingCreate$.next(false)
        return throwError(() => ({ ...err }));
      }),
      map((value) => {
        this.isLoadingCreate$.next(false)
        return { ...value.data }
      })
    )
  }

  public update(data: IUserForm) {
    this.isLoadingUpdate$.next(true)
    return this.userService.patch({
      ...data,
      channelId: parseInt(data.channelId.toString()),
      statusId: parseInt(data.statusId.toString())
    }).pipe(
      catchError((err) => {
        this.isLoadingUpdate$.next(false)
        return throwError(() => ({ ...err }));
      }),
      map((value) => {
        this.isLoadingUpdate$.next(false)
        this.userFound$.next(value.data)
        return { ...value.data }
      })
    )
  }

  public getAllUsers(disableLoading?: boolean, callback?: () => void) {
    if (!disableLoading) {
      this.isLoadingGetAll$.next(true)
    }

    this.userService.all().pipe(
      catchError((err) => {
        if (!disableLoading) {
          this.isLoadingGetAll$.next(false)
        }

        if (callback) {
          callback()
        }
        return throwError(() => ({ ...err }));
      })
    ).subscribe(({ data }) => {
      this.allUsers$.next(data.map((userDetail) => ({ ...userDetail, createdAt: this.datePipe.transform(userDetail.createdAt, "dd/MM/yyyy") as string, updatedAt: this.datePipe.transform(userDetail.updatedAt, "dd/MM/yyyy") as string })))
      if (!disableLoading) {
        this.isLoadingGetAll$.next(false)
      }
      if (callback) {
        callback()
      }
    })
  }

  public find(userId: number) {
    this.isLoadingFind$.next(true)
    return this.userService.find(userId).pipe(
      catchError((err) => {
        this.isLoadingFind$.next(false)
        return throwError(() => ({ ...err }));
      }),
      map(({ data }) => {
        this.isLoadingFind$.next(false)
        return { ...data }
      })
    ).subscribe((userFound: IUserDetails) => {
      this.userFound$.next({ ...userFound, createdAt: this.datePipe.transform(userFound.createdAt, "dd/MM/yyyy") as string, updatedAt: this.datePipe.transform(userFound.updatedAt, "dd/MM/yyyy") as string })
    })
  }

  public delete(userId: number, getAll?: boolean) {
    this.isLoadingDelete$.next(true)
    return this.userService.delete(userId).pipe(
      catchError((err) => {
        this.isLoadingDelete$.next(false)
        return throwError(() => ({ ...err }));
      }),
      map(({ data }) => {
        if (getAll) {

          this.getAllUsers(true, () => this.isLoadingDelete$.next(false))

          return { ...data }

        } else {
          this.isLoadingDelete$.next(false)
          return { ...data }
        }
      })
    )
  }
}
