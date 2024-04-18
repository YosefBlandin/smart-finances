# ABS - Administrador del Bus de Servicios

![Logo](https://code.kx.com/insights/1.2/microservices/img/microservice_icon.png)

## Autor

- Emsys Solutions

## Principales Tecnologías

![Angular](https://img.shields.io/badge/angular-%23DD0031.svg?style=for-the-badge&logo=angular&logoColor=white) ![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white) ![cypress](https://img.shields.io/badge/-cypress-%23E5E5E5?style=for-the-badge&logo=cypress&logoColor=058a5e) ![Jest](https://img.shields.io/badge/-jest-%23C21325?style=for-the-badge&logo=jest&logoColor=white) ![Nx](https://img.shields.io/badge/nx-143055?style=for-the-badge&logo=nx&logoColor=white)

## Licencia

El derecho a copiar, distribuir, modificar o hacer uso de este software de otro modo puede otorgarse bajo licencia únicamente de conformidad con los términos de un acuerdo de licencia de Emsys Solutions.

## Requisitos del Sistema

- Node: v20.11.0 LTS

## Instalación

En la carpeta raíz del proyecto ejecute los siguientes comandos:

```bash
  npm install
  npm install -g nx
```

[Documentación](https://angular.io/cli)

## Comandos

### Generales

- `npm run start`: Inicia un servidor web de desarrollo.
- `npm run build`: Ejecuta el compilado para produccion, y lo guarda en la carpeta "dist/".
- `npm run test`: Ejecuta las pruebas unitarias previamente creadas.

### Creando recursos

- `nx generate component "Nombre del componente en camelCase"`: Crea un angular component, es recomendable ejecutar el comando dentro de la carpeta components o pages del modulo correspondiente.
- `nx generate service "Nombre del servicio en camelCase"`: Crea un angular service, es recomendable ejecutar el comando dentro de la carpeta services del modulo correspondiente.
- `nx generate guard "Nombre del guardia en camelCase"`: Crea un angular guard, es recomendable ejecutar el comando dentro de la carpeta guards del modulo correspondiente.
- `nx generate interceptor "Nombre del interceptor en camelCase"`: Crea un angular interceptor, es recomendable ejecutar el comando dentro de la carpeta interceptors del modulo correspondiente.
- `nx generate directive "Nombre de la directiva en camelCase"`: Crea un angular directive, es recomendable ejecutar el comando dentro de la carpeta directives del modulo correspondiente.

### Creación de Módulos y Entidades

#### **1. Navegar al Directorio App:**

Abre tu terminal y navega al directorio `src/app` del proyecto.

```bash
cd src/app
```

#### **2. Crear Carpeta para el Nuevo Módulo:**

Dentro del directorio `src/app`, crea una nueva carpeta para la módulo que deseas agregar. Esta carpeta contendrá todos los archivos relacionados con tu módulo.

```bash
mkdir nombre-del-módulo
```

#### **3. Generar Archivo Barrel:**

Dentro de la carpeta de la funcionalidad, crea un archivo `index.ts`. Este archivo barrel debe exportar todos los componentes, servicios y otros elementos que desees exponer de este módulo. Por ejemplo:

```typescript
// src/app/nombre-del-módulo/index.ts

export * from './nombre.component';
export * from './nombre.service';
// Agrega otras exportaciones necesarias
```

#### **4. Crear Archivo de Rutas:**

Genera un archivo de rutas para tu funcionalidad siguiendo el patrón: `nombre-del-modulo.routes.ts`. Este archivo definirá las rutas específicas para tu módulo.

```typescript
// src/app/nombre-de-la-módulo/nombre-del-módulo.routes.ts

import { Routes } from '@angular/router';
import { NombreDelComponente } from './nombre-del-componente.component';

export const nombreDelMóduloRoutes: Routes = [
  { path: 'ruta-1', component: NombreDelComponente },
  // Agrega otras rutas necesarias
];
```

#### **5. Crear Carpetas Necesarias:**

Crea las siguientes carpetas si tu módulo las requiere: components, guards, layouts, pages, interceptors o directives.

```bash
cd nombre-del-módulo
mkdir guards layouts pages interceptors directives components
```

#### **6. Agregar Entidades:**

Si necesitas agregar entidades como servicios, navega a la carpeta relevante a la entidad dentro de tu módulo. Por ejemplo, para agregar un servicio de autenticación, ve a la carpeta services, crea la carpeta para el servicio (`auth`), entra en la carpeta y ejecuta el comando (en caso de estar creando un componente, no es necesario crear la carpeta, el comando la va a crear por defecto).

```
nx generate service Auth
```

    Este comando va a generar los archivos necesarios dentro de la carpeta.

#### **Nota Importante:**

Al momento de generar una entidad usando el CLI de nx, es posible que la siguiente pregunta aparezca:

> ```
> "Which generator would you like to use? …
> @nx/angular:entidad
> ▸ @schematics/angular:entidad
> None of the above"
> ```
>
> Debes seleccionar `@schematics/angular:entidad`. Si la siguiente pregunta es:
>
> ```
> "Where should the component be generated? …
> ▸ As provided: src/app/admin/services/entidad/nombre.entidad.ts
>   Derived:     src/app/entidad/entidad.sevice.ts"
> ```
>
> Debes seleccionar la primera opción (`As provided`).
