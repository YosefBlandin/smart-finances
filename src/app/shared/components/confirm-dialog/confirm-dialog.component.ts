import { Component, Inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogContainer, MatDialogContent, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'smart-finances-confirm-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatDialogActions,
    MatDialogContainer,
    MatDialogContent,
    MatButton
  ],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.css'
})
export class ConfirmDialogComponent {
  public title!: string;
  public message!: string;
  public buttonText!: string;
  public secondaryButtonText!: string;

  constructor(public dialogRef: MatDialogRef<ConfirmDialogComponent>, @Inject(MAT_DIALOG_DATA) public data: { title: string, message: string, buttonText: string, secondaryButtonText: string }) {
    this.title = data.title
    this.message = data.message
    this.buttonText = data.buttonText
    this.secondaryButtonText = data.secondaryButtonText
  }

  public handleConfirm() {
    this.dialogRef.close(true)
  }

  public handleDismiss() {
    this.dialogRef.close(false)
  }
}
