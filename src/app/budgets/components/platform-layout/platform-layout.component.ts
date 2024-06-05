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
import { RouterOutlet } from '@angular/router';

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
    MatActionList,
  ],
  templateUrl: './platform-layout.component.html',
  styleUrl: './platform-layout.component.scss',
})
export class PlatformLayoutComponent implements AfterViewInit {
  @ViewChild('drawer') matDrawer!: MatDrawer;
  public options: any[] = [
    {
      label: 'Home',
      route: '',
      icon: 'home',
    },
    {
      label: 'Notifications',
      route: '',
      icon: 'notifications',
    },
    {
      label: 'Goals',
      route: '',
      icon: 'military_tech',
    },
  ];

  public showDrawerButton = signal(true);

  constructor(@Inject(PLATFORM_ID) private platformId: string) {}

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (window.innerWidth >= 1024) {
        this.matDrawer.open();
        this.showDrawerButton.set(false);
      }
    }
  }
}