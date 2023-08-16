import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from './components/button/button.component';
import { LoadingSpinnerComponent } from './components/loading-spinner/loading-spinner.component';



@NgModule({
	declarations: [
		ButtonComponent,
		LoadingSpinnerComponent
	],
	imports: [
		CommonModule
	],
	exports: [
		ButtonComponent,
		LoadingSpinnerComponent
	]
})
export class SharedModule { }
