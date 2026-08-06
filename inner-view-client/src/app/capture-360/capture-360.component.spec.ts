import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { Capture360Component } from './capture-360.component';

describe('Capture360Component', () => {
  let fixture: ComponentFixture<Capture360Component>;
  let stopSpy: jasmine.Spy;

  beforeEach(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
    const fakeStream = canvas.captureStream(0);
    const track = fakeStream.getVideoTracks()[0];
    stopSpy = spyOn(track, 'stop').and.callThrough();

    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(fakeStream);
    spyOn(navigator.mediaDevices, 'enumerateDevices').and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [Capture360Component],
      providers: [provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(Capture360Component);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 120));
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('tem um plano de 18 passos e começa no primeiro (upper:0)', () => {
    const c = fixture.componentInstance;
    expect(c.plan.length).toBe(18);
    expect(c.totalSteps).toBe(18);
    expect(c.capturedCount).toBe(0);
    expect(c.currentStep.key).toBe('upper:0');
    expect(c.isComplete).toBeFalse();
  });

  it('expõe a instrução e a seta do passo atual', () => {
    const c = fixture.componentInstance;
    expect(c.currentStep.instructionKey).toContain('TILT_UP');
    expect(c.arrowIcon).toBe('arrow-up-outline');
  });

  it('redoLast não faz nada sem capturas', () => {
    const c = fixture.componentInstance;
    c.redoLast();
    expect(c.capturedCount).toBe(0);
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
