import { Component, Injector, Input, OnInit } from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  FormControlDirective,
  FormControlName,
  FormGroupDirective,
  FormsModule,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  NgControl,
  ReactiveFormsModule,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import {
  MatFormFieldAppearance,
  MatFormFieldModule,
} from '@angular/material/form-field';
import {
  ErrorStateMatcher,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { MyErrorStateMatcher } from '../input/input.component';
import { MatSelectModule } from '@angular/material/select';

@Component({
  selector: 'app-input-select',
  standalone: true,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: InputSelectComponent,
    },
    {
      provide: NG_VALIDATORS,
      multi: true,
      useExisting: InputSelectComponent,
    },
    provideNativeDateAdapter(),
  ],
  templateUrl: './input-select.component.html',
  styleUrl: './input-select.component.css',
})
export class InputSelectComponent
  implements OnInit, ControlValueAccessor, Validator
{
  @Input() public label = '';
  @Input() public containerClasses?: string;
  @Input() public tabIndex = '1';
  @Input() public placeholder = '';
  @Input() public options: { label: string; value: string | number }[] = [];
  @Input() public inputAppareance: MatFormFieldAppearance = 'outline';
  @Input() public disabledCustom = false;
  private onTouched!: (arg: unknown) => void;
  private onChange!: (arg: unknown) => void;
  public value = '';
  public errorStateMatcher!: ErrorStateMatcher;
  public formControl: FormControl = new FormControl();
  constructor(private injector: Injector) {}

  ngOnInit(): void {
    const ngControl = this.injector.get(NgControl);

    if (ngControl instanceof FormControlName) {
      this.formControl = this.injector
        .get(FormGroupDirective)
        .getControl(ngControl);
    } else {
      this.formControl = (ngControl as FormControlDirective)
        .form as FormControl;
    }

    this.errorStateMatcher = new MyErrorStateMatcher(this.formControl);
  }

  public writeValue(value: string): void {
    this.value = value;
  }

  public registerOnChange(fn: () => unknown): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => unknown): void {
    this.onTouched = fn;
  }

  public validate(): ValidationErrors | null {
    return null;
  }

  public getObjPropValue(
    obj: { [key: string]: string | number },
    index?: number
  ): string | number {
    const keys: string[] = Object.keys(obj);
    const keyToGet: string | number = keys[index ?? 0];

    if (keys.length > 0) {
      return obj[keyToGet];
    } else {
      return '';
    }
  }
}
