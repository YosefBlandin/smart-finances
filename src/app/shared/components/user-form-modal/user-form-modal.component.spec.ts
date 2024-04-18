import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserFormModalComponent } from './user-form-modal.component';

describe('ModalComponent', () => {
  let component: UserFormModalComponent;
  let fixture: ComponentFixture<UserFormModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserFormModalComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(UserFormModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
