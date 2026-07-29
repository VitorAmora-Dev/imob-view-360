import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { InnerViewCardComponent } from './inner-view-card.component';

describe('InnerViewCardComponent', () => {
  let component: InnerViewCardComponent;
  let fixture: ComponentFixture<InnerViewCardComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [InnerViewCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(InnerViewCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
