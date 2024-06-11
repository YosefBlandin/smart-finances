import { Injectable } from '@angular/core';
import { BudgetService } from '../../services';
import { BehaviorSubject, catchError, map, throwError } from 'rxjs';
import { DatePipe } from '@angular/common';
enum TransactionType {
  Income = 1,
  Expense = 2,
}

enum TransactionFrequency {
  OneTime = 0,
  Daily = 1,
  Weekly = 2,
  Biweekly = 3,
  Monthly = 4,
  Annually = 5,
}
@Injectable({
  providedIn: 'root',
})
export class ExpenseFacadeService {
  private allExpenses$ = new BehaviorSubject<any[]>([]);
  private expenseFound$ = new BehaviorSubject<any | undefined>(undefined);
  private isLoadingCreate$ = new BehaviorSubject<boolean>(false);
  private isLoadingUpdate$ = new BehaviorSubject<boolean>(false);
  private isLoadingGetAll$ = new BehaviorSubject<boolean>(false);
  private isLoadingDelete$ = new BehaviorSubject<boolean>(false);
  private isLoadingFind$ = new BehaviorSubject<boolean>(false);

  constructor(
    private BudgetService: BudgetService,
    private datePipe: DatePipe
  ) {}

  get allExpenses() {
    return this.allExpenses$.asObservable();
  }

  get expenseFound() {
    return this.expenseFound$.asObservable();
  }

  get isLoadingCreate() {
    return this.isLoadingCreate$.asObservable();
  }

  get isLoadingUpdate() {
    return this.isLoadingUpdate$.asObservable();
  }

  get isLoadingGetAll() {
    return this.isLoadingGetAll$.asObservable();
  }

  get isLoadingDelete() {
    return this.isLoadingDelete$.asObservable();
  }

  get isLoadingFind() {
    return this.isLoadingFind$.asObservable();
  }

  public create(data: any) {
    this.isLoadingCreate$.next(true);
    return this.BudgetService.create({
      ...data,
    }).pipe(
      catchError((err) => {
        this.isLoadingCreate$.next(false);
        return throwError(() => ({ ...err }));
      }),
      map((value) => {
        this.isLoadingCreate$.next(false);
        return { ...value.data };
      })
    );
  }

  public update(data: any) {
    this.isLoadingUpdate$.next(true);
    return this.BudgetService.patch({
      ...data,
      channelId: parseInt(data.channelId.toString()),
      statusId: parseInt(data.statusId.toString()),
    }).pipe(
      catchError((err) => {
        this.isLoadingUpdate$.next(false);
        return throwError(() => ({ ...err }));
      }),
      map((value) => {
        this.isLoadingUpdate$.next(false);
        this.expenseFound$.next(value.data);
        return { ...value.data };
      })
    );
  }

  public getAllExpenses(disableLoading?: boolean, callback?: () => void) {
    if (!disableLoading) {
      this.isLoadingGetAll$.next(true);
    }

    this.BudgetService.all()
      .pipe(
        catchError((err) => {
          if (!disableLoading) {
            this.isLoadingGetAll$.next(false);
          }

          if (callback) {
            callback();
          }
          return throwError(() => ({ ...err }));
        })
      )
      .subscribe((data: any) => {
        console.log(data);
        this.allExpenses$.next(
          data.map((record: any) => ({
            ...record,
            progress_percentage:
              (record.amount_saved / record.total_savings_goal) * 100,
          }))
        );
        if (!disableLoading) {
          this.isLoadingGetAll$.next(false);
        }
        if (callback) {
          callback();
        }
      });
  }

  public find(userId: number) {
    this.isLoadingFind$.next(true);
    return this.BudgetService.find(userId)
      .pipe(
        catchError((err) => {
          this.isLoadingFind$.next(false);
          return throwError(() => ({ ...err }));
        }),
        map(({ data }) => {
          this.isLoadingFind$.next(false);
          return { ...data };
        })
      )
      .subscribe((userFound: any) => {
        this.expenseFound$.next({
          ...userFound,
          createdAt: this.datePipe.transform(
            userFound.createdAt,
            'dd/MM/yyyy'
          ) as string,
          updatedAt: this.datePipe.transform(
            userFound.updatedAt,
            'dd/MM/yyyy'
          ) as string,
        });
      });
  }

  public delete(userId: number, getAll?: boolean) {
    this.isLoadingDelete$.next(true);
    return this.BudgetService.delete(userId).pipe(
      catchError((err) => {
        this.isLoadingDelete$.next(false);
        return throwError(() => ({ ...err }));
      }),
      map(({ data }) => {
        if (getAll) {
          this.getAllExpenses(true, () => this.isLoadingDelete$.next(false));

          return { ...data };
        } else {
          this.isLoadingDelete$.next(false);
          return { ...data };
        }
      })
    );
  }
}
