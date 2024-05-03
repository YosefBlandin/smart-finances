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
            id: 1,
            name: 'Emigration Plan',
            created_at: '2024/05/03',
            start_date: '2024/01/01',
            end_date: '2024/09/15',
            total_savings_goal: 5000,
            recurring_incomes: [
                {
                    id: 1,
                    name: 'Vest Selling',
                    amount: 100,
                    frequency: 1, // 1 = daily, 2 = weekly, 3 = monthly, 4 = annual
                    created_at: '2024/07/03',
                    start_date: '2024/07/03',
                    end_date: '',
                },
            ],
            recurring_expenses: [
                {
                    id: 1,
                    name: 'Internet Services',
                    amount: 40,
                    frequency: 3, // 1 = daily, 2 = weekly, 3 = monthly, 4 = annual
                    created_at: '2024/07/03',
                    start_date: '2024/07/03',
                    end_date: '',
                },
            ],
            additional_income: [
                {
                    id: 1,
                    name: 'Vest Selling',
                    amount: 100,
                    created_at: '2024/07/03',
                },
            ],
            additional_expenses: [
                {
                    id: 1,
                    name: 'Groceries',
                    amount: 300,
                    created_at: '2024/01/02',
                },
            ],
            total_income: 0,
            total_expenses: 0,
            net_income_saved: 0,
            amount_needed_to_save: 0,
        },
    ];
}
