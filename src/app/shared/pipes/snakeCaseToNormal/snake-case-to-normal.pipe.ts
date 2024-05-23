import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'snakeCaseToNormal',
  standalone: true,
})
export class SnakeCaseToNormalPipe implements PipeTransform {
  transform(value: unknown, ...args: unknown[]): string {
    const isString = typeof value === 'string';
    if (isString) {
      return value.replaceAll('_', ' ');
    }
    console.warn('SnakeCaseToNormalPipe: An empty string was provided');
    return '';
  }
}
