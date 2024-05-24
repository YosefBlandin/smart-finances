import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlatformLayoutComponent } from './platform-layout.component';

describe('PlatformLayoutComponent', () => {
  let component: PlatformLayoutComponent;
  let fixture: ComponentFixture<PlatformLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlatformLayoutComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(PlatformLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
