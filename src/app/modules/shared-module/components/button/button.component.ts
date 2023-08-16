import { Component, Input, OnInit } from '@angular/core';

@Component({
	selector: 'app-button',
	templateUrl: './button.component.html',
	styleUrls: ['./button.component.css']
})
export class ButtonComponent implements OnInit {
	@Input() buttonClass:
		"primary" | "secondary" | "danger" = 'primary'
	@Input() disabled: boolean = false
	@Input() type: string = "button"
	@Input() isLoading: boolean = false
	@Input() spinnerColor: "black" | "white" = "black"

	constructor() { }

	ngOnInit(): void {
	}

}
