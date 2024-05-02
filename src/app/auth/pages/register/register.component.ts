import { HttpErrorResponse } from '@angular/common/http';
import { Component, WritableSignal, signal } from '@angular/core';
import {
    FormControl,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { LoginService } from '@auth/services/login/login.service';
import { ButtonComponent, InputComponent } from '@shared/components';

@Component({
    selector: 'smart-finances-register',
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
        MatProgressSpinnerModule,
        MatIcon,
    ],
    providers: [provideNativeDateAdapter()],
    templateUrl: './register.component.html',
    styleUrl: './register.component.css',
})
export class RegisterComponent {
    constructor(private LoginService: LoginService, private router: Router) {}

    public isLoading: WritableSignal<boolean> = signal(false);
    public loginForm: FormGroup<{
        email: FormControl<string>;
        password: FormControl<string>;
    }> = new FormGroup({
        email: new FormControl('', {
            nonNullable: true,
            validators: [Validators.required, Validators.maxLength(40)],
        }),
        password: new FormControl('', {
            nonNullable: true,
            validators: [Validators.required, Validators.maxLength(15)],
        }),
    });
    public isFormValid = false;
    public errorMessage: string | null = null;

    ngOnInit(): void {
        this.loginForm.statusChanges.subscribe((status: string) => {
            this.isFormValid = status === 'VALID';
        });
    }

    ngOnDestroy() {}

    public handleLogin(): void {
        this.isLoading.set(true);
        this.LoginService.login(this.loginForm.getRawValue()).subscribe({
            next: this.handleLoginResponse.bind(this),
            error: this.handleLoginError.bind(this),
        });
    }

    private handleLoginResponse(response: string | number): void {
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
