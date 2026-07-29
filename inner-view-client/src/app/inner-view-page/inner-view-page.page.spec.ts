import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InnerViewPagePage } from './inner-view-page.page';

describe('InnerViewPagePage', () => {
  let component: InnerViewPagePage;
  let fixture: ComponentFixture<InnerViewPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(InnerViewPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
