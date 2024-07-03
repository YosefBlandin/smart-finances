import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

@Component({
  selector: 'app-card-item',
  standalone: true,
  imports: [MatProgressBarModule, MatIcon, MatFabButton],
  templateUrl: './card-item.component.html',
  styleUrl: './card-item.component.scss',
})
export class CardItemComponent {
  @Input({ alias: 'title', required: true }) title: string = '';
  @Input({ alias: 'date', required: false }) date: string | null = '';
  @Input({ alias: 'from_progress_text', required: true })
  from_progress_text: string = '';
  @Input({ alias: 'to_progress_text', required: true })
  to_progress_text: string = '';
  @Input({ alias: 'rate', required: false })
  rate: string | undefined = '';
  @Input({ alias: 'progress_percentage', required: false })
  progress_percentage: string = '';
  @Output() onNavigationClick = new EventEmitter();

  public _onNavigationClick() {
    this.onNavigationClick.emit();
  }
}
