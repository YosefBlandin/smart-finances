import { Component, OnInit, WritableSignal, signal } from '@angular/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LoginService } from '../../services/login/login.service';
import { ButtonComponent, InputComponent } from '@shared/components';
import { MatButton } from '@angular/material/button';

@Component({
  selector: 'smart-finances-login',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatButton,
    MatProgressSpinnerModule
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  constructor(
    private LoginService: LoginService,
    private router: Router
  ) { }

  public isLoading: WritableSignal<boolean> = signal(false);
  public loginForm: FormGroup<{
    username: FormControl<string>;
    password: FormControl<string>;
  }> = new FormGroup({
    username: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(40)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.maxLength(15)
      ],
    }),
  });
  public isFormValid = false;
  public errorMessage: string | null = null;

  ngOnInit(): void {
    this.loginForm.statusChanges.subscribe((status: string) => {
      this.isFormValid = status === 'VALID';
    });
  }

  public handleLogin(): void {
    this.isLoading.set(true);
    this.LoginService.login(this.loginForm.getRawValue()).subscribe({
      next: this.handleLoginResponse.bind(this),
      error: this.handleLoginError.bind(this),
    });
  }

  private handleLoginResponse(response: string | number): void {
    console.log(response)

    this.router.navigate(['admin/dashboard']);

  }

  private handleLoginError(error: HttpErrorResponse): void {
    this.errorMessage = error.message[0];
    this.isLoading.set(false);
  }

  public handleGoRegister(): void {
    this.router.navigateByUrl('/auth/register');
  }
}
