import {
    Component,
    Inject,
    OnDestroy,
    OnInit,
    WritableSignal,
    inject,
    signal,
} from '@angular/core';
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
import { MatIcon } from '@angular/material/icon';
import {
    Auth,
    User,
    user,
    authState,
    createUserWithEmailAndPassword,
} from '@angular/fire/auth';
import { Subscription } from 'rxjs';
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
        MatProgressSpinnerModule,
        MatIcon,
    ],
    providers: [provideNativeDateAdapter()],
    templateUrl: './login.component.html',
    styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit, OnDestroy {
    constructor(private LoginService: LoginService, private router: Router) {}
    private userSubscription!: Subscription;

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
        console.log(error.message);
        this.errorMessage = this.handleErrorMessage(error.message);
        this.isLoading.set(false);
    }

    private handleErrorMessage(errorMessage: string): string {
        const isString =
            typeof errorMessage === 'string' && errorMessage.length > 0;
        const isInvalidEmail =
            isString && errorMessage.includes('invalid-email');
        const isInvalidCredential =
            isString && errorMessage.includes('invalid-credential');

        if (isInvalidEmail) {
            return 'Invalid email';
        } else if (isInvalidCredential) {
            return 'Invalid email or password';
        }

        return 'Something went wrong!';
    }

    public handleGoRegister(): void {
        this.router.navigateByUrl('/auth/register');
    }
}
