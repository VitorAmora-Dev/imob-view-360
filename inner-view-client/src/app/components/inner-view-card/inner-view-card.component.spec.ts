import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { InnerViewCardComponent } from './inner-view-card.component';
import { Property } from '../../models/property.model';

describe('InnerViewCardComponent', () => {
  let component: InnerViewCardComponent;
  let fixture: ComponentFixture<InnerViewCardComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [InnerViewCardComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InnerViewCardComponent);
    component = fixture.componentInstance;
    component.item = {
      id: 'p1',
      code: 'IML-TEST',
      title: 'Casa de teste',
      type: 'HOUSE',
      purpose: 'SALE',
    } as Property;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
