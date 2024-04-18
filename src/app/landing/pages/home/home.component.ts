import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { BrowserModule } from '@angular/platform-browser';
import { ButtonComponent } from '@shared/components';

@Component({
    selector: 'smart-finances-home',
    standalone: true,
    imports: [ButtonComponent, MatButton, CommonModule],
    templateUrl: './home.component.html',
    styleUrl: './home.component.css',
})
export class HomeComponent implements OnInit {
    public isContainerAnimation = false;
    public cardItems: any[] = [
        {
            title: 'Predictability',
            subtitle: 'Metrics about your savings perfomance',
            link: '',
            image: '../../../../assets/images/smart-finances.png',
        },
    ];

    public recommendations: any[] = [
        {
            name: 'Angel Rosendo',
            occupation: 'CEO, Filtration Advice Inc./ LPD Technologies',
            description:
                'Highly commendable as a team member, demonstrating exceptional proactivity and a strong sense of responsibility. Displays a proactive approach towards tasks and consistently takes initiative to contribute positively to team objectives.',
            profileImg: '../../../../assets/images/filtration-advice-img.jpeg',
            bgImg: '../../../../assets/images/filtration-advice-bg.jpeg',
        },
        {
            name: 'Dirk Ter Horst',
            occupation:
                'President and co-founder of Filtration Advice, President of Oterca Maquinarias, President LPD Technologies',
            description:
                'Yosef has worked on our software project very effectively. He has very good ideas, is a team player, executes taskes quickly and without making any noise. Yosef produces very good results!',
            profileImg: '../../../../assets/images/oterka-img.jpeg',
            bgImg: '../../../../assets/images/oterca-bg.jpg',
        },
        {
            name: 'Miguel Bastidas',
            occupation: 'CRO Developer (Adobe Target + Dynamic Yield)',
            description:
                "His dedication and professionalism were evident in the two key projects he contributed to, namely 'Nsur' and 'Snap'. Not only did Yosef consistently deliver his work punctually, but he also took the initiative to propose and execute performance enhancements for our websites. ",
            profileImg: '../../../../assets/images/nsur-img.jpeg',
            bgImg: '../../../../assets/images/nsur-bg.jpeg',
        },
    ];

    ngOnInit(): void {
        this.startCarousel();
    }

    private startCarousel() {
        setInterval(() => {
            // const leftElement = this.professionalProjects[0];
            // const centerElement = this.professionalProjects[1];
            // const rightElement = this.professionalProjects[2];
            // this.professionalProjects[0] = centerElement;
            // this.professionalProjects[1] = rightElement;
            // this.professionalProjects[2] = leftElement;
        }, 3000);
    }
}
