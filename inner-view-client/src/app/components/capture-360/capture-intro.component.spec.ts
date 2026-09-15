import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { CaptureIntroComponent } from './capture-intro.component';

describe('CaptureIntroComponent', () => {
  let fixture: ComponentFixture<CaptureIntroComponent>;
  let component: CaptureIntroComponent;
  let video: HTMLVideoElement;
  let playVideo: jasmine.Spy;
  let pauseVideo: jasmine.Spy;
  let loadVideo: jasmine.Spy;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CaptureIntroComponent],
      providers: [provideIonicAngular(), provideTranslateService()],
    }).compileComponents();
    playVideo = spyOn(HTMLMediaElement.prototype, 'play').and.resolveTo();
    pauseVideo = spyOn(HTMLMediaElement.prototype, 'pause');
    loadVideo = spyOn(HTMLMediaElement.prototype, 'load');
    fixture = TestBed.createComponent(CaptureIntroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    video = fixture.nativeElement.querySelector('video');
    await Promise.resolve();
    fixture.detectChanges();
  });

  it('inicia automaticamente, sem áudio e dentro da página', () => {
    expect(component.autoplayEnabled).toBeTrue();
    expect(video.autoplay).toBeTrue();
    expect(video.muted).toBeTrue();
    expect(video.playsInline).toBeTrue();
    expect(video.preload).toBe('auto');
    expect(video.controls).toBeFalse();
    expect(playVideo).toHaveBeenCalledTimes(1);
    expect(component.playRequired()).toBeFalse();
  });

  it('pausa e continua ao tocar no vídeo sem exibir controles nativos', () => {
    spyOnProperty(video, 'paused', 'get').and.returnValues(false, true);

    video.click();
    fixture.detectChanges();
    expect(pauseVideo).toHaveBeenCalled();
    expect(component.playRequired()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.tutorial-play')).not.toBeNull();

    component.toggleTutorialPlayback();
    expect(playVideo).toHaveBeenCalledTimes(2);
  });

  it('oferece a mesma pausa pelo teclado', () => {
    spyOnProperty(video, 'paused', 'get').and.returnValue(false);
    const event = new KeyboardEvent('keydown', { key: ' ' });
    spyOn(event, 'preventDefault');

    component.onTutorialKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(pauseVideo).toHaveBeenCalled();
    expect(component.playRequired()).toBeTrue();
  });

  it('deixa começar sem assistir e pausa o vídeo antes de solicitar a câmera', () => {
    const start = jasmine.createSpy('start').and.callFake(() => {
      expect(pauseVideo).toHaveBeenCalled();
    });
    component.startRequested.subscribe(start);
    component.begin();

    // A emissão precisa ocorrer no mesmo gesto, sem uma microtask intermediária.
    expect(start).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('starting', true);
    component.begin();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('terminar o tutorial oferece replay sem abrir a câmera', () => {
    const start = jasmine.createSpy('start');
    component.startRequested.subscribe(start);

    video.dispatchEvent(new Event('ended'));
    fixture.detectChanges();

    expect(component.ended()).toBeTrue();
    expect(start).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.tutorial-play').getAttribute('aria-label'))
      .toBe('CAPTURE.TUTORIAL.REPLAY');
  });

  it('mantém o botão de play quando o navegador bloqueia o autoplay', async () => {
    playVideo.and.rejectWith(new DOMException('Autoplay blocked', 'NotAllowedError'));
    component.playTutorial();
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.videoFailed()).toBeFalse();
    expect(component.playRequired()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.tutorial-play')).not.toBeNull();
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
      expect(pauseVideo).toHaveBeenCalled();
    });
    component.cancelRequested.subscribe(cancel);
    component.dismiss();
    expect(cancel).toHaveBeenCalledTimes(1);

    fixture.destroy();
    expect(video.hasAttribute('src')).toBeFalse();
    expect(loadVideo).toHaveBeenCalled();
  });

  it('não mostra falha quando sair interrompe o carregamento do vídeo', async () => {
    playVideo.and.rejectWith(new DOMException('Playback interrupted', 'AbortError'));
    component.playTutorial();
    component.dismiss();
    await Promise.resolve();
    expect(component.videoFailed()).toBeFalse();
  });
});
