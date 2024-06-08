import { Injectable } from '@angular/core';
// import { IMenuOption } from '@core/interfaces/menu-options';

@Injectable({
  providedIn: 'root',
})
export class MenuOptionsService {
  public getAll(): any[] {
    return [
      {
        active: false,
        name: 'Inicio',
        url: 'dashboard',
        icon: 'home',
      },
      {
        active: false,
        name: 'Usuarios',
        url: 'users',
        icon: 'people',
      },
      {
        active: false,
        name: 'Servicios',
        url: 'services',
        icon: 'hub',
      },
      {
        active: false,
        name: 'Seguridad',
        url: 'security',
        icon: 'shield',
      },
      {
        active: false,
        name: 'Logs',
        url: 'logs',
        icon: 'info',
      },
    ];
  }
}
