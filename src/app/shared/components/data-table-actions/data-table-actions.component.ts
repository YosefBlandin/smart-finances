import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'smart-finances-data-table-actions-component',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './data-table-actions.component.html',
  styleUrl: './data-table-actions.component.css'
})
export class DataTableActionsComponent {
  @Input() public actions: { icon: string, actionName: string, disabled: boolean }[] = [];
  @Input() public elementIndex!: number;
  @Output() public _handleAction = new EventEmitter<{ actionName: string, elementIndex: number }>();

  public handleAction(actionName: string, elementIndex: number): void {
    this._handleAction.emit({ actionName, elementIndex });
  }
}
