import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
	{
		path: "dashboard",
		loadChildren: () => import("./modules/dashboard/dashboard.module")
			.then((module) => module.DashboardModule)
	},
	{
		path: "home",
		loadChildren: () => import("./modules/home/home.module")
			.then((module) => module.HomeModule)
	},
	{
		path: "**",
		pathMatch: "prefix",
		redirectTo: "home"
	},
];

@NgModule({
	imports: [RouterModule.forRoot(routes)],
	exports: [RouterModule]
})
export class AppRoutingModule { }
