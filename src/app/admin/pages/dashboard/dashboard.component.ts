import { Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
@Component({
    selector: 'smart-finances-dashboard',
    standalone: true,
    imports: [MatButton],
    providers: [],
    templateUrl: './dashboard.component.html',
    styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
    public budgets = [
        {
            name: 'Emigration Plan',
            created_at: '2024/05/03',
            start_date: '2024/01/01',
            end_date: '2024/09/15',
            total_savings_goal: 5000,
            recurring_income: 1000,
            recurring_expenses: 5000,
            additional_income: [],
            additional_expenses: [],
            total_income: 0,
            total_expenses: 0,
            net_income: 0,
            amount_needed_to_save: 0,
        },
    ];
}
