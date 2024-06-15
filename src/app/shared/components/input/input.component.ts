import {
  AfterViewInit,
  Component,
  Injector,
  Input,
  OnInit,
  ViewChild,
  signal,
} from '@angular/core';
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
import {
  MatDatepicker,
  MatDatepickerModule,
} from '@angular/material/datepicker';
import { MatInput, MatInputModule } from '@angular/material/input';
import {
  MatFormField,
  MatFormFieldAppearance,
  MatFormFieldModule,
} from '@angular/material/form-field';
import {
  ErrorStateMatcher,
  MatOption,
  MatOptionModule,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import {
  MatAutocomplete,
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';

export class MyErrorStateMatcher implements ErrorStateMatcher {
  control: FormControl;

  constructor(control: FormControl) {
    this.control = control;
  }

  isErrorState(): boolean {
    return !!(this.control && this.control.invalid && this.control.touched);
  }
}

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatIcon,
    MatOptionModule,
    MatAutocompleteModule,
    ReactiveFormsModule,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: InputComponent,
    },
    {
      provide: NG_VALIDATORS,
      multi: true,
      useExisting: InputComponent,
    },
    provideNativeDateAdapter(),
  ],
  templateUrl: './input.component.html',
  styleUrl: './input.component.scss',
})
export class InputComponent
  implements OnInit, AfterViewInit, ControlValueAccessor, Validator
{
  @ViewChild(MatDatepicker) matDatePicker!: MatDatepicker<any>;
  @ViewChild(MatInput) matInput!: MatInput;
  @ViewChild('auto') auto!: MatAutocomplete;
  @Input() public label = '';
  @Input() public containerClasses?: string;
  @Input() public autoComplete?: AutoFill;
  @Input() public autoCompleteOptions!: {
    label: string;
    value: string | number;
  }[];
  @Input() public type:
    | 'password'
    | 'email'
    | 'number'
    | 'text'
    | 'textarea'
    | 'date' = 'text';
  @Input() public tabIndex = '1';
  @Input() public placeholder = '';
  @Input() public minDate?: string;
  @Input() public maxDate?: string;
  @Input() public includeVisibilityEye?: boolean;
  @Input() public inputAppareance: MatFormFieldAppearance = 'outline';
  @Input() disabledCustom = false;
  public isVisible = signal(false);
  private onTouched!: (arg: unknown) => void;
  public onChange!: (arg: unknown) => void;
  public value = '';
  public disabled = false;
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

  ngAfterViewInit(): void {
    if (this.type === 'date') {
      this.matInput.focus = () => {
        return false;
      };
    }

    if (this.autoCompleteOptions) {
      this.formControl.valueChanges.subscribe((value) => {
        if (!value) {
          this.auto.options
            .find((matOption: MatOption) => matOption.selected)
            ?.deselect();
        }
      });
    }
  }

  public openCalendar() {
    this.matDatePicker.open();
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

  public setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  public onInput(event: Event): void {
    if (!this.disabledCustom) {
      const newValue = (event.target as HTMLInputElement).value;
      this.value = newValue;
      this.onChange(this.value);
      this.onTouched(true);
    }
  }

  public validate(): ValidationErrors | null {
    return null;
  }

  public toDate(str: string | undefined): string | Date {
    if (str && typeof str === 'string') {
      return new Date(str);
    } else {
      return '';
    }
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

  public onToggleVisibility(event: Event) {
    event.stopPropagation();
    this.isVisible.set(!this.isVisible());
  }
}
