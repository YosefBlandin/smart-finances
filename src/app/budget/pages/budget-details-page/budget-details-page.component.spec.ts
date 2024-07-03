import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BudgetDetailsPageComponent } from './budget-details-page.component';

describe('BudgetDetailsPageComponent', () => {
  let component: BudgetDetailsPageComponent;
  let fixture: ComponentFixture<BudgetDetailsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BudgetDetailsPageComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(BudgetDetailsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
