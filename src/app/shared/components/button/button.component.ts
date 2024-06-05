import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'smart-button',
  standalone: true,
  imports: [],
  templateUrl: './button.component.html',
  styleUrl: './button.component.css',
})
export class ButtonComponent {
  @Input() isLoading = false;
  @Input() disabled = false;
  @Input() customClasses?: string;
  @Output() handleAction: EventEmitter<undefined> = new EventEmitter();

  public handleSubmit() {
    this.handleAction.emit();
  }
}
