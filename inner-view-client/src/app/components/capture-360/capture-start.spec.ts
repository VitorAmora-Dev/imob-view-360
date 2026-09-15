import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ModalController } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { Quaternion } from 'three';
import { Capture360Component } from './capture-360.component';
import { RealCameraSource, RealOrientationSource } from './capture-sources';

describe('Capture360Component — abertura da câmera', () => {
  let fixture: ComponentFixture<Capture360Component>;
  let component: Capture360Component;
  let modal: jasmine.SpyObj<ModalController>;
  let permission: jasmine.Spy;
  let cameraStart: jasmine.Spy;
  let cameraAttach: jasmine.Spy;
  let sensorStart: jasmine.Spy;

  beforeEach(() => {
    modal = jasmine.createSpyObj<ModalController>('ModalController', ['dismiss']);
    TestBed.configureTestingModule({
      imports: [Capture360Component],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        { provide: ModalController, useValue: modal },
      ],
    });
    permission = spyOn(RealOrientationSource.prototype, 'requestPermission');
    cameraStart = spyOn(RealCameraSource.prototype, 'start');
    cameraAttach = spyOn(RealCameraSource.prototype, 'attach');
    sensorStart = spyOn(RealOrientationSource.prototype, 'start');
    spyOn(RealOrientationSource.prototype, 'rezero');
    fixture = TestBed.createComponent(Capture360Component);
    component = fixture.componentInstance;
  });

  it('pede permissão ainda no gesto do botão e ignora o segundo toque', async () => {
    let answer!: (allowed: boolean) => void;
    permission.and.returnValue(new Promise<boolean>((resolve) => { answer = resolve; }));

    const first = component.begin();
    const second = component.begin();

    // Antes de qualquer microtask: mover a permissão depois de um await
    // perderia o gesto exigido pelo giroscópio no iOS.
    expect(permission).toHaveBeenCalledTimes(1);
    expect(component.starting()).toBeTrue();
    expect(cameraStart).not.toHaveBeenCalled();

    answer(false);
    await Promise.all([first, second]);
    expect(component.starting()).toBeFalse();
    expect(component.errorKey()).toBe('CAPTURE.SENSOR_ERROR');
  });

  it('cancelar durante a permissão impede que a câmera seja aberta depois', async () => {
    let answer!: (allowed: boolean) => void;
    permission.and.returnValue(new Promise<boolean>((resolve) => { answer = resolve; }));

    const opening = component.begin();
    component.cancel();
    answer(true);
    await opening;

    expect(modal.dismiss).toHaveBeenCalledWith(null, 'cancel');
    expect(cameraStart).not.toHaveBeenCalled();
    expect(component.starting()).toBeFalse();
    expect(component.state()).toBe('intro');
  });

  for (const exit of ['cancelar', 'destruir'] as const) {
    it(`encerra um stream que chega depois de ${exit} o modal`, async () => {
      const stopTrack = jasmine.createSpy('stop track');
      let finishCamera!: () => void;
      permission.and.resolveTo(true);
      cameraStart.and.callFake(function (this: RealCameraSource): Promise<void> {
        return new Promise<void>((resolve) => {
          finishCamera = () => {
            // A resposta tardia de getUserMedia cria um recurso DEPOIS do
            // teardown. Testar a track garante que esse recurso é liberado.
            this['stream'] = {
              getTracks: () => [{ stop: stopTrack }],
            } as unknown as MediaStream;
            resolve();
          };
        });
      });

      const opening = component.begin();
      await Promise.resolve();
      expect(cameraStart).toHaveBeenCalledTimes(1);

      if (exit === 'cancelar') component.cancel();
      else fixture.destroy();
      finishCamera();
      await opening;

      expect(stopTrack).toHaveBeenCalledTimes(1);
      expect(sensorStart).not.toHaveBeenCalled();
      expect(cameraAttach).not.toHaveBeenCalled();
      expect(component.starting()).toBeFalse();
      expect(component.state()).toBe('intro');
    });
  }

  it('não mostra erro tardio se a abertura rejeitar após sair', async () => {
    let rejectCamera!: (reason: Error) => void;
    permission.and.resolveTo(true);
    cameraStart.and.returnValue(new Promise<void>((_resolve, reject) => {
      rejectCamera = reject;
    }));

    const opening = component.begin();
    await Promise.resolve();
    component.cancel();
    rejectCamera(new Error('permission denied'));
    await opening;

    expect(component.state()).toBe('intro');
    expect(cameraAttach).not.toHaveBeenCalled();
  });

  it('encerra a espera do sensor quando o usuário cancela', fakeAsync(() => {
    permission.and.resolveTo(true);
    cameraStart.and.resolveTo(undefined);
    const stopCamera = spyOn(RealCameraSource.prototype, 'stop');
    spyOn(RealOrientationSource.prototype, 'sample').and.returnValue(null);

    void component.begin();
    flushMicrotasks();
    expect(sensorStart).toHaveBeenCalledTimes(1);

    component.cancel();
    tick(50);

    expect(stopCamera).toHaveBeenCalled();
    expect(cameraAttach).not.toHaveBeenCalled();
    expect(component.state()).toBe('intro');
    expect(component.starting()).toBeFalse();
  }));

  it('entra na captura quando câmera e sensor estão prontos', fakeAsync(() => {
    permission.and.resolveTo(true);
    cameraStart.and.resolveTo(undefined);
    spyOn(RealOrientationSource.prototype, 'sample').and.returnValue({
      q: new Quaternion(),
      ypr: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    });
    const startLoop = spyOn(component as unknown as { startLoop(): void }, 'startLoop');

    void component.begin();
    flushMicrotasks();
    fixture.detectChanges();
    tick();

    expect(component.state()).toBe('capturing');
    expect(component.starting()).toBeFalse();
    expect(cameraAttach).toHaveBeenCalledWith(component.previewContainer!.nativeElement);
    expect(startLoop).toHaveBeenCalledTimes(1);
  }));
});
