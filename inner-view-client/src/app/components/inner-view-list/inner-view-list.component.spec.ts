import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { InnerViewListComponent } from './inner-view-list.component';

describe('InnerViewListComponent', () => {
  let component: InnerViewListComponent;
  let fixture: ComponentFixture<InnerViewListComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [InnerViewListComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(InnerViewListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
