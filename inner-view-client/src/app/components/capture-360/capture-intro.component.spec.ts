import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { CaptureIntroComponent } from './capture-intro.component';

describe('CaptureIntroComponent', () => {
  let fixture: ComponentFixture<CaptureIntroComponent>;
  let component: CaptureIntroComponent;
  let video: HTMLVideoElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CaptureIntroComponent],
      providers: [provideIonicAngular(), provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(CaptureIntroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    video = fixture.nativeElement.querySelector('video');
    spyOn(video, 'pause');
    spyOn(video, 'load');
  });

  it('deixa começar sem assistir e pausa o vídeo antes de solicitar a câmera', () => {
    const start = jasmine.createSpy('start').and.callFake(() => {
      expect(video.pause).toHaveBeenCalled();
    });
    component.startRequested.subscribe(start);
    component.begin();

    // A emissão precisa ocorrer no mesmo gesto, sem uma microtask intermediária.
    expect(start).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('starting', true);
    component.begin();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('reproduz por escolha do usuário e terminar o tutorial não abre a câmera', async () => {
    const start = jasmine.createSpy('start');
    component.startRequested.subscribe(start);
    spyOn(video, 'play').and.resolveTo();
    expect(video.autoplay).toBeFalse();
    expect(video.preload).toBe('none');

    component.playTutorial();
    await Promise.resolve();
    video.dispatchEvent(new Event('ended'));
    fixture.detectChanges();

    expect(video.play).toHaveBeenCalledTimes(1);
    expect(component.ended()).toBeTrue();
    expect(start).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.tutorial-play').getAttribute('aria-label'))
      .toBe('CAPTURE.TUTORIAL.REPLAY');
  });

  it('mantém instruções e a opção de começar quando o vídeo falha', () => {
    const start = jasmine.createSpy('start');
    component.startRequested.subscribe(start);
    video.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    const details: HTMLDetailsElement = fixture.nativeElement.querySelector('details');
    expect(details.open).toBeTrue();
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    expect(details.querySelectorAll('li').length).toBe(4);
    component.begin();
    expect(start).toHaveBeenCalled();
  });

  it('pausa antes de cancelar e libera a mídia ao fechar o modal', () => {
    const cancel = jasmine.createSpy('cancel').and.callFake(() => {
      expect(video.pause).toHaveBeenCalled();
    });
    component.cancelRequested.subscribe(cancel);
    component.dismiss();
    expect(cancel).toHaveBeenCalledTimes(1);

    fixture.destroy();
    expect(video.hasAttribute('src')).toBeFalse();
    expect(video.load).toHaveBeenCalled();
  });

  it('não mostra falha quando sair interrompe o carregamento do vídeo', async () => {
    spyOn(video, 'play').and.rejectWith(new DOMException('Playback interrupted', 'AbortError'));
    component.playTutorial();
    component.dismiss();
    await Promise.resolve();
    expect(component.videoFailed()).toBeFalse();
  });
});
