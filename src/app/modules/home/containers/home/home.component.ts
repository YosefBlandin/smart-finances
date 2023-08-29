import { Component, OnInit } from '@angular/core';

@Component({
	selector: 'app-home',
	templateUrl: './home.component.html',
	styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
	public technologies: {
		name: string
		src: string
	}[] = []

	constructor() { }

	ngOnInit(): void {
		this.initImgs()
	}

	private initImgs(): void {
		this.technologies = [
			{
				name: 'Angular',
				src: "../../../../../assets/svg/angular_logo.png"
			},
			{
				name: 'RxJS',
				src: "../../../../../assets/svg/rxjs.svg"
			},
			{
				name: 'Nest',
				src: "../../../../../assets/svg/nestjs.svg"
			},
		]
	}

}
