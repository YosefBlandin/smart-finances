import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataTableActionsComponent } from './data-table-actions.component';

describe('DataTableActionsComponent', () => {
  let component: DataTableActionsComponent;
  let fixture: ComponentFixture<DataTableActionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataTableActionsComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(DataTableActionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
