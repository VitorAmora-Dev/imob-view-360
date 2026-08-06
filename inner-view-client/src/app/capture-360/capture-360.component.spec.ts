import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { Capture360Component } from './capture-360.component';

describe('Capture360Component', () => {
  let fixture: ComponentFixture<Capture360Component>;
  let stopSpy: jasmine.Spy;

  beforeEach(async () => {
    // Stream falso a partir de um canvas — sem tocar em karma.conf nem exigir câmera.
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
    const fakeStream = canvas.captureStream(10);
    const track = fakeStream.getVideoTracks()[0];
    stopSpy = spyOn(track, 'stop').and.callThrough();

    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(fakeStream);
    spyOn(navigator.mediaDevices, 'enumerateDevices').and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [Capture360Component],
      providers: [provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(Capture360Component);
    fixture.detectChanges(); // dispara ngAfterViewInit → initCamera
    await new Promise((resolve) => setTimeout(resolve, 120)); // deixa o init assíncrono terminar
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('começa na faixa superior, foto 1, sem tiles', () => {
    const c = fixture.componentInstance;
    expect(c.band).toBe('upper');
    expect(c.indexInBand).toBe(0);
    expect(c.tiles.length).toBe(0);
    expect(c.isComplete).toBeFalse();
  });

  it('para as tracks da câmera ao ser destruído', () => {
    fixture.destroy();
    expect(stopSpy).toHaveBeenCalled();
  });

  it('emite cancelled direto no fechar quando não há capturas', () => {
    const c = fixture.componentInstance;
    const emitted = jasmine.createSpy('cancelled');
    c.cancelled.subscribe(emitted);
    void c.onClose();
    expect(emitted).toHaveBeenCalled();
  });
});
