import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { fadeAnimation } from '@shared/animations/fade';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  animations: [fadeAnimation],
})
export class AppComponent {
  title = 'smart';

  constructor() {}

  ngOnInit() {}
}
