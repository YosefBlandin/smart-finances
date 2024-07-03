import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BudgetCreationPageComponent } from './budget-creation-page.component';

describe('BudgetCreationPageComponent', () => {
  let component: BudgetCreationPageComponent;
  let fixture: ComponentFixture<BudgetCreationPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BudgetCreationPageComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(BudgetCreationPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
