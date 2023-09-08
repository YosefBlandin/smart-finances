import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserDashboardComponent } from './containers/user-dashboard/user-dashboard.component';
import { DashboardRoutingModule } from './dashboard-routing.module'


@NgModule({
	declarations: [
		UserDashboardComponent
	],
	imports: [
		CommonModule,
		DashboardRoutingModule
	]
})
export class DashboardModule { }
