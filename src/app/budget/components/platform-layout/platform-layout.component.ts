import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  Inject,
  PLATFORM_ID,
  ViewChild,
  signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatActionList, MatListItem } from '@angular/material/list';
import {
  MatDrawer,
  MatDrawerContainer,
  MatDrawerContent,
} from '@angular/material/sidenav';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LoginService } from '@auth/services/login/login.service';
import { fadeAnimation } from '@shared/animations/fade';
import { UserAvatarComponent } from '@shared/components/user-avatar/user-avatar.component';

@Component({
  selector: 'app-platform-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    MatIcon,
    MatDrawerContent,
    MatDrawerContainer,
    MatDrawer,
    MatButton,
    MatListItem,
    UserAvatarComponent,
    MatActionList,
    RouterLink,
    RouterLinkActive,
  ],
  animations: [fadeAnimation],
  templateUrl: './platform-layout.component.html',
  styleUrl: './platform-layout.component.scss',
})
export class PlatformLayoutComponent {
  @ViewChild('drawer') matDrawer!: MatDrawer;
  public options: any[] = [
    {
      label: 'Budgets',
      route: '/budget',
      icon: 'payments',
    },
    {
      label: 'Notifications',
      route: '/notifications',
      icon: 'notifications',
    },
    {
      label: 'Goals',
      route: '/goals',
      icon: 'military_tech',
    },
  ];

  public showDrawerButton = signal(true);

  constructor(
    @Inject(PLATFORM_ID) private platformId: string,
    private loginService: LoginService
  ) {}

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (window.innerWidth >= 1024) {
        this.matDrawer.open();
        this.showDrawerButton.set(false);
      }
    }
  }

  public handleLogout(): void {
    this.loginService.logout();
    console.log('logo');
  }
}
