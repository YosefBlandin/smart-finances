import { Component } from '@angular/core';
import { FormBuilder, FormControl, FormGroup } from '@angular/forms';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent {
  constructor(private formBuilder: FormBuilder) {}
  public BudgetForm = this.formBuilder.group({
    name: this.formBuilder.control('', []),
    amount: this.formBuilder.control('', []),
  });

  public addNewBudget() {}
}
