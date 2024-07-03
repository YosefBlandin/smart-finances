import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BudgetsPageComponent } from './budget-list-page.component';

describe('BudgetsPageComponent', () => {
  let component: BudgetsPageComponent;
  let fixture: ComponentFixture<BudgetsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BudgetsPageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BudgetsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
