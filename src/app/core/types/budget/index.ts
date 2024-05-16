export interface IBudget {
    id: number;
    status: string;
    name: string;
    start_date: string;
    end_date: string;
    total_savings_goal: string;
    recurring_incomes: string[];
    recurring_expenses: string[];
    additional_income: string[];
    additional_expenses: string[];
    total_income: string;
    total_expenses: string;
    net_income: string;
    amount_needed_to_save: string;
    created_at: string;
    updated_at: string;
}
