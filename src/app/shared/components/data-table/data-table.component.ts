import { KeyValuePipe, NgStyle } from '@angular/common';
import {
  AfterViewInit,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { DataTableActionsComponent } from '../data-table-actions/data-table-actions.component';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatPaginator } from '@angular/material/paginator';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { DataSourceType, DataTableActionType } from './data-table.types';
import { InputComponent } from '../input/input.component';
import { SnakeCaseToNormalPipe } from '../../pipes/snakeCaseToNormal/snake-case-to-normal.pipe';
@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [
    NgStyle,
    InputComponent,
    MatTableModule,
    MatSort,
    MatSortModule,
    KeyValuePipe,
    MatIcon,
    MatPaginator,
    DataTableActionsComponent,
    MatFormField,
    MatLabel,
    SnakeCaseToNormalPipe,
    MatInputModule,
  ],
  providers: [
    {
      provide: SnakeCaseToNormalPipe,
    },
  ],
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.scss',
})
export class DataTableComponent implements OnInit, OnChanges, AfterViewInit {
  @ViewChild(MatPaginator, { static: false })
  set paginator(value: MatPaginator) {
    if (this.matData) {
      this.matData.paginator = value;
    }
  }
  @ViewChild(MatSort, { static: false })
  set sort(value: MatSort) {
    if (this.matData) {
      this.matData.sort = value;
    }
  }
  @Input() public isLoadingDeleteRow = false;
  @Input() public isLoadingData = false;
  @Input() public dataSource: DataSourceType<unknown>[] = [];
  @Input() public pageSizeOptions!: number[];
  @Input() public actions: DataTableActionType[] = [];
  @Output() public _handleAction = new EventEmitter<{
    id: number;
    action: string;
  }>();
  public matData = new MatTableDataSource(this.dataSource);
  private actionClicked = signal<string>('');
  public rowIdClicked = signal<number | undefined>(undefined);

  constructor() {}

  ngOnInit(): void {
    this.dataSource = this.dataSource.map((data: DataSourceType<unknown>) => ({
      ...data,
      actions: this.actions,
    }));
  }

  ngOnChanges(changes: SimpleChanges): void {
    console.log(changes);
    if (changes['dataSource'] && changes['dataSource'].currentValue) {
      this.dataSource = changes['dataSource'].currentValue.map(
        (data: DataSourceType<unknown>) => ({ ...data, actions: this.actions })
      );
      this.matData = new MatTableDataSource(this.dataSource);
    }
  }

  ngAfterViewInit(): void {
    this.matData.paginator = this.paginator;
    this.matData.sort = this.sort;
  }

  public getObjectKeys(obj: unknown): string[] {
    if (obj) {
      return Object.keys(obj);
    }
    return [];
  }

  public returnAsString(value: string | number | unknown): string {
    const isValidValue = typeof value === 'string' || typeof value === 'number';

    if (isValidValue) {
      return value.toString();
    } else {
      return '';
    }
  }

  public handleAction({ actionName }: { actionName: string }): void {
    console.log({ actionName });
    this.actionClicked.set(actionName);
  }

  public removeBrackets(value: string): string {
    return value.replace('{{', '').replace('}}', '');
  }

  public isObject(value: unknown): boolean {
    if (value && typeof value === 'object' && Object.keys(value).length > 0) {
      return true;
    }
    return false;
  }

  public handleRowClick(position: number) {
    this.rowIdClicked.set(position);
    this._handleAction.emit({ id: position, action: this.actionClicked() });

    // prevent action execution
    this.actionClicked.set('');
  }

  public handleSortData({
    active,
    direction,
  }: {
    active: string;
    direction: string;
  }): void {
    this.matData.data = this.dataSource.sort(
      (a: { [key: string]: unknown }, b: { [key: string]: unknown }) => {
        const activePropertyA = a[active] as string | number;
        const activePropertyB = b[active] as string | number;

        return this.compare(
          activePropertyA,
          activePropertyB,
          direction === 'asc'
        );
      }
    );
  }

  private compare(
    a: number | string,
    b: number | string,
    isAsc: boolean
  ): number {
    return (a < b ? -1 : 1) * (isAsc ? 1 : -1);
  }

  public applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.matData.filter = filterValue.trim().toLowerCase();

    if (this.matData.paginator) {
      this.matData.paginator.firstPage();
    }
  }
}
