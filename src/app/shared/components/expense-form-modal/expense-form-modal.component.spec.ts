import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExpenseFormModalComponent } from './expense-form-modal.component';

describe('ModalComponent', () => {
  let component: ExpenseFormModalComponent;
  let fixture: ComponentFixture<ExpenseFormModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpenseFormModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ExpenseFormModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
