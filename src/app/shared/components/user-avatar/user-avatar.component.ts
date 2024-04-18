import { Component, EventEmitter, Output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
@Component({
  selector: 'smart-finances-user-avatar-component',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './user-avatar.component.html',
  styleUrl: './user-avatar.component.css'
})
export class UserAvatarComponent {
  public showMenu = false;
  @Output() private handleLogout: EventEmitter<null> = new EventEmitter();
  @Output() private handleNavigate: EventEmitter<string> = new EventEmitter();

  public handleToggleMenu(): void {
    this.showMenu = !this.showMenu;
  }

  public hiddeMenu(): void {
    setTimeout(() => {
      this.showMenu = false
    }, 100)
  }

  public _handleLogout(): void {
    this.handleLogout.emit();
  }

  public _handleNavigate(route: string): void {
    this.handleNavigate.emit(route)
  }
}
