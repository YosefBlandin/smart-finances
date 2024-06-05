import { AfterContentInit, Component, OnInit, ViewChild } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { UserAvatarComponent } from '@shared/components';
import { IMenuOption } from '@core/interfaces/menu-options';
import { MenuOptionsService } from '../../services/menu-options/menu-options.service';
import { LoginService } from '@auth/services/login/login.service';

@Component({
  selector: 'smart-dashboard-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    MatSidenavModule,
    MatButtonModule,
    MatIconModule,
    RouterLink,
    UserAvatarComponent,
    MatSidenav,
  ],
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.css',
})
export class DashboardLayoutComponent implements OnInit, AfterContentInit {
  @ViewChild('sidenav', { static: true }) public sidenav!: MatSidenav;
  public isDesktop = false;
  public activeOptionTitle = '';
  public menuOptions: IMenuOption[] = [];

  constructor(
    private routerService: Router,
    private menuOptionsServices: MenuOptionsService,
    private loginService: LoginService
  ) {}

  ngOnInit(): void {
    if (this.menuOptions.length === 0) {
      this.menuOptions = this.menuOptionsServices.getAll();
      this.menuOptions.forEach((menuOption: IMenuOption) => {
        if (this.routerService.url.includes(menuOption.url)) {
          menuOption.active = true;
          this.activeOptionTitle = menuOption.name;
        }
      });
    }
  }

  ngAfterContentInit(): void {
    if (window.innerWidth > 768 && this.sidenav) {
      this.sidenav.toggle();
      this.isDesktop = true;
    }
  }

  public isRouteActive(route: string): boolean {
    return this.routerService.url.includes(route);
  }

  public handleOptionClick(option: {
    active: boolean;
    name: string;
    url: string;
    icon: string;
  }): void {
    this.activeOptionTitle = option.name;
    this.handleNavigate(option.url);
  }

  public handleNavigate(route: string): void {
    if (!this.isDesktop) {
      this.sidenav.toggle(false);
    }
    this.routerService.navigateByUrl(`admin/${route}`);
  }

  public toggleSidenav(event: MouseEvent, value?: boolean): void {
    event.stopPropagation();
    if (!this.isDesktop) {
      if (value === null) {
        this.sidenav.toggle();
      } else {
        this.sidenav.toggle(value);
      }
    }
  }

  public handleLogout(): void {
    this.loginService.logout();
    console.log('logo');
  }
}
