import { AbstractControl, ValidatorFn, Validators } from "@angular/forms";

export const customEmailValidator: ValidatorFn = (control: AbstractControl): { [key: string]: string } | null => {
  const email = control.value;
  const genericError = { email: "Ingrese un correo válido" };

  // FIRST VALIDATION LAYER
  const isEmailInvalid = Validators.email(control);

  if (isEmailInvalid) {
    return genericError;
  }

  // SECOND VALIDATION LAYER
  const domain = email.substring(email.lastIndexOf('@') + 1);
  const partsAfterAt = domain.split('.');

  if (
    partsAfterAt.length < 2 ||
    partsAfterAt.some((part: string | number[]) => part.length === 0)
  ) {
    return genericError;
  }

  return null;
};


